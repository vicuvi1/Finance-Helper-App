// The money calendar: one month, day by day. For each day: what was spent,
// the bills due (recurring payments), the income expected (a salary, a
// client's monthly invoice), big one-off buys, and for days still to come a
// running "money left" line: today's cards and cash, minus bills, plus income.
// A future day where that line is under the safety floor (settings.moneyFloor,
// default 0) is "tight". Days with no spending record are no-spend days.
// Pure and read only; js/screens/calendar.js shows it.
//   settings.moneyFloor  cents, the money you want to keep (default 0)

import { B, knownRates } from './model.js';
import { spendingIds } from './forecast.js';
import { safeToSpend, isEveryday } from './safespend.js';
import { dueItems, upcomingItems, occurrences } from './recurring.js';
import { countsAsSpending } from './catshare.js';
import { convert } from './fx.js';
import { addDays, addMonths, daysBetween, daysInMonth, monthKey } from './dates.js';

const pad = (n) => String(n).padStart(2, '0');

// A one-off buy is "big" from this much (main currency, in cents).
export const BIG_BUY = 100000;

export const floorOf = (state) => Math.max(0, Math.round(Number(state.settings?.moneyFloor) || 0));

const baseConverter = (state) => {
  const base = state.settings.currency;
  const rates = knownRates(state);
  return (c, cur) => (!cur || cur === base ? c : convert(c, cur, base, rates)) || 0;
};

// What came in and went out on each day after today, up to `to`, and the
// money left at the end of each day. Cards and cash only; everyday spending
// is not guessed, only bills, income and records logged ahead.
export function moneyLine(state, today, to) {
  const toBase = baseConverter(state);
  const out = new Map();
  const days = daysBetween(today, to);
  if (days < 1) return out;
  const sf = safeToSpend(state, today);
  // Late items (due before today, never logged) are money still to move: the last 31 days only,
  // and not a rule with 3 or more payments never logged (most likely cancelled, not owed).
  let left = sf.liquid;
  const due = dueItems(state, today);
  const missed = new Map();
  for (const x of due) missed.set(x.rule.id, (missed.get(x.rule.id) || 0) + 1);
  const since = addDays(today, -31);
  for (const x of due) {
    if (missed.get(x.rule.id) >= 3 || (x.date && x.date < since)) continue;
    const v = toBase(x.rule.amount, x.rule.currency);
    if (x.rule.type === 'income') left += v; else if (x.rule.type === 'expense') left -= v;
  }
  const step = new Map();
  const at = (d) => { if (!step.has(d)) step.set(d, { in: 0, out: 0 }); return step.get(d); };
  for (const x of upcomingItems(state, today, days)) {
    const v = toBase(x.rule.amount, x.rule.currency);
    if (x.rule.type === 'income') at(x.date).in += v; else if (x.rule.type === 'expense') at(x.date).out += v;
  }
  // Records logged ahead: only those on your cards and cash (a future move into savings isn't spending money).
  const mine = spendingIds(state, today);
  for (const t of state.tx) {
    if (t.date <= today || t.date > to || t.notIncome || t.notSpending) continue;
    if (t.account && !mine.has(t.account)) continue;
    if (t.type === 'income') at(t.date).in += B(t); else if (t.type === 'expense') at(t.date).out += B(t);
  }
  out.set(today, { left, in: 0, out: 0 });
  for (let i = 1; i <= days; i++) {
    const d = addDays(today, i);
    const s = step.get(d) || { in: 0, out: 0 };
    left += s.in - s.out;
    out.set(d, { left, in: s.in, out: s.out });
  }
  return out;
}

// Days of a month with no spending record, up to (not including) today.
// Days before the first record you ever logged are not counted. Same
// "counts as spending" rule as the Money hub spending card.
export function noSpendDays(state, key, today, { upTo = null } = {}) {
  const n = daysInMonth(key);
  const first = state.tx.reduce((m, t) => (!m || t.date < m ? t.date : m), '');
  if (!first) return { count: 0, counted: 0, dates: [] };
  const spend = new Set(state.tx.filter(countsAsSpending).map((t) => t.date));
  const dates = [];
  let counted = 0;
  for (let i = 1; i <= (upTo ? Math.min(n, upTo) : n); i++) {
    const d = `${key}-${pad(i)}`;
    if (d >= today || d < first) continue;
    counted++;
    if (!spend.has(d)) dates.push(d);
  }
  return { count: dates.length, counted, dates };
}

export function monthCalendar(state, today, key) {
  const floor = floorOf(state);
  const toBase = baseConverter(state);
  const n = daysInMonth(key);
  const first = `${key}-01`;
  const last = `${key}-${pad(n)}`;
  const days = [];
  const byDate = new Map();
  for (let i = 1; i <= n; i++) {
    const date = `${key}-${pad(i)}`;
    const day = { date, future: date > today, today: date === today, spent: 0, records: [], bills: [], income: [], big: [], ahead: [], noSpend: false, left: null, tight: false };
    days.push(day);
    byDate.set(date, day);
  }
  for (const t of state.tx) {
    const day = byDate.get(t.date);
    if (!day) continue;
    day.records.push(t);
    if (day.future) { if (t.type === 'income' || t.type === 'expense') day.ahead.push(t); continue; }
    if (countsAsSpending(t)) day.spent += B(t);
    if (isEveryday(state, t) && B(t) >= BIG_BUY) day.big.push(t);
  }
  for (const rule of (state.recurring || []).filter((r) => !r.paused)) {
    if (rule.type !== 'income' && rule.type !== 'expense') continue;
    for (const date of occurrences(rule, first, last, 100)) {
      const item = { rule, label: rule.note || (rule.type === 'income' ? 'Income' : 'Bill'), amount: toBase(rule.amount, rule.currency), done: !!rule.lastDone && date <= rule.lastDone };
      byDate.get(date)[rule.type === 'income' ? 'income' : 'bills'].push(item);
    }
  }
  // Money left, from today on.
  const line = last > today ? moneyLine(state, today, last) : new Map();
  for (const day of days) {
    const p = line.get(day.date);
    if (!p || day.today) continue;
    day.left = p.left;
    day.tight = p.left < floor;
  }
  const ns = noSpendDays(state, key, today);
  const set = new Set(ns.dates);
  for (const day of days) day.noSpend = set.has(day.date);
  // Last month, over the same days when this month isn't over.
  const upTo = key === monthKey(today) ? Number(today.slice(8)) - 1 : null;
  const prev = noSpendDays(state, addMonths(key, -1), today, { upTo });
  return {
    key, days, floor,
    noSpend: ns.count, counted: ns.counted, prev: { count: prev.count, counted: prev.counted, upTo },
    spent: days.reduce((a, d) => a + d.spent, 0),
    tightDays: days.filter((d) => d.tight).length,
    endLeft: line.get(last)?.left ?? null,
  };
}
