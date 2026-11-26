// Debts you pay off: a bank loan or a credit card, with its interest rate and
// monthly payment. Shows what's left, when it's paid off and the interest still
// to pay. The monthly payment is a normal repeating bill (state.recurring, with
// `debtId`), so it shows in To confirm and Safe to spend keeps it back.
// Pure and tested (tests/debts.test.js).
//   settings.debts = [{ id, name, kind: 'loan'|'card', balance, asOf: 'YYYY-MM-DD', rate, payment,
//                       currency, account, day, ruleId, updatedAt }]
// balance: what you owed on asOf (bani). rate: yearly % (e.g. 18.5). payment: a month (bani).
// People & loans (money between you and people you know) stays separate.

import { addDays, addMonths, monthKey } from './dates.js';
import { activeAccounts, category } from './model.js';

export const debtList = (state) => (Array.isArray(state.settings?.debts) ? state.settings.debts : []);

/** Balance after k monthly payments of P at a monthly rate r. */
export function afterPayments(balance, r, P, k) {
  if (k <= 0) return balance;
  if (!r) return Math.max(0, balance - P * k);
  const g = (1 + r) ** k;
  return Math.max(0, Math.round(balance * g - (P * (g - 1)) / r));
}

/** Months to pay off B with P a month at monthly rate r (Infinity when P doesn't cover the interest). */
export function monthsToPayOff(balance, r, P) {
  if (balance <= 0) return 0;
  if (P <= 0) return Infinity;
  if (!r) return Math.ceil(balance / P);
  if (P <= balance * r) return Infinity;
  return Math.ceil(-Math.log(1 - (r * balance) / P) / Math.log(1 + r));
}

/** One debt's numbers: payments logged since asOf, what's left now, payoff month, interest still to pay. */
export function debtStatus(state, d, today) {
  const r = (Number(d.rate) || 0) / 100 / 12;
  const paid = d.ruleId ? (state.tx || []).filter((t) => t.recurring === d.ruleId && t.date > (d.asOf || '') && t.date <= today).length : 0;
  const left = afterPayments(d.balance, r, d.payment, paid);
  const months = monthsToPayOff(left, r, d.payment);
  const done = left <= 0;
  // The month of the next payment: this month only while its payment day is still ahead
  // (a first payment on 15 Dec seen on 22 Nov is December, so 2 payments end in January).
  const rule = d.ruleId ? (state.recurring || []).find((x) => x.id === d.ruleId) : null;
  const logged = d.ruleId ? (state.tx || []).filter((t) => t.recurring === d.ruleId && t.date <= today).map((t) => t.date) : [];
  const lastDone = [rule?.lastDone || '', ...logged].reduce((m, x) => (x > m ? x : m), '') || addDays(today, -1);
  const dd = String(Math.min(28, Math.max(1, Number(d.day) || 1))).padStart(2, '0');
  let first = monthKey(lastDone);
  if (`${first}-${dd}` <= lastDone) first = addMonths(first, 1);
  if (first < monthKey(today)) first = monthKey(today); // overdue: you pay it now
  const payoff = Number.isFinite(months) ? addMonths(first, Math.max(0, months - 1)) : null;
  const interestLeft = Number.isFinite(months) && !done ? Math.max(0, d.payment * months - left) : null;
  const interestMonth = Math.round(left * r);
  return { ...d, paid, left, months, payoff, interestLeft, interestMonth, done, never: !done && !Number.isFinite(months) };
}

/** How much sooner (months) and how much interest is saved by paying `extra` more a month. */
export function payMore(d, left, extra) {
  const r = (Number(d.rate) || 0) / 100 / 12;
  const a = monthsToPayOff(left, r, d.payment);
  const b = monthsToPayOff(left, r, d.payment + extra);
  if (!Number.isFinite(b)) return null;
  const costA = Number.isFinite(a) ? d.payment * a - left : null;
  const costB = (d.payment + extra) * b - left;
  return { months: Number.isFinite(a) ? a - b : null, saved: costA == null ? null : Math.max(0, costA - costB) };
}

const billCategory = (state) => {
  const cats = state.settings.categories || [];
  return (cats.find((c) => !c.archived && /loan|credit|debt|bank|bills|fees/i.test(c.name || '') && (c.type || 'expense') === 'expense') || category(state, 'other') || cats[0])?.id || 'other';
};

/** Adds a debt and its monthly payment as a repeating bill. */
export function addDebt(state, f, { id, ruleId, now = Date.now(), today }) {
  const cur = f.currency || state.settings.currency || 'MDL';
  const account = f.account || activeAccounts(state).find((a) => (a.currency || state.settings.currency) === cur && !a.savings)?.id || '';
  const day = Math.min(28, Math.max(1, Number(f.day) || Number(today.slice(8)) || 1));
  const d = {
    id, name: String(f.name || '').trim() || (f.kind === 'card' ? 'Credit card' : 'Loan'), kind: f.kind === 'card' ? 'card' : 'loan',
    balance: Math.max(0, Math.round(f.balance || 0)), asOf: today, rate: Math.max(0, Number(f.rate) || 0),
    payment: Math.max(0, Math.round(f.payment || 0)), currency: cur, account, day, ruleId: null, updatedAt: now,
  };
  if (d.payment > 0) {
    let next = `${today.slice(0, 8)}${String(day).padStart(2, '0')}`;
    if (next <= today) next = `${addMonths(today.slice(0, 7), 1)}-${String(day).padStart(2, '0')}`;
    const rule = { id: ruleId, createdAt: now, updatedAt: now, type: 'expense', note: `${d.name} payment`, amount: d.payment, currency: cur, account, category: billCategory(state), every: 'month', start: next, lastDone: addDays(next, -1), auto: false, paused: false, debtId: id };
    state.recurring = [...(state.recurring || []), rule];
    d.ruleId = ruleId;
  }
  state.settings.debts = [...debtList(state), d];
  state.settings.updatedAt = now;
  return d;
}

/** Updates what you owe today (from the bank's app): the count of payments starts again from today. */
export function setBalance(state, id, balance, { now = Date.now(), today }) {
  const d = debtList(state).find((x) => x.id === id);
  if (!d) return false;
  Object.assign(d, { balance: Math.max(0, Math.round(balance)), asOf: today, updatedAt: now });
  state.settings.updatedAt = now;
  return true;
}

/** Removes a debt; its monthly bill is paused (past payments stay in your records). */
export function removeDebt(state, id, { now = Date.now() } = {}) {
  const d = debtList(state).find((x) => x.id === id);
  if (!d) return false;
  state.settings.debts = debtList(state).filter((x) => x.id !== id);
  const rule = (state.recurring || []).find((r) => r.id === d.ruleId);
  if (rule) Object.assign(rule, { paused: true, updatedAt: now });
  state.settings.updatedAt = now;
  return true;
}
