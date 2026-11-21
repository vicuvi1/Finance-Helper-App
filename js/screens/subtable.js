// Plan → Subscriptions: one table, each row editable in place (name, type,
// amount, currency, how often, next payment, paid from, warning days), with a
// status (late / today / in N days / not enough money on that card) and an
// "Add a subscription" row. Every edit is one undoable change and syncs.
// Logic and rules: js/subtable.js.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { evalAmount, centsToPlain, formatMoney } from '../money.js';
import { todayISO } from '../dates.js';
import { recId } from '../recurring.js';
import { cloudEngine } from '../standalone.js';
import { addSub } from '../cattree.js';
import { EVERY, REMIND, DEFAULT_REMIND, subscriptionTable, addSubscription, editSubscription, subTypes, subsCategory } from '../subtable.js';

const draft = { name: '', amount: '', currency: '', every: 'month', next: '', account: '', sub: '', remind: DEFAULT_REMIND };

const currencies = (state) => [...new Set([state.settings.currency || 'MDL', 'USD', 'EUR', ...state.settings.accounts.filter((a) => !a.archived && a.kind !== 'crypto').map((a) => a.currency || state.settings.currency)].filter(Boolean))];
const opt = (v, label, sel) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(label)}</option>`;
const accOpts = (state, sel) => state.settings.accounts.filter((a) => !a.archived || a.id === sel).map((a) => opt(a.id, a.name, sel)).join('');
const typeOpts = (state, rule, sel) => `${opt('', '—', sel)}${subTypes(state, rule).map((s) => opt(s.id, `${s.emoji ? `${s.emoji} ` : ''}${s.name}`, sel)).join('')}<option value="__new">+ New type…</option>`;
const remindLabel = (d) => (d ? `${d} day${d === 1 ? '' : 's'}` : 'Off');

function statusCell(x) {
  const low = x.low ? `<span class="st-chip bad" title="The account holds ${esc(formatMoney(Math.max(0, x.have), x.accCur))}">⚠ Card too low</span>` : '';
  if (x.status === 'paused') return '<span class="st-chip">Paused</span>';
  if (x.status === 'late') return `<span class="st-chip bad">Late</span> <button type="button" class="btn sm" data-st-act="log" data-id="${esc(x.id)}">Log it</button>${low}`;
  if (x.status === 'today') return `<span class="st-chip warn">Today</span> <button type="button" class="btn sm" data-st-act="log" data-id="${esc(x.id)}">Log it</button>${low}`;
  if (x.status === 'soon') return `<span class="st-chip warn">In ${x.days} day${x.days === 1 ? '' : 's'}</span>${low}`;
  return `<span class="st-chip ok">In ${x.days} days</span>${low}`;
}

export function tab() {
  const { state } = ctx;
  const today = todayISO();
  const base = state.settings.currency || 'MDL';
  const t = subscriptionTable(state, today);
  const curs = currencies(state);
  const rows = t.rows.map((x) => {
    const r = x.rule;
    return `<tr class="st-row st-${x.status}" data-testid="sub-row">
      <td><input class="st-in" data-st="name" data-id="${esc(r.id)}" value="${esc(r.note || '')}" aria-label="Name"></td>
      <td><select class="st-in" data-st="sub" data-id="${esc(r.id)}" aria-label="Type">${typeOpts(state, r, r.sub || '')}</select></td>
      <td><input class="st-in st-num" data-st="amount" data-id="${esc(r.id)}" value="${esc(centsToPlain(r.amount))}" inputmode="decimal" aria-label="Amount"></td>
      <td><select class="st-in" data-st="currency" data-id="${esc(r.id)}" aria-label="Currency">${[...new Set([...curs, r.currency])].map((c) => opt(c, c, r.currency)).join('')}</select></td>
      <td><select class="st-in" data-st="every" data-id="${esc(r.id)}" aria-label="How often">${EVERY.map((e) => opt(e.id, e.label, r.every)).join('')}${EVERY.some((e) => e.id === r.every) ? '' : opt(r.every, 'Custom', r.every)}</select></td>
      <td><input class="st-in" type="date" data-st="next" data-id="${esc(r.id)}" value="${esc(x.next || '')}" aria-label="Next payment"${r.paused ? ' disabled' : ''}></td>
      <td><select class="st-in" data-st="account" data-id="${esc(r.id)}" aria-label="Paid from">${accOpts(state, r.account)}</select></td>
      <td><select class="st-in" data-st="remind" data-id="${esc(r.id)}" aria-label="Warn me">${REMIND.map((d) => opt(d, remindLabel(d), x.remind)).join('')}</select></td>
      <td class="st-status">${statusCell(x)}</td>
      <td class="st-acts"><button type="button" class="icon-btn" data-st-act="pause" data-id="${esc(r.id)}" title="${r.paused ? 'Resume' : 'Pause'}" aria-label="${r.paused ? 'Resume' : 'Pause'}">${r.paused ? '▶️' : '⏸️'}</button><button type="button" class="icon-btn" data-st-act="delete" data-id="${esc(r.id)}" title="Delete" aria-label="Delete">🗑️</button></td>
    </tr>`;
  }).join('');
  const d = { ...draft, currency: draft.currency || base, account: draft.account || state.settings.accounts.find((a) => !a.archived)?.id || '', next: draft.next || today };
  const newRow = `<tr class="st-new" data-testid="sub-new">
      <td><input class="st-in" data-st-new="name" value="${esc(d.name)}" placeholder="e.g. ChatGPT" aria-label="New subscription name"></td>
      <td><select class="st-in" data-st-new="sub" aria-label="Type">${typeOpts(state, null, d.sub)}</select></td>
      <td><input class="st-in st-num" data-st-new="amount" value="${esc(d.amount)}" placeholder="0" inputmode="decimal" aria-label="Amount"></td>
      <td><select class="st-in" data-st-new="currency" aria-label="Currency">${curs.map((c) => opt(c, c, d.currency)).join('')}</select></td>
      <td><select class="st-in" data-st-new="every" aria-label="How often">${EVERY.map((e) => opt(e.id, e.label, d.every)).join('')}</select></td>
      <td><input class="st-in" type="date" data-st-new="next" value="${esc(d.next)}" aria-label="Next payment"></td>
      <td><select class="st-in" data-st-new="account" aria-label="Paid from">${accOpts(state, d.account)}</select></td>
      <td><select class="st-in" data-st-new="remind" aria-label="Warn me">${REMIND.map((n) => opt(n, remindLabel(n), d.remind)).join('')}</select></td>
      <td colspan="2"><button type="button" class="btn primary sm" data-st-act="add" data-testid="sub-add">Add</button></td>
    </tr>`;
  const soon = t.rows.filter((x) => ['late', 'today', 'soon'].includes(x.status)).length;
  const low = t.rows.filter((x) => x.low).length;
  return `<section class="card st-card" data-testid="sub-table">
    <div class="st-top">
      <div><h2 style="margin:0">Subscriptions</h2>
        <p class="muted small" style="margin:4px 0 0">${t.count} active · ${soon ? `<b>${soon} due soon</b>` : 'nothing due in the next days'}${low ? ` · <b class="expense">${low} card${low === 1 ? '' : 's'} short</b>` : ''}. You get a notification before each payment (the days you pick).</p></div>
      <div class="st-totals"><button type="button" class="btn sm" data-st-act="calendar" data-testid="sub-calendar" style="align-self:center">📅 Add to Google Calendar</button><span><small>A month</small><b>${esc(formatMoney(t.month, base))}</b></span><span><small>A year</small><b>${esc(formatMoney(t.year, base))}</b></span></div>
    </div>
    ${t.missingRate ? '<p class="muted small">Some foreign amounts have no exchange rate yet (Accounts → Rates), so the totals leave them out.</p>' : ''}
    <div class="st-wrap"><table class="st-table">
      <thead><tr><th>Name</th><th>Type</th><th>Amount</th><th>Currency</th><th>How often</th><th>Next payment</th><th>Paid from</th><th>Warn me</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="10" class="muted" style="padding:14px">No subscriptions yet. Add your first one below.</td></tr>'}${newRow}</tbody>
    </table></div>
    <p class="muted small" style="margin-bottom:0">Each change saves at once and can be undone (Ctrl+Z). Logging a payment makes a normal record in the Log.</p>
  </section>`;
}

async function openCalendar(reset = false) {
  const cloud = cloudEngine();
  if (!cloud?.config.signedIn) { ctx.toast('Sign in to Cloud sync first (the line under the app\'s name).'); return; }
  let url;
  try { url = (await cloud.api('/api/calendar', { op: reset ? 'reset' : 'link' })).url; } catch (e) { ctx.toast(e.message); return; }
  if (document.querySelector('.sheet')) ctx.closeSheet();
  ctx.openSheet(`<h3>Bills and subscriptions in your calendar <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p class="muted" style="margin-top:0">Each payment shows on its day ("Netflix 199 MDL · maib card"), with a reminder the evening before. Changes here reach the calendar by themselves (Google refreshes every few hours).</p>
    <label class="field"><span>Your private link (keep it to yourself)</span><input id="cal-url" readonly value="${esc(url)}" data-testid="cal-url"></label>
    <div class="btns"><button type="button" class="btn primary" data-st-act="cal-copy">Copy link</button><button type="button" class="btn" data-st-act="cal-reset" title="Makes a new link; the old one stops working">New link</button></div>
    <ol class="muted small" style="padding-left:18px"><li>Open <b>calendar.google.com</b> on your computer.</li><li>On the left, next to <b>Other calendars</b>, press <b>+</b> → <b>From URL</b>.</li><li>Paste the link and press <b>Add calendar</b>. It shows on your phone too.</li></ol>`);
}

function rerender() { if (location.hash === '#plan' || ctx.ui.tab === 'plan') ctx.render(); }

function openNewType(onDone) {
  const { state } = ctx;
  const cat = subsCategory(state);
  if (!cat) { ctx.toast('Add a "Subscriptions" category first (Settings → Categories & rules).'); return; }
  ctx.openSheet(`<h3>New type of subscription <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p class="muted" style="margin-top:0">A subcategory of ${esc(cat.name)}, e.g. Tech, AI tools, Streaming, Music, Cloud.</p>
    <form id="st-type-form"><label class="field"><span>Name</span><input id="st-type-name" required maxlength="40" placeholder="Tech"></label>
    <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Add</button></div></form>`, (sheet) => {
    sheet.querySelector('#st-type-name').focus();
    sheet.querySelector('#st-type-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const s = addSub(ctx.state, cat.id, sheet.querySelector('#st-type-name').value);
      ctx.closeSheet();
      if (s) onDone(s.id);
    });
  });
}

function onChange(el) {
  const { state } = ctx;
  if (el.dataset.stNew) {
    const f = el.dataset.stNew;
    if (f === 'sub' && el.value === '__new') { openNewType((id) => { draft.sub = id; ctx.commit(); }); el.value = draft.sub; return; }
    draft[f] = f === 'remind' ? Number(el.value) : el.value;
    return;
  }
  const id = el.dataset.id;
  const f = el.dataset.st;
  if (f === 'sub' && el.value === '__new') {
    openNewType((sid) => { editSubscription(ctx.state, id, 'sub', sid); ctx.commit(); });
    return;
  }
  let v = el.value;
  if (f === 'amount') { v = evalAmount(el.value); if (!(v > 0)) { ctx.toast('Type an amount, like 199 or 9.99'); rerender(); return; } }
  if (editSubscription(state, id, f, v)) { ctx.commit(); ctx.toast('Saved', 'Undo', () => ctx.undo()); }
  else rerender();
}

function add() {
  const { state } = ctx;
  const amount = evalAmount(draft.amount || document.querySelector('[data-st-new="amount"]')?.value || '');
  const name = (draft.name || document.querySelector('[data-st-new="name"]')?.value || '').trim();
  if (!name) { ctx.toast('Give it a name, like "ChatGPT"'); document.querySelector('[data-st-new="name"]')?.focus(); return; }
  if (!(amount > 0)) { ctx.toast('Type how much it costs'); document.querySelector('[data-st-new="amount"]')?.focus(); return; }
  const today = todayISO();
  addSubscription(state, { ...draft, name, amount, currency: draft.currency || state.settings.currency, next: draft.next || today, account: draft.account || state.settings.accounts.find((a) => !a.archived)?.id, sub: draft.sub || '' }, { id: M.uid(), today });
  Object.assign(draft, { name: '', amount: '', sub: '', next: '' });
  ctx.commit();
  ctx.toast(`Added ${name}`, 'Undo', () => ctx.undo());
}

function log(id) {
  const { state } = ctx;
  const r = state.recurring.find((x) => x.id === id);
  if (!r) return;
  const x = subscriptionTable(state, todayISO()).rows.find((y) => y.id === id);
  const date = x?.next || todayISO();
  ctx.openTxSheet(null, { type: 'expense', amountText: centsToPlain(r.amount), note: r.note, category: r.category, account: r.account, date, fromRule: { id: r.id, date, txId: recId(r, date) } });
}

function confirmDelete(id) {
  const r = ctx.state.recurring.find((x) => x.id === id);
  if (!r) return;
  ctx.openSheet(`<h3>Delete ${esc(r.note || 'this subscription')}? <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p class="muted" style="margin-top:0">It leaves this table and stops reminding you. Payments you already logged stay in the Log. Ctrl+Z brings it back.</p>
    <div class="btns"><button type="button" class="btn" data-close>Keep it</button><button type="button" class="btn danger" id="st-del-go">Delete</button></div>`, (sheet) => {
    sheet.querySelector('#st-del-go').addEventListener('click', () => {
      const now = Date.now();
      ctx.state.recurring = ctx.state.recurring.filter((x) => x.id !== id);
      ctx.state.deleted = { ...(ctx.state.deleted || {}), [id]: now };
      ctx.closeSheet();
      ctx.commit();
      ctx.toast('Deleted', 'Undo', () => ctx.undo());
    });
  });
}

let bound = false;
export function init() {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el?.dataset && (el.dataset.st || el.dataset.stNew)) onChange(el);
  });
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el?.dataset?.stNew && (el.dataset.stNew === 'name' || el.dataset.stNew === 'amount')) draft[el.dataset.stNew] = el.value;
  });
  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key === 'Enter' && el?.dataset?.stNew) { e.preventDefault(); add(); }
    else if (e.key === 'Enter' && el?.dataset?.st && el.tagName === 'INPUT') { e.preventDefault(); el.blur(); }
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-st-act]');
    if (!b) return;
    const act = b.dataset.stAct;
    if (act === 'add') add();
    else if (act === 'calendar') openCalendar();
    else if (act === 'cal-copy') { const i = document.getElementById('cal-url'); i?.select(); navigator.clipboard?.writeText(i?.value || '').then(() => ctx.toast('Link copied'), () => ctx.toast('Select the link and press Ctrl+C')); }
    else if (act === 'cal-reset') openCalendar(true);
    else if (act === 'log') log(b.dataset.id);
    else if (act === 'delete') confirmDelete(b.dataset.id);
    else if (act === 'pause') {
      const r = ctx.state.recurring.find((x) => x.id === b.dataset.id);
      if (r && editSubscription(ctx.state, r.id, 'paused', !r.paused)) { ctx.commit(); ctx.toast(r.paused ? `Paused ${r.note}: no reminders` : `Resumed ${r.note}`, 'Undo', () => ctx.undo()); }
    }
  });
}
