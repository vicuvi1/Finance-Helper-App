// The weekly money ritual and the cash check (pure, tested).
// - weeklyReview: the last 7 days: kept % vs your target, spending vs your
//   usual week, the biggest leak, records still in "Other".
// - cashCheck: you count your wallet; the difference from what the app
//   expects becomes one "untracked cash" record, so balances stay true.

import { accountBalances, B, category, savingsJar, sortTx } from './model.js';
import { addDays } from './dates.js';

const counts = (t) => !t.loan && t.type !== 'transfer';
const inRange = (t, from, to) => t.date >= from && t.date <= to;

// Days in a row with at least one record, ending today (or yesterday, so
// the streak isn't "broken" before you had a chance to log today).
export function loggingStreak(state, today) {
  const days = new Set(state.tx.map((t) => t.date));
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

export function weeklyReview(state, today) {
  const from = addDays(today, -6);
  const week = state.tx.filter((t) => counts(t) && inRange(t, from, today));
  const income = week.filter((t) => t.type === 'income').reduce((a, t) => a + B(t), 0);
  const expense = week.filter((t) => t.type === 'expense').reduce((a, t) => a + B(t), 0);
  // The 4 weeks before, as "a usual week" (weeks with no records skipped).
  const prior = [];
  const perCat = {};
  for (let w = 1; w <= 4; w++) {
    const f = addDays(from, -7 * w);
    const to = addDays(today, -7 * w);
    const list = state.tx.filter((t) => counts(t) && t.type === 'expense' && inRange(t, f, to));
    if (!state.tx.some((t) => inRange(t, f, to))) continue;
    prior.push(list.reduce((a, t) => a + B(t), 0));
    for (const t of list) perCat[t.category] = (perCat[t.category] || 0) + B(t);
  }
  const usual = prior.length ? Math.round(prior.reduce((a, b) => a + b, 0) / prior.length) : null;
  const byCat = {};
  for (const t of week.filter((x) => x.type === 'expense')) byCat[t.category] = (byCat[t.category] || 0) + B(t);
  // Biggest leak: the category most above its usual week (or simply the biggest).
  let leak = null;
  for (const [id, amount] of Object.entries(byCat)) {
    const avg = prior.length ? (perCat[id] || 0) / prior.length : 0;
    const over = amount - avg;
    if (over >= 10000 && (!leak || over > leak.over)) leak = { category: id, amount, usual: Math.round(avg), over: Math.round(over) };
  }
  if (!leak) {
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    if (top) leak = { category: top[0], amount: top[1], usual: null, over: null };
  }
  const other = sortTx(state.tx.filter((t) => t.type === 'expense' && t.category === 'other' && t.note && t.date >= addDays(today, -13) && t.date <= today && !t.cashCheck)).slice(0, 5);
  const target = savingsJar(state)?.pct ?? 0;
  const kept = income > 0 ? (income - expense) / income : null;
  return { from, to: today, income, expense, kept, target, usual, change: usual ? (expense - usual) / usual : null, leak, other, streak: loggingStreak(state, today), records: week.length };
}

export const cashAccounts = (state) => state.settings.accounts.filter((a) => a.kind === 'cash' && !a.archived);

// You counted `counted` (cents) in a cash account. Returns what the app
// expected, the difference and the record that settles it (or null).
export function cashCheck(state, accountId, counted, { date, id, now = Date.now(), rate = 1 } = {}) {
  const acc = state.settings.accounts.find((a) => a.id === accountId);
  const expected = accountBalances(state)[accountId] || 0;
  const diff = counted - expected;
  if (!acc || !diff) return { expected, diff, tx: null };
  const out = diff < 0;
  const amount = Math.abs(diff);
  const tx = {
    id, createdAt: now, updatedAt: now, type: out ? 'expense' : 'income', amount, currency: acc.currency, rate, base: Math.round(amount * rate), date,
    category: out ? 'other' : 'other-in', account: accountId, note: out ? 'Untracked cash (cash check)' : 'Found cash (cash check)', cashCheck: true,
  };
  return { expected, diff, tx };
}

export const catName = (state, id) => category(state, id)?.name || 'Other';
