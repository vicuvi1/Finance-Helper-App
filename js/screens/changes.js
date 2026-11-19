// Change history screen (#changes, from More and Settings -> Data & backups):
// every change to a Money record on this device, newest first, with filters
// (kind of record, day, device, one record) and "Put back" on each entry (or
// "Put back all" on a step that changed several). A Put back is a normal
// save: logged itself, with Undo in its toast. Amounts go through ctx.money,
// so hidden amounts stay hidden here too. Rules: js/changelog.js; storage:
// js/changestore.js.

import { ctx, esc } from '../ctx.js';
import { dayLabel, todayISO } from '../dates.js';
import { DEVICES, changesOf, afterOf, alreadyBack, putBack } from '../changelog.js';
import * as Store from '../changestore.js';

const LIST_WORD = {
  tx: 'Record', goals: 'Goal', goalAllocations: 'Goal reservation', recurring: 'Scheduled payment', invoices: 'Invoice',
  people: 'Person', reconciliations: 'Reconciliation', 'settings.accounts': 'Account', 'settings.categories': 'Category', 'settings.jars': 'Jar', 'settings.incomeSources': 'Income source',
};
const KINDS = [
  ['all', 'All changes'], ['tx', 'Records'], ['accounts', 'Accounts'], ['categories', 'Categories and budgets'], ['goals', 'Goals'], ['other', 'Other'], ['deleted', 'Deleted only'],
];
const ACT_WORD = { add: 'Added', edit: 'Edited', delete: 'Deleted', undo: 'Undone', redo: 'Redone', putback: 'Put back', many: 'Many changes' };
const FIELD = {
  amount: 'Amount', base: 'Value', type: 'Type', date: 'Date', category: 'Category', sub: 'Subcategory', account: 'Account', from: 'From', to: 'To',
  note: 'Note', currency: 'Currency', rate: 'Rate', tax: 'Tax tag', refund: 'Refund', name: 'Name', emoji: 'Icon', budget: 'Monthly budget',
  target: 'Target', saved: 'Saved', deadline: 'Deadline', start: 'Starting balance', archived: 'Archived', goalId: 'Goal', jar: 'Jar',
  guardOk: 'Checked as right', incomeSource: 'Income source', expected: 'Expected per month', payday: 'Pay day', color: 'Colour', pct: 'Share', every: 'Repeats', paused: 'Paused', real: 'Real balance', diff: 'Difference', price: 'Price', person: 'Person', receipts: 'Receipts', splits: 'Split', fields: 'Your fields',
};
/** "lastMilestone" -> "Last milestone" for a field without its own name. */
const fieldName = (k) => FIELD[k] || String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])/g, (m, c) => ` ${c.toLowerCase()}`);
const MONEY = new Set(['amount', 'base', 'budget', 'target', 'saved', 'start', 'real', 'app', 'diff', 'price', 'adjustment', 'toAmount', 'limit', 'balance', 'expected']);
const PAGE = 60;

const f = { kind: 'all', day: '', dev: '', rid: '', limit: PAGE };

function moneyIn(c, cur) {
  const main = ctx.state.settings.currency;
  const s = ctx.money(Math.round(Number(c) || 0));
  return cur && cur !== main ? String(s).replace(main, cur) : s;
}

const named = (list, id) => (ctx.state.settings[list] || []).find((x) => x.id === id);
const nameOfRef = (field, v) => {
  if (v == null || v === '') return '–';
  if (field === 'category') return named('categories', v)?.name || String(v);
  if (field === 'account' || field === 'from' || field === 'to') return named('accounts', v)?.name || String(v);
  if (field === 'sub') return (ctx.state.settings.subcats || []).find((x) => x.id === v)?.name || String(v);
  if (field === 'goalId') return (ctx.state.goals || []).find((g) => g.id === v)?.name || String(v);
  if (field === 'jar') return named('jars', v)?.name || String(v);
  if (field === 'incomeSource') return named('incomeSources', v)?.name || 'a source that is gone';
  return null;
};

function valueText(field, v, rec) {
  if (v === undefined || v === null || v === '') return '–';
  // Split lines and your own fields (js/splits.js, js/fields.js), in words.
  if (field === 'splits' && Array.isArray(v)) return esc(v.map((l) => `${named('categories', l?.category)?.name || 'Other'} ${moneyIn(l?.amount, rec?.currency)}`).join(' · ') || '–');
  if (field === 'fields' && typeof v === 'object') return esc(Object.entries(v).map(([id, x]) => `${(ctx.state.settings.customFields || []).find((d) => d.id === id)?.name || id}: ${x === true ? 'Yes' : x === false ? 'No' : x}`).join(', ') || '–');
  if (MONEY.has(field) && Number.isFinite(Number(v))) return esc(moneyIn(v, field === 'amount' ? rec?.currency : null));
  const ref = nameOfRef(field, v);
  if (ref != null) return esc(ref);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return esc(dayLabel(v));
  if (typeof v === 'object') return Array.isArray(v) ? `${v.length} item${v.length === 1 ? '' : 's'}` : 'changed';
  const s = String(v);
  return esc(s.length > 60 ? `${s.slice(0, 58)}…` : s);
}

function recordName(e) {
  const r = afterOf(e) || e.before || {};
  if (e.list === 'tx') {
    const cat = named('categories', r.category)?.name;
    const what = r.note || cat || (r.type === 'transfer' ? 'Transfer' : 'Record');
    return `${what}${r.date ? ` · ${dayLabel(r.date)}` : ''}`;
  }
  if (e.list === 'invoices') return `Invoice ${r.number || r.date || ''}`.trim();
  if (e.list === 'reconciliations') return `Reconciliation ${r.date ? dayLabel(r.date) : ''}`.trim();
  return `${r.emoji ? `${r.emoji} ` : ''}${r.name || r.note || LIST_WORD[e.list] || 'Item'}`;
}

function kindOf(e) {
  if (e.list === 'tx') return 'tx';
  if (e.list === 'settings.accounts') return 'accounts';
  if (e.list === 'settings.categories' || e.list === 'settings.jars') return 'categories';
  if (e.list === 'goals' || e.list === 'goalAllocations') return 'goals';
  return 'other';
}

const localDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const timeOf = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function filtered(all = Store.entries()) {
  return all.filter((e) => {
    if (f.rid && e.rid !== f.rid) return false;
    if (f.dev && e.dev !== f.dev) return false;
    if (f.day && localDay(e.at) !== f.day) return false;
    if (f.kind === 'deleted') return e.act === 'delete' || (e.gone && e.act !== 'putback');
    if (f.kind !== 'all' && (e.act === 'many' || kindOf(e) !== f.kind)) return false;
    return true;
  });
}

function entryHTML(e) {
  const state = ctx.state;
  if (e.act === 'many') return `<div class="ch-entry" data-testid="ch-entry"><span class="t"><b>${esc(e.label || `${e.n} changes at once`)}</b><span>Too many to list one by one</span></span></div>`;
  const cur = afterOf(e) || e.before;
  const main = state.settings.currency;
  // The value in the main currency only matters for a record in another currency.
  const lines = (e.act === 'add' || (e.act !== 'edit' && !e.before) || e.gone ? [] : changesOf(e)).filter((c) => !(c.f === 'base' && e.list === 'tx' && (cur?.currency || main) === main));
  const detail = lines.length
    ? `<ul class="ch-fields">${lines.slice(0, 8).map((c) => `<li><span class="ch-f">${esc(fieldName(c.f))}:</span> <s>${valueText(c.f, c.from, e.before)}</s> → <b>${valueText(c.f, c.to, cur)}</b></li>`).join('')}${lines.length > 8 ? `<li class="muted">and ${lines.length - 8} more</li>` : ''}</ul>`
    : cur && (cur.amount != null || cur.budget != null || cur.target != null)
      ? `<p class="ch-fields muted small">${cur.amount != null ? valueText('amount', cur.amount, cur) : cur.budget != null ? `Budget ${valueText('budget', cur.budget, cur)}` : `Target ${valueText('target', cur.target, cur)}`}</p>`
      : '';
  const back = alreadyBack(state, e);
  const word = e.gone && e.act !== 'delete' ? `${ACT_WORD[e.act]} (removed)` : ACT_WORD[e.act] || e.act;
  const btnText = e.before ? (currentMissing(e) ? 'Bring back' : 'Put back') : 'Remove';
  return `<div class="ch-entry" data-testid="ch-entry" data-id="${esc(e.id)}" data-act-kind="${esc(e.act)}">
    <div class="ch-head"><span class="ch-act ch-${esc(e.act)}">${esc(word)}</span>
      <button type="button" class="ch-rec" data-ch="rec" data-rid="${esc(e.rid)}" title="Only this one">${esc(LIST_WORD[e.list] || 'Item')}: ${esc(recordName(e))}</button>
      <span class="ch-btn">${back ? '<span class="muted small" data-testid="ch-same">Already like this</span>' : `<button type="button" class="btn sm" data-ch="back" data-id="${esc(e.id)}" data-testid="ch-back">${btnText}</button>`}</span></div>
    ${detail}
  </div>`;
}

function currentMissing(e) {
  const list = e.list.startsWith('settings.') ? ctx.state.settings[e.list.slice(9)] : ctx.state[e.list];
  return !(list || []).some((x) => x && x.id === e.rid);
}

function groupsOf(list) {
  const out = [];
  for (const e of list) {
    const g = out.at(-1);
    if (g && g.grp === e.grp) g.items.push(e);
    else out.push({ grp: e.grp, at: e.at, dev: e.dev, label: e.label, items: [e] });
  }
  return out;
}

export function view() {
  const state = ctx.state;
  if (state._sealed) return '<header class="top"><div><h1>Change history</h1></div></header>';
  if (!Store.isLoaded()) Store.ensureLoaded();
  const all = Store.entries();
  const list = filtered(all);
  const shown = list.slice(0, f.limit);
  const devs = [...new Set(all.map((e) => e.dev))].filter((d) => DEVICES[d]);
  const recName = f.rid ? (() => { const e = all.find((x) => x.rid === f.rid); return e ? recordName(e) : 'this one'; })() : '';
  let lastDay = '';
  const body = groupsOf(shown).map((g) => {
    const d = localDay(g.at);
    const dayHead = d !== lastDay ? `<h3 class="ch-day">${d === todayISO() ? 'Today' : esc(dayLabel(d))}</h3>` : '';
    lastDay = d;
    const many = g.items.filter((e) => e.act !== 'many' && !alreadyBack(state, e)).length;
    return `${dayHead}<div class="ch-step card" data-testid="ch-step">
      <div class="ch-step-head"><span class="muted small">${timeOf(g.at)} · ${esc(DEVICES[g.dev] || 'Another device')}${g.items.length > 1 ? ` · ${g.items.length} changes` : ''}${g.label ? ` · ${esc(g.label)}` : ''}</span>
      ${g.items.length > 1 && many > 1 ? `<button type="button" class="btn sm" data-ch="back-all" data-grp="${esc(g.grp)}" data-testid="ch-back-all">Put back all ${many}</button>` : ''}</div>
      ${g.items.map(entryHTML).join('')}
    </div>`;
  }).join('');
  return `<header class="top"><div><h1>Change history</h1><div class="sub">Every change to your money records, newest first · kept on this device for 90 days</div></div></header>
  <section class="card ch-filters" data-testid="changes-screen">
    <label class="field"><span>Show</span><select data-ch="kind" aria-label="Kind of change">${KINDS.map(([k, l]) => `<option value="${k}"${f.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field"><span>Day</span><input type="date" data-ch="day" value="${esc(f.day)}" aria-label="Day"></label>
    <label class="field"><span>Device</span><select data-ch="dev" aria-label="Device" data-testid="ch-dev"><option value="">All devices</option>${devs.map((d) => `<option value="${d}"${f.dev === d ? ' selected' : ''}>${esc(DEVICES[d])}</option>`).join('')}</select></label>
    ${f.rid ? `<button type="button" class="chip on" data-ch="rec-clear" data-testid="ch-rec-clear">Only ${esc(recName)} ✕</button>` : ''}
    ${f.kind !== 'all' || f.day || f.dev || f.rid ? '<button type="button" class="btn sm" data-ch="clear">Show everything</button>' : ''}
  </section>
  ${shown.length ? body : `<section class="card"><p class="muted" data-testid="ch-empty">${all.length ? 'No changes match these filters.' : 'No changes yet. Every add, edit and delete from now on shows up here, with Put back.'}</p></section>`}
  ${list.length > shown.length ? `<div class="btns"><button type="button" class="btn" data-ch="more">Show more (${list.length - shown.length})</button></div>` : ''}`;
}

/** The card in Settings -> Data & backups. */
export function settingsCard() {
  const n = Store.entries().length;
  return `<section class="card"><h2>Change history</h2>
    <p class="muted small" style="margin-top:0">Every add, edit and delete of a record, account, category or goal: when, on which device and what changed, with Put back. ${n ? `${n} change${n === 1 ? '' : 's'} kept` : 'Kept'} on this device for 90 days (2,000 at most).</p>
    <div class="btns"><a class="btn" href="#changes" data-testid="open-changes">Open change history</a></div></section>`;
}

function doPutBack(list) {
  const state = ctx.state;
  if (state._sealed || !list.length) return;
  const n = putBack(state, list, Date.now());
  if (!n) { ctx.toast('Already like this'); ctx.render(); return; }
  Store.expectPutBack(list[0].id, n > 1 ? `put back ${n} changes` : '');
  ctx.commit();
  ctx.toast(n === 1 ? `Put back: ${recordName(list[0])}` : `Put back ${n} records`, 'Undo', () => ctx.undo());
}

let bound = false;
/** Installs the listeners (once). */
export function init() {
  if (bound) return;
  bound = true;
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-ch]');
    if (!el || el.closest('.sheet') || ctx.ui.tab !== 'changes') return;
    const a = el.dataset.ch;
    if (a === 'back') { const x = Store.entries().find((y) => y.id === el.dataset.id); if (x) doPutBack([x]); }
    else if (a === 'back-all') doPutBack(Store.entries().filter((y) => y.grp === el.dataset.grp));
    else if (a === 'rec') { f.rid = el.dataset.rid || ''; f.limit = PAGE; ctx.render(); }
    else if (a === 'rec-clear') { f.rid = ''; ctx.render(); }
    else if (a === 'clear') { Object.assign(f, { kind: 'all', day: '', dev: '', rid: '', limit: PAGE }); ctx.render(); }
    else if (a === 'more') { f.limit += PAGE; ctx.render(); }
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    const a = el?.dataset?.ch;
    if (!a || ctx.ui.tab !== 'changes') return;
    if (a === 'kind') f.kind = el.value;
    else if (a === 'day') f.day = el.value;
    else if (a === 'dev') f.dev = el.value;
    else return;
    f.limit = PAGE;
    ctx.render();
  });
  // New entries (a save, a sync, the stored log read after start): show them.
  Store.onChanges(() => { if (ctx.ui.tab === 'changes' && !document.querySelector('#sheet-root .sheet')) ctx.render(); });
}
