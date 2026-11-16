/**
 * antigravity-claude-ux — user/custom.js
 * Non-invasive runtime UX extension for Google Antigravity Desktop 2.0:
 * 1. Unfolds outer `worked-for-collapsible` end-of-turn wrapper so interleaved narration & tool summaries stay inline.
 * 2. Adds smooth 190ms collapse transition when React unmounts finished `tool-group-collapsible` panels.
 * 3. Renders an in-place reactive Claude `TodoWrite` checklist card (`- [ ]` pending / `- [/]` active / `- [x]` completed),
 *    deduplicating and merging all checklist updates within the same turn into a single card.
 * 4. Attaches orbiting terracotta dots + live `1s / 2s...` elapsed timer exclusively to the actively executing step row.
 *
 * Feature switches (user/config.json -> "modules", all default true):
 *   claudeUxStepUnfold, claudeUxCollapseAnimation, claudeUxTodoCard, claudeUxRunningTimer,
 *   claudeUxContextRing, claudeUxModelMenu
 */
(function () {
  const MODS =
    (typeof ctx !== 'undefined' && ctx && (ctx.modules || (ctx.config && ctx.config.modules))) || {};
  const FEAT = {
    stepUnfold: MODS.claudeUxStepUnfold !== false,
    collapseAnim: MODS.claudeUxCollapseAnimation !== false,
    todoCard: MODS.claudeUxTodoCard !== false,
    runningTimer: MODS.claudeUxRunningTimer !== false,
    contextRing: MODS.claudeUxContextRing !== false,
    modelMenu: MODS.claudeUxModelMenu !== false
  };

  /* an older instance that was never cleaned up (no ctx.onCleanup) must not keep running */
  if (typeof window.__agClaudeUxDispose === 'function') {
    try {
      window.__agClaudeUxDispose();
    } catch {}
  }

  const userToggled = new WeakSet();
  const autoExpandCount = new WeakMap();
  const openSnapshots = new WeakMap();
  const runningTimers = new WeakMap();
  const paneLastActiveTs = new WeakMap();
  const paneUndockTimers = new WeakMap();
  const todoParseCache = new WeakMap();
  let timerIntervalId = null;
  let rafPending = false;

  /* ---- lifecycle: every async callback is tracked and becomes a no-op after cleanup ---- */
  let disposed = false;
  const pendingRafs = new Set();
  const pendingTimeouts = new Set();
  function frame(fn) {
    if (disposed) return 0;
    const id = requestAnimationFrame((ts) => {
      pendingRafs.delete(id);
      if (!disposed) fn(ts);
    });
    pendingRafs.add(id);
    return id;
  }
  function later(fn, ms) {
    if (disposed) return 0;
    const id = setTimeout(() => {
      pendingTimeouts.delete(id);
      if (!disposed) fn();
    }, ms);
    pendingTimeouts.add(id);
    return id;
  }
  function cancelLater(id) {
    if (!id) return;
    clearTimeout(id);
    pendingTimeouts.delete(id);
  }

  const SVG_PENDING =
    '<svg class="ag-todo-ico ag-todo-pending" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.6" stroke="currentColor" stroke-width="1.4"/></svg>';
  const SVG_ACTIVE =
    '<svg class="ag-todo-ico ag-todo-active" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.6" stroke="currentColor" stroke-opacity="0.22" stroke-width="1.5"/><path d="M8 1.4a6.6 6.6 0 0 1 6.6 6.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const SVG_DONE =
    '<svg class="ag-todo-ico ag-todo-done" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="7.2" fill="currentColor"/><path class="ag-todo-done-check" d="M5.1 8.15l1.95 1.95 3.95-4.1" stroke="#FFFFFF" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const PAST_LABEL_RE = /^(?:Explored|Ran\b|Edited\b|Done\b|已探索|已运行|已编辑|已完成)/i;

  const onDocClick = (e) => {
    if (!e.isTrusted) return;
    const btn = e.target && e.target.closest && e.target.closest('button[data-testid="worked-for-collapsible"]');
    if (btn) userToggled.add(btn);
  };
  document.addEventListener('click', onDocClick, true);

  function captureOpenToolPanels() {
    /* Keep a reference to the live panel node (no innerHTML serialisation per frame).
       It is cloned only at the moment React collapses it. */
    const openBtns = document.querySelectorAll('button[data-testid="tool-group-collapsible"][aria-expanded="true"]');
    for (const btn of openBtns) {
      const panel = btn.nextElementSibling;
      if (!panel || panel.classList.contains('ag-collapse-ghost')) continue;
      const snap = openSnapshots.get(btn);
      if (!snap || snap.panel !== panel) openSnapshots.set(btn, { panel });
    }
  }

  function animateCollapseIfNeeded(btn) {
    const snap = openSnapshots.get(btn);
    if (!snap) return;
    openSnapshots.delete(btn);
    if (btn.getAttribute('aria-expanded') !== 'false') return;
    const parent = btn.parentElement;
    if (!parent || parent.querySelector(':scope > .ag-collapse-ghost')) return;
    const src = snap.panel;
    if (!src || !src.firstChild) return;

    const ghost = document.createElement('div');
    ghost.className = `${src.className} ag-collapse-ghost`;
    ghost.setAttribute('aria-hidden', 'true');
    for (const n of Array.from(src.childNodes)) ghost.appendChild(n.cloneNode(true));
    ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    ghost.style.cssText = 'overflow: hidden; pointer-events: none; opacity: 1; transform: translateY(0)';
    btn.insertAdjacentElement('afterend', ghost);

    const height = Math.min(ghost.scrollHeight || 0, 360);
    if (height <= 8) {
      ghost.remove();
      return;
    }
    ghost.style.maxHeight = `${height}px`;
    ghost.style.transition =
      'max-height 190ms cubic-bezier(0.16, 1, 0.3, 1), opacity 150ms ease-out, transform 190ms cubic-bezier(0.16, 1, 0.3, 1), margin 190ms ease';

    frame(() => {
      frame(() => {
        ghost.style.maxHeight = '0px';
        ghost.style.opacity = '0';
        ghost.style.transform = 'translateY(-4px)';
        ghost.style.marginTop = '0px';
        ghost.style.marginBottom = '0px';
      });
    });

    const cleanup = () => {
      if (ghost.parentNode) ghost.remove();
    };
    ghost.addEventListener('transitionend', cleanup, { once: true });
    setTimeout(cleanup, 240); /* intentionally untracked: must also run after dispose */
  }

  function parseTodoUlUncached(ul) {
    const lis = Array.from(ul.children).filter((el) => el.tagName === 'LI' && el.classList.contains('task-list-item'));
    if (lis.length < 2 || lis.length > 15) return null;

    const items = [];
    for (const li of lis) {
      const iconBox = li.querySelector(':scope > div:first-child');
      let status = 'pending';
      if (li.classList.contains('task-checked')) {
        status = 'completed';
      } else if (iconBox && iconBox.classList.contains('bg-primary')) {
        status = 'in_progress';
      }
      const clone = li.cloneNode(true);
      const firstDiv = clone.querySelector(':scope > div:first-child');
      if (firstDiv) firstDiv.remove();
      const checkedSpan = clone.querySelector(':scope > span.task-checked-content');
      const labelHtml = (checkedSpan ? checkedSpan.innerHTML : clone.innerHTML).trim();
      if (!labelHtml) return null;
      items.push({ status, html: labelHtml });
    }
    return items;
  }

  function parseTodoUl(ul) {
    if (!ul.classList || !ul.classList.contains('contains-task-list')) return null;
    if (ul.closest('pre, code, [data-testid="user-input-step"], .agy-user-bubble')) return null;
    if (ul.closest('[data-testid="tool-group-collapsible"] + div')) return null;
    if (ul.closest('.ag-claude-todo-card, .ag-collapse-ghost')) return null;

    /* cheap signature: item count + status classes + text; avoids re-cloning unchanged lists every sync */
    const sig = `${ul.children.length}|${ul.querySelectorAll(':scope > li.task-checked').length}|${
      ul.querySelectorAll(':scope > li > div.bg-primary:first-child').length
    }|${ul.textContent}`;
    const cached = todoParseCache.get(ul);
    if (cached && cached.sig === sig) return cached.items;
    const items = parseTodoUlUncached(ul);
    todoParseCache.set(ul, { sig, items });
    return items;
  }

  function normalizeTodoText(html) {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function isChecklistEvolution(prevItems, nextItems) {
    if (!prevItems || !nextItems) return false;
    const a = prevItems.map((it) => normalizeTodoText(it.html));
    const b = nextItems.map((it) => normalizeTodoText(it.html));
    let matches = 0;
    for (const txtB of b) {
      if (!txtB) continue;
      const hit = a.some(
        (txtA) =>
          txtA === txtB ||
          (txtA.length >= 6 && txtB.length >= 6 && (txtA.includes(txtB.slice(0, 6)) || txtB.includes(txtA.slice(0, 6))))
      );
      if (hit) matches += 1;
    }
    return matches >= Math.max(1, Math.ceil(Math.min(a.length, b.length) * 0.4));
  }

  function iconForStatus(status) {
    return status === 'completed' ? SVG_DONE : status === 'in_progress' ? SVG_ACTIVE : SVG_PENDING;
  }

  function patchCardDom(card, items, paused) {
    if (paused) card.setAttribute('data-ag-todo-paused', 'true');
    else card.removeAttribute('data-ag-todo-paused');
    const sig = JSON.stringify(items);
    if (card.getAttribute('data-ag-todo-sig') === sig) return;
    card.setAttribute('data-ag-todo-sig', sig);

    const existingRows = Array.from(card.children).filter((el) => el.classList.contains('ag-claude-todo-row'));
    if (existingRows.length === items.length) {
      for (let i = 0; i < items.length; i++) {
        const row = existingRows[i];
        const it = items[i];
        const prevStatus = row.getAttribute('data-status');
        if (prevStatus !== it.status) {
          row.setAttribute('data-status', it.status);
          const ico = row.querySelector(':scope > .ag-todo-ico');
          if (ico) {
            ico.outerHTML = iconForStatus(it.status);
          }
        }
        const lbl = row.querySelector(':scope > .ag-claude-todo-label');
        if (lbl && lbl.innerHTML !== it.html) {
          lbl.innerHTML = it.html;
        }
      }
      return;
    }

    card.innerHTML = items
      .map(
        (it) =>
          `<div class="ag-claude-todo-row" data-status="${it.status}">${iconForStatus(it.status)}<span class="ag-claude-todo-label">${it.html}</span></div>`
      )
      .join('');
  }

  function removeInlineMount(ul) {
    if (ul.nextElementSibling && ul.nextElementSibling.hasAttribute('data-ag-todo-mount')) {
      ul.nextElementSibling.remove();
    }
  }

  function markMergedUl(ul) {
    ul.removeAttribute('data-ag-todo-primary');
    ul.setAttribute('data-ag-todo-merged', 'true');
    removeInlineMount(ul);
    const pWrap = ul.parentElement;
    if (pWrap && pWrap.children.length === 1) {
      pWrap.setAttribute('data-ag-todo-empty-wrap', 'true');
    }
  }

  function restoreNativeUl(ul) {
    ul.removeAttribute('data-ag-todo-primary');
    ul.removeAttribute('data-ag-todo-merged');
    removeInlineMount(ul);
    const pWrap = ul.parentElement;
    if (pWrap) pWrap.removeAttribute('data-ag-todo-empty-wrap');
  }

  function renderInlineTodoCard(anchorUl, items, paused) {
    anchorUl.setAttribute('data-ag-todo-primary', 'true');
    anchorUl.removeAttribute('data-ag-todo-merged');
    let card = anchorUl.nextElementSibling;
    if (!card || !card.hasAttribute('data-ag-todo-mount')) {
      card = document.createElement('div');
      card.className = 'ag-claude-todo-card';
      card.setAttribute('data-ag-todo-mount', 'true');
      anchorUl.insertAdjacentElement('afterend', card);
    }
    patchCardDom(card, items, paused);
  }

  /* One pane = one composer input box + its conversation. Computed once per sync (panes are few). */
  const INPUT_BOX_SEL = '[id="antigravity.agentSidePanelInputBox"]';
  function collectPanes() {
    const panes = [];
    for (const inputBox of document.querySelectorAll(INPUT_BOX_SEL)) {
      let cur = inputBox.parentElement;
      for (let i = 0; i < 16 && cur; i++, cur = cur.parentElement) {
        if (cur.querySelector('[data-testid="agent-response"]')) {
          if (cur.querySelectorAll(INPUT_BOX_SEL).length === 1) panes.push({ root: cur, inputBox });
          break;
        }
      }
    }
    return panes;
  }

  function paneFor(el, panes) {
    for (const p of panes) if (p.root.contains(el)) return p;
    return null;
  }

  function isPaneActivelyGenerating(pane) {
    if (!pane) return false;
    const hasCancel = Boolean(pane.inputBox.querySelector('button[data-testid="input-cancel-button"]'));
    const now = Date.now();
    if (hasCancel) {
      paneLastActiveTs.set(pane.root, now);
      const pendingTimer = paneUndockTimers.get(pane.root);
      if (pendingTimer) {
        cancelLater(pendingTimer);
        paneUndockTimers.delete(pane.root);
      }
      return true;
    }
    const lastTs = paneLastActiveTs.get(pane.root) || 0;
    if (now - lastTs < 280) {
      if (!paneUndockTimers.has(pane.root)) {
        const tid = later(() => {
          paneUndockTimers.delete(pane.root);
          scheduleSync();
        }, 300);
        paneUndockTimers.set(pane.root, tid);
      }
      return true;
    }
    return false;
  }

  function renderLiveDockedTodoCard(pane, items) {
    const inputBox = pane.inputBox;
    if (!inputBox || !inputBox.parentElement) return false;
    let dock = inputBox.parentElement.querySelector(':scope > [data-ag-todo-dock="true"]');
    if (!dock) {
      dock = document.createElement('div');
      dock.className = 'ag-claude-todo-live-dock';
      dock.setAttribute('data-ag-todo-dock', 'true');
      inputBox.insertAdjacentElement('beforebegin', dock);
    } else if (dock.nextElementSibling !== inputBox) {
      inputBox.insertAdjacentElement('beforebegin', dock);
    }
    let card = dock.querySelector(':scope > .ag-claude-todo-card');
    if (!card) {
      card = document.createElement('div');
      card.className = 'ag-claude-todo-card';
      card.setAttribute('data-ag-todo-mount', 'true');
      dock.appendChild(card);
    }
    patchCardDom(card, items, false);
    return dock;
  }

  function isAllTodoCompleted(items) {
    return Boolean(items && items.length > 0 && items.every((it) => it.status === 'completed'));
  }

  function hasActiveTodo(items) {
    return Boolean(items && items.some((it) => it.status === 'in_progress'));
  }

  /**
   * Only *execution-progress* checklists are taken over:
   *  - a cluster starts with a list containing an active `[/]` item (the marker the AGENTS.md rule mandates);
   *  - later lists join it when they evolve from it (same items) or, across turns, when they still look like
   *    progress (`[/]` present or 100% done).
   * Ordinary answer checklists (materials, review points: only `[ ]` / `[x]`, no `[/]`) stay native and visible.
   * A taken-over list is never hidden without a visible replacement card.
   */
  function syncTodoCards(panes) {
    const touched = new Set();
    const activeDocks = new Set();

    if (FEAT.todoCard) {
      const byPane = new Map();
      for (const ul of document.querySelectorAll('ul.contains-task-list')) {
        const items = parseTodoUl(ul);
        if (!items) continue;
        const turnEl = ul.closest('[data-testid="agent-response"]');
        const pane = turnEl ? paneFor(turnEl, panes) : null;
        const key = pane || ul; /* orphan lists form their own group */
        let group = byPane.get(key);
        if (!group) {
          group = { pane, entries: [] };
          byPane.set(key, group);
        }
        group.entries.push({ ul, items, turnEl });
      }

      for (const group of byPane.values()) {
        const clusters = [];
        for (const entry of group.entries) {
          const last = clusters[clusters.length - 1];
          const active = hasActiveTodo(entry.items);
          let join = false;
          if (last) {
            const evolved = isChecklistEvolution(last.items, entry.items);
            const sameTurn = Boolean(entry.turnEl && last.lastTurnEl === entry.turnEl);
            if (sameTurn) {
              join = evolved;
            } else {
              const looksLikeProgress = active || isAllTodoCompleted(entry.items);
              join = evolved || (!isAllTodoCompleted(last.items) && looksLikeProgress);
            }
          }
          if (join) {
            last.lists.push(entry.ul);
            last.items = entry.items;
            if (entry.turnEl) last.lastTurnEl = entry.turnEl;
          } else if (active) {
            clusters.push({ lists: [entry.ul], items: entry.items, lastTurnEl: entry.turnEl || null });
          }
          /* else: ordinary checklist, left untouched */
        }

        const pane = group.pane;
        const paneLive = Boolean(pane) && isPaneActivelyGenerating(pane);
        let latestPaneTurn = null;
        if (pane) {
          const paneTurns = pane.root.querySelectorAll('[data-testid="agent-response"]');
          latestPaneTurn = paneTurns.length ? paneTurns[paneTurns.length - 1] : null;
        }

        for (let i = 0; i < clusters.length; i++) {
          const cluster = clusters[i];
          for (const ul of cluster.lists) touched.add(ul);
          const isDockedLiveCluster =
            paneLive && i === clusters.length - 1 && Boolean(cluster.lastTurnEl && cluster.lastTurnEl === latestPaneTurn);
          const mountedDock = isDockedLiveCluster ? renderLiveDockedTodoCard(pane, cluster.items) : null;

          if (mountedDock) {
            activeDocks.add(mountedDock);
            for (const ul of cluster.lists) markMergedUl(ul);
          } else {
            /* finished (100%) or paused/interrupted: keep a visible card at the latest list */
            const anchorUl = cluster.lists[cluster.lists.length - 1];
            for (let j = 0; j < cluster.lists.length - 1; j++) markMergedUl(cluster.lists[j]);
            renderInlineTodoCard(anchorUl, cluster.items, !isAllTodoCompleted(cluster.items));
          }
        }
      }
    }

    /* release lists we no longer own (re-render, rule change, feature off) */
    for (const ul of document.querySelectorAll('ul[data-ag-todo-merged], ul[data-ag-todo-primary]')) {
      if (!touched.has(ul)) restoreNativeUl(ul);
    }
    for (const card of document.querySelectorAll('[data-ag-todo-mount]')) {
      if (card.parentElement && card.parentElement.hasAttribute('data-ag-todo-dock')) continue;
      const prev = card.previousElementSibling;
      if (!prev || !prev.hasAttribute('data-ag-todo-primary')) card.remove();
    }
    for (const dock of document.querySelectorAll('[data-ag-todo-dock="true"]')) {
      if (!activeDocks.has(dock)) dock.remove();
    }
  }

  function isActivelyRunningRow(el, isLastCandidate, turnGenerating) {
    if (!turnGenerating || !isLastCandidate) return false;
    if (el.getAttribute('data-testid') === 'ephemeral-tool-status') return true;
    const span = el.querySelector(':scope > span[title], :scope > span[data-ag-orig-title]');
    const raw =
      (span && (span.getAttribute('data-ag-orig-title') || span.getAttribute('title'))) ||
      el.getAttribute('data-ag-orig-aria-label') ||
      el.getAttribute('aria-label') ||
      el.textContent ||
      '';
    return !PAST_LABEL_RE.test(raw.trim());
  }

  function syncRunningToolIndicators(panesArg) {
    if (disposed) return;
    const candidates = FEAT.runningTimer
      ? Array.from(document.querySelectorAll('button[data-testid="tool-group-collapsible"], [data-testid="ephemeral-tool-status"]'))
      : [];
    const panes = panesArg || collectPanes();
    const globalGenerating = Boolean(document.querySelector('button[data-testid="input-cancel-button"]'));

    /* "last row" and "generating" are evaluated per pane, so a busy pane never lights up another one */
    const lastInPane = new Map();
    const paneOfEl = new Map();
    for (const el of candidates) {
      const pane = paneFor(el, panes);
      paneOfEl.set(el, pane);
      lastInPane.set(pane, el);
    }
    const generatingCache = new Map();
    const paneGenerating = (pane) => {
      if (!pane) return panes.length === 0 && globalGenerating;
      if (!generatingCache.has(pane)) {
        generatingCache.set(pane, Boolean(pane.inputBox.querySelector('button[data-testid="input-cancel-button"]')));
      }
      return generatingCache.get(pane);
    };

    let activeCount = 0;
    const now = Date.now();
    for (const el of candidates) {
      const pane = paneOfEl.get(el);
      const isRunning = isActivelyRunningRow(el, lastInPane.get(pane) === el, paneGenerating(pane));
      let orbit = el.querySelector(':scope > .ag-orbit-dots');
      let timerEl = el.querySelector(':scope > .ag-elapsed-timer');

      if (isRunning) {
        activeCount += 1;
        let startTs = runningTimers.get(el);
        if (!startTs) {
          startTs = now;
          runningTimers.set(el, startTs);
        }
        if (!orbit) {
          orbit = document.createElement('span');
          orbit.className = 'ag-orbit-dots';
          orbit.setAttribute('aria-hidden', 'true');
          orbit.innerHTML = '<i></i><i></i>';
          el.insertBefore(orbit, el.firstChild);
        }
        const secs = Math.max(1, Math.floor((now - startTs) / 1000));
        if (!timerEl) {
          timerEl = document.createElement('span');
          timerEl.className = 'ag-elapsed-timer';
          const chevron = el.querySelector(':scope > svg');
          if (chevron) {
            el.insertBefore(timerEl, chevron);
          } else {
            el.appendChild(timerEl);
          }
        }
        const txt = `${secs}s`;
        if (timerEl.textContent !== txt) timerEl.textContent = txt;
      } else {
        if (orbit) orbit.remove();
        if (timerEl) timerEl.remove();
        runningTimers.delete(el);
      }
    }
    /* stale indicators on rows that are no longer candidates */
    if (!FEAT.runningTimer) {
      document.querySelectorAll('.ag-orbit-dots, .ag-elapsed-timer').forEach((n) => n.remove());
    }

    if (activeCount > 0 && !timerIntervalId) {
      timerIntervalId = setInterval(() => syncRunningToolIndicators(), 1000);
    } else if (activeCount === 0 && timerIntervalId) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
    }
  }

  let lastSyncTs = 0;
  function syncStepStream() {
    rafPending = false;
    if (disposed) return;
    lastSyncTs = Date.now();
    if (FEAT.stepUnfold) {
      const workedBtns = document.querySelectorAll('button[data-testid="worked-for-collapsible"]');
      for (const btn of workedBtns) {
        const wrap = btn.parentElement;
        if (wrap && !wrap.hasAttribute('data-ag-inline-stream')) {
          wrap.setAttribute('data-ag-inline-stream', 'true');
        }
        if (btn.getAttribute('aria-expanded') === 'false' && !userToggled.has(btn)) {
          /* bounded: never fight the app in a click loop if it keeps re-collapsing the same node */
          const n = autoExpandCount.get(btn) || 0;
          if (n < 3) {
            autoExpandCount.set(btn, n + 1);
            btn.click();
          }
        }
      }
    }
    if (FEAT.collapseAnim) captureOpenToolPanels();
    const panes = collectPanes();
    syncTodoCards(panes);
    syncRunningToolIndicators(panes);
    if (FEAT.contextRing) {
      ensureMetricsWrapped();
      ensureComposerContextRing();
    }
  }

  /* ==========================================================================
   * 5. Claude-Style Composer Context Ring + Live Plan Quota Popover + Slim Pill
   *    - Strips `Ctx ...` & `Out ...` from center `#ag-live-metrics-pill` (keeps Speed + Time only)
   *    - Mounts radial context progress ring right beside the Model Selector
   *    - Clicking opens real-time Usage Popover (`retrieveUserQuotaSummary` 5h & weekly buckets)
   * ========================================================================== */
  const RING_CIRC = 2 * Math.PI * 7;
  let cachedQuotaSvc = null;
  let cachedUserTierName = '';
  let cachedQuotaGroups = null;
  let lastQuotaFetchTs = 0;
  let quotaFetchInFlight = null;
  let quotaPopoverOpen = false;
  let selectedQuotaGroupIdx = -1;
  let latestCtxState = { pct: 0, ratioText: '', outText: '', hasData: false, cascadeId: '' };

  function getActiveCascadeId() {
    const m = (window.location.pathname || '').match(/^\/c\/([0-9a-f-]+)/i);
    return m ? m[1] : '';
  }

  function parseAndSlimMetricsPayload(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const rawInline = payload.__agOrigInlineHtml || payload.inlineHtml || '';
    const curCid = getActiveCascadeId();

    if (payload.hasData && rawInline && (!curCid || payload.cascadeId === curCid)) {
      const tmp = document.createElement('div');
      tmp.innerHTML = rawInline;
      let ratioText = '';
      let pct = 0;
      let outText = '';

      const kids = Array.from(tmp.children);
      for (let i = 0; i < kids.length; i++) {
        const el = kids[i];
        const txt = (el.textContent || '').trim();
        if (/^Ctx\b/i.test(txt)) {
          const m = txt.match(/Ctx\s+([^\s(]+)\s*(?:\((\d+)%\))?/i);
          if (m) {
            ratioText = m[1].replace('/', ' / ');
            pct = Math.max(0, Math.min(100, Number(m[2] || 0)));
          }
          const prev = el.previousElementSibling;
          if (prev && prev.classList.contains('ag-sep')) prev.remove();
          el.remove();
        } else if (/^Out\b/i.test(txt)) {
          outText = txt;
          const prev = el.previousElementSibling;
          if (prev && prev.classList.contains('ag-sep')) prev.remove();
          el.remove();
        } else if (el.classList.contains('ag-sub-badge') || /^\+?\d+\s*sub\b/i.test(txt)) {
          const prev = el.previousElementSibling;
          if (prev && prev.classList.contains('ag-sep')) prev.remove();
          el.remove();
        }
      }
      while (tmp.firstElementChild && tmp.firstElementChild.classList.contains('ag-sep')) {
        tmp.firstElementChild.remove();
      }

      latestCtxState = {
        pct,
        ratioText,
        outText,
        hasData: Boolean(ratioText),
        cascadeId: payload.cascadeId || curCid
      };

      const slimmed = Object.assign({}, payload, {
        __agOrigInlineHtml: rawInline,
        inlineHtml: tmp.innerHTML
      });
      return slimmed;
    }

    if (!curCid || payload.cascadeId !== curCid || !payload.hasData) {
      latestCtxState = { pct: 0, ratioText: '', outText: '', hasData: false, cascadeId: curCid };
    }
    return payload;
  }

  /* Wrapped lazily (retried every sync) so load order vs. the upstream runtime does not matter.
     A stale wrapper left by an older instance is unwrapped first; after dispose ours is a pass-through. */
  let ownMetricsWrapper = null;
  function ensureMetricsWrapped() {
    let cur = window.__ag_render_metrics;
    if (typeof cur !== 'function' || cur === ownMetricsWrapper) return;
    while (cur && cur.__agSlimWrapped && typeof cur.__agOrig === 'function') cur = cur.__agOrig;
    const origRenderMetrics = cur;
    const wrappedRender = function (payload) {
      if (disposed) return origRenderMetrics.call(this, payload);
      const slimPayload = parseAndSlimMetricsPayload(payload);
      const ret = origRenderMetrics.call(this, slimPayload);
      if (payload && payload.__agOrigInlineHtml === undefined && window.__ag_last_metrics === slimPayload) {
        window.__ag_last_metrics.__agOrigInlineHtml = payload.inlineHtml;
      }
      updateComposerRingVisuals();
      if (quotaPopoverOpen) renderQuotaPopoverBody();
      return ret;
    };
    wrappedRender.__agSlimWrapped = true;
    wrappedRender.__agOrig = origRenderMetrics;
    ownMetricsWrapper = wrappedRender;
    window.__ag_render_metrics = wrappedRender;

    if (window.__ag_last_metrics) {
      window.__ag_render_metrics(window.__ag_last_metrics);
    }
  }
  if (FEAT.contextRing) ensureMetricsWrapped();

  function discoverQuotaService() {
    if (cachedQuotaSvc) return cachedQuotaSvc;
    const inputBox = document.getElementById('antigravity.agentSidePanelInputBox');
    if (!inputBox) return null;
    const fk = Object.keys(inputBox).find((k) => k.startsWith('__reactFiber$'));
    let f = fk ? inputBox[fk] : null;
    const seen = new Set();

    const walkObj = (obj, depth) => {
      if (!obj || typeof obj !== 'object' || depth > 4 || seen.has(obj)) return;
      seen.add(obj);
      try {
        if (!cachedQuotaSvc && typeof obj.retrieveUserQuotaSummary === 'function') {
          cachedQuotaSvc = obj;
        }
        if (!cachedUserTierName && obj.userTier && typeof obj.userTier.name === 'string') {
          cachedUserTierName = obj.userTier.name;
        }
      } catch {}
      let keys = [];
      try {
        keys = Object.keys(obj).slice(0, 40);
      } catch {}
      for (const k of keys) {
        try {
          const v = obj[k];
          if (v && typeof v === 'object') walkObj(v, depth + 1);
        } catch {}
      }
    };

    for (let n = 0; n < 45 && f; n++, f = f.return) {
      walkObj(f.memoizedProps, 0);
      walkObj(f.memoizedState, 0);
      let dep = f.dependencies ? f.dependencies.firstContext : null;
      while (dep) {
        walkObj(dep.memoizedValue, 0);
        dep = dep.next;
      }
      if (cachedQuotaSvc && cachedUserTierName) break;
    }
    return cachedQuotaSvc;
  }

  function fetchQuotaSummary(forceRefresh = false) {
    const svc = discoverQuotaService();
    if (!svc) return Promise.resolve(cachedQuotaGroups || []);
    const now = Date.now();
    if (!forceRefresh && cachedQuotaGroups && now - lastQuotaFetchTs < 15000) {
      return Promise.resolve(cachedQuotaGroups);
    }
    if (quotaFetchInFlight) return quotaFetchInFlight;

    quotaFetchInFlight = new Promise((resolve) => resolve(svc.retrieveUserQuotaSummary(Boolean(forceRefresh))))
      .then((res) => {
        if (disposed) return [];
        const rawGroups = (res && res.response && res.response.groups) || (res && res.groups) || [];
        cachedQuotaGroups = rawGroups.filter((g) => g && Array.isArray(g.buckets) && g.buckets.length > 0);
        lastQuotaFetchTs = Date.now();
        if (quotaPopoverOpen) renderQuotaPopoverBody();
        return cachedQuotaGroups;
      })
      .catch(() => {
        cachedQuotaSvc = null; /* service object may belong to an unmounted tree: rediscover next time */
        return cachedQuotaGroups || [];
      })
      .finally(() => {
        quotaFetchInFlight = null;
      });
    return quotaFetchInFlight;
  }

  function formatResetLabel(bucket, usedPct) {
    const win = String(bucket.window || '').trim().toLowerCase();
    const secStr = bucket.resetTime && bucket.resetTime.seconds !== undefined ? String(bucket.resetTime.seconds) : '';
    const resetMs = secStr ? Number(secStr) * 1000 : 0;

    if (win === '5h' && usedPct === 0 && !bucket.description) {
      return '从发送第一条消息时起算';
    }
    if (!resetMs || Number.isNaN(resetMs)) {
      return usedPct === 0 ? '从发送第一条消息时起算' : '';
    }
    const diffMs = resetMs - Date.now();
    if (diffMs <= 60000) return '即将重置';

    if (win === 'weekly') {
      const dt = new Date(resetMs);
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const hh = String(dt.getHours()).padStart(2, '0');
      const mm = String(dt.getMinutes()).padStart(2, '0');
      return `${weekdays[dt.getDay()]} ${hh}:${mm} 重置`;
    }

    const totalMins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hrs > 0) {
      return mins > 0 ? `${hrs} 小时 ${mins} 分后重置` : `${hrs} 小时后重置`;
    }
    return `${Math.max(1, mins)} 分钟后重置`;
  }

  function localizeGroupShortName(name) {
    const s = String(name || '').trim();
    if (/gemini/i.test(s)) return 'Gemini 模型';
    if (/claude/i.test(s) && /gpt/i.test(s)) return 'Claude / GPT';
    if (/claude/i.test(s)) return 'Claude 模型';
    return s || '全部模型';
  }

  function detectDefaultGroupIndex(groups) {
    if (!groups || groups.length <= 1) return 0;
    const inputBox = document.getElementById('antigravity.agentSidePanelInputBox');
    const txt = inputBox ? inputBox.textContent || '' : '';
    const want3p = /claude|sonnet|opus|gpt/i.test(txt);
    const idx = groups.findIndex((g) =>
      want3p ? /claude|gpt/i.test(g.displayName || '') : /gemini/i.test(g.displayName || '')
    );
    return idx >= 0 ? idx : 0;
  }

  function barColorForPct(pct, warnAt = 70, critAt = 85) {
    if (pct >= critAt) return '#DC2626';
    if (pct >= warnAt) return '#D97706';
    return 'var(--primary, #2F75C3)';
  }

  function ensureQuotaPopover() {
    let pop = document.getElementById('ag-claude-quota-popover');
    if (pop) return pop;
    pop = document.createElement('div');
    pop.id = 'ag-claude-quota-popover';
    pop.setAttribute('data-ag-i18n-ignore', '1');
    pop.setAttribute('data-open', 'false');
    pop.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('[data-ag-quota-tab]');
      if (tabBtn) {
        e.stopPropagation();
        selectedQuotaGroupIdx = Number(tabBtn.getAttribute('data-ag-quota-tab')) || 0;
        renderQuotaPopoverBody();
        return;
      }
      const viewAll = e.target.closest('[data-ag-quota-view-all]');
      if (viewAll) {
        e.stopPropagation();
        closeQuotaPopover();
        const settingsBtn = document.querySelector('button[data-testid="settings-button"]');
        if (settingsBtn) {
          settingsBtn.click();
          let tries = 0;
          const jumpModels = () => {
            const modelsBtn = document.querySelector('button[data-testid="settings-nav-item-Models"]');
            if (modelsBtn) {
              modelsBtn.click();
            } else if (++tries < 12) {
              frame(jumpModels);
            }
          };
          frame(jumpModels);
        }
      }
    });
    document.body.appendChild(pop);
    return pop;
  }

  function positionQuotaPopover() {
    const ring = document.getElementById('ag-claude-ctx-ring');
    const pop = document.getElementById('ag-claude-quota-popover');
    if (!ring || !pop) return;
    const r = ring.getBoundingClientRect();
    const popW = 344;
    const left = Math.max(12, Math.min(Math.round(r.left - 84), window.innerWidth - popW - 14));
    const bottom = Math.max(12, Math.round(window.innerHeight - r.top + 10));
    pop.style.left = `${left}px`;
    pop.style.bottom = `${bottom}px`;
  }

  function renderQuotaPopoverBody() {
    const pop = ensureQuotaPopover();
    const curCid = getActiveCascadeId();
    const hasCtx = Boolean(curCid && latestCtxState.hasData && latestCtxState.cascadeId === curCid);
    const ctxPct = hasCtx ? latestCtxState.pct : 0;
    const ctxSub = hasCtx
      ? `${latestCtxState.ratioText}${latestCtxState.outText ? ` · ${latestCtxState.outText}` : ''}`
      : '当前会话暂无消耗';

    discoverQuotaService();
    const tierShort = cachedUserTierName
      ? cachedUserTierName.replace(/^Google\s+AI\s+/i, '').trim() || cachedUserTierName
      : 'Pro';

    const groups = cachedQuotaGroups || [];
    if (selectedQuotaGroupIdx < 0 || selectedQuotaGroupIdx >= groups.length) {
      selectedQuotaGroupIdx = detectDefaultGroupIndex(groups);
    }

    let tabsHtml = '';
    if (groups.length > 1) {
      tabsHtml = `<div class="ag-qp-tabs">${groups
        .map((g, idx) => {
          const active = idx === selectedQuotaGroupIdx ? ' data-active="true"' : '';
          return `<button type="button" class="ag-qp-tab" data-ag-quota-tab="${idx}"${active}>${escapeHtml(localizeGroupShortName(
            g.displayName
          ))}</button>`;
        })
        .join('')}</div>`;
    }

    let quotaRowsHtml = '';
    if (!cachedQuotaGroups && quotaFetchInFlight) {
      quotaRowsHtml = '<div class="ag-qp-empty">正在读取实时套餐限额…</div>';
    } else if (groups.length === 0) {
      quotaRowsHtml = '<div class="ag-qp-empty">暂无可用套餐限额数据</div>';
    } else {
      const grp = groups[selectedQuotaGroupIdx] || groups[0];
      const grpShort = localizeGroupShortName(grp.displayName);
      const sortedBuckets = (grp.buckets || []).slice().sort((a, b) => {
        const rank = (w) => (w === '5h' ? 0 : w === 'daily' ? 1 : 2);
        return rank(String(a.window || '').toLowerCase()) - rank(String(b.window || '').toLowerCase());
      });

      quotaRowsHtml = sortedBuckets
        .map((b) => {
          const rem =
            b.remaining && b.remaining.case === 'remainingFraction' && typeof b.remaining.value === 'number'
              ? b.remaining.value
              : typeof b.remainingFraction === 'number'
                ? b.remainingFraction
                : 1;
          const usedPct = Math.max(0, Math.min(100, Math.round((1 - rem) * 100)));
          const win = String(b.window || '').trim().toLowerCase();
          const title =
            win === '5h'
              ? '5 小时限额'
              : win === 'weekly'
                ? `每周 · ${grpShort}`
                : win === 'daily'
                  ? `每日 · ${grpShort}`
                  : b.displayName || '使用限额';
          const resetTxt = formatResetLabel(b, usedPct);
          const fillCol = barColorForPct(usedPct, 75, 90);
          return `<div class="ag-qp-item">
            <div class="ag-qp-row">
              <span class="ag-qp-title">${escapeHtml(title)}</span>
              <span class="ag-qp-meta"><span class="ag-qp-reset">${escapeHtml(resetTxt)}</span><span class="ag-qp-pct">${usedPct}%</span></span>
            </div>
            <div class="ag-qp-track"><div class="ag-qp-fill" style="width:${usedPct}%;background:${fillCol}"></div></div>
          </div>`;
        })
        .join('');
    }

    const ctxColor = barColorForPct(ctxPct, 70, 85);
    pop.innerHTML = `
      <div class="ag-qp-hdr">
        <span class="ag-qp-tier">套餐使用限额 · ${escapeHtml(tierShort)}</span>
        <button type="button" class="ag-qp-all" data-ag-quota-view-all="true">
          <span>查看全部</span>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8h9m0 0L8.8 4.3M12.5 8l-3.7 3.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <div class="ag-qp-item">
        <div class="ag-qp-row">
          <span class="ag-qp-title">当前上下文</span>
          <span class="ag-qp-meta"><span class="ag-qp-reset">${escapeHtml(ctxSub)}</span><span class="ag-qp-pct">${ctxPct}%</span></span>
        </div>
        <div class="ag-qp-track"><div class="ag-qp-fill" style="width:${ctxPct}%;background:${ctxColor}"></div></div>
      </div>
      <div class="ag-qp-divider"></div>
      ${tabsHtml}
      <div class="ag-qp-group-list">${quotaRowsHtml}</div>
    `;
    positionQuotaPopover();
  }

  function openQuotaPopover() {
    if (typeof closeClaudeModelPopover === 'function' && modelPopoverOpen) {
      closeClaudeModelPopover();
    }
    quotaPopoverOpen = true;
    selectedQuotaGroupIdx = -1;
    const ring = document.getElementById('ag-claude-ctx-ring');
    if (ring) ring.setAttribute('data-open', 'true');
    const pop = ensureQuotaPopover();
    renderQuotaPopoverBody();
    pop.setAttribute('data-open', 'true');
    positionQuotaPopover();
    fetchQuotaSummary(false).then(() => {
      if (Date.now() - lastQuotaFetchTs > 12000) fetchQuotaSummary(true);
    });
  }

  function closeQuotaPopover() {
    quotaPopoverOpen = false;
    const ring = document.getElementById('ag-claude-ctx-ring');
    if (ring) ring.setAttribute('data-open', 'false');
    const pop = document.getElementById('ag-claude-quota-popover');
    if (pop) pop.setAttribute('data-open', 'false');
  }

  function updateComposerRingVisuals() {
    const ring = document.getElementById('ag-claude-ctx-ring');
    if (!ring) return;
    const curCid = getActiveCascadeId();
    const hasCtx = Boolean(curCid && latestCtxState.hasData && latestCtxState.cascadeId === curCid);
    const pct = hasCtx ? latestCtxState.pct : 0;
    const arc = ring.querySelector('.ag-ctx-ring-arc');
    if (arc) {
      const offset = RING_CIRC * (1 - pct / 100);
      arc.style.strokeDashoffset = offset.toFixed(2);
      arc.style.strokeOpacity = pct <= 0 ? '0' : '1';
      let level = 'normal';
      if (pct >= 85) level = 'crit';
      else if (pct >= 70) level = 'warn';
      ring.setAttribute('data-level', level);
    }
    ring.title = hasCtx
      ? `当前上下文 ${latestCtxState.ratioText} (${pct}%) · 点击查看套餐限额`
      : '当前会话暂无上下文消耗 · 点击查看套餐限额';
  }

  function ensureComposerContextRing() {
    const inputBox = document.getElementById('antigravity.agentSidePanelInputBox');
    if (!inputBox) return;
    const leftGroup = inputBox.querySelector('div.flex.min-w-0.flex-1.items-center');
    if (!leftGroup) return;

    const modelWrap = Array.from(leftGroup.children).find(
      (ch) => ch.tagName === 'DIV' && ch.id !== 'ag-live-metrics-pill' && ch.querySelector('button')
    );
    if (!modelWrap) return;

    let ring = document.getElementById('ag-claude-ctx-ring');
    let newlyInserted = false;
    if (!ring) {
      newlyInserted = true;
      ring = document.createElement('button');
      ring.id = 'ag-claude-ctx-ring';
      ring.type = 'button';
      ring.setAttribute('data-no-drag', '');
      ring.setAttribute('data-ag-i18n-ignore', '1');
      ring.setAttribute('data-open', quotaPopoverOpen ? 'true' : 'false');
      ring.setAttribute('aria-label', '上下文与套餐使用限额');
      ring.innerHTML =
        '<svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true">' +
        '<circle class="ag-ctx-ring-track" cx="10" cy="10" r="7" fill="none" stroke-width="2.15"/>' +
        `<circle class="ag-ctx-ring-arc" cx="10" cy="10" r="7" fill="none" stroke-width="2.15" stroke-linecap="round" stroke-dasharray="${RING_CIRC.toFixed(
          2
        )}" stroke-dashoffset="${RING_CIRC.toFixed(2)}"/>` +
        '</svg>';
      ring.addEventListener('click', (e) => {
        e.stopPropagation();
        if (quotaPopoverOpen) {
          closeQuotaPopover();
        } else {
          openQuotaPopover();
        }
      });
    }

    if (modelWrap.nextElementSibling !== ring) {
      modelWrap.insertAdjacentElement('afterend', ring);
      newlyInserted = true;
    }

    updateComposerRingVisuals();

    if (newlyInserted && typeof window.__ag_ensure_metrics_pill_fn === 'function') {
      frame(() => {
        if (typeof window.__ag_ensure_metrics_pill_fn === 'function') {
          window.__ag_ensure_metrics_pill_fn(true);
        }
      });
    }
  }

  const onOutsidePopoverPointerDown = (e) => {
    if (!quotaPopoverOpen) return;
    const pop = document.getElementById('ag-claude-quota-popover');
    const ring = document.getElementById('ag-claude-ctx-ring');
    if ((pop && pop.contains(e.target)) || (ring && ring.contains(e.target))) return;
    closeQuotaPopover();
  };
  const onPopoverKeyDown = (e) => {
    if (quotaPopoverOpen && e.key === 'Escape') {
      closeQuotaPopover();
    }
  };
  const onWindowResizePopover = () => {
    if (quotaPopoverOpen) positionQuotaPopover();
    if (modelPopoverOpen) positionModelPopovers();
  };
  document.addEventListener('pointerdown', onOutsidePopoverPointerDown, true);
  document.addEventListener('keydown', onPopoverKeyDown, true);
  window.addEventListener('resize', onWindowResizePopover);

  /* ==========================================================================
   * 6. Claude-Style Stratified Model Selector Popover
   *    - Replaces crowded 9-row flat native list & noisy `新 / 快速` badges
   *    - Top: `模型 · 本次会话` + 4 core Gemini models (full names, `1-4` keys, blue `✓`)
   *    - Bottom: unified `思考强度 >` flyout (`Low/Medium/High/XHigh`) & `更多模型 >` flyout
   *    - Calls Antigravity's native React Fiber `setSelectedModel(option)` directly
   * ========================================================================== */
  const EFFORT_LABEL_RE = /^(.*?)\s*\((Low|Medium|High|XHigh|Max)\)\s*$/i;
  const EFFORT_NORM = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max' };
  const EFFORT_RANK = { Low: 0, Medium: 1, High: 2, XHigh: 3, Max: 4 };
  const EFFORT_DESC = {
    Low: '最快响应，轻量日常问答',
    Medium: '速度与推理均衡（默认）',
    High: '深度推演与复杂问题排障',
    XHigh: '极限长链深度推理',
    Max: '最高推理强度'
  };
  const SVG_CM_CHECK =
    '<svg class="ag-cm-check" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.2 8.4L6.5 11.7L13 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const SVG_CM_CHEVRON =
    '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  let modelPopoverOpen = false;
  let activeModelSubmenu = null; // null | 'effort' | 'more'
  let activeModelTriggerBtn = null;
  let lastPreferredEffort = 'Medium';
  let currentCatalogSnapshot = null;

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function findModelTriggerBtn() {
    if (activeModelTriggerBtn && document.body.contains(activeModelTriggerBtn)) {
      return activeModelTriggerBtn;
    }
    return document.querySelector('button[data-testid="model-selector-trigger"]');
  }

  function discoverModelSelectorApi(btnEl) {
    const btn = btnEl || findModelTriggerBtn();
    if (!btn) return null;
    const fk = Object.keys(btn).find((k) => k.startsWith('__reactFiber$'));
    let f = fk ? btn[fk] : null;
    for (let i = 0; i < 26 && f; i++, f = f.return) {
      const p = f.memoizedProps;
      if (p && typeof p.setSelectedModel === 'function' && Array.isArray(p.modelOptions) && p.modelOptions.length > 0) {
        return p;
      }
    }
    return null;
  }

  function buildModelCatalog(api) {
    const rawOpts = (api.modelOptions || []).filter((o) => o && !o.disabled && o.label);
    const customOpts = Array.isArray(api.customModels)
      ? api.customModels.filter((o) => o && !o.disabled && o.label)
      : [];
    const allOpts = rawOpts.concat(customOpts);

    const familyMap = new Map();
    for (const opt of allOpts) {
      const m = String(opt.label).match(EFFORT_LABEL_RE);
      const baseName = m ? m[1].trim() : String(opt.label).trim();
      const effort = m ? EFFORT_NORM[m[2].toLowerCase()] || m[2] : null;
      let fam = familyMap.get(baseName);
      if (!fam) {
        fam = { baseName, variants: [] };
        familyMap.set(baseName, fam);
      }
      fam.variants.push({ effort, opt });
    }

    for (const fam of familyMap.values()) {
      fam.variants.sort((a, b) => {
        const ra = a.effort && EFFORT_RANK[a.effort] !== undefined ? EFFORT_RANK[a.effort] : 99;
        const rb = b.effort && EFFORT_RANK[b.effort] !== undefined ? EFFORT_RANK[b.effort] : 99;
        return ra - rb;
      });
    }

    const families = Array.from(familyMap.values());
    const isOrch = (f) => /orchestrator/i.test(f.baseName);
    const isCoreGemini = (f) => /^gemini\b/i.test(f.baseName) && !isOrch(f);

    const coreRank = (name) => {
      if (/carbon/i.test(name)) return 0;
      if (/argon/i.test(name)) return 1;
      if (/hydrogen/i.test(name)) return 2;
      if (/flash/i.test(name)) return 3;
      return 10;
    };

    const primaryFamilies = families
      .filter(isCoreGemini)
      .sort((a, b) => coreRank(a.baseName) - coreRank(b.baseName))
      .slice(0, 4);

    const primarySet = new Set(primaryFamilies);
    const moreFamilies = families
      .filter((f) => !primarySet.has(f))
      .map((f) => ({
        group: isOrch(f) ? '多智能体编排' : '其他模型',
        fam: f
      }))
      .sort((a, b) => (a.group === b.group ? 0 : a.group === '多智能体编排' ? -1 : 1));

    const sel = api.selectedModel || null;
    let activeFamily = null;
    let activeVariant = null;

    if (sel) {
      for (const fam of families) {
        for (const v of fam.variants) {
          if (
            (sel.value !== undefined && v.opt.value === sel.value) ||
            (sel.modelId && v.opt.modelId === sel.modelId) ||
            v.opt.label === sel.label
          ) {
            activeFamily = fam;
            activeVariant = v;
            break;
          }
        }
        if (activeFamily) break;
      }
    }

    if (!activeFamily && primaryFamilies.length > 0) {
      activeFamily = primaryFamilies[0];
      activeVariant = activeFamily.variants[0] || null;
    }

    if (activeVariant && activeVariant.effort) {
      lastPreferredEffort = activeVariant.effort;
    }

    return {
      primaryFamilies,
      moreFamilies,
      activeFamily,
      activeVariant
    };
  }

  function pickVariantForFamily(fam, desiredEffort) {
    if (!fam || !fam.variants.length) return null;
    if (desiredEffort) {
      const exact = fam.variants.find((v) => v.effort === desiredEffort);
      if (exact) return exact.opt;
      if (desiredEffort === 'XHigh' || desiredEffort === 'Max') {
        const high = fam.variants.find((v) => v.effort === 'High');
        if (high) return high.opt;
      }
    }
    const med = fam.variants.find((v) => v.effort === 'Medium');
    return (med || fam.variants[0]).opt;
  }

  function ensureModelPopovers() {
    let mainPop = document.getElementById('ag-claude-model-popover');
    if (!mainPop) {
      mainPop = document.createElement('div');
      mainPop.id = 'ag-claude-model-popover';
      mainPop.setAttribute('data-ag-i18n-ignore', '1');
      mainPop.setAttribute('data-open', 'false');
      mainPop.addEventListener('mouseover', (e) => {
        const row = e.target.closest('[data-ag-cm-hover]');
        if (!row) return;
        const kind = row.getAttribute('data-ag-cm-hover');
        const nextSub = kind === 'none' ? null : kind;
        if (activeModelSubmenu !== nextSub) {
          activeModelSubmenu = nextSub;
          renderModelPopovers();
        }
      });
      mainPop.addEventListener('click', (e) => {
        e.stopPropagation();
        const famBtn = e.target.closest('[data-ag-cm-family]');
        if (famBtn) {
          const baseName = famBtn.getAttribute('data-ag-cm-family');
          const api = discoverModelSelectorApi();
          if (api) {
            const cat = buildModelCatalog(api);
            const fam = cat.primaryFamilies.find((f) => f.baseName === baseName);
            const targetOpt = pickVariantForFamily(fam, lastPreferredEffort);
            if (targetOpt) api.setSelectedModel(targetOpt);
          }
          closeClaudeModelPopover();
          return;
        }
        const subTrigger = e.target.closest('[data-ag-cm-subtrigger]');
        if (subTrigger) {
          if (subTrigger.getAttribute('data-disabled') === 'true') return;
          const kind = subTrigger.getAttribute('data-ag-cm-subtrigger');
          activeModelSubmenu = activeModelSubmenu === kind ? null : kind;
          renderModelPopovers();
        }
      });
      document.body.appendChild(mainPop);
    }

    let subPop = document.getElementById('ag-claude-model-subpop');
    if (!subPop) {
      subPop = document.createElement('div');
      subPop.id = 'ag-claude-model-subpop';
      subPop.setAttribute('data-ag-i18n-ignore', '1');
      subPop.setAttribute('data-open', 'false');
      subPop.addEventListener('click', (e) => {
        e.stopPropagation();
        const effBtn = e.target.closest('[data-ag-cm-effort]');
        if (effBtn) {
          const eff = effBtn.getAttribute('data-ag-cm-effort');
          const api = discoverModelSelectorApi();
          if (api) {
            const cat = buildModelCatalog(api);
            if (cat.activeFamily) {
              const v = cat.activeFamily.variants.find((x) => x.effort === eff);
              if (v && v.opt) {
                lastPreferredEffort = eff;
                api.setSelectedModel(v.opt);
              }
            }
          }
          closeClaudeModelPopover();
          return;
        }
        const moreBtn = e.target.closest('[data-ag-cm-more-family]');
        if (moreBtn) {
          const baseName = moreBtn.getAttribute('data-ag-cm-more-family');
          const api = discoverModelSelectorApi();
          if (api) {
            const cat = buildModelCatalog(api);
            const entry = cat.moreFamilies.find((x) => x.fam.baseName === baseName);
            const targetOpt = entry ? pickVariantForFamily(entry.fam, lastPreferredEffort) : null;
            if (targetOpt) api.setSelectedModel(targetOpt);
          }
          closeClaudeModelPopover();
        }
      });
      document.body.appendChild(subPop);
    }

    return { mainPop, subPop };
  }

  function positionModelPopovers() {
    const btn = findModelTriggerBtn();
    const mainPop = document.getElementById('ag-claude-model-popover');
    const subPop = document.getElementById('ag-claude-model-subpop');
    if (!btn || !mainPop) return;

    const r = btn.getBoundingClientRect();
    const mainW = 254;
    const left = Math.max(12, Math.min(Math.round(r.left), window.innerWidth - mainW - 14));
    const bottom = Math.max(12, Math.round(window.innerHeight - r.top + 8));
    mainPop.style.left = `${left}px`;
    mainPop.style.bottom = `${bottom}px`;

    if (subPop && subPop.getAttribute('data-open') === 'true') {
      const mr = mainPop.getBoundingClientRect();
      const subW = 236;
      let subLeft = Math.round(mr.right + 6);
      if (subLeft + subW > window.innerWidth - 10) {
        subLeft = Math.max(10, Math.round(mr.left - subW - 6));
      }
      subPop.style.left = `${subLeft}px`;
      subPop.style.bottom = `${bottom}px`;
    }
  }

  function renderModelPopoversRaw() {
    const api = discoverModelSelectorApi();
    if (!api) return;
    const { mainPop, subPop } = ensureModelPopovers();
    const cat = buildModelCatalog(api);
    currentCatalogSnapshot = cat;

    const multiEfforts = cat.activeFamily
      ? cat.activeFamily.variants.filter((v) => Boolean(v.effort))
      : [];
    const hasAdjustableEffort = multiEfforts.length > 1;
    const curEffortText =
      cat.activeVariant && cat.activeVariant.effort
        ? cat.activeVariant.effort
        : hasAdjustableEffort
          ? lastPreferredEffort
          : '固定';

    const activeInMore = cat.moreFamilies.some((x) => cat.activeFamily && x.fam.baseName === cat.activeFamily.baseName);
    const moreShortLabel =
      activeInMore && cat.activeFamily
        ? cat.activeFamily.baseName.replace(/^Orchestrator\s*/i, 'Orch ').replace(/^Claude\s+/i, '')
        : '';

    const primaryRowsHtml = cat.primaryFamilies
      .map((fam, idx) => {
        const isSelected = Boolean(cat.activeFamily && cat.activeFamily.baseName === fam.baseName);
        const rightHtml = isSelected ? SVG_CM_CHECK : `<span class="ag-cm-key">${idx + 1}</span>`;
        return `<button type="button" class="ag-cm-row" data-ag-cm-hover="none" data-ag-cm-family="${escapeHtml(
          fam.baseName
        )}">
          <span>${escapeHtml(fam.baseName)}</span>
          ${rightHtml}
        </button>`;
      })
      .join('');

    const effSubActive = activeModelSubmenu === 'effort' && hasAdjustableEffort ? ' data-active-sub="true"' : '';
    const effDisabled = hasAdjustableEffort ? '' : ' data-disabled="true"';
    const moreSubActive = activeModelSubmenu === 'more' ? ' data-active-sub="true"' : '';

    mainPop.innerHTML = `
      <div class="ag-cm-sec-hdr">模型 · 本次会话</div>
      <div>${primaryRowsHtml}</div>
      <div class="ag-cm-divider"></div>
      <button type="button" class="ag-cm-row" data-ag-cm-hover="${
        hasAdjustableEffort ? 'effort' : 'none'
      }" data-ag-cm-subtrigger="effort"${effSubActive}${effDisabled}>
        <span>思考强度</span>
        <span class="ag-cm-right"><span>${escapeHtml(curEffortText)}</span>${
          hasAdjustableEffort ? SVG_CM_CHEVRON : ''
        }</span>
      </button>
      <button type="button" class="ag-cm-row" data-ag-cm-hover="more" data-ag-cm-subtrigger="more"${moreSubActive}>
        <span style="display:inline-flex;align-items:center;gap:6px;">
          <span>更多模型</span>
          ${activeInMore ? '<span class="ag-cm-dot"></span>' : ''}
        </span>
        <span class="ag-cm-right">
          ${moreShortLabel ? `<span style="font-size:12px;">${escapeHtml(moreShortLabel)}</span>` : ''}
          ${SVG_CM_CHEVRON}
        </span>
      </button>
    `;

    if (activeModelSubmenu === 'effort' && hasAdjustableEffort) {
      const famTitle = cat.activeFamily ? cat.activeFamily.baseName : '';
      subPop.innerHTML =
        `<div class="ag-cm-sec-hdr">思考强度 · ${escapeHtml(famTitle)}</div>` +
        multiEfforts
          .map((v) => {
            const on = Boolean(cat.activeVariant && v.effort === cat.activeVariant.effort);
            const desc = EFFORT_DESC[v.effort] || '';
            return `<button type="button" class="ag-cm-row" data-ag-cm-effort="${escapeHtml(v.effort)}">
              <span>
                <span style="display:block;line-height:1.25;">${escapeHtml(v.effort)}</span>
                ${desc ? `<span class="ag-cm-sub-desc" style="display:block;">${escapeHtml(desc)}</span>` : ''}
              </span>
              ${on ? SVG_CM_CHECK : ''}
            </button>`;
          })
          .join('');
      subPop.setAttribute('data-open', 'true');
    } else if (activeModelSubmenu === 'more' && cat.moreFamilies.length > 0) {
      let lastGrp = '';
      subPop.innerHTML = cat.moreFamilies
        .map(({ group, fam }) => {
          let hdr = '';
          if (group !== lastGrp) {
            hdr = `${lastGrp ? '<div class="ag-cm-divider"></div>' : ''}<div class="ag-cm-sec-hdr">${escapeHtml(
              group
            )}</div>`;
            lastGrp = group;
          }
          const on = Boolean(cat.activeFamily && cat.activeFamily.baseName === fam.baseName);
          return `${hdr}<button type="button" class="ag-cm-row" style="min-height:34px;font-size:13.5px;" data-ag-cm-more-family="${escapeHtml(
            fam.baseName
          )}">
            <span>${escapeHtml(fam.baseName)}</span>
            ${on ? SVG_CM_CHECK : ''}
          </button>`;
        })
        .join('');
      subPop.setAttribute('data-open', 'true');
    } else {
      subPop.setAttribute('data-open', 'false');
    }

    positionModelPopovers();
  }

  /* ---- menu accessibility: roles, inert when closed, focus preserved across re-renders ---- */
  const MENU_KEY_ATTRS = ['data-ag-cm-family', 'data-ag-cm-subtrigger', 'data-ag-cm-effort', 'data-ag-cm-more-family'];
  let focusBeforeModelMenu = null;
  let lastKeyToggleTs = 0;

  function menuFocusKey(el) {
    if (!el || !el.getAttribute) return null;
    for (const a of MENU_KEY_ATTRS) if (el.hasAttribute(a)) return [a, el.getAttribute(a)];
    return null;
  }

  function findMenuRowByKey(key) {
    if (!key) return null;
    for (const id of ['ag-claude-model-popover', 'ag-claude-model-subpop']) {
      const pop = document.getElementById(id);
      if (!pop) continue;
      for (const row of pop.querySelectorAll(`[${key[0]}]`)) if (row.getAttribute(key[0]) === key[1]) return row;
    }
    return null;
  }

  function isInModelMenu(el) {
    return Boolean(el && el.closest && el.closest('#ag-claude-model-popover, #ag-claude-model-subpop'));
  }

  function syncMenuA11y() {
    for (const id of ['ag-claude-model-popover', 'ag-claude-model-subpop']) {
      const pop = document.getElementById(id);
      if (!pop) continue;
      const open = pop.getAttribute('data-open') === 'true';
      pop.setAttribute('role', 'menu');
      pop.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (open) pop.removeAttribute('inert');
      else pop.setAttribute('inert', '');
      pop.querySelectorAll('.ag-cm-row').forEach((row) => {
        row.setAttribute('role', 'menuitem');
        row.setAttribute('tabindex', '-1');
        if (row.getAttribute('data-disabled') === 'true') row.setAttribute('aria-disabled', 'true');
      });
      pop.querySelectorAll('[data-ag-cm-subtrigger]').forEach((row) => {
        row.setAttribute('aria-haspopup', 'menu');
        row.setAttribute('aria-expanded', row.hasAttribute('data-active-sub') ? 'true' : 'false');
      });
    }
  }

  function renderModelPopovers() {
    const active = document.activeElement;
    const key = isInModelMenu(active) ? menuFocusKey(active) : null;
    renderModelPopoversRaw();
    syncMenuA11y();
    if (key) {
      const row = findMenuRowByKey(key);
      if (row) row.focus();
    }
  }

  function menuRows(pop) {
    return pop ? Array.from(pop.querySelectorAll('.ag-cm-row')).filter((r) => r.getAttribute('data-disabled') !== 'true') : [];
  }

  function focusFirstRow(pop, preferSelected) {
    const rows = menuRows(pop);
    if (!rows.length) return;
    const sel = preferSelected ? rows.find((r) => r.querySelector('.ag-cm-check')) : null;
    (sel || rows[0]).focus();
  }

  function openClaudeModelPopover(btnEl, opts = {}) {
    const btn = btnEl || findModelTriggerBtn();
    const api = discoverModelSelectorApi(btn);
    if (!api) return false;
    if (quotaPopoverOpen) closeQuotaPopover();
    if (api.open && typeof api.setIsOpen === 'function') {
      try {
        api.setIsOpen(false);
      } catch {}
    }
    focusBeforeModelMenu = document.activeElement && document.activeElement !== document.body ? document.activeElement : btn;
    activeModelTriggerBtn = btn;
    modelPopoverOpen = true;
    activeModelSubmenu = null;
    if (btn) {
      btn.setAttribute('data-ag-model-open', 'true');
      btn.setAttribute('aria-expanded', 'true');
    }
    const { mainPop } = ensureModelPopovers();
    renderModelPopoversRaw();
    mainPop.setAttribute('data-open', 'true');
    syncMenuA11y();
    positionModelPopovers();
    if (opts.focus) focusFirstRow(mainPop, true);
    return true;
  }

  function closeClaudeModelPopover(opts = {}) {
    const hadFocus = isInModelMenu(document.activeElement);
    modelPopoverOpen = false;
    activeModelSubmenu = null;
    currentCatalogSnapshot = null;
    if (activeModelTriggerBtn) {
      activeModelTriggerBtn.removeAttribute('data-ag-model-open');
      activeModelTriggerBtn.setAttribute('aria-expanded', 'false');
    }
    document.querySelectorAll('button[data-ag-model-open]').forEach((el) => el.removeAttribute('data-ag-model-open'));
    const mainPop = document.getElementById('ag-claude-model-popover');
    const subPop = document.getElementById('ag-claude-model-subpop');
    if (mainPop) mainPop.setAttribute('data-open', 'false');
    if (subPop) subPop.setAttribute('data-open', 'false');
    syncMenuA11y();
    if (opts.returnFocus || hadFocus) {
      const target =
        focusBeforeModelMenu && document.body.contains(focusBeforeModelMenu) ? focusBeforeModelMenu : activeModelTriggerBtn;
      if (target && typeof target.focus === 'function') target.focus();
    }
    focusBeforeModelMenu = null;
  }

  function toggleClaudeModelPopover(btnEl, opts) {
    if (modelPopoverOpen) {
      closeClaudeModelPopover({ returnFocus: Boolean(opts && opts.focus) });
      return true;
    }
    return openClaudeModelPopover(btnEl, opts);
  }

  const TRIGGER_SEL = 'button[data-testid="model-selector-trigger"]';

  const onModelTriggerPointerDown = (e) => {
    const trigger = e.target && e.target.closest && e.target.closest(TRIGGER_SEL);
    if (trigger) {
      if (e.button !== undefined && e.button !== 0) return;
      const api = discoverModelSelectorApi(trigger);
      if (!api) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      toggleClaudeModelPopover(trigger);
      return;
    }
    if (!modelPopoverOpen) return;
    if (isInModelMenu(e.target)) return;
    closeClaudeModelPopover();
  };

  /* Mouse: the menu already toggled on pointerdown, so swallow the follow-up mousedown/click.
     Keyboard / assistive tech: activation arrives as a click with detail === 0 -> toggle here. */
  const onModelTriggerSwallowMouseClick = (e) => {
    const trigger = e.target && e.target.closest && e.target.closest(TRIGGER_SEL);
    if (!trigger) return;
    const api = discoverModelSelectorApi(trigger);
    if (!api) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.type === 'click' && e.detail === 0 && Date.now() - lastKeyToggleTs > 1000) {
      lastKeyToggleTs = Date.now();
      toggleClaudeModelPopover(trigger, { focus: true });
    }
  };

  const onModelPopoverKeyDown = (e) => {
    if (disposed) return;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === '/') {
      const btn = findModelTriggerBtn();
      if (btn && discoverModelSelectorApi(btn)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        toggleClaudeModelPopover(btn, { focus: true });
        return;
      }
    }

    const trig = e.target && e.target.closest && e.target.closest(TRIGGER_SEL);
    if (trig && plain && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      if (discoverModelSelectorApi(trig)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        lastKeyToggleTs = Date.now();
        if (modelPopoverOpen && e.key.startsWith('Arrow')) {
          focusFirstRow(document.getElementById('ag-claude-model-popover'), true);
        } else {
          toggleClaudeModelPopover(trig, { focus: true });
        }
        return;
      }
    }

    if (!modelPopoverOpen) return;
    const mainPop = document.getElementById('ag-claude-model-popover');
    const subPop = document.getElementById('ag-claude-model-subpop');
    const active = document.activeElement;
    const inSub = Boolean(subPop && subPop.contains(active));
    const inMain = Boolean(mainPop && mainPop.contains(active));
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    if (e.key === 'Escape') {
      stop();
      if (inSub && activeModelSubmenu) {
        const kind = activeModelSubmenu;
        activeModelSubmenu = null;
        renderModelPopovers();
        const t = mainPop && mainPop.querySelector(`[data-ag-cm-subtrigger="${kind}"]`);
        if (t) t.focus();
      } else {
        closeClaudeModelPopover({ returnFocus: true });
      }
      return;
    }
    if (e.key === 'Tab' && (inMain || inSub)) {
      stop();
      closeClaudeModelPopover({ returnFocus: true });
      return;
    }
    if (plain && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      stop();
      const rows = menuRows(inSub ? subPop : mainPop);
      if (!rows.length) return;
      const down = e.key === 'ArrowDown';
      let idx = rows.indexOf(active);
      idx = idx < 0 ? (down ? 0 : rows.length - 1) : (idx + (down ? 1 : -1) + rows.length) % rows.length;
      rows[idx].focus();
      return;
    }
    if (plain && e.key === 'ArrowRight' && inMain && active.hasAttribute('data-ag-cm-subtrigger')) {
      stop();
      if (active.getAttribute('data-disabled') === 'true') return;
      activeModelSubmenu = active.getAttribute('data-ag-cm-subtrigger');
      renderModelPopovers();
      focusFirstRow(subPop, true);
      return;
    }
    if (plain && e.key === 'ArrowLeft' && inSub) {
      stop();
      const kind = activeModelSubmenu;
      activeModelSubmenu = null;
      renderModelPopovers();
      const t = mainPop && mainPop.querySelector(`[data-ag-cm-subtrigger="${kind}"]`);
      if (t) t.focus();
      return;
    }
    if (plain && /^[1-4]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      const api = discoverModelSelectorApi();
      if (api) {
        const cat = currentCatalogSnapshot || buildModelCatalog(api);
        const fam = cat.primaryFamilies[idx];
        if (fam) {
          stop();
          const targetOpt = pickVariantForFamily(fam, lastPreferredEffort);
          if (targetOpt) api.setSelectedModel(targetOpt);
          closeClaudeModelPopover({ returnFocus: true });
        }
      }
    }
  };

  if (FEAT.modelMenu) {
    document.addEventListener('pointerdown', onModelTriggerPointerDown, true);
    document.addEventListener('mousedown', onModelTriggerSwallowMouseClick, true);
    document.addEventListener('click', onModelTriggerSwallowMouseClick, true);
    document.addEventListener('keydown', onModelPopoverKeyDown, true);
  }

  /* ---- scheduling: rAF-coalesced, throttled, and blind to our own DOM writes ---- */
  const MIN_SYNC_GAP_MS = 80;
  let throttleTimer = 0;
  function scheduleSync() {
    if (disposed || rafPending || throttleTimer) return;
    const wait = MIN_SYNC_GAP_MS - (Date.now() - lastSyncTs);
    if (wait > 0) {
      throttleTimer = later(() => {
        throttleTimer = 0;
        scheduleSync();
      }, wait);
      return;
    }
    rafPending = true;
    frame(syncStepStream);
  }

  const OWN_SEL =
    '.ag-claude-todo-card, .ag-claude-todo-live-dock, .ag-collapse-ghost, .ag-orbit-dots, .ag-elapsed-timer, #ag-claude-ctx-ring, #ag-claude-quota-popover, #ag-claude-model-popover, #ag-claude-model-subpop';
  const CLASS_WATCH_SEL =
    'ul.contains-task-list, [id="antigravity.agentSidePanelInputBox"], [data-testid="tool-group-collapsible"], [data-testid="worked-for-collapsible"]';

  function isOwnNode(n) {
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    return Boolean(el && el.closest && el.closest(OWN_SEL));
  }

  function isOwnChildListMutation(m) {
    if (isOwnNode(m.target)) return true;
    const total = m.addedNodes.length + m.removedNodes.length;
    if (!total) return true;
    for (const n of m.addedNodes) if (!isOwnNode(n)) return false;
    for (const n of m.removedNodes) if (!isOwnNode(n)) return false;
    return true;
  }

  const observer = new MutationObserver((mutations) => {
    if (disposed) return;
    let needSync = false;
    for (const m of mutations) {
      if (m.type === 'attributes') {
        const t = m.target;
        if (!t || !t.getAttribute) continue;
        if (m.attributeName === 'aria-expanded') {
          if (FEAT.collapseAnim && t.getAttribute('data-testid') === 'tool-group-collapsible' && t.getAttribute('aria-expanded') === 'false') {
            animateCollapseIfNeeded(t);
          }
          if (!isOwnNode(t)) needSync = true;
        } else if (m.attributeName === 'class') {
          if (!isOwnNode(t) && t.closest && t.closest(CLASS_WATCH_SEL)) needSync = true;
        }
      } else if (m.type === 'childList') {
        if (!isOwnChildListMutation(m)) needSync = true;
      }
    }
    if (needSync) scheduleSync();
  });

  if (document.body) {
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-expanded', 'class']
    });
    syncStepStream();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    for (const id of pendingRafs) cancelAnimationFrame(id);
    pendingRafs.clear();
    for (const id of pendingTimeouts) clearTimeout(id);
    pendingTimeouts.clear();
    if (timerIntervalId) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
    }
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('pointerdown', onOutsidePopoverPointerDown, true);
    document.removeEventListener('keydown', onPopoverKeyDown, true);
    document.removeEventListener('pointerdown', onModelTriggerPointerDown, true);
    document.removeEventListener('mousedown', onModelTriggerSwallowMouseClick, true);
    document.removeEventListener('click', onModelTriggerSwallowMouseClick, true);
    document.removeEventListener('keydown', onModelPopoverKeyDown, true);
    window.removeEventListener('resize', onWindowResizePopover);
    if (ownMetricsWrapper && window.__ag_render_metrics === ownMetricsWrapper) {
      window.__ag_render_metrics = ownMetricsWrapper.__agOrig;
    }
    document
      .querySelectorAll(
        '.ag-collapse-ghost, .ag-orbit-dots, .ag-elapsed-timer, [data-ag-todo-mount], [data-ag-todo-dock], #ag-claude-ctx-ring, #ag-claude-quota-popover, #ag-claude-model-popover, #ag-claude-model-subpop'
      )
      .forEach((el) => el.remove());
    document
      .querySelectorAll('[data-ag-todo-primary], [data-ag-todo-merged], [data-ag-todo-empty-wrap], [data-ag-model-open], [data-ag-inline-stream]')
      .forEach((el) => {
        el.removeAttribute('data-ag-todo-primary');
        el.removeAttribute('data-ag-todo-merged');
        el.removeAttribute('data-ag-todo-empty-wrap');
        el.removeAttribute('data-ag-model-open');
        el.removeAttribute('data-ag-inline-stream');
      });
    if (window.__agClaudeUxDispose === dispose) window.__agClaudeUxDispose = null;
  }

  window.__agClaudeUxDispose = dispose;
  if (typeof ctx !== 'undefined' && ctx && typeof ctx.onCleanup === 'function') {
    ctx.onCleanup(dispose);
  }
})();
