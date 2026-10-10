// Cash-flow forecast: spending money (cards and cash, not savings or
// crypto) day by day for the next weeks, from recurring bills and income,
// unpaid invoices and your usual day-to-day spending. Pure and tested.

import { accountBalances, B } from './model.js';
import { dueItems, upcomingItems } from './recurring.js';
import { invoiceStatus, invoiceTotal } from './invoices.js';
import { addDays, daysBetween } from './dates.js';
import { convert } from './fx.js';

export const isLiquid = (a) => !a.archived && !a.savings && a.kind !== 'savings' && a.kind !== 'crypto';

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
  const start = state.settings.accounts.filter(isLiquid).reduce((a, acc) => a + (toBase(bal[acc.id] || 0, acc.currency) || 0), 0);
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
