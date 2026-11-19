// Saved views above the Log: one-click chips that set the search, the type
// filter, the month and the Log view together; Save this view; Manage
// (rename, reorder, pin up to 8, delete). The rules are in js/savedviews.js.

import { ctx, esc } from '../ctx.js';
import { todayISO } from '../dates.js';
import { MAX_PINNED, viewsOf, pinnedViews, snapshotView, resolveView, suggestName, addView, renameView, removeView, moveView, setPinned } from '../savedviews.js';

function current() {
  return { search: ctx.ui.search.trim(), filter: ctx.ui.filter, month: ctx.ui.month, view: ctx.state.settings.logView || '' };
}

const isOn = (v) => {
  const r = resolveView(v, todayISO());
  return r.search === ctx.ui.search.trim() && r.filter === ctx.ui.filter && (!ctx.ui.search.trim() ? r.month === ctx.ui.month : true);
};

/** The bar for the Log (above the quick chips). */
export function barHTML(state, ui) {
  const list = pinnedViews(state);
  const total = viewsOf(state).length;
  const canSave = !!ui.search.trim() || ui.filter !== 'all';
  const chips = list.map((v) => `<button type="button" class="sv-chip${isOn(v) ? ' on' : ''}" data-sv="apply" data-id="${esc(v.id)}" aria-pressed="${isOn(v)}" title="${esc(v.q || 'Everything')}${v.filter !== 'all' ? ` · ${esc(v.filter)}` : ''}" data-testid="sv-chip">★ ${esc(v.name)}</button>`).join('');
  return `<div class="sv-bar" data-testid="saved-views">${chips}
    ${canSave ? '<button type="button" class="sv-chip sv-add" data-sv="save" data-testid="sv-save">☆ Save this view</button>' : ''}
    ${total ? `<button type="button" class="sv-chip sv-manage" data-sv="manage" data-testid="sv-manage">Manage${total > list.length ? ` (${total})` : ''}</button>` : ''}</div>`;
}

function apply(v) {
  const r = resolveView(v, todayISO());
  const ui = ctx.ui;
  ui.search = r.search;
  ui.filter = r.filter;
  ui.month = r.month;
  ui.selected?.clear();
  const viewChanged = r.view && ctx.state.settings.logView !== r.view;
  if (viewChanged) { ctx.state.settings.logView = r.view; ctx.persist({ quiet: true }); }
  if (location.hash !== '#log') location.hash = '#log'; else ctx.render();
}

function openSave() {
  const cur = current();
  const name = suggestName(cur.search || (cur.filter !== 'all' ? cur.filter : ''));
  ctx.openSheet(`<h3>Save this view <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p class="muted small" style="margin-top:0">Saves the search${cur.filter !== 'all' ? ', the type filter' : ''} and the Log view. Words like "this month" stay relative, so it is always up to date.</p>
    <label class="field"><span>Name</span><input type="text" id="sv-name" maxlength="40" value="${esc(name)}" data-testid="sv-name" autocomplete="off"></label>
    <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn primary" data-sv="save-ok" data-testid="sv-save-ok">Save</button></div>`, (sheet) => {
    const input = sheet.querySelector('#sv-name');
    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sheet.querySelector('[data-sv="save-ok"]').click(); } });
  });
}

function manageHTML() {
  const list = viewsOf(ctx.state);
  if (!list.length) return '<p class="muted">No saved views yet. Search or filter the Log, then press "Save this view".</p>';
  const pinned = list.filter((v) => v.pinned).length;
  return `<div class="sv-list" data-testid="sv-list">${list.map((v, i) => `<div class="sv-row">
    <input type="text" class="sv-rename" data-sv-name="${esc(v.id)}" value="${esc(v.name)}" maxlength="40" aria-label="Name" data-testid="sv-rename">
    <span class="muted small sv-q">${esc(v.q || 'Everything')}${v.filter !== 'all' ? ` · ${esc(v.filter)}` : ''}</span>
    <label class="sv-pin" title="Show as a chip above the Log (up to ${MAX_PINNED})"><input type="checkbox" data-sv="pin" data-id="${esc(v.id)}" ${v.pinned ? 'checked' : ''} ${!v.pinned && pinned >= MAX_PINNED ? 'disabled' : ''}> Pinned</label>
    <button type="button" class="icon-btn" data-sv="up" data-id="${esc(v.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
    <button type="button" class="icon-btn" data-sv="down" data-id="${esc(v.id)}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
    <button type="button" class="icon-btn" data-sv="del" data-id="${esc(v.id)}" aria-label="Delete ${esc(v.name)}" data-testid="sv-del">🗑</button></div>`).join('')}</div>`;
}

function openManage() {
  ctx.openSheet(`<h3>Saved views <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <div id="sv-body">${manageHTML()}</div>
    <p class="muted small">Pin up to ${MAX_PINNED} to show them as chips above the Log. They sync with your other devices.</p>`);
}

function refreshManage() {
  const body = document.getElementById('sv-body');
  if (body) body.innerHTML = manageHTML();
}

function mutate(fn) {
  fn();
  ctx.commit();
  refreshManage();
}

let bound = false;
export function init() {
  if (bound) return;
  bound = true;
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-sv]');
    if (!el || ctx.state._sealed) return;
    const a = el.dataset.sv;
    const v = el.dataset.id && viewsOf(ctx.state).find((x) => x.id === el.dataset.id);
    if (a === 'apply' && v) apply(v);
    else if (a === 'save') openSave();
    else if (a === 'manage') openManage();
    else if (a === 'save-ok') {
      const name = document.getElementById('sv-name')?.value || '';
      const view = snapshotView(name, current(), todayISO());
      addView(ctx.state, view);
      ctx.closeSheet();
      ctx.commit();
      ctx.toast(`Saved "${view.name}". Tap its chip to open it again.`);
    } else if (a === 'up' && v) mutate(() => moveView(ctx.state, v.id, -1));
    else if (a === 'down' && v) mutate(() => moveView(ctx.state, v.id, 1));
    else if (a === 'del' && v) mutate(() => removeView(ctx.state, v.id));
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el?.dataset?.sv === 'pin') {
      if (setPinned(ctx.state, el.dataset.id, el.checked) === null) { ctx.toast(`Up to ${MAX_PINNED} pinned views`); refreshManage(); return; }
      ctx.commit();
      refreshManage();
    } else if (el?.dataset?.svName) {
      mutate(() => renameView(ctx.state, el.dataset.svName, el.value));
    }
  });
}
