// Recurring payments and income (rent, subscriptions, salary, a client's
// monthly invoice). A rule says what, how much and how often, from a first
// date; the app lists what is due and coming up, and can log it for you.
// Pure and tested; js/screens/plan.js shows it.

import { addMonths, addDays, daysInMonth, monthKey } from './dates.js';

export const FREQS = [
  { id: 'week', label: 'Every week', short: 'weekly' },
  { id: '2weeks', label: 'Every 2 weeks', short: 'every 2 weeks' },
  { id: 'month', label: 'Every month', short: 'monthly' },
  { id: '3months', label: 'Every 3 months', short: 'quarterly' },
  { id: 'year', label: 'Every year', short: 'yearly' },
];
const MONTHS = { month: 1, '3months': 3, year: 12 };
const pad = (n) => String(n).padStart(2, '0');

// The n-th date of a rule (0 = its start). Monthly rules keep the start's
// day, moved to the month's last day when shorter (31st -> 30 Apr, 28 Feb).
export function nth(rule, n) {
  if (rule.every === 'week') return addDays(rule.start, 7 * n);
  if (rule.every === '2weeks') return addDays(rule.start, 14 * n);
  const key = addMonths(monthKey(rule.start), (MONTHS[rule.every] || 1) * n);
  return `${key}-${pad(Math.min(Number(rule.start.slice(8, 10)), daysInMonth(key)))}`;
}

// Dates of a rule between from and to (inclusive).
export function occurrences(rule, from, to, max = 1000) {
  const out = [];
  for (let n = 0; n < 5000 && out.length < max; n++) {
    const d = nth(rule, n);
    if (d > to || (rule.end && d > rule.end)) break;
    if (d >= from) out.push(d);
  }
  return out;
}

export const nextDate = (rule, after) => occurrences(rule, addDays(after, 1), '9999-12-31', 1)[0] || null;

const active = (state) => (state.recurring || []).filter((r) => !r.paused);
const sortItems = (a, b) => a.date.localeCompare(b.date) || (a.rule.note || '').localeCompare(b.rule.note || '');

// Dates up to today that were neither logged nor skipped.
export function dueItems(state, today) {
  const out = [];
  for (const rule of active(state)) {
    const from = rule.lastDone ? addDays(rule.lastDone, 1) : rule.start;
    for (const date of occurrences(rule, from, today, 60)) out.push({ rule, date });
  }
  return out.sort(sortItems);
}

// What comes in the next `days` days (after today).
export function upcomingItems(state, today, days = 30) {
  const out = [];
  const to = addDays(today, days);
  for (const rule of active(state)) {
    const from = addDays(rule.lastDone && rule.lastDone > today ? rule.lastDone : today, 1);
    for (const date of occurrences(rule, from, to, 60)) out.push({ rule, date });
  }
  return out.sort(sortItems);
}

// The record a rule makes for one date. `rate` converts the rule's currency
// to the main one (1 when it is the main currency).
export function makeTx(rule, date, { id, now = Date.now(), rate = 1 } = {}) {
  const tx = {
    id,
    createdAt: now,
    updatedAt: now,
    type: rule.type,
    amount: rule.amount,
    currency: rule.currency,
    rate,
    base: Math.round(rule.amount * (rate || 1)),
    date,
    category: rule.category,
    account: rule.account,
    note: rule.note || '',
    recurring: rule.id,
  };
  if (rule.person) tx.person = rule.person;
  return tx;
}

// Logs (or skips) every due date of a rule up to `date`.
export function markDone(rule, date, now = Date.now()) {
  if (!rule.lastDone || date > rule.lastDone) rule.lastDone = date;
  rule.updatedAt = now;
  return rule;
}

// Monthly cost of a rule (weekly x 52/12 etc.), for totals.
export function perMonth(rule) {
  const f = { week: 52 / 12, '2weeks': 26 / 12, month: 1, '3months': 1 / 3, year: 1 / 12 }[rule.every] || 1;
  return Math.round(rule.amount * f);
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Things that look regular in the log: the same note and type in at least 3
// of the last 4 months, about once a month, for a similar amount (so
// "groceries" twenty times a month is not a bill), and not a rule yet.
export function suggestions(state, today, { months = 4, min = 3 } = {}) {
  const thisMonth = monthKey(today);
  const firstMonth = addMonths(thisMonth, -(months - 1));
  const have = new Set((state.recurring || []).map((r) => `${r.type}|${norm(r.note)}`));
  const groups = new Map();
  for (const t of state.tx) {
    if (t.type === 'transfer' || t.loan || t.recurring || !norm(t.note)) continue;
    const m = monthKey(t.date);
    if (m < firstMonth || m > thisMonth) continue;
    const k = `${t.type}|${norm(t.note)}`;
    if (have.has(k)) continue;
    if (!groups.has(k)) groups.set(k, { months: new Set(), last: t, count: 0, lo: Infinity, hi: 0 });
    const g = groups.get(k);
    g.months.add(m);
    g.count++;
    g.lo = Math.min(g.lo, t.amount);
    g.hi = Math.max(g.hi, t.amount);
    if (t.date > g.last.date) g.last = t;
  }
  return [...groups.values()]
    .filter((g) => g.months.size >= min && g.count <= g.months.size * 1.5 && g.hi <= g.lo * 1.5)
    .map((g) => ({ tx: g.last, months: g.months.size }))
    .sort((a, b) => b.tx.amount - a.tx.amount);
}
