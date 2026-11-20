// Recurring payments and income (rent, subscriptions, salary, a client's
// monthly invoice). A rule says what, how much and how often, from a first
// date; the app lists what is due and coming up, and can log it for you.
// Pure and tested; js/screens/plan.js shows it.

import { addMonths, addDays, daysInMonth, monthKey } from './dates.js';

export const FREQS = [
  { id: 'once', label: 'Just once (scheduled)', short: 'once' },
  { id: 'week', label: 'Every week', short: 'weekly' },
  { id: '2weeks', label: 'Every 2 weeks', short: 'every 2 weeks' },
  { id: 'month', label: 'Every month', short: 'monthly' },
  { id: '3months', label: 'Every 3 months', short: 'quarterly' },
  { id: 'year', label: 'Every year', short: 'yearly' },
  { id: 'custom', label: 'Custom: every N days, weeks, months or years', short: 'custom' },
];
export const UNITS = [
  { id: 'day', one: 'day', many: 'days' },
  { id: 'week', one: 'week', many: 'weeks' },
  { id: 'month', one: 'month', many: 'months' },
  { id: 'year', one: 'year', many: 'years' },
];
const LEGACY = { week: ['week', 1], '2weeks': ['week', 2], month: ['month', 1], '3months': ['month', 3], year: ['year', 1] };
const pad = (n) => String(n).padStart(2, '0');
const clampN = (n) => Math.max(1, Math.min(999, Math.round(Number(n)) || 1));

// How a rule repeats: { unit: day|week|month|year, n, dom } (null for "once").
// The old ids (week, 2weeks, month, 3months, year) still work; "custom" reads
// rule.n and rule.unit, and rule.dom (a day of the month, 1-31) for months and years.
export function spec(rule) {
  if (rule.every === 'once') return null;
  if (rule.every === 'custom') {
    const unit = UNITS.some((u) => u.id === rule.unit) ? rule.unit : 'month';
    const dom = (unit === 'month' || unit === 'year') && Number.isInteger(rule.dom) && rule.dom >= 1 && rule.dom <= 31 ? rule.dom : null;
    return { unit, n: clampN(rule.n), dom };
  }
  const [unit, n] = LEGACY[rule.every] || ['month', 1];
  return { unit, n, dom: null };
}

// "Every 2 weeks", "Every month on the 5th", for lists.
export function describe(rule) {
  if (rule.every === 'once') return 'Just once';
  const s = spec(rule);
  const u = UNITS.find((x) => x.id === s.unit);
  const nth = (d) => `${d}${d % 100 >= 11 && d % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[d % 10] || 'th'}`;
  const base = s.n === 1 ? `Every ${u.one}` : `Every ${s.n} ${u.many}`;
  return s.dom ? `${base} on the ${nth(s.dom)}` : base;
}

// The first date of a rule: its start (a day-of-month rule moves it to the
// first such day on or after the start).
function anchor(rule, s) {
  if (!s.dom || (s.unit !== 'month' && s.unit !== 'year')) return rule.start;
  const key = monthKey(rule.start);
  const d = `${key}-${pad(Math.min(s.dom, daysInMonth(key)))}`;
  return d >= rule.start ? d : `${addMonths(key, 1)}-${pad(Math.min(s.dom, daysInMonth(addMonths(key, 1))))}`;
}

// The n-th date of a rule (0 = its start). Month and year rules keep the
// start's day (or the chosen day of the month), moved to the month's last day
// when it is shorter (31st -> 30 Apr, 28 Feb; 29 Feb -> 28 Feb, and back to 29
// Feb in the next leap year, because every date is worked out from the start).
export function nth(rule, n) {
  const s = spec(rule);
  if (!s) return rule.start;
  const first = anchor(rule, s);
  if (s.unit === 'day') return addDays(first, s.n * n);
  if (s.unit === 'week') return addDays(first, 7 * s.n * n);
  const key = addMonths(monthKey(first), (s.unit === 'year' ? 12 : 1) * s.n * n);
  return `${key}-${pad(Math.min(s.dom || Number(first.slice(8, 10)), daysInMonth(key)))}`;
}

// The id of the record a rule makes for one date: the same on every device, so a
// date is never added twice (sync keeps one record per id).
export const recId = (rule, date) => `rec-${rule.id}-${date}`;

// Dates of a rule between from and to (inclusive).
export function occurrences(rule, from, to, max = 1000) {
  const out = [];
  for (let n = 0; n < 5000 && out.length < max; n++) {
    if (rule.every === 'once' && n > 0) break;
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
  const have = new Set((state.tx || []).map((t) => t.id));
  for (const rule of active(state)) {
    const from = rule.lastDone ? addDays(rule.lastDone, 1) : rule.start;
    for (const date of occurrences(rule, from, today, 60)) {
      // Another device may have logged it already (its lastDone not here yet): never offer it again.
      if (have.has(recId(rule, date))) continue;
      out.push({ rule, date });
    }
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
  if (rule.sub) tx.sub = rule.sub; // its subcategory (Subscriptions › Tech / AI…)
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
  if (rule.every === 'once') return 0; // a one-off isn't a regular cost
  const sp = spec(rule);
  const f = { day: 365 / 12, week: 52 / 12, month: 1, year: 1 / 12 }[sp.unit] / sp.n;
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
