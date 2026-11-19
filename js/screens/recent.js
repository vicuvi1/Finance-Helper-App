// Undo everywhere and the "Recent actions" panel (key U, the clock button in
// the sidebar and next to the Log's undo buttons). The rules are in
// js/undolog.js; app.js keeps the session undo and asks `guard` before every
// step, so Ctrl+Z never undoes another device's change, or overwrites a newer
// edit, without asking first.

import { ctx, esc } from '../ctx.js';
import { formatMoney } from '../money.js';
import { DEVICES } from '../changelog.js';
import * as Store from '../changestore.js';
import { groupsOf, stacksOf, recentActions, labelOf, risks, applyGroup, nothingToDo } from '../undolog.js';
import { isTyping } from '../shortcuts.js';

const fmt = (amount, cur) => formatMoney(amount, cur || '');
const devName = (d) => DEVICES[d] || d;
const clock = (at) => {
  const d = new Date(at);
  const today = new Date();
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === today.toDateString() ? t : `${d.getDate()}/${d.getMonth() + 1} ${t}`;
};

const stacks = () => stacksOf(Store.entries(), Store.thisDevice);

/** The action the next Ctrl+Z (dir < 0) or Ctrl+Y (dir > 0) would take: the session step's group, else the log's top. */
export function target(dir) {
  if (ctx.canSession?.(dir)) {
    const grp = ctx.topGrp?.(dir);
    return { source: 'session', group: grp ? groupsOf(Store.entries(), Store.thisDevice).find((g) => g.grp === grp) || null : null };
  }
  const st = stacks();
  const g = (dir < 0 ? st.undo : st.redo).at(-1) || null;
  return g ? { source: 'log', group: g } : null;
}

/** Label of the next undo / redo that only the log knows (after a reload), for the buttons. */
export function nextLabel(dir) {
  try {
    const t = target(dir);
    return t?.group ? labelOf(t.group, fmt) : null;
  } catch { return null; }
}

function describeRisk(g, r) {
  const parts = [];
  if (r.foreign.length) parts.push(`This change was made on ${[...new Set(r.foreign.map(devName))].join(' and ')} at ${clock(g.at)}.`);
  if (r.changed.length) parts.push(`${r.changed.length === 1 ? 'That record was' : `${r.changed.length} records were`} changed again since, so this puts the older version back over the newer one.`);
  return parts.join(' ');
}

function askFirst(g, dir, r, go) {
  ctx.openSheet(`<h3>${dir < 0 ? 'Undo' : 'Redo'} this? <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p><b>${esc(labelOf(g, fmt))}</b></p>
    <p data-testid="undo-ask-text">${esc(describeRisk(g, r))}</p>
    <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn primary" data-ask-ok data-testid="undo-ask-ok">${dir < 0 ? 'Undo it anyway' : 'Redo it anyway'}</button></div>`, (sheet) => {
    sheet.querySelector('[data-ask-ok]').addEventListener('click', (e) => { e.target.disabled = true; ctx.closeSheet(); go(); });
  });
}

/** app.js calls this before each Ctrl+Z / Ctrl+Y step. True when it asked instead (it runs the step itself on OK). */
export function guard(dir, force) {
  if (force) return false;
  let t = null;
  try { t = target(dir); } catch { return false; }
  if (!t?.group) return false;
  const r = risks(ctx.state, t.group, dir);
  if (!r.foreign.length && !r.changed.length) return false;
  askFirst(t.group, dir, r, () => ctx.undoRedo(dir, true));
  return true;
}

function run(g, dir) {
  applyGroup(ctx.state, g.entries, dir);
  ctx.finishRevert(dir, labelOf(g, fmt), g.entries[0].id);
}

/** The step when the session has nothing to undo (after a reload): from the log. True when it did something. */
export function step(dir) {
  const t = target(dir);
  if (!t || t.source !== 'log' || !t.group) return false;
  if (nothingToDo(ctx.state, t.group.entries, dir)) { ctx.toast('Already like this'); return true; }
  run(t.group, dir);
  return true;
}

/** Any action from the panel: the top one goes through Ctrl+Z, an older one is put back on its own (after asking). */
function revert(g, dir) {
  const st = stacks();
  const top = (dir < 0 ? st.undo : st.redo).at(-1);
  if (top && top.grp === g.grp && g.mine) { ctx.undoRedo(dir); return; }
  const r = risks(ctx.state, g, dir);
  const go = () => {
    if (nothingToDo(ctx.state, g.entries, dir)) { ctx.toast('Already like this'); return; }
    ctx.clearSession?.(); // the session steps no longer match the data
    run(g, dir);
  };
  if (r.foreign.length || r.changed.length) askFirst(g, dir, r, go); else go();
}

function rowHTML(g) {
  const undone = g.status === 'undone';
  const mine = g.mine;
  return `<div class="ra-row${undone ? ' undone' : ''}" data-testid="ra-row" data-grp="${esc(g.grp)}">
    <div class="ra-main"><b class="ra-label">${esc(labelOf(g, fmt))}</b>
      <span class="muted small">${esc(clock(g.at))} · ${esc(mine ? `${devName(g.dev)} (this device)` : devName(g.dev))}${undone ? ' · undone' : ''}</span></div>
    <button type="button" class="btn sm" data-ra="${undone ? 'redo' : 'undo'}" data-grp="${esc(g.grp)}" data-testid="ra-${undone ? 'redo' : 'undo'}">${undone ? 'Redo this' : 'Undo this'}</button></div>`;
}

export function panelHTML() {
  const list = recentActions(Store.entries(), Store.thisDevice);
  return `<h3>Recent actions <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <div class="ra-list" data-testid="ra-list">${list.length ? list.map(rowHTML).join('') : '<p class="muted" data-testid="ra-empty">Nothing yet. Every add, edit and delete shows up here for 90 days, with Undo.</p>'}</div>
    <p class="muted small">Ctrl+Z undoes the latest change on any screen, Ctrl+Y puts it back. A change made on another device always asks first.</p>`;
}

export function openPanel() {
  if (ctx.state._sealed) return;
  Store.ensureLoaded().finally(() => {
    ctx.openSheet(panelHTML(), (sheet) => {
      sheet.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ra]');
        if (!b) return;
        const g = groupsOf(Store.entries(), Store.thisDevice).find((x) => x.grp === b.dataset.grp);
        if (!g) return;
        ctx.closeSheet();
        revert(g, b.dataset.ra === 'redo' ? 1 : -1);
      });
    });
  });
}

/** The small button for the sidebar. */
export const sideButton = () => '<button type="button" class="ra-side" data-act="recent-actions" data-testid="recent-open" title="Recent actions (U)">🕘 Recent actions</button>';

let bound = false;
export function init() {
  if (bound) return;
  bound = true;
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('[data-act="recent-actions"]')) { e.preventDefault(); openPanel(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'u' && e.key !== 'U') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (isTyping(e.target) || document.querySelector('#sheet-root .sheet') || ctx.state?._sealed) return;
    e.preventDefault();
    openPanel();
  });
}
