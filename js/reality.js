// Reality check: compare the app's money with the real money (pure, tested).
// The schedule and the one adjustment record live in js/checkup.js; this file adds
// what the Reality check window (js/screens/reality.js) needs:
//  - rowDiff: an account's app balance vs the real number you typed, in its own
//    currency and valued in the main one;
//  - realityCauses: what could explain a difference, before any blind adjustment
//    (records waiting in To confirm, likely duplicates, a record of exactly that
//    amount, records dated in the future, records in another currency, transfers
//    not arrived yet, and spending that usually happens and is missing);
//  - the history of checks (settings.realityHistory, a list by id that syncs item by
//    item: js/settingstamp.js BY_ID), the accuracy streak, the accounts that drift
//    most and a habit tip for an account that keeps drifting;
//  - the real-data guard: new records that look wrong (far outside their category's
//    usual amount, a date in the future or long before the day they were added, a
//    currency that is not the account's, an exact duplicate, income with no source).
//    Nothing is changed by the guard: you confirm a record (guardOk) or fix it.

import { accountBalances, uid } from './model.js';
import { addDays, daysBetween, monthKey, dayLabel } from './dates.js';
import { dueItems } from './recurring.js';
import { effectOn, likelyDuplicates } from './reconcile.js';
import { countsAsIncome, countsAsSpending, isCorrection, isPointsReward } from './catshare.js';
import { applyCheckup, checkupConfig, everyOf, EVERY } from './checkup.js';

/** Within this much (main currency cents) the app counts as "right". */
export const CLOSE_ENOUGH = 5000;
export const HISTORY_MAX = 80;
export const GUARD_DAYS = 30;

const main = (state) => state.settings.currency || 'MDL';
const accOf = (state, id) => state.settings.accounts.find((a) => a.id === id);
const curOf = (state, acc) => (acc && acc.currency) || main(state);
const touches = (t, id) => t.account === id || t.from === id || t.to === id;
const baseOf = (t) => (Number.isFinite(t.base) ? Math.abs(t.base) : Math.abs(t.amount || 0));
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const dayOfMs = (ms) => new Date(ms).toISOString().slice(0, 10);

/** "Reality check 18 Nov": the note of the adjustment record. */
export const realityNote = (today) => `Reality check ${dayLabel(today).replace(/^\w+, /, '')}`;

/**
 * One account's row: app balance today vs the real number (`real` cents in the account's
 * currency, or null). `rate` = main currency per unit of the account's currency.
 */
export function rowDiff(state, accountId, real, today, rate = 1) {
  const acc = accOf(state, accountId);
  const currency = curOf(state, acc);
  const app = accountBalances(state, today)[accountId] || 0;
  const r = currency === main(state) ? 1 : rate > 0 ? rate : null;
  const diff = real == null ? null : real - app;
  const val = (c) => (c == null || r == null ? null : Math.round(c * r));
  return { account: accountId, currency, app, real, diff, rate: r, appBase: val(app), realBase: val(real), diffBase: val(diff) };
}

// ---------- Causes ----------

const KIND_ORDER = ['confirm', 'dupe', 'exact', 'wrongway', 'future', 'transfer', 'currency', 'olddate', 'forgot'];

/**
 * What could explain `diff` (= real − app, account currency cents). Each cause has
 * `effect`: how the app balance moves if you fix it (0 = can't tell), `fits` (fixing it
 * makes the difference exactly 0) and `helps` (it moves the app toward the bank).
 */
export function realityCauses(state, accountId, today, diff, { now = Date.now() } = {}) {
  if (!diff) return [];
  const acc = accOf(state, accountId);
  if (!acc) return [];
  const cur = curOf(state, acc);
  const since = checkupConfig(state).last[accountId] || null;
  const from = since || addDays(today, -60);
  const mine = state.tx.filter((t) => touches(t, accountId));
  const out = [];
  const seen = new Set();
  const add = (c) => { const k = `${c.kind}:${c.tx?.id || c.rule?.id || c.category}:${c.date || ''}`; if (!seen.has(k)) { seen.add(k); out.push(c); } };
  // Waiting in To confirm (a repeating record not confirmed yet).
  for (const { rule, date } of dueItems(state, today)) {
    if (rule.account !== accountId || (rule.currency || main(state)) !== cur) continue;
    const effect = rule.type === 'income' ? rule.amount : rule.type === 'expense' ? -rule.amount : 0;
    if (effect) add({ kind: 'confirm', rule, date, effect });
  }
  // Likely duplicates (the duplicate finder's rule, js/reconcile.js likelyDuplicates).
  const recent = mine.filter((t) => t.date > addDays(from, -3) && t.date <= today && !t.notDupe && !isCorrection(t) && !t.checkup);
  for (const [a, b] of likelyDuplicates(recent, accountId)) add({ kind: 'dupe', tx: b, other: a, effect: -effectOn(b, accountId) });
  // A record of exactly the difference (logged but not real) or half of it (logged the wrong way).
  for (const t of recent) {
    if (t.date <= from) continue;
    const e = effectOn(t, accountId);
    if (!e) continue;
    if (-e === diff) add({ kind: 'exact', tx: t, effect: -e });
    else if (-2 * e === diff) add({ kind: 'wrongway', tx: t, effect: -2 * e });
  }
  for (const t of mine) {
    const e = effectOn(t, accountId);
    // Dated in the future (not in today's balance): a bot or quick-add record with the wrong date, or a transfer still on its way.
    if (t.date > today) add({ kind: t.type === 'transfer' ? 'transfer' : 'future', tx: t, effect: e });
    // Added after your last check but dated before it: it changed a balance you had already checked.
    else if (since && t.date < since && Number(t.createdAt) > 0 && dayOfMs(t.createdAt) > since && !t.checkup) add({ kind: 'olddate', tx: t, effect: 0 });
    // A record in another currency than the account's (its amount was taken as the account's money).
    if (t.date <= today && !isCorrection(t) && ((t.type !== 'transfer' && t.account === accountId) || t.from === accountId) && (t.currency || main(state)) !== cur) add({ kind: 'currency', tx: t, effect: 0 });
  }
  // Probably forgotten spending: a category you pay from this account in 3 of the last 4 months, with nothing since the last check.
  if (diff < 0) {
    const months = [1, 2, 3, 4].map((i) => { const [y, m] = monthKey(today).split('-').map(Number); const k = y * 12 + m - 1 - i; return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`; });
    const sums = new Map();
    for (const t of mine) {
      if (t.account !== accountId || t.type !== 'expense' || !countsAsSpending(t)) continue;
      const mk = monthKey(t.date);
      if (!months.includes(mk)) continue;
      const m = sums.get(t.category) || new Map();
      m.set(mk, (m.get(mk) || 0) + t.amount);
      sums.set(t.category, m);
    }
    const quiet = since && daysBetween(since, today) >= 7 ? since : addDays(today, -14);
    for (const [cat, m] of sums) {
      if (m.size < 3) continue;
      if (mine.some((t) => t.account === accountId && t.type === 'expense' && t.category === cat && t.date > quiet && t.date <= today)) continue;
      add({ kind: 'forgot', category: cat, effect: -median([...m.values()]), since: quiet });
    }
  }
  for (const c of out) {
    c.fits = c.effect !== 0 && c.effect === diff;
    c.helps = c.effect !== 0 && Math.sign(c.effect) === Math.sign(diff) && Math.abs(c.effect) <= Math.abs(diff) * 1.5;
  }
  return out
    .sort((a, b) => Number(b.fits) - Number(a.fits) || Number(b.helps) - Number(a.helps) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
    .slice(0, 12);
}

// ---------- Fix: matches / one adjustment, and the history ----------

/** The history of checks, newest first. */
export function historyOf(state) {
  const list = Array.isArray(state.settings.realityHistory) ? state.settings.realityHistory : [];
  return list.filter((e) => e && typeof e.id === 'string' && typeof e.date === 'string' && Array.isArray(e.rows)).sort((a, b) => (a.date === b.date ? (b.updatedAt || 0) - (a.updatedAt || 0) : a.date < b.date ? 1 : -1));
}

/** A new check's id (one per window session). */
export const newCheckId = () => `rc-${uid()}`;

/**
 * Saves one account's result in check `checkId` (made when missing). `first` = the
 * difference when you first typed the real number (account currency), `firstBase` the
 * same in the main currency; `how` = 'match' | 'fixed' | 'adjusted' | 'fixed+adjusted'.
 */
export function saveRow(state, checkId, today, row, now = Date.now()) {
  if (!Array.isArray(state.settings.realityHistory)) state.settings.realityHistory = [];
  const list = state.settings.realityHistory;
  let e = list.find((x) => x && x.id === checkId);
  if (!e) { e = { id: checkId, date: today, rows: [] }; list.push(e); }
  e.rows = [...e.rows.filter((r) => r.account !== row.account), row];
  e.updatedAt = now;
  // Keep the newest HISTORY_MAX checks.
  if (list.length > HISTORY_MAX) {
    const keep = new Set(historyOf(state).slice(0, HISTORY_MAX).map((x) => x.id));
    state.settings.realityHistory = list.filter((x) => keep.has(x.id));
  }
  return e;
}

/**
 * Finishes one account. `real` null = "Matches" (only the check date). Otherwise the
 * difference left after any fixes becomes ONE adjustment record (notIncome / notSpending,
 * note "Reality check 18 Nov", `reality: <check id>`). Returns { tx, row }.
 */
export function finishAccount(state, accountId, real, today, { checkId, first = null, firstBase = null, rate = 1, now = Date.now(), id } = {}) {
  const before = rowDiff(state, accountId, real, today, rate);
  const r = applyCheckup(state, accountId, real, today, { rate, now, note: realityNote(today), extra: { reality: checkId }, ...(id ? { id } : {}) });
  const left = real == null ? 0 : before.diff;
  const firstDiff = first == null ? left : first;
  const how = real == null || (!left && !firstDiff) ? 'match' : !left ? 'fixed' : firstDiff !== left ? 'fixed+adjusted' : 'adjusted';
  const row = {
    account: accountId, currency: before.currency, app: before.app, real: real == null ? before.app : real,
    first: firstDiff, base: firstBase == null ? (before.rate ? Math.round(firstDiff * before.rate) : 0) : firstBase,
    left, how, ...(r.tx ? { adj: r.tx.id } : {}),
  };
  saveRow(state, checkId, today, row, now);
  // The weekly cash count is answered too (one check, not two cards).
  if (accOf(state, accountId)?.kind === 'cash') state.settings.cashCountLast = today;
  return { tx: r.tx, row };
}

// ---------- Adapt: accuracy, drift, habits ----------

/** How many checks in a row (newest first) had every account within `tol` of reality, before any fix. */
export function accuracy(state, tol = CLOSE_ENOUGH) {
  const list = historyOf(state).filter((e) => e.rows.length);
  let streak = 0;
  for (const e of list) {
    if (e.rows.every((r) => Math.abs(Number(r.base) || 0) <= tol)) streak++;
    else break;
  }
  return { streak, checks: list.length, tol };
}

/** Accounts that were off in their recent checks, most often first. */
export function drift(state, { last = 6, tol = CLOSE_ENOUGH } = {}) {
  const per = new Map();
  for (const e of historyOf(state)) {
    for (const r of e.rows) {
      const d = per.get(r.account) || { account: r.account, checks: 0, misses: 0, recent: 0, total: 0 };
      if (d.checks >= last) continue;
      const miss = Math.abs(Number(r.base) || 0) > tol;
      if (miss) { d.misses++; d.total += Math.abs(Number(r.base) || 0); if (d.checks < 3) d.recent++; }
      d.checks++;
      per.set(r.account, d);
    }
  }
  return [...per.values()].filter((d) => d.misses > 0 && accOf(state, d.account)).sort((a, b) => b.misses - a.misses || b.total - a.total);
}

/**
 * Habit tips for accounts off in 2 of their last 3 checks: log cash the same day (turn on the
 * weekly cash count), a repeating rule for regular payments, and checking that account weekly.
 */
export function habitTips(state) {
  const c = checkupConfig(state);
  const tips = [];
  for (const d of drift(state)) {
    if (d.recent < 2) continue;
    const acc = accOf(state, d.account);
    if (acc.kind === 'cash') tips.push({ account: acc.id, kind: 'cash', act: state.settings.cashCountOn === false ? 'cash-count-on' : null });
    else tips.push({ account: acc.id, kind: 'rule', act: 'open-repeating' });
    if (everyOf(c, acc.id) !== 'week') tips.push({ account: acc.id, kind: 'weekly', act: 'acct-weekly' });
  }
  return tips;
}

/** Checks one account on its own interval (null = back to the general one). */
export function setAcctEvery(state, accountId, every, now = Date.now()) {
  const map = { ...(state.settings.checkupAcctEvery && typeof state.settings.checkupAcctEvery === 'object' ? state.settings.checkupAcctEvery : {}) };
  if (every && EVERY.includes(every)) map[accountId] = every;
  else delete map[accountId];
  state.settings.checkupAcctEvery = map;
  state.settings.updatedAt = now;
}

// ---------- The real-data guard ----------

export const SOURCE_WORD = { telegram: 'Telegram bot', capture: 'quick add', import: 'import', maib: 'bank import', bank: 'bank import', gwallet: 'phone pay', 'life-system': 'Life System', aim: 'Life System', manual: 'you' };

const guarded = (t) => t && !t.guardOk && !isCorrection(t) && !isPointsReward(t) && !t.checkup && !t.cashCheck && !t.cashCount && !t.adjustment && !t.recurring && t.amount > 0;
const dupKey = (t) => [t.date, t.type, t.amount, t.currency, t.account || '', t.from || '', t.to || '', norm(t.note)].join('|');

/**
 * New records (added in the last GUARD_DAYS days) that look wrong. Returns
 * [{ tx, reasons: [{ code, ... }] }], newest first. Codes: 'range' (usual = the category's
 * median, main currency), 'future', 'old' (days = how long before it was added), 'currency'
 * (want = the account's currency), 'dupe' (of = the older record's id), 'nosource'.
 */
export function guardFlags(state, today, { now = Date.now(), days = GUARD_DAYS } = {}) {
  const isNew = (t) => (Number(t.createdAt) > 1e11 ? now - Number(t.createdAt) <= days * 864e5 : t.date >= addDays(today, -days) && t.date <= addDays(today, days));
  const list = state.tx.filter(guarded);
  const fresh = list.filter(isNew);
  if (!fresh.length) return [];
  // The usual amount per type and category (the last year, main currency values).
  const yearAgo = addDays(today, -365);
  const usual = new Map();
  for (const t of list) {
    if (t.type === 'transfer' || t.date < yearAgo || t.date > today) continue;
    const k = `${t.type}|${t.category}`;
    (usual.get(k) || usual.set(k, []).get(k)).push(baseOf(t));
  }
  // Exact duplicates: the same day, type, amount, currency, accounts and note.
  const groups = new Map();
  for (const t of state.tx) {
    if (!t || t.notDupe || t.splitOf || isCorrection(t) || t.checkup) continue;
    const k = dupKey(t);
    (groups.get(k) || groups.set(k, []).get(k)).push(t);
  }
  const older = new Map();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0) || String(a.id).localeCompare(String(b.id)));
    for (const t of g.slice(1)) older.set(t.id, g[0].id);
  }
  const out = [];
  for (const t of fresh) {
    const reasons = [];
    if (t.type !== 'transfer') {
      const xs = usual.get(`${t.type}|${t.category}`) || [];
      if (xs.length >= 6) {
        const med = median(xs);
        if (baseOf(t) > med * 5 && baseOf(t) - med >= 50000) reasons.push({ code: 'range', usual: med });
      }
    }
    if (t.date > today) reasons.push({ code: 'future' });
    else if (Number(t.createdAt) > 1e11) {
      const gap = daysBetween(t.date, dayOfMs(Number(t.createdAt)));
      if (gap > 60) reasons.push({ code: 'old', days: gap });
    }
    const accId = t.type === 'transfer' ? t.from : t.account;
    const acc = accOf(state, accId);
    if (acc && (t.currency || main(state)) !== curOf(state, acc)) reasons.push({ code: 'currency', want: curOf(state, acc) });
    if (older.has(t.id)) reasons.push({ code: 'dupe', of: older.get(t.id) });
    if (t.type === 'income' && countsAsIncome(t) && !t.incomeSource && !norm(t.note) && !t.person && !t.client) reasons.push({ code: 'nosource' });
    if (reasons.length) out.push({ tx: t, reasons });
  }
  return out.sort((a, b) => (Number(b.tx.createdAt) || 0) - (Number(a.tx.createdAt) || 0) || (a.tx.date < b.tx.date ? 1 : -1));
}

/** "It's right": the record is no longer flagged (a normal edit: logged, undoable, syncs). */
export function markRight(state, ids, now = Date.now()) {
  let n = 0;
  for (const t of state.tx) if (ids.includes(t.id) && !t.guardOk) { t.guardOk = true; t.updatedAt = now; n++; }
  return n;
}
