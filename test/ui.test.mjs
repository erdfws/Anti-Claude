/**
 * DOM behaviour tests for user/custom.js (jsdom). Skipped automatically when jsdom is not installed:
 *   npm i --no-save jsdom && node --test test/
 * or point JSDOM_FROM at any package.json whose node_modules contains jsdom.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let JSDOM = null;
try {
  JSDOM = createRequire(process.env.JSDOM_FROM || import.meta.url)('jsdom').JSDOM;
} catch {}
const skip = JSDOM ? false : 'jsdom not installed';

const SRC = fs
  .readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8')
  .replace(/\}\)\(\);\s*$/, 'window.__t = { scheduleSync, syncStepStream, dispose }; })();');

function mount(html, { modules = {} } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, {
    runScripts: 'outside-only',
    url: 'http://127.0.0.1/c/abcd-1234',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const queue = new Map();
  let nextId = 1;
  window.requestAnimationFrame = (cb) => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => queue.delete(id);
  const cleanups = [];
  window.ctx = { modules, onCleanup: (fn) => cleanups.push(fn) };
  window.eval(SRC);
  const flushFrames = () => {
    for (let i = 0; i < 10 && queue.size; i++) {
      const cbs = [...queue.values()];
      queue.clear();
      cbs.forEach((cb) => cb(0));
    }
  };
  const microtasks = () => new Promise((r) => setTimeout(r, 0));
  return { window, doc: window.document, queue, cleanups, flushFrames, microtasks, close: () => window.close() };
}

const li = (text, status = 'pending') =>
  status === 'completed'
    ? `<li class="task-list-item task-checked"><div></div><span class="task-checked-content">${text}</span></li>`
    : `<li class="task-list-item"><div class="${status === 'in_progress' ? 'bg-primary' : ''}"></div>${text}</li>`;
const ul = (...items) => `<ul class="contains-task-list">${items.join('')}</ul>`;
const pane = (turns, { generating = false } = {}) =>
  `<section>${turns.map((t) => `<div data-testid="agent-response">${t}</div>`).join('')}<div id="antigravity.agentSidePanelInputBox">${
    generating ? '<button data-testid="input-cancel-button"></button>' : ''
  }</div></section>`;

test('ordinary answer checklist stays native and visible', { skip }, () => {
  const h = mount(pane([ul(li('身份证复印件'), li('合同原件'))]));
  const list = h.doc.querySelector('ul');
  assert.equal(list.hasAttribute('data-ag-todo-merged'), false);
  assert.equal(list.hasAttribute('data-ag-todo-primary'), false);
  assert.equal(h.doc.querySelectorAll('.ag-claude-todo-card').length, 0);
  h.close();
});

test('ordinary checklist with some items ticked is also left alone', { skip }, () => {
  const h = mount(pane([ul(li('营业执照', 'completed'), li('授权委托书'), li('身份证明'))]));
  assert.equal(h.doc.querySelectorAll('.ag-claude-todo-card').length, 0);
  assert.equal(h.doc.querySelector('ul').attributes.length, 1);
  h.close();
});

test('interrupted execution checklist keeps a visible paused card', { skip }, () => {
  const h = mount(pane([ul(li('读代码', 'completed'), li('修复 bug', 'in_progress'), li('跑测试'))]));
  const list = h.doc.querySelector('ul');
  assert.equal(list.getAttribute('data-ag-todo-primary'), 'true');
  const card = list.nextElementSibling;
  assert.ok(card && card.classList.contains('ag-claude-todo-card'));
  assert.equal(card.getAttribute('data-ag-todo-paused'), 'true');
  assert.equal(card.querySelectorAll('.ag-claude-todo-row').length, 3);
  h.close();
});

test('cross-turn progress merges into one card; ordinary list in a later turn is untouched', { skip }, () => {
  const h = mount(
    pane([
      ul(li('阶段一 读代码', 'in_progress'), li('阶段二 修复'), li('阶段三 测试')),
      ul(li('阶段一 读代码', 'completed'), li('阶段二 修复', 'completed'), li('阶段三 测试', 'completed')),
      ul(li('身份证复印件'), li('合同原件'))
    ])
  );
  const lists = h.doc.querySelectorAll('ul');
  assert.equal(lists[0].getAttribute('data-ag-todo-merged'), 'true');
  assert.equal(lists[1].getAttribute('data-ag-todo-primary'), 'true');
  assert.equal(lists[1].nextElementSibling.hasAttribute('data-ag-todo-paused'), false);
  assert.equal(lists[2].hasAttribute('data-ag-todo-merged'), false);
  assert.equal(h.doc.querySelectorAll('.ag-claude-todo-card').length, 1);
  h.close();
});

test('live execution checklist docks above the composer', { skip }, () => {
  const h = mount(pane([ul(li('读代码', 'in_progress'), li('修复'))], { generating: true }));
  const dock = h.doc.querySelector('[data-ag-todo-dock]');
  assert.ok(dock);
  assert.equal(dock.nextElementSibling.id, 'antigravity.agentSidePanelInputBox');
  h.close();
});

test('dispose cancels queued frames: no marker is resurrected', { skip }, async () => {
  const h = mount(pane([ul(li('读代码', 'in_progress'), li('修复'))]));
  h.doc.querySelector('section').appendChild(h.doc.createElement('p')); /* trigger a mutation -> scheduled sync */
  await h.microtasks();
  h.window.__t.scheduleSync();
  h.cleanups.forEach((fn) => fn());
  assert.equal(h.doc.querySelector('ul').hasAttribute('data-ag-todo-primary'), false);
  h.flushFrames();
  await new Promise((r) => setTimeout(r, 120)); /* any throttled timeout would have fired by now */
  h.flushFrames();
  assert.equal(h.doc.querySelector('ul').hasAttribute('data-ag-todo-primary'), false);
  assert.equal(h.doc.querySelectorAll('.ag-claude-todo-card').length, 0);
  h.close();
});

test('own DOM writes do not schedule another sync (no self-trigger loop)', { skip }, async () => {
  const h = mount(pane([ul(li('读代码', 'in_progress'), li('修复'))], { generating: true }));
  await h.microtasks();
  await h.microtasks();
  assert.equal(h.queue.size, 0, 'card/dock insertion must not re-trigger syncStepStream');
  h.close();
});

test('running timer lights only the generating pane', { skip }, async () => {
  const row = (label) => `<button data-testid="tool-group-collapsible" aria-expanded="false"><span title="${label}">${label}</span><svg></svg></button>`;
  const h = mount(
    `<div>${pane([row('Running command')], { generating: true })}${pane([row('Running command')], { generating: false })}</div>`
  );
  const [a, b] = h.doc.querySelectorAll('button[data-testid="tool-group-collapsible"]');
  assert.ok(a.querySelector('.ag-orbit-dots'), 'generating pane shows the indicator');
  assert.equal(b.querySelector('.ag-orbit-dots'), null, 'idle pane must stay clean');
  h.cleanups.forEach((fn) => fn());
  h.close();
});

function modelTrigger(h) {
  const btn = h.doc.createElement('button');
  btn.setAttribute('data-testid', 'model-selector-trigger');
  btn.textContent = 'Gemini';
  let selected = { label: 'Gemini 4 Carbon (Medium)', value: 'c-m' };
  btn.__reactFiber$test = {
    memoizedProps: {
      modelOptions: [
        { label: 'Gemini 4 Carbon (Medium)', value: 'c-m' },
        { label: 'Gemini 4 Carbon (High)', value: 'c-h' },
        { label: 'Gemini 3.8 Flash', value: 'f' }
      ],
      get selectedModel() {
        return selected;
      },
      setSelectedModel(o) {
        selected = o;
      }
    }
  };
  h.doc.body.appendChild(btn);
  return { btn, selected: () => selected };
}

test('keyboard activation (click detail=0) opens the custom menu', { skip }, () => {
  const h = mount('');
  const { btn } = modelTrigger(h);
  btn.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
  const pop = h.doc.getElementById('ag-claude-model-popover');
  assert.ok(pop);
  assert.equal(pop.getAttribute('data-open'), 'true');
  assert.equal(pop.getAttribute('role'), 'menu');
  h.close();
});

test('Enter opens + focuses menu, arrows move, Escape returns focus', { skip }, () => {
  const h = mount('');
  const { btn } = modelTrigger(h);
  btn.focus();
  const key = (target, k) => target.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  key(btn, 'Enter');
  const pop = h.doc.getElementById('ag-claude-model-popover');
  assert.equal(pop.getAttribute('data-open'), 'true');
  assert.ok(pop.contains(h.doc.activeElement), 'focus moved into the menu');
  const first = h.doc.activeElement;
  key(first, 'ArrowDown');
  assert.notEqual(h.doc.activeElement, first);
  key(h.doc.activeElement, 'Escape');
  assert.equal(pop.getAttribute('data-open'), 'false');
  assert.ok(pop.hasAttribute('inert'), 'closed menu leaves the tab order');
  assert.equal(h.doc.activeElement, btn);
  h.close();
});

test('feature switch off: model menu is not intercepted, checklists untouched', { skip }, () => {
  const h = mount(pane([ul(li('读代码', 'in_progress'), li('修复'))]), {
    modules: { claudeUxModelMenu: false, claudeUxTodoCard: false }
  });
  const { btn } = modelTrigger(h);
  let native = 0;
  btn.addEventListener('click', () => native++);
  btn.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
  assert.equal(native, 1);
  assert.equal(h.doc.getElementById('ag-claude-model-popover'), null);
  assert.equal(h.doc.querySelectorAll('.ag-claude-todo-card').length, 0);
  h.close();
});

test('virtualised step stream: card keeps the newest progress after the mid-turn list is unmounted', { skip }, async () => {
  const h = mount(pane([ul(li('阶段一 读代码', 'in_progress'), li('阶段二 修复'), li('阶段三 测试'))], { generating: true }));
  const statuses = () => Array.from(h.doc.querySelectorAll('[data-ag-todo-dock] .ag-claude-todo-row')).map((r) => r.getAttribute('data-status'));
  const settle = async () => {
    await h.microtasks();
    await new Promise((r) => setTimeout(r, 100));
    h.flushFrames();
  };
  assert.deepEqual(statuses(), ['in_progress', 'pending', 'pending']);

  /* a later step streams in with an updated checklist ... */
  const turn = h.doc.querySelector('[data-testid="agent-response"]');
  const step = h.doc.createElement('div');
  step.innerHTML = `<div data-testid="planner-response-text">${ul(li('阶段一 读代码', 'completed'), li('阶段二 修复', 'completed'), li('阶段三 测试', 'in_progress'))}</div>`;
  turn.appendChild(step);
  await settle();
  assert.deepEqual(statuses(), ['completed', 'completed', 'in_progress']);

  /* ... then scrolls out of the render window and is unmounted by the app */
  step.remove();
  await settle();
  assert.deepEqual(statuses(), ['completed', 'completed', 'in_progress'], 'must not fall back to the first list');

  /* scrolling back up re-mounts the first list: progress must not regress either */
  turn.appendChild(h.doc.createElement('p'));
  await settle();
  assert.deepEqual(statuses(), ['completed', 'completed', 'in_progress']);
  h.cleanups.forEach((fn) => fn());
  h.close();
});

function attachTurnSteps(h, texts) {
  const turn = h.doc.querySelector('[data-testid="agent-response"]');
  const steps = texts.map((t) => ({ step: { case: 'plannerResponse', value: { response: t, thinking: '- [x] 阶段一 (thinking must be ignored)' } } }));
  turn.__reactFiber$t = { memoizedProps: {}, return: { memoizedProps: { container: { steps } } } };
  return { turn, steps };
}

async function settle(h) {
  await h.microtasks();
  await new Promise((r) => setTimeout(r, 100));
  h.flushFrames();
}

const dockStatuses = (h) => Array.from(h.doc.querySelectorAll('[data-ag-todo-dock] .ag-claude-todo-row')).map((r) => r.getAttribute('data-status'));

test('one-line 〔进度 N/M〕 marker in turn step data advances the live card', { skip }, async () => {
  const h = mount(pane([ul(li('切换守护', 'in_progress'), li('真机验证'), li('收尾说明'))], { generating: true }));
  assert.deepEqual(dockStatuses(h), ['in_progress', 'pending', 'pending']);
  const { turn, steps } = attachTurnSteps(h, ['开场说明', '守护已切换。〔进度 2/3〕真机验证']);
  turn.appendChild(h.doc.createElement('p'));
  await settle(h);
  assert.deepEqual(dockStatuses(h), ['completed', 'in_progress', 'pending']);

  steps.push({ step: { case: 'plannerResponse', value: { response: '〔进度 3/3〕收尾' } } });
  turn.appendChild(h.doc.createElement('p'));
  await settle(h);
  assert.deepEqual(dockStatuses(h), ['completed', 'completed', 'in_progress']);
  h.cleanups.forEach((fn) => fn());
  h.close();
});

test('full checklist in an unrendered step response is used; thinking text is ignored', { skip }, async () => {
  const h = mount(pane([ul(li('阶段一', 'in_progress'), li('阶段二'), li('阶段三'))], { generating: true }));
  const { turn } = attachTurnSteps(h, ['进展：\n- [x] 阶段一\n- [/] 阶段二\n- [ ] 阶段三']);
  turn.appendChild(h.doc.createElement('p'));
  await settle(h);
  assert.deepEqual(dockStatuses(h), ['completed', 'in_progress', 'pending']);
  h.cleanups.forEach((fn) => fn());
  h.close();
});

test('marker with a mismatched total is ignored', { skip }, async () => {
  const h = mount(pane([ul(li('阶段一', 'in_progress'), li('阶段二'), li('阶段三'))], { generating: true }));
  const { turn } = attachTurnSteps(h, ['〔进度 2/5〕别的任务']);
  turn.appendChild(h.doc.createElement('p'));
  await settle(h);
  assert.deepEqual(dockStatuses(h), ['in_progress', 'pending', 'pending']);
  h.cleanups.forEach((fn) => fn());
  h.close();
});
