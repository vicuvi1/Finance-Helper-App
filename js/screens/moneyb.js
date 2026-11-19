// Money ideas B on Money Home: the one-line quick add (Q), the salary watch
// (card, settings, one message to Life), price memory in the record sheet and
// "Ask about your money". The logic lives in js/quickadd.js, salary.js,
// prices.js and ask.js (pure); this file draws it and listens. Its own
// listeners (data-mb, data-sal), so the big handlers in app.js stay as they are.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { formatMoney, evalAmount, centsToPlain } from '../money.js';
import { todayISO, monthKey, dayLabel, addDays } from '../dates.js';
import { parseQuick, quickCategories } from '../quickadd.js';
import { salaryStatus, salaryConfig, sourceAlerts } from '../salary.js';
import { colorVar, sourceById } from '../incomesources.js';
import { priceMemory } from '../prices.js';
import { askMoney, CANT } from '../ask.js';
import { shortDay } from '../safespend.js';

let qaText = '';
let qaCat = null;
let askText = '';
let askOut = null; // the last answer, kept while the page redraws

// ---------- Quick add ----------

const KIND = { expense: 'Expense', income: 'Income', refund: 'Refund (lowers spending)' };
const LEVEL = { sure: 'learned from your records', maybe: 'learned, not sure', name: 'from the words you typed', guess: 'a guess', chosen: 'your pick', none: 'not sure' };

const parse = () => parseQuick(ctx.state, qaText, { catOverride: qaCat, today: todayISO() });

function previewHTML() {
  const { state } = ctx;
  if (!qaText.trim()) return '<span class="muted">Type an amount and a note. Add + for income, a minus for a refund, a currency (usd, eur) if it is not lei. Another day: add "yesterday", "12 nov" or "mon".</span>';
  const r = parse();
  if (!r.ok) return `<span class="qa-miss" data-testid="qa-missing" role="status">${esc(r.missing || 'Type an amount first.')}</span>`;
  const accName = M.account(state, r.account)?.name || '';
  const opts = quickCategories(state, r.kind).map((c) => `<option value="${esc(c.id)}"${c.id === r.category ? ' selected' : ''}>${esc(`${c.emoji ? `${c.emoji} ` : ''}${c.name}`)}</option>`).join('');
  const other = r.category === 'other' || r.category === 'other-in';
  const catOpts = other ? `<option value="${esc(r.category)}" selected>Other</option>${opts}` : opts;
  const shown = r.currency !== r.tx.currency ? `${formatMoney(r.amount, r.currency)} → ${formatMoney(r.tx.amount, r.tx.currency)}` : formatMoney(r.amount, r.currency);
  return `<div class="qa-line" data-testid="qa-preview"><b data-testid="qa-kind">${esc(KIND[r.kind])}</b>
    <span class="qa-amt" data-testid="qa-amount">${esc(shown)}</span>
    ${r.otherDay ? `<span class="qa-day" data-testid="qa-day">${esc(r.date === addDays(todayISO(), -1) ? 'Yesterday' : dayLabel(r.date))}</span>` : ''}
    <label class="qa-cat"><span>Category <i>(${esc(LEVEL[r.level] || '')})</i></span><select id="qa-cat" data-testid="qa-cat" aria-label="Category">${catOpts}</select></label>
    <span data-testid="qa-account">${esc(accName)}</span>
    ${r.sourceName ? `<span class="src-tag" data-testid="qa-source" style="--c:${colorVar(sourceById(ctx.state, r.source))}"><i aria-hidden="true"></i>${esc(r.sourceName)}</span>` : ''}
    <span data-testid="qa-note" class="qa-note">${r.note ? `“${esc(r.note)}”` : '<i>no note</i>'}</span>
    <button type="button" class="btn sm primary" data-mb="qa-save" data-testid="qa-save">Save</button></div>
    <div class="muted small">Enter saves · Tab or ↓ changes the category · Esc clears</div>`;
}

function paintPreview() {
  const box = document.getElementById('qa-preview');
  if (!box) return;
  const hadSelect = document.activeElement?.id === 'qa-cat';
  box.innerHTML = previewHTML();
  if (hadSelect) document.getElementById('qa-cat')?.focus();
}

function clearQuick(focus = true) {
  qaText = '';
  qaCat = null;
  const el = document.getElementById('qa-input');
  if (el) el.value = '';
  paintPreview();
  if (focus) el?.focus();
}

function saveQuick() {
  const { state } = ctx;
  if (state._sealed) { ctx.toast('The data is locked. Unlock it first.'); return; }
  const r = parse();
  if (!r.ok) { ctx.toast(r.missing || 'Type an amount first, like "120 lunch".'); return; }
  const now = Date.now();
  const tx = { id: M.uid(), createdAt: now, updatedAt: now, ...r.tx };
  state.tx.push(tx);
  ctx.ui.flashId = tx.id;
  qaText = '';
  qaCat = null;
  ctx.commit();
  ctx.toast(`Added ${formatMoney(tx.amount, tx.currency)}${tx.note ? ` · ${tx.note}` : ''}${tx.date !== todayISO() ? ` · ${dayLabel(tx.date)}` : ''}`, 'Undo', () => ctx.undo());
  setTimeout(() => document.getElementById('qa-input')?.focus(), 0);
}

// ---------- Salary ----------

function sourceCards(today) {
  let out = '';
  for (const w of sourceAlerts(ctx.state, today)) {
    const f = (c) => formatMoney(c, ctx.state.settings.currency);
    out += `<section class="card sal-card" data-testid="source-${w.status}" role="status"><h2>${w.status === 'late' ? `${esc(w.source.name)}: income not in yet (due ${esc(shortDay(w.payDate))})` : `${esc(w.source.name)}: lower than usual`}</h2>
      <p class="muted small" style="margin:0 0 8px">${w.status === 'late' ? `Expected about ${esc(f(w.expected))} a month. Nothing is logged on this source yet.` : `Expected about ${esc(f(w.expected))} a month, so far ${esc(f(w.received))}.`}</p>
      <button type="button" class="btn sm" data-mb="src-log" data-id="${esc(w.source.id)}" data-testid="source-log">Log it</button></section>`;
  }
  return out;
}

function logSource(id) {
  const { state } = ctx;
  const src = (state.settings.incomeSources || []).find((x) => x.id === id);
  if (!src) return;
  const acc = (src.account && M.account(state, src.account)) || M.account(state, M.defaultAccount(state, 'income', null));
  const same = acc && (acc.currency || state.settings.currency) === (src.currency || state.settings.currency);
  ctx.openTxSheet(null, { type: 'income', incomeSource: src.id, ...(acc ? { account: acc.id } : {}), ...(same && src.expected ? { amountText: centsToPlain(src.expected) } : {}) });
}

function salaryCards(today) {
  const st = salaryStatus(ctx.state, today);
  if (!st) return sourceCards(today);
  const base = ctx.state.settings.currency;
  let out = sourceCards(today);
  if (st.late) {
    out += `<section class="card sal-card" data-testid="salary-late" role="status"><h2>Salary not in yet (due ${esc(shortDay(st.dueDate))})</h2>
      <p class="muted small" style="margin:0 0 8px">Expected about ${esc(formatMoney(st.cfg.amount, st.cfg.currency))}${st.accountName ? ` in ${esc(st.accountName)}` : ''}. Nothing like it is in your records yet.</p>
      <button type="button" class="btn sm" data-mb="sal-log" data-testid="salary-log">Log it</button></section>`;
  }
  if (st.hourly) {
    out += `<section class="card sal-card" data-testid="salary-hourly"><p style="margin:0"><span class="muted">Your real hourly pay this month:</span> <b data-testid="salary-rate">${esc(formatMoney(st.hourly.rate, base))}/h</b></p>
      <p class="muted small" style="margin:4px 0 0">Salary received ÷ ${Math.round(st.hourly.hours * 10) / 10} h (${st.hourly.source === 'invoices' ? 'hours on invoices paid this month' : 'the hours a month you set under Your hour'}).</p></section>`;
  }
  return out;
}

function logSalary() {
  const { state } = ctx;
  const cfg = salaryConfig(state);
  if (!cfg) return;
  const acc = (cfg.account && M.account(state, cfg.account)) || M.account(state, M.defaultAccount(state, 'income', null));
  const same = acc && (acc.currency || state.settings.currency) === cfg.currency;
  ctx.openTxSheet(null, { type: 'income', note: 'Salary', ...(acc ? { account: acc.id } : {}), ...(same ? { amountText: centsToPlain(cfg.amount) } : {}) });
}

/** The Settings card for the salary watch (optional). */
export function settingsCard() {
  const { state } = ctx;
  const s = state.settings.salary || {};
  const base = state.settings.currency;
  const curs = [...new Set([s.currency, base, 'USD', 'EUR', ...state.settings.accounts.map((a) => a.currency)].filter(Boolean))];
  const accs = M.activeAccounts(state);
  const on = !!salaryConfig(state);
  return `<section class="card" id="sal-card" data-testid="salary-settings"><h2>Salary</h2>
    <p class="muted small" style="margin-top:0">${on ? 'Money Home tells you when your pay day + 2 days has passed and the salary is not in your records.' : 'Optional. Say what you expect and when, and Money Home tells you if it is late. Set the amount and the day to switch it on.'}</p>
    <div class="row2">
      <label class="field"><span>Expected amount</span><input type="text" inputmode="decimal" data-sal="amount" value="${s.amount ? centsToPlain(s.amount) : ''}" placeholder="e.g. 15000"></label>
      <label class="field"><span>Currency</span><select data-sal="currency">${curs.map((c) => `<option ${c === (s.currency || base) ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    </div>
    <div class="row2">
      <label class="field"><span>Pay day of the month</span><input type="number" min="1" max="31" data-sal="day" value="${s.day || ''}" placeholder="10"></label>
      <label class="field"><span>Account</span><select data-sal="account"><option value="">Any account</option>${accs.map((a) => `<option value="${esc(a.id)}" ${a.id === s.account ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
    </div></section>`;
}

function onSalaryChange(el) {
  const { state } = ctx;
  const k = el.dataset.sal;
  const cur = { ...(state.settings.salary || {}) };
  if (k === 'amount') {
    if (!el.value.trim()) { delete cur.amount; } else {
      const v = evalAmount(el.value);
      if (!(v > 0)) { ctx.toast('Type what you expect, e.g. 15000'); return; }
      cur.amount = v;
    }
  } else if (k === 'day') {
    if (!el.value.trim()) delete cur.day; else {
      const d = Math.round(Number(el.value));
      if (!(d >= 1 && d <= 31)) { ctx.toast('A day between 1 and 31'); return; }
      cur.day = d;
    }
  } else if (k === 'currency') cur.currency = el.value;
  else if (k === 'account') cur.account = el.value;
  else return;
  if (!cur.currency) cur.currency = state.settings.currency;
  if (cur.amount || cur.day) state.settings.salary = cur; else delete state.settings.salary;
  state.settings.updatedAt = Date.now();
  ctx.persistSync();
  const card = document.getElementById('sal-card');
  if (card) card.outerHTML = settingsCard();
}

// One message to Life System (its notification budget) when the salary is late; once a month.
const NOTIFIED = 'finance-helper.salary-notified';
const NOTIFIED_SRC = 'finance-helper.source-notified';
function tellLifeIfLate() {
  if (ctx.DEMO || ctx.state._sealed) return;
  const today = todayISO();
  const st = salaryStatus(ctx.state, today);
  const month = monthKey(today);
  if (window.parent === window) return; // not inside Life System: the card is enough
  let sent = false;
  if (st?.late) {
    let done = false;
    try { done = localStorage.getItem(NOTIFIED) === month; } catch { /* no storage: Life keeps its own once-a-month guard */ }
    if (!done) {
      try {
        window.parent.postMessage({ type: 'LIFE_SYSTEM_BRIDGE', action: 'FINANCE_SALARY_LATE', payload: { month, due: st.dueDate } }, location.origin);
        try { localStorage.setItem(NOTIFIED, month); } catch { /* ignore */ }
        sent = true;
      } catch { /* ignore */ }
    }
  }
  // An income source that is late or lower than usual uses the same bell slot (one message a day, each source once a month).
  if (sent) return;
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(NOTIFIED_SRC) || '[]'); } catch { /* ignore */ }
  if (!Array.isArray(seen)) seen = [];
  if (seen.includes(`day:${today}`)) return;
  const w = sourceAlerts(ctx.state, today).find((x) => !seen.includes(`${month}:${x.source.id}`));
  if (!w) return;
  try {
    window.parent.postMessage({ type: 'LIFE_SYSTEM_BRIDGE', action: 'FINANCE_SALARY_LATE', payload: { month, due: w.payDate, tag: w.source.id, source: w.source.name, kind: w.status } }, location.origin);
    try { localStorage.setItem(NOTIFIED_SRC, JSON.stringify([...seen.filter((k) => k.startsWith(month)), `${month}:${w.source.id}`, `day:${today}`].slice(-40))); } catch { /* ignore */ }
  } catch { /* ignore */ }
}

// ---------- Price memory (record sheet) ----------

/** Fills the line under the amount of the record sheet. `info`: { note, type, amountBase, existingId }. */
export function paintPrice(sheet, info) {
  const hint = sheet.querySelector('#calc-hint');
  if (!hint) return;
  let box = sheet.querySelector('#price-mem');
  if (!box) {
    box = document.createElement('div');
    box.id = 'price-mem';
    box.className = 'price-mem';
    box.setAttribute('data-testid', 'price-memory');
    hint.after(box);
  }
  const m = info.type === 'expense' ? priceMemory(ctx.state, info.note, { amountBase: info.amountBase, excludeId: info.existingId }) : null;
  if (!m) { box.hidden = true; box.textContent = ''; return; }
  box.hidden = false;
  box.innerHTML = `<span data-testid="price-line">${esc(m.line)}</span>${m.high ? ' <span class="pm-high" data-testid="price-high">Higher than usual</span>' : ''}`;
}

// ---------- Ask about your money ----------

function answerHTML() {
  if (!askOut) return '';
  if (!askOut.ok) return `<p class="muted" data-testid="ask-cant">${esc(askOut.text || CANT)}</p>`;
  const rows = (askOut.txs || []).map((t) => ctx.txRow(t, { showDate: true })).join('');
  return `<div class="ask-answer" data-testid="ask-answer"><div class="ask-num" data-testid="ask-number">${esc(askOut.headline)}</div>
    <p class="muted small" style="margin:2px 0 8px" data-testid="ask-detail">${esc(askOut.detail)}</p>
    ${rows ? `<div class="list ask-list">${rows}</div>` : ''}
    <button type="button" class="btn sm" data-mb="ask-log" data-testid="ask-log">Open these in the Log</button></div>`;
}

function runAsk() {
  const el = document.getElementById('ask-input');
  askText = el ? el.value : askText;
  askOut = askText.trim() ? askMoney(ctx.state, askText, todayISO()) : null;
  const out = document.getElementById('ask-out');
  if (out) out.innerHTML = answerHTML();
}

function openLog() {
  if (!askOut?.search) return;
  ctx.ui.search = askOut.search;
  ctx.ui.filter = 'all';
  location.hash = '#log';
  ctx.render();
}

function askHTML() {
  return `<section class="card ask-card" data-testid="ask-money"><h2>Ask about your money</h2>
    <div class="ask-row"><input id="ask-input" type="text" autocomplete="off" value="${esc(askText)}" placeholder="e.g. how much on food in October?" aria-label="Ask about your money" data-testid="ask-input">
    <button type="button" class="btn sm primary" data-mb="ask" data-testid="ask-go">Ask</button></div>
    <div id="ask-out" aria-live="polite">${answerHTML()}</div></section>`;
}

// ---------- Home ----------

/** The top of Money Home: the quick add, then the salary cards. */
export function topHTML() {
  return `<section class="card qa-card" data-testid="quick-add"><label class="qa-label" for="qa-input">Quick add <kbd>Q</kbd></label>
    <input id="qa-input" type="text" autocomplete="off" value="${esc(qaText)}" placeholder='120 lunch · 3000 salary + · -300 tech refund' aria-label="Quick add a record" data-testid="qa-input">
    <div id="qa-preview" class="qa-preview" aria-live="polite">${previewHTML()}</div></section>${salaryCards(todayISO())}`;
}

export const askBox = askHTML;

let bound = false;
/** Installs the listeners (once). */
export function init() {
  if (bound) return;
  bound = true;
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'qa-input') { qaText = t.value; qaCat = null; paintPreview(); }
    else if (t.id === 'ask-input') askText = t.value;
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'qa-cat') { qaCat = t.value; paintPreview(); }
    else if (t.dataset?.sal) onSalaryChange(t);
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.id === 'qa-input' || t.id === 'qa-cat') {
      if (e.key === 'Enter') { e.preventDefault(); saveQuick(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); clearQuick(); }
      else if (e.key === 'ArrowDown' && t.id === 'qa-input') { const s = document.getElementById('qa-cat'); if (s) { e.preventDefault(); s.focus(); } }
      else if (e.key === 'ArrowUp' && t.id === 'qa-cat') { e.preventDefault(); document.getElementById('qa-input')?.focus(); }
      return;
    }
    if (t.id === 'ask-input') {
      if (e.key === 'Enter') { e.preventDefault(); runAsk(); }
      return;
    }
    // Q: jump to the quick add (from any section).
    if ((e.key === 'q' || e.key === 'Q') && !e.ctrlKey && !e.metaKey && !e.altKey && !t.closest?.('input, select, textarea, [contenteditable]') && !document.querySelector('#sheet-root .sheet')) {
      e.preventDefault();
      if (ctx.ui.tab !== 'home') location.hash = '#home';
      setTimeout(() => document.getElementById('qa-input')?.focus(), ctx.ui.tab === 'home' ? 0 : 120);
    }
  }, true);
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-mb]');
    if (!el) return;
    const a = el.dataset.mb;
    if (a === 'qa-save') saveQuick();
    else if (a === 'ask') runAsk();
    else if (a === 'ask-log') openLog();
    else if (a === 'sal-log') logSalary();
    else if (a === 'src-log') logSource(el.dataset.id);
  });
  // The salary check: once the app is up, then every hour.
  setTimeout(tellLifeIfLate, 4000);
  setInterval(tellLifeIfLate, 60 * 60 * 1000);
}
