// "Pay yourself": freelance income comes in lumps, so it all goes into a
// buffer account, and once a month a fixed salary moves from the buffer to
// your spending account. Every month then looks the same, and the buffer
// tells you how many months you'd be fine if clients stopped paying.
// Pure and tested (tests/payyourself.test.js). Settings: state.settings.pay =
// { on, buffer, to, amount (bani, main currency), day (1–28), auto }.

import { accountBalances, personalMonth, payOn } from './model.js';
import { addMonths, monthKey, daysInMonth, monthLabel } from './dates.js';
import { convert } from './fx.js';

const pad = (n) => String(n).padStart(2, '0');
const toBase = (state, c, cur) => (!cur || cur === state.settings.currency ? c : convert(c, cur, state.settings.currency, state.rates));
const fromBase = (state, c, cur) => (!cur || cur === state.settings.currency ? c : convert(c, state.settings.currency, cur, state.rates));

// A safe salary: 80% of what your work earned on average (after work costs),
// over the last 6 months that had income. Whole hundreds of lei.
export function suggestSalary(state, today) {
  const key = monthKey(today);
  const months = [1, 2, 3, 4, 5, 6].map((n) => personalMonth(state, addMonths(key, -n))).filter((m) => m.workIncome > 0);
  if (!months.length) return { amount: 0, average: 0, months: 0 };
  const average = Math.round(months.reduce((a, m) => a + m.profit, 0) / months.length);
  return { amount: Math.max(0, Math.floor((average * 0.8) / 10000) * 10000), average, months: months.length };
}

// The salary day in a month ("1st", "15th"); short months clamp to their end.
export const salaryDate = (key, day = 1) => `${key}-${pad(Math.min(Math.max(1, day), daysInMonth(key)))}`;

export const salaryOf = (state, key) => state.tx.find((t) => t.type === 'transfer' && t.salary === key) || null;

export function payStatus(state, today) {
  if (!payOn(state)) return { on: false, suggest: suggestSalary(state, today) };
  const p = state.settings.pay;
  const key = monthKey(today);
  const date = salaryDate(key, p.day);
  const paid = salaryOf(state, key);
  const due = !paid && today >= date;
  // The next payday Safe to spend counts down to.
  const next = !paid && today < date ? date : salaryDate(addMonths(key, 1), p.day);
  const acc = state.settings.accounts.find((a) => a.id === p.buffer);
  const bal = accountBalances(state);
  const bufferBalance = toBase(state, bal[p.buffer] || 0, acc?.currency) ?? 0;
  const runway = p.amount > 0 ? Math.max(0, bufferBalance) / p.amount : 0;
  return { on: true, key, label: monthLabel(key), amount: p.amount, date, paid, due, next, bufferBalance, runway, short: due && bufferBalance < p.amount };
}

// This month's salary: a transfer from the buffer to your spending account
// (converted when they are in different currencies). null without a rate.
export function salaryTx(state, today, { id, now = Date.now() } = {}) {
  const p = state.settings.pay;
  const key = monthKey(today);
  const accs = state.settings.accounts;
  const from = accs.find((a) => a.id === p.buffer);
  const to = accs.find((a) => a.id === p.to);
  if (!from || !to || !(p.amount > 0)) return null;
  const fromCur = from.currency || state.settings.currency;
  const toCur = to.currency || state.settings.currency;
  const out = fromBase(state, p.amount, fromCur);
  const inn = fromBase(state, p.amount, toCur);
  if (out == null || inn == null) return null;
  const amount = Math.round(out);
  return {
    id, createdAt: now, updatedAt: now, type: 'transfer', amount, currency: fromCur, rate: amount ? p.amount / amount : 1, base: p.amount,
    ...(toCur !== fromCur ? { toAmount: Math.round(inn) } : {}),
    date: today, from: p.buffer, to: p.to, note: `Salary · ${monthLabel(key)}`, salary: key,
  };
}

// "Your buffer covers 5.5 months" / "3 weeks".
export function runwayText(months) {
  if (months >= 1) return `${months >= 10 ? Math.round(months) : Math.round(months * 10) / 10} month${months >= 1 && months < 1.05 ? '' : 's'}`;
  const weeks = Math.floor(months * 4.3);
  return weeks >= 1 ? `${weeks} week${weeks === 1 ? '' : 's'}` : 'less than a week';
}
