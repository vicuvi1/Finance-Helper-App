// "Suggest budgets from the last 3 months": for each expense category, the
// monthly average of the last 3 full months, rounded UP to the nearest 50 of
// the main currency. One-off records and work-cost categories are left out
// (js/everyday.js, the same rule as "Everyday only"). Pure; nothing is saved
// here: the screen writes only the ticked ones, as one undo step.

import { addMonths, monthKey } from './dates.js';
import { countsAsSpending, signed } from './catshare.js';
import { everydayList } from './everyday.js';
import { isWorkCost } from './model.js';

const base = (t) => (Number.isInteger(t.base) ? t.base : t.amount);
export const STEP = 5000; // 50 of the main currency, in cents
export const roundUp50 = (cents) => Math.ceil(cents / STEP) * STEP;

// -> [{ id, name, emoji, average (cents), suggested (cents), current (cents|null) }], biggest first.
export function suggestBudgets(state, today, months = 3) {
  const now = monthKey(today);
  const from = `${addMonths(now, -months)}-01`;
  const to = `${addMonths(now, -1)}-31`;
  const inRange = state.tx.filter((t) => t.date >= from && t.date <= to && countsAsSpending(t));
  const { list } = everydayList(inRange, { settings: state.settings, rates: state.rates, base, from, to });
  const sums = new Map();
  for (const t of list) sums.set(t.category, (sums.get(t.category) || 0) + signed(t, base(t)));
  const out = [];
  for (const c of state.settings.categories) {
    if (c.type !== 'expense' || isWorkCost(state, c.id)) continue;
    const total = sums.get(c.id) || 0;
    if (total <= 0) continue;
    const average = Math.round(total / months);
    out.push({ id: c.id, name: c.name, emoji: c.emoji || '', average, suggested: roundUp50(average), current: c.budget > 0 ? c.budget : null });
  }
  return out.sort((a, b) => b.average - a.average);
}
