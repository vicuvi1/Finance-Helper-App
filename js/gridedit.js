// Spreadsheet feel for the Log's Sheet (#sheet-grid) and Table (#tx-table):
// an active cell, arrow keys, Enter / F2 to edit, type to replace, Tab,
// ranges (Shift+arrows, Shift+click), Ctrl+C / X / V for cells and columns,
// Delete to clear a cell, Ctrl+D to fill down, and a type-to-filter dropdown
// for category / account / type cells. The key rules and the clipboard parsing
// are pure and tested (js/gridnav.js).
//
// Nothing here writes data itself: a cell is changed by setting the real box's
// value and firing its normal `change` event, so the app's own save path runs
// (validation, change history, undo, sync). Mouse editing is unchanged: a click
// in a box edits it as before.

import { ctx } from './ctx.js';
import { isTyping } from './shortcuts.js';
import * as N from './gridnav.js';

const GRIDS = [
  { id: 'sheet', sel: '#sheet-grid', rows: 'tbody tr[data-date]', ctl: 'input[data-sh]', key: (tr) => { const k = tr.querySelector('[data-sh]')?.dataset.sh.split('|'); return k ? `${k[0]}#${k[2]}` : null; } },
  { id: 'table', sel: '#tx-table', rows: 'tbody tr[data-id], tbody tr[data-draft]', ctl: '[data-col]', key: (tr) => tr.dataset.id || 'draft' },
];

const st = { key: null, c: 0, akey: null, ac: 0, mode: 'nav', orig: '' };
let pop = null;

const settle = () => new Promise((res) => setTimeout(res, 30));
const openSheetNow = () => !!document.querySelector('#sheet-root .sheet');

function model() {
  for (const g of GRIDS) {
    const root = document.querySelector(g.sel);
    if (!root) continue;
    const rows = [...root.querySelectorAll(g.rows)].filter((tr) => tr.querySelector(g.ctl));
    if (!rows.length) continue;
    const idx = new Set();
    for (const tr of rows) for (const td of tr.cells) if (td.querySelector(g.ctl)) idx.add(td.cellIndex);
    return { g, root, rows, cols: [...idx].sort((a, b) => a - b), keys: rows.map(g.key) };
  }
  return null;
}
const dims = (m) => ({ rows: m.rows.length, cols: m.cols.length });
const tdAt = (m, r, c) => m.rows[r]?.cells[m.cols[c]] || null;
const ctlOf = (td, m) => td?.querySelector(m.g.ctl) || null;
const posOf = (m, key = st.key, c = st.c) => { const r = m.keys.indexOf(key); return r < 0 ? null : { r, c }; };
const rect = (m) => {
  const a = posOf(m, st.akey, st.ac) || posOf(m);
  const b = posOf(m);
  return a && b ? N.rectOf(a, b) : null;
};
const textOf = (ctl) => (!ctl ? '' : ctl.tagName === 'SELECT' ? (ctl.selectedOptions[0]?.textContent || '').trim() : ctl.value);

// ---------- Painting ----------

function paint(m) {
  for (const root of document.querySelectorAll('.gx-active, .gx-sel')) root.classList.remove('gx-active', 'gx-sel');
  if (!m || !st.key) return;
  const rc = rect(m);
  const p = posOf(m);
  if (!rc || !p) return;
  const multi = !N.isSingle(rc);
  for (let r = rc.r1; r <= rc.r2; r++) for (let c = rc.c1; c <= rc.c2; c++) {
    const td = tdAt(m, r, c);
    if (!td) continue;
    if (multi) td.classList.add('gx-sel');
  }
  const a = tdAt(m, p.r, p.c);
  a?.classList.add('gx-active');
  if (m.g.id === 'sheet' && a) {
    const addr = document.getElementById('gs-cell-addr');
    const text = document.getElementById('gs-formula-text');
    if (addr) addr.textContent = `${['B', 'C', 'D', 'E'][p.c] || ''}${m.rows[p.r].querySelector('.gs-rn')?.textContent || ''}`;
    if (text) text.textContent = textOf(ctlOf(a, m)) || '(empty)';
  }
}

function activate(m, r, c, { extend = false, focus = true } = {}) {
  r = N.clamp(r, 0, m.rows.length - 1);
  c = N.clamp(c, 0, m.cols.length - 1);
  st.key = m.keys[r];
  st.c = c;
  if (!extend) { st.akey = st.key; st.ac = c; }
  st.mode = 'nav';
  paint(m);
  const td = tdAt(m, r, c);
  if (td && focus) {
    td.tabIndex = -1;
    td.focus({ preventScroll: true });
    td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function deactivate() {
  st.key = null;
  st.mode = 'nav';
  paint(null);
}

// A save re-draws the page: put the highlight (and the focus) back on the same cell.
let queued = false;
function reapply() {
  queued = false;
  if (!st.key || pop) return;
  const m = model();
  if (!m) { st.key = null; return; }
  const p = posOf(m);
  if (!p) { st.key = null; return; }
  paint(m);
  const a = document.activeElement;
  if (st.mode === 'nav' && (!a || a === document.body || !a.isConnected)) {
    const td = tdAt(m, p.r, p.c);
    if (td) { td.tabIndex = -1; td.focus({ preventScroll: true }); }
  }
}
const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(reapply); } };

// ---------- Editing one cell ----------

function startEdit(m, r, c, char) {
  const td = tdAt(m, r, c);
  const ctl = ctlOf(td, m);
  if (!ctl || ctl.type === 'checkbox') return;
  if (ctl.tagName === 'SELECT') { openPop(m, td, ctl, char || ''); return; }
  st.mode = 'edit';
  st.orig = ctl.value;
  ctl.focus();
  if (char !== undefined && ctl.type !== 'date') {
    ctl.value = char;
    ctl.dispatchEvent(new Event('input', { bubbles: true }));
  }
  try { if (ctl.type === 'text') { const n = ctl.value.length; ctl.setSelectionRange(n, n); } } catch { /* date boxes have no caret */ }
}

function cancelEdit(m) {
  const p = posOf(m);
  const ctl = p && ctlOf(tdAt(m, p.r, p.c), m);
  if (ctl) { ctl.value = st.orig; ctl.blur(); }
  if (p) activate(m, p.r, p.c);
}

function addRowAfter(m, p) {
  if (m.g.id !== 'sheet') return;
  const date = m.rows[p.r].dataset.date;
  const btn = m.root.querySelector(`[data-act="sh-add"][data-date="${date}"]`);
  if (!btn) return;
  btn.click();
  setTimeout(() => {
    const m2 = model();
    if (!m2) return;
    document.activeElement?.blur?.();
    activate(m2, m2.rows.length - 1, p.c);
  }, 0);
}

function commit(m, dir) {
  const p = posOf(m);
  if (!p) return;
  const ctl = ctlOf(tdAt(m, p.r, p.c), m);
  const had = !!ctl?.value.trim();
  let to = { r: p.r, c: p.c };
  if (dir === 'down') to.r += 1;
  else if (dir === 'up') to.r -= 1;
  else { const t = N.tabCell(p, dir === 'left', dims(m)); to = t.edge ? { r: p.r, c: p.c } : t; }
  const beyond = to.r >= m.rows.length;
  to.r = N.clamp(to.r, 0, m.rows.length - 1);
  const nextKey = m.keys[to.r];
  ctl?.blur(); // the change fires here: the normal save path
  st.key = nextKey;
  st.c = to.c;
  st.akey = nextKey;
  st.ac = to.c;
  st.mode = 'nav';
  paint(m);
  const td = tdAt(m, to.r, to.c);
  if (td) { td.tabIndex = -1; td.focus({ preventScroll: true }); td.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  if (beyond && dir === 'down' && had) addRowAfter(m, p);
}

// ---------- Setting values (paste, fill, clear) ----------

function setCell(ctl, text) {
  if (ctl.readOnly || ctl.disabled) return 'skip'; // e.g. a split record's amount (js/splits.js): changed in the record
  const v = String(text ?? '');
  if (ctl.tagName === 'SELECT') {
    const o = N.matchOption([...ctl.options].map((x) => ({ value: x.value, label: x.textContent })), v);
    if (!o) return 'skip';
    if (ctl.value === o.value) return 'same';
    ctl.value = o.value;
  } else if (ctl.type === 'date') {
    const d = N.parseDateCell(v);
    if (!d) return 'skip';
    if (ctl.value === d) return 'same';
    ctl.value = d;
  } else if (ctl.dataset.col === 'amount' || ctl.dataset.sh?.endsWith('|amount')) {
    const a = N.cleanAmountText(v);
    if (!a) return 'skip';
    if (a === ctl.value) return 'same';
    ctl.value = a;
  } else {
    const t = v.replace(/\s+/g, ' ').trim();
    if (ctl.value === t) return 'same';
    ctl.value = t;
  }
  ctl.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
}

/** Applies [{ key, c, text }] one by one (each is a normal save), as one undo step. */
async function applyCells(plan, what) {
  let ok = 0;
  let skip = 0;
  ctx.holdHistory?.();
  try {
    for (const p of plan) {
      const m = model();
      if (!m) break;
      const r = m.keys.indexOf(p.key);
      const ctl = r >= 0 && ctlOf(tdAt(m, r, p.c), m);
      if (!ctl) { skip++; continue; }
      const res = setCell(ctl, p.text);
      if (res === 'ok') ok++; else if (res === 'skip') skip++;
      await settle();
    }
  } finally { ctx.releaseHistory?.(); }
  if (ok) ctx.toast(`${what} ${ok} cell${ok === 1 ? '' : 's'}${skip ? ` (${skip} skipped: they did not fit)` : ''}`, 'Undo', () => ctx.undoRedo(-1));
  else if (skip) ctx.toast(`Nothing ${what.toLowerCase()}: the values did not fit those cells`);
  reapply();
  return { ok, skip };
}

const matrixOf = (m, rc) => {
  const out = [];
  for (let r = rc.r1; r <= rc.r2; r++) { const row = []; for (let c = rc.c1; c <= rc.c2; c++) row.push(textOf(ctlOf(tdAt(m, r, c), m))); out.push(row); }
  return out;
};

function clearRange(m) {
  const rc = rect(m);
  if (!rc) return;
  const plan = [];
  let blocked = 0;
  for (let r = rc.r1; r <= rc.r2; r++) for (let c = rc.c1; c <= rc.c2; c++) {
    const ctl = ctlOf(tdAt(m, r, c), m);
    if (!ctl) continue;
    const text = ctl.tagName !== 'SELECT' && ctl.type !== 'date' && ctl.dataset.col !== 'amount' && !ctl.dataset.sh?.endsWith('|amount');
    if (!text) { blocked++; continue; }
    if (ctl.value !== '') plan.push({ key: m.keys[r], c, text: '' });
  }
  if (!plan.length) { if (blocked) ctx.toast('Amounts, dates and dropdowns cannot be empty. Shift+Delete deletes the record.'); return; }
  applyCells(plan, 'Cleared');
}

function deleteRecord(m) {
  const p = posOf(m);
  const ctl = p && ctlOf(tdAt(m, p.r, p.c), m);
  if (!ctl) return;
  if (m.g.id === 'table') {
    const row = m.rows[p.r];
    if (row.hasAttribute('data-draft')) return;
    row.querySelector('[data-act="row-del"]')?.click();
  } else if (ctl.dataset.id) {
    const amount = m.rows[p.r].querySelector(`[data-sh$="|amount"][data-id="${CSS.escape(ctl.dataset.id)}"]`);
    if (amount) { amount.value = ''; amount.dispatchEvent(new Event('change', { bubbles: true })); }
  }
}

function fillDown(m) {
  const rc = rect(m);
  if (!rc) return;
  const plan = N.fillPlan(rc).map((f) => ({ key: m.keys[f.to.r], c: f.to.c, text: textOf(ctlOf(tdAt(m, f.from.r, f.from.c), m)) }));
  if (plan.length) applyCells(plan, 'Filled');
}

// ---------- The dropdown ----------

function closePop(refocus = true) {
  if (!pop) return;
  const { el } = pop;
  pop = null;
  el.remove();
  st.mode = 'nav';
  if (refocus) { const m = model(); const p = m && posOf(m); if (p) activate(m, p.r, p.c); }
}

function drawPop() {
  const list = N.filterOptions(pop.options, pop.q);
  pop.list = list;
  pop.hi = N.clamp(pop.hi, 0, Math.max(0, list.length - 1));
  const ul = pop.el.querySelector('ul');
  ul.innerHTML = list.length
    ? list.map((o, i) => `<li role="option" data-i="${i}" class="${i === pop.hi ? 'on' : ''}${o.value === pop.sel.value ? ' cur' : ''}" aria-selected="${i === pop.hi}"></li>`).join('')
    : '<li class="none">No match</li>';
  [...ul.querySelectorAll('li[data-i]')].forEach((li, i) => { li.textContent = list[i].label; });
  ul.querySelector('li.on')?.scrollIntoView({ block: 'nearest' });
}

function pick(o) {
  if (!o) return;
  const sel = pop.sel;
  closePop();
  if (sel.value !== o.value && sel.isConnected) {
    sel.value = o.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function openPop(m, td, sel, q0) {
  closePop(false);
  const options = [...sel.options].filter((o) => o.value !== '').map((o) => ({ value: o.value, label: o.textContent.trim() }));
  const el = document.createElement('div');
  el.className = 'gx-pop';
  el.dataset.testid = 'gx-pop';
  el.innerHTML = '<input type="text" class="gx-pop-q" aria-label="Type to filter" placeholder="Type to filter" autocomplete="off"><ul role="listbox"></ul>';
  document.body.append(el);
  const b = td.getBoundingClientRect();
  const h = Math.min(260, 40 + options.length * 30);
  el.style.left = `${Math.max(8, Math.min(b.left, window.innerWidth - 230))}px`;
  el.style.top = `${b.bottom + h > window.innerHeight ? Math.max(8, b.top - h - 2) : b.bottom + 2}px`;
  el.style.minWidth = `${Math.max(180, b.width)}px`;
  pop = { el, sel, td, options, q: q0, hi: Math.max(0, options.findIndex((o) => o.value === sel.value)), list: options };
  if (q0) pop.hi = 0;
  st.mode = 'pick';
  const input = el.querySelector('input');
  input.value = q0;
  drawPop();
  input.focus();
  input.addEventListener('input', () => { pop.q = input.value; pop.hi = 0; drawPop(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); pop.hi = Math.min(pop.hi + 1, pop.list.length - 1); drawPop(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); pop.hi = Math.max(pop.hi - 1, 0); drawPop(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(pop.list[pop.hi]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); }
  });
  el.addEventListener('mousedown', (e) => { e.preventDefault(); const li = e.target.closest('li[data-i]'); if (li) pick(pop.list[Number(li.dataset.i)]); });
  input.addEventListener('blur', () => setTimeout(() => { if (pop && pop.el === el) closePop(false); }, 0));
}

// ---------- Events ----------

const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

function onKey(e) {
  if (e.defaultPrevented || e.isComposing || openSheetNow()) return;
  if (pop && pop.el.contains(e.target)) return;
  const m = model();
  if (!m) return;
  const t = e.target;
  let ctl = m.root.contains(t) ? t.closest?.(m.g.ctl) : null;
  if (ctl && m.rows.indexOf(ctl.closest('tr')) < 0) ctl = null; // a header button, say
  const onCell = !ctl && t.classList?.contains('gx-active') && m.root.contains(t);
  const k = { key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey };

  if (!ctl && !onCell) {
    // From nowhere: ArrowDown on the Log starts the cell selection.
    if (e.key === 'ArrowDown' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (t === document.body || t === document.documentElement) && !isTyping(t) && !ctx.state?._sealed) {
      stop(e);
      const p = st.key && posOf(m);
      activate(m, p ? p.r : 0, p ? p.c : 0);
    }
    return;
  }

  if (ctl) {
    if (ctl.tagName === 'SELECT') return; // a dropdown you opened with the mouse keeps its own keys
    const intent = N.keyIntent(k, 'edit');
    if (!intent) return;
    if (intent.type === 'commit' && intent.dir === 'down' && ctl.closest('tr')?.hasAttribute('data-draft')) return; // Enter in the new row adds it (app.js)
    stop(e);
    if (intent.type === 'cancel') cancelEdit(m); else commit(m, intent.dir);
    return;
  }

  const intent = N.keyIntent(k, 'nav');
  if (!intent) return;
  const p = posOf(m);
  if (!p) return;
  if (intent.type === 'move') {
    stop(e);
    const to = N.moveCell(intent.extend ? posOf(m) : p, intent.key, { ...dims(m), jump: intent.jump });
    activate(m, to.r, to.c, { extend: intent.extend });
  } else if (intent.type === 'tab') {
    const to = N.tabCell(p, intent.back, dims(m));
    if (to.edge) return;
    stop(e);
    activate(m, to.r, to.c);
  } else if (intent.type === 'edit') { stop(e); startEdit(m, p.r, p.c); }
  else if (intent.type === 'type') { stop(e); startEdit(m, p.r, p.c, intent.char); }
  else if (intent.type === 'escape') {
    stop(e);
    if (st.akey !== st.key || st.ac !== st.c) activate(m, p.r, p.c); else { t.blur(); deactivate(); }
  } else if (intent.type === 'clear') { stop(e); clearRange(m); }
  else if (intent.type === 'delete-record') { stop(e); deleteRecord(m); }
  else if (intent.type === 'fill-down') { stop(e); fillDown(m); }
  else if (intent.type === 'select-all') {
    stop(e);
    st.akey = m.keys[0]; st.ac = 0; st.key = m.keys.at(-1); st.c = m.cols.length - 1;
    paint(m);
  }
}

const navTarget = (e) => {
  const m = model();
  if (!m || openSheetNow() || pop) return null;
  const a = document.activeElement;
  return a && a.classList?.contains('gx-active') && m.root.contains(a) ? m : null;
};

function onCopy(e, cut) {
  const m = navTarget(e);
  const rc = m && rect(m);
  if (!rc) return;
  e.clipboardData?.setData('text/plain', N.formatClipboard(matrixOf(m, rc)));
  stop(e);
  if (cut) clearRange(m);
}

function onPaste(e) {
  const m = navTarget(e);
  const rc = m && rect(m);
  if (!rc) return;
  const matrix = N.parseClipboard(e.clipboardData?.getData('text/plain') || '');
  if (!matrix.length) return;
  e.preventDefault();
  e.stopImmediatePropagation(); // not the Log's "import pasted rows" (app.js)
  const { cells, cut } = N.pasteTargets(rc, matrix, dims(m));
  const keys = m.keys.slice();
  applyCells(cells.map((x) => ({ key: keys[x.r], c: x.c, text: x.value })), 'Pasted').then((res) => { if (cut && res.ok) ctx.toast(`Pasted ${res.ok} cells; ${cut} more did not fit the grid`); });
}

function onFocusIn(e) {
  if (pop && pop.el.contains(e.target)) return;
  const m = model();
  if (!m) return;
  const ctl = e.target.closest?.(m.g.ctl);
  if (!ctl || !m.root.contains(ctl)) return;
  const td = ctl.closest('td');
  const r = m.rows.indexOf(ctl.closest('tr'));
  const c = m.cols.indexOf(td?.cellIndex);
  if (r < 0 || c < 0) return;
  st.key = m.keys[r]; st.c = c; st.akey = st.key; st.ac = c;
  st.mode = 'edit';
  st.orig = textOf(ctl);
  paint(m);
}

function onFocusOut(e) {
  if (st.mode !== 'edit') return;
  const m = model();
  if (m && e.relatedTarget && m.root.contains(e.relatedTarget)) return;
  st.mode = 'nav';
}

function onMouseDown(e) {
  const m = model();
  if (!m || pop?.el.contains(e.target)) return;
  const td = e.target.closest?.('td');
  if (!td || !m.root.contains(td)) { if (st.key) deactivate(); return; }
  const r = m.rows.indexOf(td.closest('tr'));
  const c = m.cols.indexOf(td.cellIndex);
  if (r < 0 || c < 0) return;
  if (e.shiftKey && st.key) { e.preventDefault(); activate(m, r, c, { extend: true }); return; }
  if (e.target.closest('button, a, input, select, textarea, summary')) return; // the box takes the focus (see onFocusIn)
  if (e.target.closest('.drag-h')) return; // the ⠿ handle starts a drag onto another day (js/app.js)
  e.preventDefault();
  activate(m, r, c);
}

let bound = false;
export function init() {
  if (bound) return;
  bound = true;
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('copy', (e) => onCopy(e, false), true);
  document.addEventListener('cut', (e) => onCopy(e, true), true);
  document.addEventListener('paste', onPaste, true);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  document.addEventListener('mousedown', onMouseDown, true);
  const root = document.getElementById('app');
  if (root && typeof MutationObserver !== 'undefined') new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
}
