/**
 * CDP client robustness: response deadline, close/error before reply, exceptionDetails, missing store.
 * Runs install.mjs in-process with a fake HOME, fake fetch and fake WebSocket.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ux-cdp-'));
process.env.HOME = home;
process.env.APPDATA = path.join(home, 'AppData', 'Roaming');
delete process.env.CLAUDE_UX_NO_CDP;
process.env.CLAUDE_UX_CDP_TIMEOUT_MS = '150';

let mod;
const realFetch = globalThis.fetch;
const realWS = globalThis.WebSocket;

function portFile() {
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort');
  if (process.platform === 'win32') return path.join(process.env.APPDATA, 'Antigravity', 'DevToolsActivePort');
  return path.join(home, '.config', 'Antigravity', 'DevToolsActivePort');
}

function fakeSocket(mode) {
  return class extends EventTarget {
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event('open')));
    }
    send(raw) {
      const { id } = JSON.parse(raw);
      const reply = (result) => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id, result }) }));
      queueMicrotask(() => {
        if (mode === 'close') this.dispatchEvent(new Event('close'));
        else if (mode === 'exception') reply({ exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: boom' } } });
        else if (mode === 'not_found') reply({ result: { value: { found: false } } });
        else if (mode === 'ok')
          reply({ result: { value: { found: true, before: { project4kMode: 2, verboseConversationSteps: false }, after: { project4kMode: 1, verboseConversationSteps: true } } } });
        /* 'silent': never answers */
      });
    }
    close() {}
  };
}

before(async () => {
  fs.mkdirSync(path.dirname(portFile()), { recursive: true });
  fs.writeFileSync(portFile(), '12345\n/devtools/browser/x');
  globalThis.fetch = async () => ({ json: async () => [{ type: 'page', url: 'http://127.0.0.1:5173/', webSocketDebuggerUrl: 'ws://127.0.0.1/x' }] });
  mod = await import(path.join(REPO, 'install.mjs'));
});

after(() => {
  globalThis.fetch = realFetch;
  globalThis.WebSocket = realWS;
  fs.rmSync(home, { recursive: true, force: true });
});

const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r('PENDING'), ms))]);

test('socket closing before the reply settles with ok:false', async () => {
  globalThis.WebSocket = fakeSocket('close');
  const r = await within(mod.cdpPrefs({ project4kMode: 1 }), 1000);
  assert.notEqual(r, 'PENDING');
  assert.equal(r.ok, false);
  assert.match(r.reason, /ws_closed/);
});

test('no reply hits the per-request deadline', async () => {
  globalThis.WebSocket = fakeSocket('silent');
  const r = await within(mod.cdpPrefs({ project4kMode: 1 }), 1000);
  assert.notEqual(r, 'PENDING');
  assert.equal(r.ok, false);
  assert.match(r.reason, /cdp_timeout/);
});

test('exceptionDetails is a failure', async () => {
  globalThis.WebSocket = fakeSocket('exception');
  const r = await mod.cdpPrefs({ project4kMode: 1 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /eval_exception: TypeError: boom/);
});

test('missing pref store is a failure', async () => {
  globalThis.WebSocket = fakeSocket('not_found');
  const r = await mod.cdpPrefs({ project4kMode: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'pref_store_not_found');
});

test('applied prefs report ok with before/after values', async () => {
  globalThis.WebSocket = fakeSocket('ok');
  const r = await mod.cdpPrefs({ project4kMode: 1, verboseConversationSteps: true });
  assert.equal(r.ok, true);
  assert.equal(r.before.project4kMode, 2);
});
