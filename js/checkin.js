// The 10-minute Sunday check-in: one guided screen each week (Saturday to Monday).
//  1. Your week in one number (spent, against a usual week) and the biggest leak.
//  2. Confirm: payments to check (phone) and bills not marked paid yet.
//  3. File what is in "Other".
//  4. Next week: what's safe a day, the bills coming, and one tip.
// Done weeks: settings.checkins = { 'YYYY-MM-DD' (that week's Monday): time } (synced).
// Pure and tested (tests/checkin.test.js); js/screens/checkin.js shows it.

import { addDays, dowIndex } from './dates.js';
import { weeklyReview } from './review.js';
import { toCheck } from './tocheck.js';
import { dueItems, upcomingItems } from './recurring.js';
import { safeToSpend } from './safespend.js';
import { smartSteps } from './smartwarn.js';
import { category } from './model.js';

/** The Monday of the week a day is in (dowIndex: 0 = Monday). */
export const weekOf = (day) => addDays(day, -dowIndex(day));

/** The week a check-in on `today` is about: Sat/Sun → this week; Monday → last week. */
export function checkinWeek(today) {
  const d = dowIndex(today);
  return d === 0 ? weekOf(addDays(today, -1)) : weekOf(today);
}

export const checkins = (state) => state.settings?.checkins || {};
export const isDone = (state, today) => !!checkins(state)[checkinWeek(today)];
/** Offered Saturday, Sunday and Monday until done, once there are some records. */
export const isDue = (state, today) => [5, 6, 0].includes(dowIndex(today)) && !isDone(state, today) && (state.tx || []).length >= 5;

export function markDone(state, today, now = Date.now()) {
  state.settings.checkins = { ...checkins(state), [checkinWeek(today)]: now };
  state.settings.updatedAt = now;
}

/** Everything the check-in shows. */
export function checkinData(state, today) {
  const r = weeklyReview(state, today);
  const check = toCheck(state);
  const late = dueItems(state, today).filter((x) => x.rule.type === 'expense');
  const other = (state.tx || []).filter((t) => t.type === 'expense' && (t.category === 'other' || !t.category) && t.date >= addDays(today, -13) && t.date <= today && !t.cashCheck);
  const next = upcomingItems(state, today, 7).filter((x) => x.rule.type === 'expense');
  const sf = safeToSpend(state, today);
  const tip = smartSteps(state, today)[0] || null;
  return {
    week: checkinWeek(today), review: r, leakName: r.leak ? category(state, r.leak.category)?.name || 'Other' : null,
    check, late, other, next, perDay: sf.perDay, tip,
    todo: check.length + late.length + other.length,
  };
}
