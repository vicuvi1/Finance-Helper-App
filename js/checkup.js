// Reality check (was the monthly check-up; pure, tested). Every 2 weeks by
// default (or every week / month, on the weekday or day of the month you pick,
// from the time you pick), Money asks for each account whether the bank shows the
// same balance. "Matches" only saves the check date. A different real balance adds
// ONE visible adjustment record that moves the balance but is marked
// notIncome / notSpending, so income and spending totals stay honest.
// The full window, causes, history and the real-data guard: js/reality.js and
// js/screens/reality.js.
// Plain settings keys (they sync with the data):
//   checkupOn (missing = on), checkupEvery ('week' | '2weeks' | 'month', missing = '2weeks'),
//   checkupWeekday (0 = Sunday … 6, missing = 0), checkupDay (1-28, missing = 1, for 'month'),
//   checkupTime ('HH:MM', missing = '19:00'), checkupAcctEvery = { accountId: every } (a
//   shorter interval for one account), checkupLast = { accountId: 'YYYY-MM-DD' } the last
//   check of each account, checkupSnooze = 'YYYY-MM-DD' "Not today".
// The reminder in Life System's bell (slot 'checkup', src/core/checkupNotice.ts) is sent by
// src/renderer/src/money/checkupRunner.ts: once per cycle, and a gentle reminder 2 days later.

import { accountBalances, activeAccounts, uid } from './model.js';
import { addDays, daysBetween, daysInMonth, monthKey, weekday } from './dates.js';

export const CHECKUP_NOTE = 'Monthly check-up';
export const EVERY = ['week', '2weeks', 'month'];
export const EVERY_LABEL = { week: 'Every week', '2weeks': 'Every 2 weeks', month: 'Every month' };
/** A check this many days before a check day counts for that day's cycle. */
const EARLY = { week: 2, '2weeks': 3, month: 7 };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function checkupConfig(state) {
  const st = state.settings || {};
  const day = Number.isInteger(st.checkupDay) && st.checkupDay >= 1 && st.checkupDay <= 28 ? st.checkupDay : 1;
  const wd = Number.isInteger(st.checkupWeekday) && st.checkupWeekday >= 0 && st.checkupWeekday <= 6 ? st.checkupWeekday : 0;
  const acctEvery = {};
  if (st.checkupAcctEvery && typeof st.checkupAcctEvery === 'object') for (const [k, v] of Object.entries(st.checkupAcctEvery)) if (EVERY.includes(v)) acctEvery[k] = v;
  return {
    on: st.checkupOn !== false,
    every: EVERY.includes(st.checkupEvery) ? st.checkupEvery : '2weeks',
    weekday: wd,
    day,
    time: typeof st.checkupTime === 'string' && TIME.test(st.checkupTime) ? st.checkupTime : '19:00',
    acctEvery,
    last: st.checkupLast && typeof st.checkupLast === 'object' ? st.checkupLast : {},
    snooze: typeof st.checkupSnooze === 'string' ? st.checkupSnooze : '',
  };
}

const pad = (n) => String(n).padStart(2, '0');
const monthDay = (key, d) => `${key}-${pad(Math.min(d, daysInMonth(key)))}`;
const shiftMonth = (key, n) => { const [y, m] = key.split('-').map(Number); const i = y * 12 + m - 1 + n; return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`; };

/** The first check day on or after `from` (the chosen weekday, or day of the month). */
export function gridOnOrAfter(every, c, from) {
  if (every === 'month') {
    const here = monthDay(monthKey(from), c.day);
    return here >= from ? here : monthDay(shiftMonth(monthKey(from), 1), c.day);
  }
  return addDays(from, (c.weekday - weekday(from) + 7) % 7);
}

/** The last check day on or before `today`. */
export function gridOnOrBefore(every, c, today) {
  if (every === 'month') {
    const here = monthDay(monthKey(today), c.day);
    return here <= today ? here : monthDay(shiftMonth(monthKey(today), -1), c.day);
  }
  return addDays(today, -((weekday(today) - c.weekday + 7) % 7));
}

/** How often one account is checked: its own interval, else the general one. */
export const everyOf = (c, accountId) => c.acctEvery[accountId] || c.every;

/**
 * When one account is due: the check day after the cycle its last check belongs to;
 * never checked = the last check day up to today. `cycle` is the start of the cycle running
 * today: a skipped check moves on to the next cycle, so the reminder comes back then.
 */
export function accountDue(c, accountId, last, today) {
  const every = everyOf(c, accountId);
  let due;
  if (!last) due = gridOnOrBefore(every, c, today);
  else {
    // The cycle a check belongs to: the check day before it (or one a few days after: a check a little early counts).
    const of = gridOnOrBefore(every, c, addDays(last, EARLY[every]));
    due = every === 'month' ? gridOnOrAfter('month', c, addDays(of, 1)) : addDays(of, every === 'week' ? 7 : 14);
  }
  let cycle = due;
  if (due < today) {
    if (every === 'month') { const g = gridOnOrBefore('month', c, today); if (g > cycle) cycle = g; }
    else { const p = every === 'week' ? 7 : 14; cycle = addDays(due, Math.floor(daysBetween(due, today) / p) * p); }
  }
  return { due, cycle, every };
}

/** The accounts to check: open accounts, the date each was last checked ('' = never) and (with `today`) when it is due. */
export function checkupAccounts(state, today) {
  const c = checkupConfig(state);
  return activeAccounts(state).map((a) => {
    const last = c.last[a.id] || '';
    return { account: a, last, ...(today ? accountDue(c, a.id, last, today) : {}) };
  });
}

/** Accounts due by today (with `hhmm`: by now, a check due today waits for the chosen time). */
export function unchecked(state, today, hhmm = '') {
  const c = checkupConfig(state);
  return checkupAccounts(state, today).filter((x) => x.due <= today && !(hhmm && x.due === today && hhmm < c.time));
}

/**
 * Is a reality check due: on, and some account is due. Returns { cycle, due, left, overdue, month }
 * or null. `cycle` = the newest cycle start among the accounts left (the reminder's key);
 * `overdue` = 2 days or more past the oldest due day.
 */
export function checkupDue(state, today, hhmm = '') {
  const c = checkupConfig(state);
  if (!c.on) return null;
  const left = unchecked(state, today, hhmm);
  if (!left.length) return null;
  const due = left.map((x) => x.due).sort()[0];
  const cycle = left.map((x) => x.cycle).sort().at(-1);
  return { cycle, due, left, overdue: daysBetween(due, today) >= 2, month: monthKey(today) };
}

/** The next day a check is due (after today), for "Next check: Sun, 29 Nov". */
export function nextCheck(state, today) {
  return checkupAccounts(state, today).map((x) => x.due).filter((d) => d > today).sort()[0] || null;
}

/** The Home card: due and not snoozed for today. */
export const checkupCard = (state, today) => {
  const due = checkupDue(state, today);
  return due && checkupConfig(state).snooze !== today ? due : null;
};

/**
 * You looked at the bank. `real` = the balance the bank shows (cents, the account's
 * currency), or null for "Yes, the same". Adds the adjustment only when it differs.
 * Returns { expected, diff, tx }.
 */
export function applyCheckup(state, accountId, real, today, { id = `chk-${uid()}`, now = Date.now(), rate = 1, note = CHECKUP_NOTE, extra = {} } = {}) {
  const acc = state.settings.accounts.find((a) => a.id === accountId);
  if (!acc) return { expected: 0, diff: 0, tx: null };
  const expected = accountBalances(state, today)[accountId] || 0;
  const diff = real == null ? 0 : real - expected;
  let tx = null;
  if (diff) {
    const out = diff < 0;
    const amount = Math.abs(diff);
    const cur = acc.currency || state.settings.currency;
    const r = cur === state.settings.currency ? 1 : rate;
    tx = {
      id, createdAt: now, updatedAt: now, type: out ? 'expense' : 'income', amount, currency: cur, rate: r, base: Math.round(amount * r), date: today,
      category: out ? 'other' : 'other-in', account: accountId, note, checkup: true, ...extra,
      ...(out ? { notSpending: true } : { notIncome: true }),
    };
    state.tx.push(tx);
  }
  // Only the day (sync keeps the later day per account): the shared settings time is not touched.
  state.settings.checkupLast = { ...(state.settings.checkupLast || {}), [accountId]: today };
  return { expected, diff, tx };
}

export function snoozeCheckup(state, today) {
  state.settings.checkupSnooze = today;
}

export function setCheckup(state, { on, day, every, weekday: wd, time }, now = Date.now()) {
  if (on !== undefined) state.settings.checkupOn = !!on;
  if (day !== undefined && Number.isInteger(day) && day >= 1 && day <= 28) state.settings.checkupDay = day;
  if (every !== undefined && EVERY.includes(every)) state.settings.checkupEvery = every;
  if (wd !== undefined && Number.isInteger(wd) && wd >= 0 && wd <= 6) state.settings.checkupWeekday = wd;
  if (time !== undefined && TIME.test(time)) state.settings.checkupTime = time;
  state.settings.updatedAt = now;
}
