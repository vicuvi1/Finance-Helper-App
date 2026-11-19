// The long view: net worth over time, the savings rate, this year against
// last year per category, and how many months your savings would last.
// Pure functions over the state (no page, no clock: `today` is passed in),
// tested in Node. They only READ the state; nothing here changes a record.
//
// The rules, in one place (all shared with the rest of Finance, none new):
// - Income and spending: catshare.js countsAsIncome / countsAsSpending, the
//   one rule Reports, the year review and the Money page use (loans, rewards
//   bought with points and reconciliation adjustments are neither). Transfers
//   between your accounts are never either. A refund (`refund: true`) is not income: it lowers its category's spending
//   (the same in Reports and on the Money page).
// - Money is in your main currency: each record's own `base` (fixed at the
//   rate of its day). Account balances in another currency are converted with
//   the saved rate of that day (or the nearest earlier saved day), else the
//   rate of your latest converted record in that currency up to that day,
//   else model.js knownRates (today's, or the newest known). With no rate at
//   all an account is listed as missing, never counted 1:1.
// - Today's point is model.js totalBalance: open accounts, knownRates, coins
//   included. Coins are only known for today, so earlier points leave them out.
// - A month with a saved net-worth snapshot (state.netWorth) and no records
//   after it that month uses the snapshot: it holds that day's real rates and
//   coins. Other months are rebuilt from records.
// - Books (`tx.book ?? 'personal'`, `account.book ?? 'personal'`): with a book
//   picked, only that book's records count, and an account's starting balance
//   counts in its own book. The books add up to the whole. Snapshots hold
//   every book, so a book view is always rebuilt.

import { B, category, knownRates } from './model.js';
import { withArchive } from './archive.js';
import { countsAsSpending, countsAsIncome, signed } from './catshare.js';
import { pairRate, convert, coinValue } from './fx.js';
import { addMonths, daysInMonth, monthKey } from './dates.js';
import { expandSplits } from './splits.js';

export const bookOf = (t) => t?.book ?? 'personal';
export const accountBook = (a) => a?.book ?? 'personal';
const allBooks = (book) => !book || book === 'all';
const inBook = (t, book) => allBooks(book) || bookOf(t) === book;
const accInBook = (a, book) => allBooks(book) || accountBook(a) === book;

// Every book that appears in your records or accounts ("personal" first).
export function booksIn(state) {
  const set = new Set(['personal']);
  for (const t of state.tx || []) if (t) set.add(bookOf(t));
  for (const a of state.settings?.accounts || []) set.add(accountBook(a));
  return [...set].sort((a, b) => (a === 'personal' ? -1 : b === 'personal' ? 1 : a.localeCompare(b)));
}

const monthEnd = (k) => `${k}-${String(daysInMonth(k)).padStart(2, '0')}`;
// A split record counts as its lines (js/splits.js).
const live = (state) => expandSplits(state.tx || []).filter((t) => t && !t.deleted && typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t.date));


// ---------- Rates on a past day ----------

// A lookup for "1 unit of `cur` in the main currency on `date`".
// Returns { rate, from: 'day' | 'record' | 'today' } or null.
export function rateBook(state) {
  const base = state.settings?.currency || 'MDL';
  const known = knownRates(state);
  const hist = state.rates?.history || {};
  const days = Object.keys(hist).sort();
  const recs = new Map();
  for (const t of live(state)) {
    if (!t.currency || t.currency === base || !(t.rate > 0) || (t.rate === 1 && t.base === t.amount)) continue;
    if (!recs.has(t.currency)) recs.set(t.currency, []);
    recs.get(t.currency).push(t);
  }
  for (const list of recs.values()) list.sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
  const lastOnOrBefore = (sorted, date, key = (x) => x) => {
    let lo = 0;
    let hi = sorted.length - 1;
    let hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (key(sorted[mid]) <= date) { hit = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return hit;
  };
  return (cur, date) => {
    if (!cur || cur === base) return { rate: 1, from: 'day' };
    // The saved rates of that day, or the nearest earlier day that has this currency.
    for (let i = lastOnOrBefore(days, date); i >= 0; i--) {
      const r = pairRate(cur, base, { usd: hist[days[i]] });
      if (r) return { rate: r, from: 'day' };
    }
    const list = recs.get(cur) || [];
    const j = lastOnOrBefore(list, date, (t) => t.date.slice(0, 10));
    if (j >= 0) return { rate: list[j].rate, from: 'record' };
    const now = pairRate(cur, base, known);
    if (now) return { rate: now, from: 'today' };
    // Before anything was saved: the earliest saved day or record we have.
    for (const d of days) {
      const r = pairRate(cur, base, { usd: hist[d] });
      if (r) return { rate: r, from: 'day' };
    }
    return list.length ? { rate: list[0].rate, from: 'record' } : null;
  };
}

// ---------- Showing it in another currency (MDL, USD, EUR) ----------

// The currencies the long view can be shown in: your main one first, then
// MDL, USD and EUR when a rate for them is known.
export const VIEW_CURRENCIES = ['MDL', 'USD', 'EUR'];
export function viewCurrencies(state, today, rate = rateBook(state)) {
  const base = state.settings?.currency || 'MDL';
  return [...new Set([base, ...VIEW_CURRENCIES])].filter((c) => c === base || rate(c, today));
}

// Main-currency cents shown in `cur` at the rate of `date` (the same lookup
// as the balances: that day's saved rate or the nearest one we have; today's
// point uses knownRates). A currency without any rate falls back to the main
// one, so a figure is never counted 1:1. Returns { cur, show(cents, date, current) }.
export function viewIn(state, cur, rate = rateBook(state)) {
  const base = state.settings?.currency || 'MDL';
  if (!cur || cur === base || !rate(cur, '9999-12-31')) return { cur: base, show: (c) => c };
  const known = knownRates(state);
  const cache = new Map();
  return {
    cur,
    show: (c, date, current = false) => {
      if (c == null) return null;
      if (current) {
        const v = convert(c, base, cur, known);
        if (v != null) return v;
      }
      if (!cache.has(date)) cache.set(date, rate(cur, date)?.rate || null);
      const r = cache.get(date);
      return r ? Math.round(c / r) : null;
    },
  };
}

// ---------- Net worth over time ----------

function move(bal, t) {
  if (t.type === 'income' && t.account in bal) bal[t.account] += t.amount;
  else if (t.type === 'expense' && t.account in bal) bal[t.account] -= t.amount;
  else if (t.type === 'transfer') {
    if (t.from in bal) bal[t.from] -= t.amount;
    if (t.to in bal) bal[t.to] += Number.isInteger(t.toAmount) ? t.toAmount : t.amount;
  }
}

// Net worth at the end of every month from your first record to today, plus
// year ends, and what each account adds.
//   months: [{ key, date, total, rebuilt, source: 'snapshot' | 'rebuilt' | 'today',
//              byAccount: { id: cents | null }, missing: [id], estimated }]
//     (byAccount is always rebuilt from records; `estimated`: some account had
//      no saved rate for that day and used the nearest one we have)
//   years:  [{ year, date, total, change }]   (the first year's change is from your opening balances)
//   accounts: [{ id, name, emoji, currency, archived, now, change }]  (change: this year)
//   opening, now, changeThisYear, currency, missing
export function netWorthHistory(state, today, { book = null, cur = null } = {}) {
  const base = state.settings?.currency || 'MDL';
  const accounts = state.settings?.accounts || [];
  const rate = rateBook(state);
  const known = knownRates(state);
  const view = viewIn(state, cur, rate);
  // Shown in the picked currency at the rate of that day (MDL: as it is).
  const shown = (v, date, current) => ({ ...v, total: view.show(v.total, date, current), byAccount: Object.fromEntries(Object.entries(v.byAccount).map(([id, x]) => [id, view.show(x, date, current)])) });
  const txs = live(state).filter((t) => inBook(t, book) && t.date.slice(0, 10) <= today).sort((a, b) => a.date.localeCompare(b.date));
  const now = monthKey(today);
  const firstKey = txs.length ? monthKey(txs[0].date) : now;
  const snaps = allBooks(book) ? (state.netWorth || []).filter((x) => x && typeof x.date === 'string' && Number.isFinite(x.total)).sort((a, b) => a.date.localeCompare(b.date)) : [];
  const bal = Object.fromEntries(accounts.map((a) => [a.id, accInBook(a, book) ? a.start || 0 : 0]));
  const value = (date, current) => {
    const byAccount = {};
    const missing = [];
    let total = 0;
    let estimated = false;
    for (const a of accounts) {
      // Today's total is totalBalance's: open accounts only.
      if (current && a.archived) continue;
      const own = bal[a.id] || 0;
      const acur = a.currency || base;
      let v;
      if (acur === base || !own) v = own;
      else if (current) v = convert(own, acur, base, known);
      else {
        const r = rate(acur, date);
        v = r ? Math.round(own * r.rate) : null;
        if (r && r.from !== 'day') estimated = true;
      }
      if (current && accInBook(a, book)) {
        for (const h of a.holdings || []) {
          const c = coinValue(Number(h.qty), h.asset, base, known);
          if (c != null && v != null) v += c;
        }
      }
      byAccount[a.id] = v;
      if (v == null) missing.push(a.id);
      else total += v;
    }
    return { total, byAccount, missing, estimated };
  };
  const openDate = txs.length ? txs[0].date.slice(0, 10) : today;
  const opening = shown(value(openDate, false), openDate, false);
  const months = [];
  let i = 0;
  for (let k = firstKey; k <= now; k = addMonths(k, 1)) {
    const current = k === now;
    const end = current ? today : monthEnd(k);
    while (i < txs.length && txs[i].date.slice(0, 10) <= end) move(bal, txs[i++]);
    const v = shown(value(end, current), end, current);
    // A saved snapshot wins when nothing was logged after it that month
    // (`i` is now just past this month's records).
    const snap = current ? null : snaps.filter((x) => x.date.startsWith(k) && x.date <= end).at(-1);
    const fresh = !!snap && !(i > 0 && txs[i - 1].date.slice(0, 10) > snap.date && txs[i - 1].date.slice(0, 7) === k);
    months.push({ key: k, date: end, ...v, rebuilt: v.total, total: fresh ? view.show(snap.total, snap.date) : v.total, source: current ? 'today' : fresh ? 'snapshot' : 'rebuilt' });
  }
  const years = [];
  let prev = opening.total;
  for (const m of months) {
    if (m.key.endsWith('-12') || m.key === now) {
      years.push({ year: Number(m.key.slice(0, 4)), date: m.date, total: m.total, change: m.total - prev });
      prev = m.total;
    }
  }
  const last = months.at(-1);
  const lastYearEnd = months.find((m) => m.key === `${Number(now.slice(0, 4)) - 1}-12`) || null;
  const yearStart = lastYearEnd || opening;
  const list = accounts
    .map((a) => {
      const v = a.id in last.byAccount ? last.byAccount[a.id] : 0;
      const s = yearStart.byAccount[a.id];
      return { id: a.id, name: a.name || 'Account', emoji: a.emoji || '', currency: a.currency || base, archived: !!a.archived, now: v, change: v == null || s == null ? null : v - s };
    })
    .filter((a) => months.some((m) => (m.byAccount[a.id] ?? 0) !== 0) || (opening.byAccount[a.id] || 0) !== 0)
    .sort((a, b) => (b.now ?? 0) - (a.now ?? 0));
  return { currency: view.cur, opening: opening.total, months, years, accounts: list, now: last.total, changeThisYear: last.total - yearStart.total, missing: last.missing };
}

// What each account added between two points (for the table under the chart).
export function contributions(history, key) {
  const idx = history.months.findIndex((m) => m.key === key);
  if (idx < 0) return [];
  const m = history.months[idx];
  const before = idx ? history.months[idx - 1].byAccount : null;
  return history.accounts.map((a) => {
    const v = a.id in m.byAccount ? m.byAccount[a.id] : 0;
    const p = !before ? null : a.id in before ? before[a.id] : 0;
    return { ...a, value: v, change: v == null || p == null ? null : v - p, share: v != null && m.total ? v / m.total : null };
  }).filter((a) => a.value !== 0 || (a.change != null && a.change !== 0));
}

// ---------- Money in and out per month ----------

// key -> { income, spending, records, byCat: Map(category -> cents) }
export function monthFlows(state, { book = null, from = null, to = null, cur = null, view = viewIn(state, cur) } = {}) {
  const out = new Map();
  for (const t of live(state)) {
    const d = t.date.slice(0, 10);
    if (!inBook(t, book) || (from && d < from) || (to && d > to)) continue;
    const k = monthKey(d);
    if (!out.has(k)) out.set(k, { income: 0, spending: 0, records: 0, byCat: new Map() });
    const m = out.get(k);
    m.records++;
    // Each record at its own day's rate (its `base`; shown in another currency at that day's rate).
    if (countsAsIncome(t)) m.income += view.show(B(t), d) ?? 0;
    else if (countsAsSpending(t)) {
      const v = signed(t, view.show(B(t), d) ?? 0);
      m.spending += v;
      m.byCat.set(t.category, (m.byCat.get(t.category) || 0) + v);
    }
  }
  return out;
}

const rateOf = (income, spending) => (income > 0 ? (income - spending) / income : null);

// ---------- Savings rate ----------

// (income − spending) / income for every month from your first record to
// this one, and every year; `trend` compares the last 3 full months with the
// 3 before (in percentage points).
export function savingsRates(state, today, { book = null, cur = null } = {}) {
  const view = viewIn(state, cur);
  const flows = monthFlows(state, { book, to: today, view });
  const now = monthKey(today);
  const keys = [...flows.keys()].sort();
  const months = [];
  if (keys.length) {
    for (let k = keys[0]; k <= now; k = addMonths(k, 1)) {
      const f = flows.get(k) || { income: 0, spending: 0, records: 0 };
      months.push({ key: k, income: f.income, spending: f.spending, records: f.records, rate: rateOf(f.income, f.spending), running: k === now });
    }
  }
  const byYear = new Map();
  for (const m of months) {
    const y = Number(m.key.slice(0, 4));
    const v = byYear.get(y) || { year: y, income: 0, spending: 0 };
    v.income += m.income;
    v.spending += m.spending;
    byYear.set(y, v);
  }
  const years = [...byYear.values()].map((y) => ({ ...y, rate: rateOf(y.income, y.spending), running: y.year === Number(now.slice(0, 4)) }));
  const full = months.filter((m) => !m.running);
  const pool = (list) => (list.length ? rateOf(list.reduce((a, m) => a + m.income, 0), list.reduce((a, m) => a + m.spending, 0)) : null);
  const last3 = pool(full.slice(-3));
  const prev3 = full.length >= 6 ? pool(full.slice(-6, -3)) : null;
  const diff = last3 != null && prev3 != null ? Math.round((last3 - prev3) * 100) : null;
  const thisYear = years.find((y) => y.running) || null;
  return { currency: view.cur, months, years, thisYear: thisYear ? thisYear.rate : null, trend: { last3, prev3, diff } };
}

// ---------- This year against last year ----------

// The same day number in another year (29 Feb becomes 28 Feb).
const sameDayIn = (year, mmdd) => {
  const k = `${year}-${mmdd.slice(0, 2)}`;
  return `${k}-${String(Math.min(Number(mmdd.slice(3)), daysInMonth(k))).padStart(2, '0')}`;
};

// Spending per category in `year` against the year before (countsAsSpending). mode 'soFar':
// 1 January to today (or the year's end) against the same days a year
// earlier. mode 'full': the whole year against the whole year before.
//   { year, mode, from, to, prev: { from, to }, total: { now, before }, rows, up, down }
//   rows: { id, name, emoji, now, before, diff, change }  (change: fraction, null when nothing before)
//   up / down: the 3 biggest increases / decreases.
export function yearOverYear(state, year, today, { mode = 'soFar', book = null, cur = null } = {}) {
  const view = viewIn(state, cur);
  const from = `${year}-01-01`;
  const end = `${year}-12-31`;
  const to = mode === 'full' || end < today ? end : today;
  const prev = { from: `${year - 1}-01-01`, to: mode === 'full' ? `${year - 1}-12-31` : sameDayIn(year - 1, to.slice(5)) };
  const sum = (a, b) => {
    const m = new Map();
    for (const f of monthFlows(state, { book, from: a, to: b, view }).values()) for (const [id, v] of f.byCat) m.set(id, (m.get(id) || 0) + v);
    return m;
  };
  const now = sum(from, to);
  const before = sum(prev.from, prev.to);
  const ids = new Set([...now.keys(), ...before.keys()]);
  const rows = [...ids].map((id) => {
    const c = category(state, id);
    const a = now.get(id) || 0;
    const b = before.get(id) || 0;
    return { id, name: c?.name || 'Other', emoji: c?.emoji || '', now: a, before: b, diff: a - b, change: b > 0 ? (a - b) / b : null };
  }).filter((r) => r.now || r.before).sort((a, b) => b.now - a.now || b.before - a.before || String(a.id).localeCompare(String(b.id)));
  const total = { now: rows.reduce((s, r) => s + r.now, 0), before: rows.reduce((s, r) => s + r.before, 0) };
  return {
    currency: view.cur, year, mode, from, to, prev, total, rows,
    change: total.before > 0 ? (total.now - total.before) / total.before : null,
    up: rows.filter((r) => r.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 3),
    down: rows.filter((r) => r.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 3),
  };
}

// ---------- Runway ----------

export const RUNWAY_WINDOWS = [3, 6, 12];
const AVG_MONTH_DAYS = 30.44;

// Liquid savings: every open account except crypto (coins left out), at
// today's value. Average monthly spending over the last 3, 6 and 12 full
// months you have records for (a month with no records at all is a gap, not
// a month of zero spending). In your first month, this month so far scaled
// to a whole month (marked `estimated`).
//   { liquid, counted: [{ id, name, value }], leftOut: [name], missing: [name], windows: [...], main, text }
export function runway(state, today, { book = null, cur = null, windows = RUNWAY_WINDOWS, main = 6 } = {}) {
  const nw = netWorthHistory(state, today, { book, cur });
  const known = knownRates(state);
  const last = nw.months.at(-1);
  const accounts = state.settings?.accounts || [];
  const counted = [];
  const leftOut = [];
  const missing = [];
  let liquid = 0;
  for (const a of accounts) {
    if (a.archived || !accInBook(a, book)) continue;
    if (a.kind === 'crypto') { leftOut.push(a.name); continue; }
    let v = last.byAccount[a.id];
    if (v == null) { missing.push(a.name); continue; }
    // Coins kept in a non-crypto account are not cash either.
    for (const h of a.holdings || []) {
      const c = coinValue(Number(h.qty), h.asset, nw.currency, known);
      if (c != null) v -= c;
    }
    if (!v) continue;
    counted.push({ id: a.id, name: a.name, value: v });
    liquid += v;
  }
  const flows = monthFlows(state, { book, to: today, cur: nw.currency });
  const now = monthKey(today);
  const full = [...flows.entries()].filter(([k, f]) => k < now && f.records > 0).sort((a, b) => a[0].localeCompare(b[0]));
  const thisMonth = flows.get(now);
  const day = Number(today.slice(8, 10));
  const list = windows.map((n) => {
    const use = full.slice(-n);
    let average;
    let estimated = false;
    if (use.length) average = Math.round(use.reduce((a, [, f]) => a + f.spending, 0) / use.length);
    else if (thisMonth && thisMonth.spending > 0) { average = Math.round((thisMonth.spending / day) * AVG_MONTH_DAYS); estimated = true; } else average = 0;
    return { months: n, used: use.length, average, estimated, runway: average > 0 ? Math.max(0, liquid) / average : null };
  });
  const pick = list.find((w) => w.months === main) || list[0];
  return { currency: nw.currency, liquid, counted, leftOut, missing, windows: list, main: pick, text: runwayText(liquid, pick) };
}

// "7,5" below 10 months, whole months above (decimal comma, like amounts).
export const monthsText = (n) => (n >= 10 ? String(Math.round(n)) : (Math.round(n * 10) / 10).toString().replace('.', ','));

export function runwayText(liquid, w) {
  if (!w || w.runway == null) return 'No spending logged yet, so there is no runway to show.';
  if (liquid <= 0) return 'Your savings would not cover a month of spending.';
  if (w.runway >= 120) return 'You could live more than 10 years on your savings.';
  const n = monthsText(w.runway);
  return `You could live ${n} month${n === '1' ? '' : 's'} on your savings.`;
}

// ---------- The compact card (Money page) ----------

// Net worth, its change this year, this year's savings rate and the runway.
export function longCard(state, today, { book = null } = {}) {
  state = withArchive(state);
  const nw = netWorthHistory(state, today, { book });
  const sr = savingsRates(state, today, { book });
  const rw = runway(state, today, { book });
  return {
    currency: nw.currency,
    netWorth: nw.now,
    changeThisYear: nw.changeThisYear,
    missing: nw.missing.length,
    savingsRate: sr.thisYear,
    trend: sr.trend.diff,
    runway: rw.main.runway,
    runwayText: rw.text,
    spendPerMonth: rw.main.average,
  };
}
