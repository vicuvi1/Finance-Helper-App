// The month review on Money Home (1st to 7th) and the net worth line.
// Pure (today is passed in). The card and the chart are drawn by
// js/screens/moneyb2.js. Spending is the one rule everywhere: catshare.js
// countsAsSpending / signed, so a refund lowers it.

import { addMonths, monthKey, monthLabel } from './dates.js';
import { countsAsSpending, countsAsIncome, signed } from './catshare.js';
import { txInMonth, category, isWorkCost, budgetStatus } from './model.js';
import { netWorthHistory } from './longview.js';
import { roundUp50 } from './budgetsuggest.js';
import { formatMoney } from './money.js';
import { sourceTotals, sourceName, NONE } from './incomesources.js';
import { expandSplits } from './splits.js';

const base = (t) => (Number.isInteger(t.base) ? t.base : t.amount);

function month(state, key) {
  const list = txInMonth(state, key);
  const byCat = new Map();
  let spent = 0;
  let income = 0;
  for (const t of expandSplits(list)) { // a split record per line (js/splits.js)
    if (countsAsSpending(t)) {
      const v = signed(t, base(t));
      spent += v;
      byCat.set(t.category, (byCat.get(t.category) || 0) + v);
    } else if (countsAsIncome(t)) income += base(t);
  }
  return { count: list.length, spent, income, byCat };
}

// The month to review: the one before `today`'s month, only on the 1st to the 7th.
export function reviewMonthKey(today) {
  const day = Number(today.slice(8, 10));
  return day >= 1 && day <= 7 ? addMonths(monthKey(today), -1) : null;
}

export function monthReview(state, today) {
  const key = reviewMonthKey(today);
  if (!key) return null;
  const cur = month(state, key);
  if (!cur.count) return null;
  const prev = month(state, addMonths(key, -1));
  const name = (id) => category(state, id)?.name || 'Other';
  const change = prev.count && prev.spent > 0 ? (cur.spent - prev.spent) / prev.spent : null;
  // The biggest change in a category (work costs apart).
  let top = null;
  for (const id of new Set([...cur.byCat.keys(), ...prev.byCat.keys()])) {
    if (isWorkCost(state, id)) continue;
    const now = cur.byCat.get(id) || 0;
    const before = prev.byCat.get(id) || 0;
    const diff = now - before;
    if (diff !== 0 && (!top || Math.abs(diff) > Math.abs(top.diff))) top = { id, name: name(id), diff, now, before };
  }
  const rate = cur.income > 0 ? (cur.income - cur.spent) / cur.income : null;
  const over = budgetStatus(state, key, `${key}-28`).rows.filter((r) => r.level === 'over')
    .map((r) => ({ id: r.category.id, name: r.category.name, spent: r.spent, budget: r.budget, pct: Math.round((r.spent / r.budget - 1) * 100) }))
    .sort((a, b) => b.pct - a.pct);
  let tip;
  if (over.length) {
    const o = over[0];
    tip = { kind: 'budget', id: o.id, raiseTo: roundUp50(o.spent), text: `${o.name} was ${o.pct}% over budget: raise it to ${formatMoney(roundUp50(o.spent), state.settings.currency)} or aim lower.` };
  } else if (rate != null && rate < 0) tip = { kind: 'deficit', text: 'You spent more than you earned. Pick one category to keep lower this month.' };
  else if (top && top.diff > 0 && top.before > 0) tip = { kind: 'rise', text: `${top.name} grew the most. Try to keep it near last month's level.` };
  else tip = { kind: 'ok', text: 'A steady month. Same again: log as you go.' };
  // Where the income came from (only when you use income sources): the biggest first.
  const st = sourceTotals(state, `${key}-01`, `${key}-31`);
  const sources = st.rows.some((x) => x.id !== NONE) ? st.rows.map((x) => ({ id: x.id, name: x.id === NONE ? 'No source' : sourceName(state, x.id), amount: x.amount })).slice(0, 4) : [];
  return { key, label: monthLabel(key), sources, name: monthLabel(key).split(' ')[0], spent: cur.spent, prevSpent: prev.count ? prev.spent : null, change, top, income: cur.income, rate, over, tip };
}

// Dismissed per device (localStorage, never synced).
const DISMISS = 'finance-helper.monthReviewDismissed';
const store = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };
export function dismissedReviews(storage = store()) {
  try { const v = JSON.parse(storage?.getItem(DISMISS) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function dismissReview(key, storage = store()) {
  try { storage?.setItem(DISMISS, JSON.stringify([...new Set([...dismissedReviews(storage), key])].slice(-24))); } catch { /* storage blocked: it shows again */ }
}

// Net worth at each of the last 12 month ends, plus today (main currency).
// Null with fewer than 2 points.
export function netWorthLine(state, today) {
  const h = netWorthHistory(state, today, { cur: null });
  const now = monthKey(today);
  const points = h.months.filter((m) => m.key < now).slice(-12).concat(h.months.filter((m) => m.key === now));
  if (points.length < 2) return null;
  const first = points[0];
  const last = points.at(-1);
  return {
    points: points.map((m) => ({ key: m.key, date: m.date, value: m.total })),
    now: last.total, first: first.total, change: last.total - first.total,
    percent: first.total ? (last.total - first.total) / Math.abs(first.total) : null,
    twelve: points.length >= 13, since: first.date, currency: h.currency,
  };
}
