// Weekly cash count (pure, tested). Once a week, on the day you pick (default
// Sunday), Money Home asks how much cash is really in your cash account. If the
// number differs from the app, one visible adjustment record "Cash count" is
// added (review.js cashCheck); if it is the same, only the check date is saved.
// Settings are three plain keys: cashCountOn (default on), cashCountDay (0 =
// Sunday ... 6 = Saturday) and cashCountLast (the day of the last count).
// Not a notification: just a card.

import { cashAccounts, cashCheck } from './review.js';

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function cashCountConfig(state) {
  const st = state.settings || {};
  const day = Number.isInteger(st.cashCountDay) && st.cashCountDay >= 0 && st.cashCountDay <= 6 ? st.cashCountDay : 0;
  return { on: st.cashCountOn !== false, day, last: typeof st.cashCountLast === 'string' ? st.cashCountLast : '' };
}

const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

// The card to show today: { accounts: [cash accounts] } or null.
export function cashCountDue(state, today) {
  const c = cashCountConfig(state);
  if (!c.on || c.last === today || weekday(today) !== c.day) return null;
  const accounts = cashAccounts(state);
  return accounts.length ? { accounts, day: c.day } : null;
}

// You counted `counted` (cents) in `accountId`. Adds the record only when it
// differs. Returns { expected, diff, tx } (tx is null when the same).
export function applyCashCount(state, accountId, counted, today, { id, now = Date.now(), rate = 1 } = {}) {
  const r = cashCheck(state, accountId, counted, { date: today, id: id || `cc-${now.toString(36)}`, now, rate });
  if (r.tx) {
    r.tx.note = 'Cash count';
    r.tx.cashCount = true;
    state.tx.push(r.tx);
  }
  // Only the day: sync keeps the later day (js/sync.js LATER_DAY). The shared
  // settings time is not touched, so a count never overrides another device's settings.
  state.settings.cashCountLast = today;
  return r;
}

// "Same as the app": just record the check date.
export function markCashSame(state, today) {
  state.settings.cashCountLast = today;
}

export function setCashCount(state, { on, day }, now = Date.now()) {
  if (on !== undefined) state.settings.cashCountOn = !!on;
  if (day !== undefined && Number.isInteger(day) && day >= 0 && day <= 6) state.settings.cashCountDay = day;
  state.settings.updatedAt = now;
}
