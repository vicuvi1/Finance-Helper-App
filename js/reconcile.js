// Monthly reconciliation: once a month you type what the bank or card really
// says, the app compares it with its own balance on that day, and keeps the
// result as a reconciliation point (per account: date, real balance, app
// balance). A difference can be explained (entries since the last point,
// likely duplicates, recurring items not logged, an entry of exactly that
// amount) or settled with ONE adjustment record, clearly labelled
// ("Reconciliation adjustment"), that Undo takes out again.
//
// Rules: nothing here edits or deletes an existing record. An adjustment is a
// new record (it moves the balance, it is not income or spending: see
// catshare.js countsAsSpending and model.js counts), and undoing it goes
// through removeTx, so the deletion syncs like any other. Pure and tested.

import { accountBalances, removeTx, uid } from './model.js';
import { addDays, daysBetween } from './dates.js';
import { dueItems } from './recurring.js';

export const RECON_DUE_DAYS = 31;
export const ADJUST_NOTE = 'Reconciliation adjustment';

const byDate = (a, b) => (a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : a.date < b.date ? -1 : 1);

// Every point of one account, oldest first.
export const reconsOf = (state, accountId) => (state.reconciliations || []).filter((r) => r.account === accountId).sort(byDate);
export const lastRecon = (state, accountId) => reconsOf(state, accountId).at(-1) || null;

// What the app says the account held at the end of `date` (its own currency, cents).
export const appBalanceOn = (state, accountId, date) => accountBalances(state, date)[accountId] || 0;

const touches = (t, id) => t.account === id || t.from === id || t.to === id;

// The signed effect of one record on the account (cents, its currency).
export function effectOn(t, id) {
  if (t.type === 'income' && t.account === id) return t.amount;
  if (t.type === 'expense' && t.account === id) return -t.amount;
  if (t.type === 'transfer') {
    let v = 0;
    if (t.from === id) v -= t.amount;
    if (t.to === id) v += Number.isInteger(t.toAmount) ? t.toAmount : t.amount;
    return v;
  }
  return 0;
}

// Compare a real balance with the app's on a date. `diff` = real − app:
// positive means the bank has more than the app.
export function reconcileCheck(state, accountId, real, date) {
  const app = appBalanceOn(state, accountId, date);
  const last = (state.reconciliations || []).filter((r) => r.account === accountId && r.date <= date).sort(byDate).at(-1) || null;
  return { account: accountId, date, real, app, diff: real - app, since: last ? last.date : null };
}

// Saves a reconciliation point. Returns it.
export function addRecon(state, { account, date, real, id = `rc-${uid()}`, now = Date.now() }) {
  const c = reconcileCheck(state, account, real, date);
  const point = { id, account, date, real, app: c.app, diff: c.diff, adjustment: null, createdAt: now, updatedAt: now };
  (state.reconciliations || (state.reconciliations = [])).push(point);
  return point;
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Pairs of records on this account that look like the same thing logged
// twice: same type, same amount, at most a day apart, and the same note
// (or one of them without a note). Records a recurring rule or a split
// made on purpose (different rule dates, parts of one receipt) are not paired.
export function likelyDuplicates(list, id) {
  const pairs = [];
  const sorted = [...list].sort(byDate);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (daysBetween(a.date, b.date) > 1) break;
      if (a.type !== b.type || effectOn(a, id) !== effectOn(b, id) || !effectOn(a, id)) continue;
      if (a.splitOf && a.splitOf === b.splitOf) continue;
      const na = norm(a.note);
      const nb = norm(b.note);
      if (na && nb && na !== nb) continue;
      pairs.push([a, b]);
    }
  }
  return pairs;
}

// What could explain a difference on `date` (see the top of the file).
export function findCauses(state, accountId, date, diff) {
  const last = (state.reconciliations || []).filter((r) => r.account === accountId && r.date < date).sort(byDate).at(-1) || null;
  const since = last ? last.date : null;
  const mine = state.tx.filter((t) => touches(t, accountId) && t.date <= date);
  const after = mine.filter((t) => !since || t.date > since).sort((a, b) => byDate(b, a));
  // Duplicates: looked for in the entries since the last point (and a few days
  // before it, so a pair across the line is still found).
  const window = since ? addDays(since, -3) : null;
  const duplicates = likelyDuplicates(mine.filter((t) => !window || t.date > window), accountId);
  // Recurring items on this account that are due by then and were neither
  // logged nor skipped (the Plan's own rule, recurring.js dueItems).
  const missing = dueItems(state, date).filter((x) => x.rule.account === accountId && (!since || x.date > since));
  // An entry whose amount is exactly the difference: logged twice (diff < 0
  // for an expense logged twice shows as the bank having more…) or the wrong way.
  const exact = diff ? after.filter((t) => Math.abs(effectOn(t, accountId)) === Math.abs(diff) || Math.abs(effectOn(t, accountId)) * 2 === Math.abs(diff)) : [];
  return { since, after, duplicates, missing, exact };
}

// The one record that settles a point's difference. Labelled, on the
// point's date, linked both ways (tx.reconcile = point id, point.adjustment
// = tx id). `rate` prices the account's currency in the main one; null when
// no rate is known (the record then keeps `rate: null` and its value in the
// main currency is left at the amount, flagged for the re-price review).
// `diff` is what is left to settle (real − app now; by default the point's
// own difference). The point's saved numbers are never rewritten.
export function adjustRecon(state, point, { id = `adj-${uid()}`, now = Date.now(), rate = 1, currency, diff = point?.diff } = {}) {
  if (!point || !Number.isSafeInteger(diff) || !diff || point.adjustment) return null;
  const acc = state.settings.accounts.find((a) => a.id === point.account);
  if (!acc) return null;
  const amount = Math.abs(diff);
  const out = diff < 0;
  const cur = currency || acc.currency || state.settings.currency;
  const r = cur === state.settings.currency ? 1 : rate > 0 ? rate : null;
  const tx = {
    id, createdAt: now, updatedAt: now, type: out ? 'expense' : 'income', amount, currency: cur, rate: r, base: Math.round(amount * (r || 1)), date: point.date,
    category: out ? 'other' : 'other-in', account: point.account, note: ADJUST_NOTE, adjustment: true, reconcile: point.id,
  };
  state.tx.push(tx);
  point.adjustment = tx.id;
  point.updatedAt = now;
  return tx;
}

// Takes the adjustment back out (a deletion that syncs). The point stays,
// with its difference. Returns the removed record (or null).
export function undoAdjust(state, point, now = Date.now()) {
  if (!point?.adjustment) return null;
  const t = removeTx(state, point.adjustment, now);
  point.adjustment = null;
  point.updatedAt = now;
  return t;
}

// Removes a point (and its adjustment, if any). Returns what was removed.
export function removeRecon(state, pointId, now = Date.now()) {
  const list = state.reconciliations || [];
  const i = list.findIndex((r) => r.id === pointId);
  if (i < 0) return null;
  const [p] = list.splice(i, 1);
  const tx = p.adjustment ? removeTx(state, p.adjustment, now) : null;
  state.deleted[p.id] = now;
  return { point: p, tx };
}

// Is the difference of this point settled now: by the adjustment, or because
// the app's balance on that day has since come to match (a fixed record)?
export function pointStatus(state, point) {
  const app = appBalanceOn(state, point.account, point.date);
  const left = point.real - app;
  return { app, left, matched: left === 0, adjusted: !!point.adjustment };
}

// Accounts whose last reconciliation is more than RECON_DUE_DAYS old. An
// account never reconciled is due once its first record is that old (a new
// account is not nagged on day one). Archived accounts are left out.
export function reconDue(state, today, days = RECON_DUE_DAYS) {
  const out = [];
  for (const a of state.settings.accounts) {
    if (a.archived) continue;
    const last = lastRecon(state, a.id);
    if (last) {
      const age = daysBetween(last.date, today);
      if (age > days) out.push({ account: a, days: age, last: last.date });
      continue;
    }
    const first = state.tx.filter((t) => touches(t, a.id)).reduce((m, t) => (!m || t.date < m ? t.date : m), null);
    if (first && daysBetween(first, today) > days) out.push({ account: a, days: null, last: null });
  }
  return out;
}
