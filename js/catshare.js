// "Where my money goes": the numbers behind the donut and the category rows.
// Pure (no page, no clock): spending per category for a period, each one's
// share (whole percents that add up to exactly 100), small ones folded into
// "Other", and the same numbers for the period before. Tested.
//
// What counts as spending: expenses only. Transfers, income, loans (lent or
// repaid) and the records Life System makes for a reward bought with points
// ("From Rewards (points)", id life-reward-…) are left out.

import { addMonths, daysInMonth, monthKey, monthLabel } from './dates.js';
import { expandSplits } from './splits.js';

export const OTHER_ID = '__other';
export const FOLD_BELOW = 0.03; // categories under 3% fold into Other
export const MAX_SEGMENTS = 7; // more than this also fold into Other

export const isPointsReward = (t) => String(t?.id || '').startsWith('life-reward-');
// A reconciliation adjustment (js/reconcile.js) settles a difference with the
// bank: it moves the balance but is neither income nor spending.
export const isCorrection = (t) => !!t?.reconcile;
// A refund is money back for something bought: an income record (`refund: true`)
// with an expense category. The money did arrive (balances see it), but it is
// not income: it lowers its category's spending instead (see `signed`).
export const isRefund = (t) => t?.type === 'income' && t.refund === true && !t.loan && !isCorrection(t) && !isPointsReward(t);
// "Doesn't count as income / spending": money you already had that was put into
// an account (`notIncome: true` on an income record), or money that left but was
// not really spending (`notSpending: true` on an expense). The balance still
// moves; the record is left out of every income / spending total.
export const isNotCounted = (t) => (t?.type === 'income' && t.notIncome === true) || (t?.type === 'expense' && t.notSpending === true);
export const countsAsSpending = (t) => (t.type === 'expense' && !t.loan && !isPointsReward(t) && !isCorrection(t) && !isNotCounted(t)) || isRefund(t);
export const countsAsIncome = (t) => t.type === 'income' && !t.loan && !isCorrection(t) && !isRefund(t) && !isNotCounted(t);
// A spending record's amount with the refund sign: a refund is negative.
export const signed = (t, v) => (isRefund(t) ? -v : v);

// "This month", "Last month", "3 months", "Year", or "m:2026-09" (a month you picked).
export const SPEND_PERIODS = [
  { id: 'month', name: 'This month' },
  { id: 'last', name: 'Last month' },
  { id: '3m', name: '3 months' },
  { id: 'year', name: 'Year' },
];

const end = (k) => `${k}-${String(daysInMonth(k)).padStart(2, '0')}`;
// The same day number in another month (31st becomes the month's last day).
const sameDay = (k, day) => `${k}-${String(Math.min(day, daysInMonth(k))).padStart(2, '0')}`;

// The period and the one right before it (same number of months; for a period
// that is still running, only as many days as have passed, so the comparison is fair).
export function spendRange(id, today) {
  const m = monthKey(today);
  const day = Number(today.slice(8));
  const pick = String(id).match(/^m:(\d{4}-\d{2})$/);
  const monthRange = (k) => {
    const running = k === m;
    const pk = addMonths(k, -1);
    return {
      id, from: `${k}-01`, to: running ? today : end(k), label: monthLabel(k),
      prev: { from: `${pk}-01`, to: running ? sameDay(pk, day) : end(pk), word: running ? 'same days last month' : 'the month before' },
    };
  };
  if (pick) return monthRange(pick[1]);
  if (id === 'last') return monthRange(addMonths(m, -1));
  if (id === '3m') {
    const k = addMonths(m, -2);
    const pk = addMonths(k, -3);
    return { id, from: `${k}-01`, to: today, label: `${monthLabel(k, true)} – ${monthLabel(m, true)}`, prev: { from: `${pk}-01`, to: sameDay(addMonths(m, -3), day), word: 'the 3 months before' } };
  }
  if (id === 'year') {
    const y = Number(today.slice(0, 4));
    return { id, from: `${y}-01-01`, to: today, label: String(y), prev: { from: `${y - 1}-01-01`, to: sameDay(`${y - 1}-${today.slice(5, 7)}`, day), word: 'last year' } };
  }
  return monthRange(m);
}

// Whole percents that add up to exactly `to` (largest remainder).
export function wholePercents(amounts, to = 100) {
  const total = amounts.reduce((a, x) => a + x, 0);
  if (!total) return amounts.map(() => 0);
  const raw = amounts.map((a) => (a / total) * to);
  const out = raw.map(Math.floor);
  let left = to - out.reduce((a, x) => a + x, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i]++;
  return out;
}

function sum(list, base, from, to) {
  const by = new Map();
  const count = new Map();
  let total = 0;
  // A split record counts as its lines (js/splits.js): 400 Food + 200 Home.
  for (const t of expandSplits(list)) {
    if (!countsAsSpending(t) || t.date < from || t.date > to) continue;
    const a = signed(t, base(t));
    by.set(t.category, (by.get(t.category) || 0) + a);
    count.set(t.category, (count.get(t.category) || 0) + 1);
    total += a;
  }
  return { by, count, total };
}

// categoryShares(list, { from, to, prev: { from, to } }, base) gives
//   { total, prevTotal, rows }
// rows: biggest first, { id, amount, share, pct, count, prev, change }
//   (change = this against before as a fraction, null when there was nothing before);
//   the last row is { id: OTHER_ID, items: [rows folded in] } when anything folded.
// `base(t)` is the record's amount in the main currency (model.js B).
export function categoryShares(list, range, base) {
  const now = sum(list, base, range.from, range.to);
  const before = range.prev ? sum(list, base, range.prev.from, range.prev.to) : { by: new Map(), count: new Map(), total: 0 };
  // A category a refund took below 0 shows as nothing; the shares are of what is shown.
  const shown = [...now.by.values()].reduce((a, x) => a + Math.max(0, x), 0);
  const make = (id, amount, count, prev) => ({ id, amount, count, prev, share: shown ? amount / shown : 0, change: prev > 0 ? (amount - prev) / prev : null });
  const all = [...now.by.entries()].filter(([, a]) => a > 0)
    .map(([id, a]) => make(id, a, now.count.get(id) || 0, Math.max(0, before.by.get(id) || 0)))
    .sort((a, b) => b.amount - a.amount || String(a.id).localeCompare(String(b.id)));
  let keep = all.filter((r) => r.share >= FOLD_BELOW);
  let small = all.filter((r) => r.share < FOLD_BELOW);
  // A lone small category stays as it is: an "Other" holding one thing would only confuse.
  if (small.length === 1) { keep = all; small = []; }
  if (keep.length > MAX_SEGMENTS) { small = [...keep.slice(MAX_SEGMENTS - 1), ...small]; keep = keep.slice(0, MAX_SEGMENTS - 1); }
  let rows = keep;
  if (small.length) {
    const amount = small.reduce((a, r) => a + r.amount, 0);
    const prev = small.reduce((a, r) => a + r.prev, 0);
    rows = [...keep, { ...make(OTHER_ID, amount, small.reduce((a, r) => a + r.count, 0), prev), items: small }];
  }
  const pcts = wholePercents(rows.map((r) => r.amount));
  rows.forEach((r, i) => { r.pct = pcts[i]; });
  const last = rows.at(-1);
  if (last?.items) {
    const ip = wholePercents(last.items.map((r) => r.amount), last.pct);
    last.items.forEach((r, i) => { r.pct = ip[i]; });
  }
  return { total: now.total, prevTotal: before.total, rows };
}

// "+12% vs last month" in plain words ("new vs ..." when there was nothing before).
export function changeText(row, word) {
  if (row.change == null) return `new vs ${word}`;
  const p = Math.round(row.change * 100);
  if (p === 0) return `no change vs ${word}`;
  return `${p > 0 ? '+' : '−'}${Math.abs(p)}% vs ${word}`;
}
