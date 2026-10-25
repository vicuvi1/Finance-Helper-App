// Cash-flow forecast: spending money (cards and cash, not savings or
// crypto) day by day for the next weeks, from recurring bills and income,
// unpaid invoices and your usual day-to-day spending. Pure and tested.

import { accountBalances, isBillCategory, isWorkCost, payOn, B } from './model.js';
import { dueItems, upcomingItems } from './recurring.js';
import { invoiceStatus, invoiceTotal } from './invoices.js';
import { addDays, daysBetween } from './dates.js';
import { convert } from './fx.js';

export const isLiquid = (a) => !a.archived && !a.savings && a.kind !== 'savings' && a.kind !== 'crypto';

// Where your everyday spending came from over the last 60 days: account ids
// with their share, biggest first.
export function spentFrom(state, today, window = 60) {
  const since = addDays(today, -window + 1);
  const by = new Map();
  let total = 0;
  for (const t of state.tx) {
    if (t.type !== 'expense' || t.loan || t.recurring || t.date < since || t.date > today) continue;
    if (isBillCategory(state, t.category) || isWorkCost(state, t.category)) continue;
    by.set(t.account, (by.get(t.account) || 0) + B(t));
    total += B(t);
  }
  return [...by.entries()].map(([id, amount]) => ({ id, amount, share: total ? amount / total : 0 })).sort((a, b) => b.amount - a.amount);
}

// Spending money: the accounts you live from. Your own pick
// (settings.spendFrom) when you made one. Otherwise cards and cash that aren't
// savings, crypto or business (work money), plus any account a fifth or more
// of your everyday spending comes from (a wallet marked as savings, say).
// With Pay yourself on, never the buffer.
export function spendingIds(state, today = null) {
  const accs = state.settings.accounts.filter((a) => !a.archived);
  const pick = Array.isArray(state.settings.spendFrom) && state.settings.spendFrom.length ? state.settings.spendFrom : null;
  const ids = new Set(pick
    ? accs.filter((a) => pick.includes(a.id)).map((a) => a.id)
    : accs.filter((a) => isLiquid(a) && a.kind !== 'business').map((a) => a.id));
  if (!pick && today) {
    for (const x of spentFrom(state, today)) {
      const a = accs.find((y) => y.id === x.id);
      if (a && a.kind !== 'crypto' && x.share >= 0.2) ids.add(a.id);
    }
  }
  if (payOn(state)) ids.delete(state.settings.pay.buffer);
  return ids;
}

// Everyday spending per day over the last `window` days, leaving out what
// recurring items already cover and loans.
export function dailySpend(state, today, window = 90) {
  const since = addDays(today, -window + 1);
  const list = state.tx.filter((t) => t.type === 'expense' && !t.loan && !t.recurring && t.date >= since && t.date <= today);
  if (!list.length) return 0;
  const first = list.reduce((m, t) => (t.date < m ? t.date : m), today);
  const span = Math.max(14, daysBetween(first, today) + 1);
  return Math.round(list.reduce((a, t) => a + B(t), 0) / span);
}

export function forecast(state, today, { days = 60 } = {}) {
  const base = state.settings.currency;
  const toBase = (c, cur) => (cur === base ? c : convert(c, cur, base, state.rates));
  const bal = accountBalances(state);
  const spend = spendingIds(state, today);
  const start = state.settings.accounts.filter((a) => spend.has(a.id)).reduce((a, acc) => a + (toBase(bal[acc.id] || 0, acc.currency) || 0), 0);
  const end = addDays(today, days);
  const events = [];
  for (const { rule, date } of [...dueItems(state, today), ...upcomingItems(state, today, days)]) {
    const v = toBase(rule.amount, rule.currency);
    if (v == null) continue;
    events.push({ date: date < today ? today : date, amount: rule.type === 'income' ? v : -v, label: rule.note || 'Recurring', kind: 'recurring', late: date < today });
  }
  for (const inv of state.invoices || []) {
    const st = invoiceStatus(inv, today);
    if (st !== 'sent' && st !== 'overdue') continue;
    const v = toBase(invoiceTotal(inv), inv.currency);
    if (v == null) continue;
    const date = st === 'overdue' ? addDays(today, 7) : inv.due || addDays(today, 14);
    if (date <= end) events.push({ date, amount: v, label: `Invoice ${inv.number}`, kind: 'invoice', late: st === 'overdue' });
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  const daily = dailySpend(state, today);
  const points = [];
  let v = start;
  let low = { date: today, value: start };
  for (let d = 0; d <= days; d++) {
    const date = addDays(today, d);
    if (d > 0) v -= daily;
    for (const e of events) if (e.date === date) v += e.amount;
    points.push({ date, value: v });
    if (v < low.value) low = { date, value: v };
  }
  const income = events.filter((e) => e.amount > 0).reduce((a, e) => a + e.amount, 0);
  const bills = events.filter((e) => e.amount < 0).reduce((a, e) => a - e.amount, 0);
  return { start, end: v, low, daily, events, points, income, bills, days };
}
