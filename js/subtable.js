// Subscriptions as a table (Plan → Subscriptions): each one is a repeating
// expense (state.recurring) with a few extra fields:
//   subscription: true    shown in this table (also: any repeating expense in a
//                         Subscriptions-like category)
//   sub: 's-…'            its subcategory (Subscriptions › Tech / AI, Streaming…)
//   remind: 3             days before the payment to warn (0 = no warning)
// The next payment is the rule's next due date. Pure and tested
// (tests/subtable.test.js); js/screens/subtable.js draws it.

import { addDays, daysBetween } from './dates.js';
import { dueItems, perMonth, occurrences } from './recurring.js';
import { convert } from './fx.js';
import { parentKeyOf, subsOf } from './cattree.js';
import { accountBalances } from './model.js';

export const EVERY = [
  { id: 'month', label: 'Monthly' },
  { id: 'year', label: 'Yearly' },
  { id: '3months', label: '3 months' },
  { id: 'week', label: 'Weekly' },
];
export const REMIND = [0, 1, 2, 3, 5, 7];
export const DEFAULT_REMIND = 3;

/** The Subscriptions category: the one whose name or id says so, or null. */
export function subsCategory(state) {
  return (state.settings.categories || []).find((c) => !c.archived && c.type === 'expense' && parentKeyOf(c) === 'subscriptions') || null;
}

export function isSubscription(state, r) {
  if (!r || r.type !== 'expense' || r.every === 'once') return false;
  if (r.subscription === true) return true;
  if (r.subscription === false) return false;
  const c = (state.settings.categories || []).find((x) => x.id === r.category);
  return parentKeyOf(c) === 'subscriptions';
}

/** The next date to pay (the earliest not yet logged, which may be in the past). */
export function nextPayment(state, rule, today) {
  const late = dueItems({ ...state, recurring: [rule] }, today)[0];
  if (late) return late.date;
  const from = rule.lastDone && rule.lastDone >= today ? addDays(rule.lastDone, 1) : addDays(today, 1);
  return occurrences(rule, from, addDays(from, 800), 1)[0] || null;
}

const inBase = (state, cents, cur) => {
  const base = state.settings.currency || 'MDL';
  return cur === base ? cents : convert(cents, cur, base, state.rates);
};

/**
 * Rows for the table, soonest first (paused last), and totals in the main currency.
 * status: 'late' (the date passed and it isn't logged), 'today', 'soon' (inside its
 * warning days), 'ok', 'paused'. low: the account it's paid from holds less than it costs.
 */
export function subscriptionTable(state, today) {
  const bal = accountBalances(state);
  const rows = [];
  for (const r of state.recurring || []) {
    if (!isSubscription(state, r)) continue;
    const next = r.paused ? null : nextPayment(state, r, today);
    const days = next ? daysBetween(today, next) : null;
    const remind = Number.isInteger(r.remind) ? r.remind : DEFAULT_REMIND;
    const status = r.paused ? 'paused' : days == null ? 'ok' : days < 0 ? 'late' : days === 0 ? 'today' : remind && days <= remind ? 'soon' : 'ok';
    const acc = (state.settings.accounts || []).find((a) => a.id === r.account) || null;
    const accCur = acc?.currency || state.settings.currency || 'MDL';
    const need = r.currency === accCur ? r.amount : convert(r.amount, r.currency, accCur, state.rates);
    const have = acc ? bal[acc.id] || 0 : null;
    const low = !r.paused && acc && need != null && have < need && (status !== 'ok' || days <= 7);
    const monthly = inBase(state, perMonth(r), r.currency);
    rows.push({ rule: r, id: r.id, name: r.note || 'Subscription', next, days, status, remind, low, have, accCur, monthly });
  }
  const order = { late: 0, today: 1, soon: 2, ok: 3, paused: 4 };
  rows.sort((a, b) => order[a.status] - order[b.status] || String(a.next || '9').localeCompare(String(b.next || '9')) || a.name.localeCompare(b.name));
  const live = rows.filter((x) => x.status !== 'paused');
  const month = live.reduce((s, x) => s + (x.monthly || 0), 0);
  const missingRate = live.some((x) => x.monthly == null);
  return { rows, month, year: month * 12, missingRate, count: live.length };
}

/** Adds a subscription. Returns the new rule. */
export function addSubscription(state, f, { id, now = Date.now(), today }) {
  const cat = f.category || subsCategory(state)?.id || 'other';
  const next = f.next || today;
  const rule = {
    id, createdAt: now, updatedAt: now, type: 'expense', subscription: true,
    note: String(f.name || '').trim() || 'Subscription',
    amount: Math.max(1, Math.round(f.amount || 0)),
    currency: f.currency || state.settings.currency || 'MDL',
    account: f.account || state.settings.accounts.find((a) => !a.archived)?.id || '',
    category: cat,
    ...(f.sub ? { sub: f.sub } : {}),
    every: EVERY.some((e) => e.id === f.every) ? f.every : 'month',
    start: next,
    lastDone: addDays(next, -1),
    remind: Number.isInteger(f.remind) ? f.remind : DEFAULT_REMIND,
    auto: false, paused: false,
  };
  state.recurring = [...(state.recurring || []), rule];
  return rule;
}

/** Changes one field of a subscription (an edit in the table). Returns false when nothing changed. */
export function editSubscription(state, id, field, value, { now = Date.now() } = {}) {
  const r = (state.recurring || []).find((x) => x.id === id);
  if (!r) return false;
  const before = JSON.stringify(r);
  if (field === 'name') r.note = String(value || '').trim() || r.note;
  else if (field === 'amount') { const v = Math.round(Number(value)); if (v > 0) r.amount = v; }
  else if (field === 'currency') { if (/^[A-Z]{3}$/.test(value)) r.currency = value; }
  else if (field === 'every') { if (EVERY.some((e) => e.id === value)) { r.every = value; delete r.n; delete r.unit; delete r.dom; } }
  else if (field === 'next') { if (/^\d{4}-\d{2}-\d{2}$/.test(value)) { r.start = value; r.lastDone = addDays(value, -1); if (Number.isInteger(r.dom)) r.dom = Number(value.slice(8)); } } // a "day of the month" rule follows the day you picked
  else if (field === 'account') { if ((state.settings.accounts || []).some((a) => a.id === value)) r.account = value; }
  else if (field === 'sub') { if (value) r.sub = value; else delete r.sub; }
  else if (field === 'remind') { const v = Number(value); if (REMIND.includes(v)) r.remind = v; }
  else if (field === 'paused') r.paused = !!value;
  else return false;
  r.subscription = true;
  if (JSON.stringify(r) === before) return false;
  r.updatedAt = now;
  return true;
}

/** The subcategories a subscription can have (of its category). */
export const subTypes = (state, rule) => subsOf(state, rule?.category || subsCategory(state)?.id);

/**
 * Warnings to send as notifications: one per payment date, inside its warning days
 * (and on the day, and if it went past without being logged). [{key, title, body}]
 */
export function subscriptionNotices(state, today, { hidden = false, money = (c, cur) => `${(c / 100).toFixed(2)} ${cur}` } = {}) {
  const out = [];
  for (const x of subscriptionTable(state, today).rows) {
    if (x.status === 'ok' || x.status === 'paused' || !x.remind && x.status === 'soon') continue;
    const acc = (state.settings.accounts || []).find((a) => a.id === x.rule.account);
    const what = hidden ? '' : ` ${money(x.rule.amount, x.rule.currency)}`;
    const from = acc ? ` from ${acc.name}` : '';
    const when = x.status === 'late' ? `was due ${x.next}` : x.status === 'today' ? 'is due today' : x.days === 1 ? 'is due tomorrow' : `is due in ${x.days} days (${x.next})`;
    const lowText = x.low && !hidden ? ` ${acc.name} has ${money(Math.max(0, x.have), x.accCur)}: top it up first.` : x.low ? ` ${acc.name} may not have enough.` : '';
    out.push({ key: `sub:${x.id}:${x.next}:${x.status === 'soon' ? 'soon' : x.status}`, title: `${x.name}${what}`, body: `${x.status === 'late' ? 'Not logged yet: it ' : 'It '}${when}${from}.${lowText}` });
  }
  return out;
}
