// The year on one page (Reports → 📅 Year): income, spending and what you kept month by month,
// your savings rate, net worth at each month's end, the top categories, the best and hardest
// month, and the same totals against the year before. Pure and tested (tests/yearview.test.js).

import { yearOverview, monthSummary, category, netWorthSeries } from './model.js';
import { monthKey, monthsBetween } from './dates.js';

export function yearData(state, year, today) {
  const y = yearOverview(state, year);
  const prev = yearOverview(state, year - 1);
  const nowKey = monthKey(today);
  const months = y.rows.map((r) => ({ ...r, future: r.key > nowKey, empty: !r.income && !r.expense }));
  const real = months.filter((r) => !r.future && !r.empty);
  // Net worth at each month's end (the months the series covers).
  const back = Math.max(0, monthsBetween(`${year}-01`, nowKey)) + 1;
  const nw = new Map(netWorthSeries(state, today, Math.min(back, 240)).map((p) => [p.key, p.value]));
  for (const m of months) m.netWorth = nw.has(m.key) ? nw.get(m.key) : null;
  const firstNw = months.find((m) => m.netWorth != null);
  const lastNw = [...months].reverse().find((m) => m.netWorth != null);
  // Top categories for the year.
  const byCat = new Map();
  for (const r of real) {
    for (const c of monthSummary(state, r.key).byCategory || []) byCat.set(c.id ?? c.category, (byCat.get(c.id ?? c.category) || 0) + (c.amount ?? c.total ?? 0));
  }
  const spent = y.total.expense;
  const top = [...byCat.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([id, v]) => ({ id, name: category(state, id)?.name || 'Other', emoji: category(state, id)?.emoji || '', amount: v, share: spent > 0 ? v / spent : 0 }));
  const best = real.length ? real.reduce((a, b) => (b.net > a.net ? b : a)) : null;
  const worst = real.length > 1 ? real.reduce((a, b) => (b.net < a.net ? b : a)) : null;
  const n = real.length || 1;
  const prevHas = prev.total.income || prev.total.expense;
  return {
    year, months, total: y.total, count: real.length,
    avg: { income: Math.round(y.total.income / n), expense: Math.round(y.total.expense / n), net: Math.round(y.total.net / n) },
    best, worst: worst && worst.key !== best?.key ? worst : null, top,
    netWorth: firstNw && lastNw ? { from: firstNw.netWorth, to: lastNw.netWorth, change: lastNw.netWorth - firstNw.netWorth, fromKey: firstNw.key, toKey: lastNw.key } : null,
    prev: prevHas ? { ...prev.total, incomeChange: prev.total.income ? (y.total.income - prev.total.income) / prev.total.income : null, expenseChange: prev.total.expense ? (y.total.expense - prev.total.expense) / prev.total.expense : null } : null,
  };
}
