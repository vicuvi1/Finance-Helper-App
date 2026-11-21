// The Reality check window (#reality; js/checkup.js schedule, js/reality.js rules).
// One row per open account: the app's balance, a box for the real balance (in the
// account's currency, its value in the main currency beside it), the difference,
// the last check and "Matches". A difference lists what could explain it first
// (To confirm, duplicates, odd dates, other currencies, transfers on their way,
// spending that usually happens); what is left can become ONE adjustment record
// (notIncome / notSpending). Below: "Check these" (new records that look wrong),
// how accurate the app has been, the accounts that drift most, and past checks.
// Keyboard: Tab between boxes and buttons, Enter in a box compares (and saves
// "matches" when there is no difference). Amounts follow Space (hidden amounts
// stay hidden; the boxes still work). Every change is a normal save: Change
// history, Undo (toast or Ctrl+Z) and sync.

import { ctx, esc } from '../ctx.js';
import * as C from '../checkup.js';
import * as RC from '../reality.js';
import * as Plan from './plan.js';
import { evalAmount, formatMoney, centsToPlain } from '../money.js';
import { todayISO, dayLabel } from '../dates.js';
import { cardHTML } from '../cards.js';

/** What you typed in this window (kept while the window is open; nothing is saved until you finish a row). */
const W = { real: {}, first: {}, firstBase: {}, counter: {}, notes: {}, checkId: null, day: '', focus: null };
const NOTES = { MDL: [1000, 500, 200, 100, 50, 20, 10, 5, 1], EUR: [500, 200, 100, 50, 20, 10, 5, 2, 1], USD: [100, 50, 20, 10, 5, 2, 1] };

const main = () => ctx.state.settings.currency || 'MDL';
const accOf = (id) => ctx.state.settings.accounts.find((a) => a.id === id);
const catName = (id) => ctx.state.settings.categories.find((c) => c.id === id)?.name || 'Other';
const rateOf = (cur) => (cur === main() ? 1 : Number(ctx.suggestedRate?.(cur)) || null);
const fm = (c, cur, o) => formatMoney(c, cur, o);
const txName = (t) => esc(t.note || catName(t.category));
const txLine = (t) => `${txName(t)} · ${esc(fm(t.amount, t.currency || main()))} · ${esc(dayLabel(t.date))}`;

function causeHTML(c, acc) {
  const cur = acc.currency || main();
  const eff = c.effect ? ` <span class="muted small">(the app ${esc(fm(c.effect, cur, { sign: true }))})</span>` : '';
  const fit = c.fits ? ' <span class="rc-tag ok">explains it all</span>' : '';
  const open = (t, label = 'Open') => `<button type="button" class="btn sm" data-act="rc-open" data-id="${esc(t.id)}">${label}</button>`;
  let text = '';
  let btn = '';
  switch (c.kind) {
    case 'confirm': text = `${esc(c.rule.note || catName(c.rule.category))} on ${esc(dayLabel(c.date))} is waiting in To confirm`; btn = `<button type="button" class="btn sm primary" data-act="rec-log" data-id="${esc(c.rule.id)}" data-date="${c.date}">Confirm</button>`; break;
    case 'dupe': text = `Maybe logged twice: ${txLine(c.tx)}`; btn = open(c.tx, 'Open the copy') + open(c.other, 'Open the first'); break;
    case 'exact': text = `Exactly the difference: ${txLine(c.tx)}. Logged but never paid?`; btn = open(c.tx); break;
    case 'wrongway': text = `Half the difference: ${txLine(c.tx)}. Income logged as spending, or the other way?`; btn = open(c.tx); break;
    case 'future': text = `Dated in the future, so not in today's balance: ${txLine(c.tx)}`; btn = open(c.tx, 'Fix the date'); break;
    case 'transfer': text = `A transfer that has not arrived yet: ${txLine(c.tx)}`; btn = open(c.tx); break;
    case 'currency': text = `In ${esc(c.tx.currency)}, but this account is in ${esc(cur)}: ${txLine(c.tx)}`; btn = open(c.tx, 'Fix the currency'); break;
    case 'olddate': text = `Added after your last check, dated before it: ${txLine(c.tx)}`; btn = open(c.tx); break;
    case 'forgot': text = `Probably forgotten: you usually spend about ${esc(fm(-c.effect, cur))} a month on ${esc(catName(c.category))} from this account, and nothing since ${esc(dayLabel(c.since))}`; btn = `<button type="button" class="btn sm" data-act="rc-log-cat" data-cat="${esc(c.category)}" data-acc="${esc(acc.id)}">Log it</button>`; break;
    default: return '';
  }
  return `<li class="rc-cause" data-testid="reality-cause" data-kind="${c.kind}"><span>${text}${eff}${fit}</span><span class="rc-cause-btns">${btn}</span></li>`;
}

function rowHTML(x, today, histToday) {
  const { state } = ctx;
  const a = x.account;
  const cur = a.currency || main();
  const rate = rateOf(cur);
  const real = W.real[a.id];
  const d = RC.rowDiff(state, a.id, real ?? null, today, rate || 0);
  const done = x.last === today && histToday.get(a.id);
  const lastTxt = x.last ? (x.last === today ? 'today' : dayLabel(x.last)) : 'never';
  const dueTxt = x.due <= today ? (x.due < today ? `due since ${dayLabel(x.due)}` : 'due today') : `next ${dayLabel(x.due)}`;
  const inMain = (c) => (cur !== main() && c != null ? `<small class="muted rc-main">≈ ${esc(fm(c, main()))}</small>` : '');
  let diffCell = '<span class="muted">–</span>';
  if (done) diffCell = `<span class="rc-ok">✓ ${esc({ match: 'Matched', fixed: 'Fixed', adjusted: 'Adjusted', 'fixed+adjusted': 'Fixed and adjusted' }[done.how] || 'Checked')}</span>`;
  else if (d.diff != null) diffCell = d.diff === 0 ? '<span class="rc-ok">Matches</span>' : `<b class="${d.diff > 0 ? 'pos' : 'neg'}" data-testid="reality-diff">${esc(fm(d.diff, cur, { sign: true }))}</b>${inMain(d.diffBase)}`;
  const counter = a.kind === 'cash' && !done ? (W.counter[a.id] ? counterHTML(a) : '') : '';
  let causes = '';
  if (!done && d.diff) {
    const list = RC.realityCauses(state, a.id, today, d.diff);
    causes = `<div class="rc-causes" data-testid="reality-causes">
      <p class="small" style="margin:0 0 6px">The bank shows ${esc(fm(Math.abs(d.diff), cur))} ${d.diff > 0 ? 'more' : 'less'} than the app. ${list.length ? 'Look at these first:' : 'Nothing obvious explains it.'}</p>
      ${list.length ? `<ul class="rc-cause-list">${list.map((c) => causeHTML(c, a)).join('')}</ul>` : ''}
      <div class="btns"><button type="button" class="btn" data-act="rc-adjust" data-acc="${esc(a.id)}" data-testid="reality-adjust">Add one adjustment of ${esc(fm(d.diff, cur, { sign: true }))}</button>
      <span class="muted small">It moves the balance only: not income, not spending. Undo takes it back.</span></div></div>`;
  }
  return `<div class="rc-row${done ? ' done' : ''}${x.due <= today && !done ? ' due' : ''}" data-testid="reality-row" data-acc="${esc(a.id)}">
    <div class="rc-name rc-with-card"><span class="mini-card" aria-hidden="true" title="${esc(a.name)}">${cardHTML({ account: a, own: 0, inBase: 0 }, { money: () => '', act: null, base: ctx.state.settings.currency })}</span><span class="rc-name-t"><b>${esc(a.name)}</b><span class="muted small">${esc(cur)} · last check ${esc(lastTxt)} · ${esc(dueTxt)}</span></span></div>
    <div class="rc-app"><span class="muted small rc-lbl">In the app</span><span class="money" data-testid="reality-app">${esc(fm(d.app, cur))}</span>${inMain(d.appBase)}</div>
    <div class="rc-real"><span class="muted small rc-lbl">Real balance</span>${done ? `<span class="money">${esc(fm(done.real, cur))}</span>` : `<input type="text" inputmode="decimal" data-rc-real="${esc(a.id)}" value="${real != null ? esc(centsToPlain(real)) : ''}" placeholder="What the bank shows" aria-label="Real balance of ${esc(a.name)} in ${esc(cur)}" data-testid="reality-real">${inMain(d.realBase)}${a.kind === 'cash' ? `<button type="button" class="btn sm rc-count-btn" data-act="rc-counter" data-acc="${esc(a.id)}" aria-expanded="${W.counter[a.id] ? 'true' : 'false'}">Count notes</button>` : ''}`}</div>
    <div class="rc-diff"><span class="muted small rc-lbl">Difference</span>${diffCell}</div>
    <div class="rc-acts">${done ? '' : `<button type="button" class="btn${d.diff === 0 ? ' primary' : ''}" data-act="rc-match" data-acc="${esc(a.id)}" data-testid="reality-match">${d.diff ? 'Matches' : d.diff === 0 ? 'Save: matches' : 'Matches'}</button>`}</div>
    ${counter}${causes}
  </div>`;
}

function counterHTML(a) {
  const cur = a.currency || main();
  const notes = NOTES[cur] || NOTES.MDL;
  const n = W.notes[a.id] || {};
  const total = notes.reduce((s, v) => s + v * 100 * (Number(n[v]) || 0), 0);
  return `<div class="rc-counter" data-testid="reality-counter">${notes.map((v) => `<label><span>${v}</span><input type="number" min="0" step="1" data-rc-note="${v}" data-acc="${esc(a.id)}" value="${n[v] || ''}" aria-label="Notes of ${v} ${esc(cur)}"></label>`).join('')}
    <span class="rc-count-total">= <b data-rc-total>${esc(fm(total, cur))}</b></span><button type="button" class="btn sm primary" data-act="rc-use-count" data-acc="${esc(a.id)}">Use this total</button></div>`;
}

function flagsHTML(flags) {
  if (!flags.length) return '';
  const why = (r, t) => {
    const acc = accOf(t.type === 'transfer' ? t.from : t.account);
    switch (r.code) {
      case 'range': return `much more than your usual ${esc(catName(t.category))} (about ${esc(fm(r.usual, main()))})`;
      case 'future': return 'dated in the future';
      case 'old': return `dated ${r.days} days before it was added`;
      case 'currency': return `in ${esc(t.currency)}, but ${esc(acc?.name || 'the account')} is in ${esc(r.want)}`;
      case 'dupe': return 'exactly the same as another record (day, amount, account and note)';
      case 'nosource': return 'income with no source or note';
      default: return '';
    }
  };
  return `<section class="card" data-testid="reality-flags"><h2>Check these <span class="rc-tag">${flags.length}</span></h2>
    <p class="muted small" style="margin-top:0">New records (last ${RC.GUARD_DAYS} days) that look unusual. Nothing was changed or blocked: say it's right, or open it to fix it.</p>
    <ul class="rc-flags">${flags.slice(0, 30).map(({ tx: t, reasons }) => `<li class="rc-flag" data-testid="reality-flag" data-id="${esc(t.id)}">
      <span><b>${txName(t)}</b> <span class="money">${esc(fm(t.type === 'expense' ? -t.amount : t.amount, t.currency || main(), { sign: t.type === 'income' }))}</span> <span class="muted small">${esc(dayLabel(t.date))} · ${esc(accOf(t.type === 'transfer' ? t.from : t.account)?.name || '')}${t.source && RC.SOURCE_WORD[t.source] ? ` · from ${esc(RC.SOURCE_WORD[t.source])}` : ''}</span>
      <br><span class="small rc-why">${reasons.map((r) => why(r, t)).filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1)).join('; ')}</span></span>
      <span class="rc-cause-btns"><button type="button" class="btn sm" data-act="rc-flag-ok" data-id="${esc(t.id)}" data-testid="reality-flag-ok">It's right</button><button type="button" class="btn sm" data-act="rc-open" data-id="${esc(t.id)}">Fix</button></span></li>`).join('')}</ul>
    ${flags.length > 30 ? `<p class="muted small">${flags.length - 30} more after these.</p>` : ''}</section>`;
}

function adaptHTML() {
  const { state } = ctx;
  const acc = RC.accuracy(state);
  const drifts = RC.drift(state).slice(0, 3);
  const tips = RC.habitTips(state);
  const tol = fm(acc.tol, main(), { reveal: true });
  const line = acc.streak >= 1
    ? `Your app was within ${esc(tol)} of reality ${acc.streak === 1 ? 'at the last check' : `${acc.streak} times in a row`}.`
    : acc.checks ? `At the last check some account was off by more than ${esc(tol)}.` : 'Your first check starts the history: from then on you see how close the app stays to reality.';
  const tipText = (t) => {
    const a = accOf(t.account);
    if (!a) return '';
    if (t.kind === 'cash') return `<li>${esc(a.name)} keeps drifting: log cash spending the same day.${t.act ? ` <button type="button" class="btn sm" data-act="rc-cash-on">Turn on the weekly cash count</button>` : ''}</li>`;
    if (t.kind === 'rule') return `<li>${esc(a.name)} keeps drifting: payments you make every month may be missing. A repeating rule logs them for you. <button type="button" class="btn sm" data-act="plan-open-repeating">Open Repeating</button></li>`;
    return `<li>Check ${esc(a.name)} every week until it stays right. <button type="button" class="btn sm" data-act="rc-acct-weekly" data-id="${esc(a.id)}">Check it weekly</button></li>`;
  };
  return `<section class="card" data-testid="reality-accuracy"><h2>How accurate the app is</h2>
    <p style="margin-top:0" data-testid="reality-streak">${line}</p>
    ${drifts.length ? `<p class="muted small" style="margin:8px 0 4px">Drifts most:</p><ul class="rc-drift">${drifts.map((d) => `<li><b>${esc(accOf(d.account).name)}</b>: off in ${d.misses} of the last ${d.checks} checks, ${esc(fm(d.total, main()))} in all</li>`).join('')}</ul>` : ''}
    ${tips.length ? `<ul class="rc-tips">${tips.map(tipText).join('')}</ul>` : ''}
  </section>`;
}

function pastHTML() {
  const list = RC.historyOf(ctx.state).slice(0, 6);
  if (!list.length) return '';
  const HOW = { match: 'matched', fixed: 'fixed', adjusted: 'adjusted', 'fixed+adjusted': 'fixed, then adjusted' };
  return `<section class="card" data-testid="reality-history"><h2>Past checks</h2><ul class="rc-past">${list.map((e) => {
    const ok = e.rows.filter((r) => Math.abs(Number(r.base) || 0) <= RC.CLOSE_ENOUGH).length;
    return `<li><b>${esc(dayLabel(e.date))}</b> <span class="muted small">${ok} of ${e.rows.length} close to reality</span><br><span class="small">${e.rows.map((r) => {
      const a = accOf(r.account);
      return `${esc(a?.name || 'Removed account')}: ${r.first ? `${esc(fm(r.first, r.currency, { sign: true }))}, ${HOW[r.how] || r.how}` : 'matched'}`;
    }).join(' · ')}</span></li>`;
  }).join('')}</ul></section>`;
}

export function view() {
  const { state } = ctx;
  if (state._sealed) return '<header class="top"><div><h1>Reality check</h1></div></header>';
  const today = todayISO();
  const rows = C.checkupAccounts(state, today);
  const due = C.checkupDue(state, today);
  const next = C.nextCheck(state, today);
  const flags = RC.guardFlags(state, today);
  const histToday = new Map();
  for (const e of RC.historyOf(state)) if (e.date === today) for (const r of e.rows) if (!histToday.has(r.account)) histToday.set(r.account, r);
  const status = due
    ? `${due.left.length === 1 ? 'One account is' : `${due.left.length} accounts are`} due${due.overdue ? ` <span class="rc-tag alert">overdue since ${esc(dayLabel(due.due))}</span>` : ''}.`
    : `All accounts checked.${next ? ` Next check: ${esc(dayLabel(next))}.` : ''}`;
  return `<header class="top"><div><h1>Reality check</h1><div class="sub">Is the money in the app the real money? Type what your bank (or wallet) shows for each account.</div></div></header>
  <section class="card rc-window" data-testid="reality-window">
    <p class="rc-status" style="margin-top:0">${status} ${flags.length ? `<a href="#rc-flags" class="card-link" data-act="rc-to-flags">${flags.length} record${flags.length === 1 ? '' : 's'} to check</a>` : ''}</p>
    <div class="rc-head muted small" aria-hidden="true"><span>Account</span><span>In the app</span><span>Real balance</span><span>Difference</span><span></span></div>
    ${rows.length ? rows.map((x) => rowHTML(x, today, histToday)).join('') : '<p class="muted">No open accounts.</p>'}
    <p class="muted small" style="margin-bottom:0">Tab moves between boxes, Enter compares. Space shows or hides amounts; the boxes work either way.</p>
  </section>
  <div id="rc-flags">${flagsHTML(flags)}</div>
  ${adaptHTML()}
  ${pastHTML()}`;
}

// ---------- Actions ----------

function readReal(accId) {
  const box = document.querySelector(`[data-rc-real="${CSS.escape(accId)}"]`);
  if (!box) return W.real[accId];
  const v = box.value.trim();
  if (!v) { delete W.real[accId]; return undefined; }
  const c = evalAmount(v);
  if (c == null || !Number.isFinite(c)) return null;
  return c;
}

function compare(accId) {
  const c = readReal(accId);
  if (c === null) { ctx.toast('Type the balance your bank shows, e.g. 1250 or 1000+250'); return null; }
  if (c === undefined) return undefined;
  W.real[accId] = c;
  if (W.first[accId] === undefined) {
    const acc = accOf(accId);
    const d = RC.rowDiff(ctx.state, accId, c, todayISO(), rateOf(acc.currency || main()) || 0);
    W.first[accId] = d.diff;
    W.firstBase[accId] = d.diffBase;
  }
  return c;
}

function focusAfter(sel) {
  W.focus = sel;
}

function restoreFocus() {
  if (!W.focus) return;
  const el = document.querySelector(W.focus);
  W.focus = null;
  if (el) { el.focus(); if (el.select && el.matches('input')) el.select(); }
}

function nextBox(accId) {
  const boxes = [...document.querySelectorAll('[data-rc-real]')].map((b) => b.dataset.rcReal);
  const i = boxes.indexOf(accId);
  return boxes.slice(i + 1).find((id) => id !== accId) || boxes.find((id) => id !== accId) || null;
}

function finish(accId, real) {
  const { state } = ctx;
  const acc = accOf(accId);
  if (!acc) return;
  const cur = acc.currency || main();
  const rate = rateOf(cur);
  if (!rate) { ctx.toast(`No ${cur} rate yet. Update rates first.`); return; }
  const today = todayISO();
  if (!W.checkId || W.day !== today) { W.checkId = RC.newCheckId(); W.day = today; }
  const next = nextBox(accId);
  const r = RC.finishAccount(state, accId, real, today, { checkId: W.checkId, first: W.first[accId] ?? null, firstBase: W.firstBase[accId] ?? null, rate });
  delete W.real[accId];
  delete W.first[accId];
  delete W.firstBase[accId];
  delete W.counter[accId];
  if (next) focusAfter(`[data-rc-real="${CSS.escape(next)}"]`);
  ctx.commit();
  restoreFocus();
  ctx.toast(r.tx ? `${acc.name}: adjusted by ${formatMoney(r.row.left, cur, { sign: true })}` : `${acc.name}: matches your bank`, 'Undo', () => ctx.undo?.());
}

function rerender(sel) {
  if (sel) focusAfter(sel);
  ctx.render();
  restoreFocus();
}

export function onClick(act, el) {
  const { state } = ctx;
  if (Plan.onClick(act, el)) { setTimeout(restoreFocus, 0); return true; }
  const accId = el?.dataset?.acc;
  if (act === 'rc-match') {
    const c = compare(accId);
    if (c === null) return true;
    const acc = accOf(accId);
    const d = c === undefined ? null : RC.rowDiff(state, accId, c, todayISO(), rateOf(acc.currency || main()) || 0);
    // A number typed that still differs is not a match: the causes and the adjustment are shown instead.
    if (d && d.diff) { rerender(`[data-act="rc-adjust"][data-acc="${CSS.escape(accId)}"]`); ctx.toast('The number you typed differs: look at the causes, or clear the box if the bank shows the same as the app'); return true; }
    finish(accId, d ? c : null);
    return true;
  }
  if (act === 'rc-adjust') {
    const c = compare(accId);
    if (c == null) return true;
    finish(accId, c);
    return true;
  }
  if (act === 'rc-open') {
    const t = state.tx.find((x) => x.id === el.dataset.id);
    if (t) ctx.openTxSheet(t);
    return true;
  }
  if (act === 'rc-log-cat') {
    ctx.openTxSheet(null, { type: 'expense', category: el.dataset.cat, account: el.dataset.acc });
    return true;
  }
  if (act === 'rc-flag-ok') {
    const id = el.dataset.id;
    if (RC.markRight(state, [id])) { ctx.commit(); ctx.toast('OK, marked as right', 'Undo', () => ctx.undo?.()); }
    return true;
  }
  if (act === 'rc-counter') {
    W.counter[accId] = !W.counter[accId];
    rerender(W.counter[accId] ? `[data-rc-note][data-acc="${CSS.escape(accId)}"]` : null);
    return true;
  }
  if (act === 'rc-use-count') {
    const acc = accOf(accId);
    const notes = NOTES[acc.currency || main()] || NOTES.MDL;
    const n = W.notes[accId] || {};
    W.real[accId] = notes.reduce((s, v) => s + v * 100 * (Number(n[v]) || 0), 0);
    W.counter[accId] = false;
    compare(accId);
    rerender(`[data-act="rc-match"][data-acc="${CSS.escape(accId)}"]`);
    return true;
  }
  if (act === 'rc-cash-on') {
    state.settings.cashCountOn = true;
    ctx.commit();
    ctx.toast('Weekly cash count is on', 'Undo', () => ctx.undo?.());
    return true;
  }
  if (act === 'rc-acct-weekly') {
    RC.setAcctEvery(state, el.dataset.id, 'week');
    ctx.commit();
    ctx.toast(`${accOf(el.dataset.id)?.name || 'This account'}: checked every week`, 'Undo', () => ctx.undo?.());
    return true;
  }
  if (act === 'rc-to-flags') {
    document.getElementById('rc-flags')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }
  return false;
}

let bound = false;
/** Installs the window's keyboard and typing listeners (once). */
export function init() {
  if (bound) return;
  bound = true;
  document.addEventListener('keydown', (e) => {
    if (ctx.ui?.tab !== 'reality' || e.key !== 'Enter' || e.isComposing) return;
    const box = e.target.closest?.('[data-rc-real]');
    if (!box || box.closest('.sheet')) return;
    e.preventDefault();
    const accId = box.dataset.rcReal;
    const c = compare(accId);
    if (c == null) return;
    const acc = accOf(accId);
    const d = RC.rowDiff(ctx.state, accId, c, todayISO(), rateOf(acc.currency || main()) || 0);
    if (d.diff === 0) { finish(accId, c); return; }
    // A difference: show the causes; Tab or Enter goes to the first thing to do about it.
    rerender(`[data-acc="${CSS.escape(accId)}"] .rc-cause button, [data-act="rc-adjust"][data-acc="${CSS.escape(accId)}"]`);
  });
  document.addEventListener('input', (e) => {
    if (ctx.ui?.tab !== 'reality') return;
    const note = e.target.closest?.('[data-rc-note]');
    if (note) {
      const accId = note.dataset.acc;
      const acc = accOf(accId);
      const n = (W.notes[accId] = W.notes[accId] || {});
      n[note.dataset.rcNote] = Math.max(0, Math.floor(Number(note.value) || 0));
      const notes = NOTES[acc.currency || main()] || NOTES.MDL;
      const total = notes.reduce((s, v) => s + v * 100 * (Number(n[v]) || 0), 0);
      const out = note.closest('.rc-counter')?.querySelector('[data-rc-total]');
      if (out) out.textContent = formatMoney(total, acc.currency || main());
      return;
    }
    const box = e.target.closest?.('[data-rc-real]');
    // A new number starts a new comparison for that row.
    if (box) { delete W.first[box.dataset.rcReal]; delete W.firstBase[box.dataset.rcReal]; }
  });
}

/** Leaving the window forgets what was typed (nothing was saved from it). */
export function reset() {
  for (const k of ['real', 'first', 'firstBase', 'counter', 'notes']) W[k] = {};
  W.checkId = null;
}
