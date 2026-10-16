// Everything the app knows how to calculate. Pure functions over the state,
// so it is all tested in Node without a browser.

import { splitByPercent, formatMoney } from './money.js';
import { monthKey, addMonths, daysInMonth, monthLabel, addDays, isValidISO } from './dates.js';
import { convert, coinValue } from './fx.js';
import { perMonth } from './recurring.js';

// v1: first release. v2: custom multi-currency accounts, people, loans,
// per-record timestamps and deletion markers for sync.
// v3: independent goal reservations, merged and undone record by record.
export const SCHEMA_VERSION = 3;

// What an account can be. Order is the order they are grouped on screen.
export const ACCOUNT_KINDS = [
  { id: 'cash', name: 'Cash' },
  { id: 'card', name: 'Card' },
  { id: 'virtual', name: 'Virtual card' },
  { id: 'business', name: 'Business' },
  { id: 'savings', name: 'Savings' },
  { id: 'crypto', name: 'Crypto' },
  { id: 'other', name: 'Other' },
];

const ACCOUNT_DEFAULTS = { bank: '', kind: 'cash', currency: 'MDL', start: 0, last4: '', color: 1, savings: false, archived: false, holdings: [] };

export function defaultState() {
  return {
    version: SCHEMA_VERSION,
    settings: {
      currency: 'MDL',
      // The "Smart sharing" split from the original sheet.
      jars: [
        { id: 'savings', name: 'Deposit (safe)', emoji: '🏦', pct: 70, savings: true },
        { id: 'living', name: 'Food & transport', emoji: '🍔', pct: 10 },
        { id: 'growth', name: 'Investing & self-development', emoji: '📈', pct: 10 },
        { id: 'care', name: 'Hygiene & cosmetics', emoji: '🧴', pct: 10 },
      ],
      accounts: [
        { ...ACCOUNT_DEFAULTS, id: 'wallet', name: 'Wallet', kind: 'cash', emoji: '💵', color: 2 },
        { ...ACCOUNT_DEFAULTS, id: 'safe', name: 'Safe', kind: 'savings', savings: true, emoji: '🏦', color: 1 },
        { ...ACCOUNT_DEFAULTS, id: 'card', name: 'Card', kind: 'card', emoji: '💳', color: 5 },
      ],
      categories: [
        { id: 'work', type: 'income', name: 'Work', emoji: '💼' },
        { id: 'family', type: 'income', name: 'Family', emoji: '👪' },
        { id: 'side', type: 'income', name: 'Side jobs', emoji: '🛠️' },
        { id: 'competitions', type: 'income', name: 'Competitions', emoji: '🏆' },
        { id: 'gift-in', type: 'income', name: 'Gifts received', emoji: '🎁' },
        { id: 'other-in', type: 'income', name: 'Other income', emoji: '➕' },

        { id: 'food', type: 'expense', name: 'Food', emoji: '🍔', jar: 'living' },
        { id: 'transport', type: 'expense', name: 'Transport', emoji: '🚌', jar: 'living' },
        { id: 'home', type: 'expense', name: 'Home & bills', emoji: '🏠', jar: 'living' },
        { id: 'family-out', type: 'expense', name: 'Family', emoji: '💞', jar: 'living' },
        { id: 'gifts', type: 'expense', name: 'Gifts', emoji: '🎁', jar: 'living' },
        { id: 'fun', type: 'expense', name: 'Fun & going out', emoji: '🎉', jar: 'living' },
        { id: 'learning', type: 'expense', name: 'Learning & tools', emoji: '📚', jar: 'growth' },
        { id: 'sport', type: 'expense', name: 'Sport & competitions', emoji: '🥋', jar: 'growth' },
        { id: 'subscriptions', type: 'expense', name: 'Subscriptions', emoji: '📱', jar: 'growth' },
        { id: 'investing', type: 'expense', name: 'Investing', emoji: '📈', jar: 'growth' },
        { id: 'hygiene', type: 'expense', name: 'Hygiene & cosmetics', emoji: '🧴', jar: 'care' },
        { id: 'health', type: 'expense', name: 'Health', emoji: '💊', jar: 'care' },
        { id: 'clothes', type: 'expense', name: 'Clothes', emoji: '👕', jar: 'care' },
        { id: 'other', type: 'expense', name: 'Other', emoji: '📦', jar: 'living' },
      ],
      goal: { name: 'Safe goal', target: 10000000, account: 'savings' },
      savingsAccount: 'safe', // where the "move to safe" button sends your deposit
      theme: 'dark',
      themeMotion: true,
      sound: true,
      smallPurchase: 10000, // under 100 MDL counts as a "small" purchase
    },
    tx: [],
    people: [],
    // Recurring payments and income (js/recurring.js).
    recurring: [],
    // Invoices to clients (js/invoices.js).
    invoices: [],
    // Money goals (see goalStatus). The old single settings.goal becomes the first one.
    goals: [{ id: 'g-main', name: 'Safe goal', emoji: '🏦', target: 10000000, account: 'savings', saved: 0, history: [], deadline: null, doneAt: null, theme: 'gold', updatedAt: 0 }],
    goalAllocations: [],
    // One net-worth snapshot per day (id nw-YYYY-MM-DD), so crypto and
    // exchange rates of the day are kept; older history is rebuilt from records.
    netWorth: [],
    // id -> time it was deleted, so a sync can tell "deleted here" from
    // "never existed there".
    deleted: {},
    // Last known exchange rates and coin prices (see fx.js). Not synced.
    rates: null,
    meta: { lastBackup: null, createdAt: null },
  };
}

// Brings any saved or imported state up to the current shape without losing
// data, including v1 data (MDL-only accounts, no people).
export function normalizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const s = raw.settings || {};
  const accounts = (Array.isArray(s.accounts) && s.accounts.length ? s.accounts : base.settings.accounts)
    .map((a, i) => {
      const acc = { ...ACCOUNT_DEFAULTS, color: (i % 8) + 1, ...a, holdings: Array.isArray(a.holdings) ? a.holdings : [] };
      if (acc.id === 'wallet' || /^(wallet|cash|numerar)$/i.test(acc.name || '')) {
        if (acc.kind !== 'cash') acc.kind = 'cash';
        if (!acc.emoji || acc.emoji === '💳') acc.emoji = '💵';
      }
      return acc;
    });
  if (!accounts.some((a) => a.kind === 'cash' || a.id === 'wallet' || /^(wallet|cash|numerar)$/i.test(a.name || ''))) {
    accounts.unshift({ ...ACCOUNT_DEFAULTS, id: 'wallet', name: 'Cash', kind: 'cash', emoji: '💵', color: 2 });
  }
  const settings = {
    ...base.settings,
    ...s,
    goal: { ...base.settings.goal, ...(s.goal || {}) },
    jars: Array.isArray(s.jars) && s.jars.length ? s.jars : base.settings.jars,
    accounts,
    categories: Array.isArray(s.categories) && s.categories.length ? s.categories : base.settings.categories,
  };
  const baseCur = settings.currency || 'MDL';
  const accCur = Object.fromEntries(accounts.map((a) => [a.id, a.currency || baseCur]));
  const tx = (Array.isArray(raw.tx) ? raw.tx : []).filter(validTx).map((t) => {
    const currency = t.currency || accCur[t.account ?? t.from] || baseCur;
    const out = { ...t, currency, updatedAt: t.updatedAt || t.createdAt || 0 };
    if (!Number.isInteger(out.base)) {
      out.base = currency === baseCur ? t.amount : Math.round(t.amount * (t.rate || 1));
      out.rate = currency === baseCur ? 1 : t.rate || null;
    }
    return out;
  });
  const people = (Array.isArray(raw.people) ? raw.people : [])
    .filter((p) => p && typeof p.id === 'string' && p.name)
    .map((p) => ({ note: '', ...p, updatedAt: p.updatedAt || 0 }));
  const deleted = raw.deleted && typeof raw.deleted === 'object' ? { ...raw.deleted } : {};
  const recurring = (Array.isArray(raw.recurring) ? raw.recurring : [])
    .filter((r) => r && typeof r.id === 'string' && Number.isInteger(r.amount) && /^\d{4}-\d{2}-\d{2}$/.test(r.start || ''))
    .map((r) => ({ every: 'month', currency: accCur[r.account] || baseCur, note: '', auto: false, paused: false, lastDone: null, ...r, updatedAt: r.updatedAt || 0 }));
  const invoices = (Array.isArray(raw.invoices) ? raw.invoices : [])
    .filter((i) => i && typeof i.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.date || ''))
    .map((i) => ({ items: [], note: '', sent: false, paidDate: null, paidTx: null, currency: 'USD', ...i, updatedAt: i.updatedAt || 0 }));
  const netWorth = (Array.isArray(raw.netWorth) ? raw.netWorth : []).filter((x) => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') && Number.isFinite(x.total));
  const goals = Array.isArray(raw.goals)
    ? raw.goals.filter((g) => g && typeof g.id === 'string' && g.name).map((g) => ({ emoji: '🎯', account: 'all', saved: 0, history: [], deadline: null, doneAt: null, ...g, updatedAt: g.updatedAt || 0 }))
      // The untouched starter "Safe goal" used to count all money: it is about the safe.
      .map((g) => (g.id === 'g-main' && !g.updatedAt && g.account === 'all' && g.name === 'Safe goal' ? { ...g, account: 'savings' } : g))
    : [{ id: 'g-main', name: settings.goal.name || 'Safe goal', emoji: '🏦', target: settings.goal.target || 0, account: settings.goal.account || 'all', saved: 0, history: [], deadline: null, doneAt: null, theme: 'gold', updatedAt: 0 }];
  const goalAllocations = (Array.isArray(raw.goalAllocations) ? raw.goalAllocations : []).filter((a) => a && typeof a.id === 'string' && typeof a.goalId === 'string' && Number.isSafeInteger(a.amount) && a.amount > 0 && isValidISO(a.date || '')).map((a) => ({ ...a, currency: a.currency || baseCur, updatedAt: a.updatedAt || 0 }));
  // Automatic migration: merge Oliviu into Brother if both exist (the user confirmed they are the same person)
  const oliviu = people.find((p) => p.name?.trim().toLowerCase() === 'oliviu');
  const brother = people.find((p) => p.name?.trim().toLowerCase() === 'brother');
  if (oliviu && brother && oliviu.id !== brother.id) {
    const now = Date.now();
    for (const t of tx) {
      if (t.person === oliviu.id) {
        t.person = brother.id;
        t.updatedAt = now;
      }
    }
    const oIdx = people.findIndex((p) => p.id === oliviu.id);
    if (oIdx !== -1) people.splice(oIdx, 1);
    deleted[oliviu.id] = now;
    brother.updatedAt = now;
  }
  return { version: SCHEMA_VERSION, settings, tx, people, recurring, invoices, netWorth, goals, goalAllocations, deleted, rates: raw.rates || null, meta: { ...base.meta, ...(raw.meta || {}) } };
}

function validTx(t) {
  return t && typeof t.id === 'string' && ['income', 'expense', 'transfer'].includes(t.type)
    && Number.isInteger(t.amount) && t.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.date);
}

// A record's value in the base currency (MDL), fixed at the rate of the day it
// was logged so old months never change when rates move.
export const B = (t) => (Number.isInteger(t.base) ? t.base : t.amount);

// Loans are money that comes back: they move balances but are not income or
// spending.
const counts = (t) => !t.loan;

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Newest first; same day keeps the order they were added (newest on top).
export function sortTx(list) {
  return [...list].sort((a, b) => (a.date === b.date
    ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1));
}

export const category = (state, id) => state.settings.categories.find((c) => c.id === id);
export const account = (state, id) => state.settings.accounts.find((a) => a.id === id);
export const person = (state, id) => state.people.find((p) => p.id === id);
// The order of your cards (Accounts screen: drag them, or the arrows).
// Accounts you never moved keep the old order: by kind, then as added; ones
// added after you set an order go last. `order` syncs like any field.
export function orderedAccounts(state) {
  const list = state.settings.accounts;
  const kindIx = (k) => { const i = ACCOUNT_KINDS.findIndex((x) => x.id === k); return i < 0 ? 99 : i; };
  const anyOrder = list.some((a) => Number.isFinite(a.order));
  const key = (a, i) => (Number.isFinite(a.order) ? a.order : anyOrder ? 1e6 + i : kindIx(a.kind) * 1e4 + i);
  return list.map((a, i) => ({ a, k: key(a, i) })).sort((x, y) => x.k - y.k).map((x) => x.a);
}

// Puts an account before another one (null: at the end) and numbers them all.
export function moveAccountTo(state, id, beforeId = null, now = Date.now()) {
  const list = orderedAccounts(state);
  const moving = list.find((a) => a.id === id);
  if (!moving || id === beforeId) return false;
  const rest = list.filter((a) => a.id !== id);
  const at = beforeId ? rest.findIndex((a) => a.id === beforeId) : -1;
  rest.splice(at < 0 ? rest.length : at, 0, moving);
  rest.forEach((a, i) => { if (a.order !== i) { a.order = i; a.updatedAt = now; } });
  return true;
}

// One step left (-1) or right (+1) among the cards you see (not archived).
export function moveAccountBy(state, id, dir, now = Date.now()) {
  const shown = orderedAccounts(state).filter((a) => !a.archived);
  const i = shown.findIndex((a) => a.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= shown.length) return false;
  return moveAccountTo(state, id, dir < 0 ? shown[j].id : shown[j + 1]?.id ?? null, now);
}

export const activeAccounts = (state) => orderedAccounts(state).filter((a) => !a.archived);
export const jar = (state, id) => state.settings.jars.find((j) => j.id === id);
export const savingsJar = (state) => state.settings.jars.find((j) => j.savings) || state.settings.jars[0];

// Set an account to the amount it really has. "start" corrects the opening
// balance quietly (history and reports stay as they are); "record" logs the
// difference today as income or spending (e.g. cash that went untracked).
// Switch an account to another currency (an MDL "Binance" that is really
// USD). Its records, starting balance and recurring items are converted at
// `rate` (1 new = rate old). Each record keeps its value in the main currency
// (`base`), so reports don't move, and remembers what it was before (`orig`).
export function changeAccountCurrency(state, accountId, newCur, rate, now = Date.now()) {
  const acc = state.settings.accounts.find((a) => a.id === accountId);
  if (!acc || !newCur || acc.currency === newCur || !(rate > 0)) return 0;
  const oldCur = acc.currency || state.settings.currency;
  const baseCur = state.settings.currency;
  const conv = (c) => Math.round(c / rate);
  let n = 0;
  for (const t of state.tx) {
    if (t.type === 'transfer') {
      if (t.from === accountId) {
        const old = t.amount;
        if (!Number.isInteger(t.base)) t.base = oldCur === baseCur ? old : Math.round(old * (t.rate || 1));
        t.amount = conv(old);
        if (!Number.isInteger(t.toAmount)) t.toAmount = old; // it arrived as it left
        t.currency = newCur;
        if (Number.isInteger(t.base) && t.amount) t.rate = t.base / t.amount;
        t.updatedAt = now; n++;
      }
      if (t.to === accountId) {
        const incoming = Number.isInteger(t.toAmount) ? t.toAmount : t.amount;
        t.toAmount = conv(incoming);
        t.updatedAt = now; n++;
      }
      continue;
    }
    if (t.account !== accountId) continue;
    const old = t.amount;
    // Its value in the main currency stays what it was.
    if (!Number.isInteger(t.base)) t.base = oldCur === baseCur ? old : Math.round(old * (t.rate || 1));
    if (t.orig?.currency === newCur) {
      // Typed in the new currency to begin with: back to exactly that.
      t.amount = t.orig.amount;
      delete t.orig;
    } else {
      t.amount = conv(old);
      if (!t.orig) t.orig = { amount: old, currency: oldCur, rate };
    }
    t.currency = newCur;
    if (newCur === baseCur) { t.rate = 1; t.base = t.amount; } else if (t.amount) t.rate = t.base / t.amount;
    t.updatedAt = now; n++;
  }
  for (const r of state.recurring || []) {
    if (r.account !== accountId) continue;
    r.amount = conv(r.amount);
    r.currency = newCur;
    r.updatedAt = now;
  }
  acc.start = conv(acc.start || 0);
  acc.currency = newCur;
  acc.updatedAt = now;
  return n;
}

export function setBalance(state, accountId, target, { mode = 'start', date, id = uid(), rate = 1, now = Date.now() } = {}) {
  const acc = state.settings.accounts.find((a) => a.id === accountId);
  const current = accountBalances(state)[accountId] || 0;
  const diff = target - current;
  if (!acc || !diff) return { diff: 0, tx: null };
  if (mode === 'start') {
    acc.start = (acc.start || 0) + diff;
    acc.updatedAt = now;
    return { diff, tx: null };
  }
  const out = diff < 0;
  const amount = Math.abs(diff);
  const tx = {
    id, createdAt: now, updatedAt: now, type: out ? 'expense' : 'income', amount, currency: acc.currency, rate, base: Math.round(amount * rate), date,
    category: out ? 'other' : 'other-in', account: accountId, note: out ? 'Balance correction (missing money)' : 'Balance correction (extra money)', adjustment: true,
  };
  state.tx.push(tx);
  return { diff, tx };
}

export function accountBalances(state, upTo = null) {
  const bal = Object.fromEntries(state.settings.accounts.map((a) => [a.id, a.start || 0]));
  for (const t of state.tx) {
    if (upTo && t.date > upTo) continue;
    if (t.type === 'income' && t.account in bal) bal[t.account] += t.amount;
    else if (t.type === 'expense' && t.account in bal) bal[t.account] -= t.amount;
    else if (t.type === 'transfer') {
      if (t.from in bal) bal[t.from] -= t.amount;
      // Between currencies the receiving side gets its own amount.
      if (t.to in bal) bal[t.to] += Number.isInteger(t.toAmount) ? t.toAmount : t.amount;
    }
  }
  return bal;
}

// Each account in its own currency and in the base currency (today's rate),
// plus coins held in crypto accounts. `inBase` is null when no rate is known.
export function accountValues(state, upTo = null) {
  const baseCur = state.settings.currency;
  const bal = accountBalances(state, upTo);
  return state.settings.accounts.map((a) => {
    const own = bal[a.id] || 0;
    let inBase = convert(own, a.currency, baseCur, state.rates);
    let coins = 0;
    let coinsKnown = true;
    for (const h of a.holdings || []) {
      const v = coinValue(Number(h.qty), h.asset, baseCur, state.rates);
      if (v == null) coinsKnown = false; else coins += v;
    }
    if (inBase != null) inBase += coins;
    return { account: a, own, coins, coinsKnown, inBase };
  });
}

// Total of all money in the base currency; `missing` lists accounts that
// could not be converted yet (no rate).
export function totalBalance(state, { includeArchived = false } = {}) {
  let total = 0;
  const missing = [];
  for (const v of accountValues(state)) {
    if (v.account.archived && !includeArchived) continue;
    if (v.inBase == null) missing.push(v); else total += v.inBase;
  }
  return { total, missing };
}

// ---------- Net worth over time ----------

// Today's total, saved once a day (updated if you change things later that
// day). Returns true when something changed.
export function takeSnapshot(state, today, now = Date.now()) {
  const { total } = totalBalance(state);
  const crypto = accountValues(state).filter((v) => !v.account.archived).reduce((a, v) => a + (v.coins || 0), 0);
  const list = state.netWorth || (state.netWorth = []);
  const id = `nw-${today}`;
  const have = list.find((x) => x.id === id);
  if (have && have.total === total && have.crypto === crypto) return false;
  if (have) Object.assign(have, { total, crypto, updatedAt: now });
  else list.push({ id, date: today, total, crypto, updatedAt: now });
  return true;
}

// Money on a past date from your records, in the main currency at today's
// rates. Coin holdings are only known for today, so they are left out.
export function rebuiltTotal(state, date) {
  const baseCur = state.settings.currency;
  const bal = accountBalances(state, date);
  let total = 0;
  for (const a of state.settings.accounts) {
    const v = convert(bal[a.id] || 0, a.currency, baseCur, state.rates);
    if (v != null) total += v;
  }
  return total;
}

// One point per month end: the last snapshot of that month when there is
// one, otherwise rebuilt from records; this month is today's real total.
export function netWorthSeries(state, today, months = 12) {
  const now = monthKey(today);
  const first = state.tx.reduce((m, t) => (t.date < m ? t.date : m), today).slice(0, 7);
  const span = Math.min(months, monthsBetweenKeys(first, now) + 1);
  const snaps = [...(state.netWorth || [])].sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  for (let i = span - 1; i >= 0; i--) {
    const key = addMonths(now, -i);
    const end = key === now ? today : `${key}-${String(daysInMonth(key)).padStart(2, '0')}`;
    const snap = snaps.filter((x) => x.date.startsWith(key) && x.date <= end).at(-1);
    // Today is known exactly (crypto included), snapshot or not.
    const value = key === now ? totalBalance(state).total : snap ? snap.total : rebuiltTotal(state, end);
    out.push({ key, date: end, value, snap: !!snap || key === now });
  }
  return out;
}

const monthsBetweenKeys = (a, b) => {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return Math.max(0, (yb - ya) * 12 + (mb - ma));
};

export const txInMonth = (state, key) => state.tx.filter((t) => monthKey(t.date) === key);

function sumBy(list, keyFn) {
  const out = new Map();
  for (const t of list) out.set(keyFn(t), (out.get(keyFn(t)) || 0) + B(t));
  return [...out.entries()].map(([id, amount]) => ({ id, amount })).sort((a, b) => b.amount - a.amount);
}

export function monthSummary(state, key) {
  const list = txInMonth(state, key);
  const incomes = list.filter((t) => t.type === 'income' && counts(t));
  const expenses = list.filter((t) => t.type === 'expense' && counts(t));
  const income = incomes.reduce((a, t) => a + B(t), 0);
  const expense = expenses.reduce((a, t) => a + B(t), 0);
  const net = income - expense;
  return {
    key,
    income,
    expense,
    net,
    // Share of this month's income you did not spend.
    savingsRate: income > 0 ? net / income : null,
    byCategory: sumBy(expenses, (t) => t.category),
    bySource: sumBy(incomes, (t) => t.category),
    count: list.length,
    expenses,
    incomes,
  };
}

// The "Smart sharing" card: how a given income should be split between jars.
export function splitIncome(state, cents) {
  const jars = state.settings.jars;
  const parts = splitByPercent(cents, jars.map((j) => j.pct));
  return jars.map((j, i) => ({ jar: j, amount: parts[i] }));
}

// Your usual monthly income, in the main currency: the regular incomes in
// Plan, or the average of the last 3 months that had income (the larger).
export function expectedIncome(state, key) {
  // Paying yourself a salary: that salary is your income.
  if (payOn(state)) return state.settings.pay.amount;
  const base = state.settings.currency;
  const regular = (state.recurring || []).filter((r) => r.type === 'income' && !r.paused)
    .reduce((a, r) => a + ((r.currency || base) === base ? perMonth(r) : convert(perMonth(r), r.currency, base, state.rates) || 0), 0);
  const past = [1, 2, 3].map((n) => personalMonth(state, addMonths(key, -n)).personalIncome).filter((x) => x > 0);
  const average = past.length ? Math.round(past.reduce((a, x) => a + x, 0) / past.length) : 0;
  return Math.max(regular, average);
}

// ---------- Work and personal money ----------
// A freelancer's month mixes two things: the work (client income, work fees,
// taxes) and the life it pays for. Income is work when its category says so
// (Work, Side jobs, client…); spending is a work cost when it sits outside the
// jars ("Business, outside the jars").
const WORK_INCOME = /\b(work|job|jobs|client|clients|freelance|salary|salariu|lucru|proiect|project|invoice|factur\w*)\b/i;
export function isWorkIncome(state, catId) {
  const c = category(state, catId);
  if (!c || c.type !== 'income') return false;
  if (typeof c.work === 'boolean') return c.work;
  return c.id === 'work' || c.id === 'side' || WORK_INCOME.test(c.name || '');
}
export const isWorkCost = (state, catId) => { const c = category(state, catId); return c?.type === 'expense' && c.jar === NO_JAR; };

// Paying yourself a fixed salary from a buffer account (settings.pay).
export const payOn = (state) => {
  const p = state.settings.pay;
  return !!(p?.on && p.buffer && p.to && p.amount > 0 && state.settings.accounts.some((a) => a.id === p.buffer));
};

// One month, split: the work (income, costs, profit) and you (what came in
// for you, what you lived on, what you kept). Without "Pay yourself" what
// came in for you is the work's profit plus other income (family, gifts);
// with it, the salary moved from the buffer plus other income.
export function personalMonth(state, key) {
  const s = monthSummary(state, key);
  const workIncome = s.incomes.filter((t) => isWorkIncome(state, t.category)).reduce((a, t) => a + B(t), 0);
  const workCosts = s.expenses.filter((t) => isWorkCost(state, t.category)).reduce((a, t) => a + B(t), 0);
  const otherIncome = s.income - workIncome;
  const pay = payOn(state);
  const salary = pay ? txInMonth(state, key).filter((t) => t.type === 'transfer' && t.salary).reduce((a, t) => a + B(t), 0) : 0;
  const personalIncome = pay ? salary + otherIncome : s.income - workCosts;
  const personalSpent = s.expense - workCosts;
  const kept = personalIncome - personalSpent;
  return {
    key, workIncome, workCosts, profit: workIncome - workCosts, otherIncome, salary, pay,
    personalIncome, personalSpent, kept, rate: personalIncome > 0 ? kept / personalIncome : null,
  };
}

// How each jar is doing this month. Spending jars get income × pct as a budget;
// the savings jar is measured by what you actually kept (income − spending).
// For the month still running (pass `today`), budgets use your usual income
// until this month's income reaches it, so jars aren't "over" just because
// the pay hasn't come in yet.
export function jarStatus(state, key, today = null) {
  const sum = monthSummary(state, key);
  const mine = personalMonth(state, key);
  const usual = today && monthKey(today) === key ? expectedIncome(state, key) : 0;
  const basis = Math.max(mine.personalIncome, usual);
  const spentByJar = {};
  for (const t of sum.expenses) {
    const j = jarOf(state, t.category);
    if (j === NO_JAR) continue;
    spentByJar[j] = (spentByJar[j] || 0) + B(t);
  }
  return state.settings.jars.map((j) => {
    // Whole lei: nobody budgets 2 446,30.
    const budget = Math.round((basis * j.pct) / 10000) * 100;
    const est = basis > mine.personalIncome ? { basis, estimated: true } : { basis, estimated: false };
    if (j.savings) {
      const kept = Math.max(0, mine.kept);
      return { jar: j, budget, used: kept, left: kept - budget, ratio: budget ? kept / budget : null, savings: true, ...est };
    }
    const used = spentByJar[j.id] || 0;
    return { jar: j, budget, used, left: budget - used, ratio: budget ? used / budget : used ? Infinity : 0, ...est };
  });
}

// A spending category can sit outside the jars (business costs like work
// fees or taxes): it still counts as spending, but no jar budget pays for it.
export const NO_JAR = 'none';
const WORKISH = /work|business|job|fee|tax|client|office|lucru|munc|afacer|tax[aă]|impozit|комис|налог|работ/i;
export const jarOf = (state, catId) => category(state, catId)?.jar || jarFallback(state);

// Fixed bills (rent, utilities, internet…): real spending, but not "daily"
// spending, so they don't use up today's safe-to-spend. A category's own
// choice wins; otherwise its name decides.
const BILLISH = /bill|rent|chiri|apart|utilit|factur|comunal|internet|subscript|abonam|insur|asigur|mortgage|ipotec|credit|coммун|аренд|квартир/i;
export const isBillCategory = (state, catId) => {
  const c = category(state, catId);
  if (!c) return false;
  return typeof c.bill === 'boolean' ? c.bill : c.id === 'home' || c.id === 'subscriptions' || BILLISH.test(c.name || '');
};

// Once: spending categories named like work costs ("Work fees", "Taxes",
// "Business") leave the personal jars; you can put them back in Settings.
const WORK_COST = /\b(work|business|job|fees?|tax(es)?|client|office|lucru|afacer\w*|impozit\w*)\b/i;
export function moveWorkCostsOutOfJars(state, now = Date.now()) {
  const moved = [];
  for (const c of state.settings.categories) {
    if (c.type !== 'expense' || c.jar === NO_JAR || c.jarChosen || !WORK_COST.test(c.name || '')) continue;
    c.jar = NO_JAR;
    touch(c, now);
    moved.push(c.name);
  }
  return moved;
}

function jarFallback(state) {
  const nonSavings = state.settings.jars.find((j) => !j.savings);
  return nonSavings ? nonSavings.id : state.settings.jars[0].id;
}

// ---------- Goals ----------
// Several goals (state.goals). Each counts money from all accounts, your
// savings accounts, one account, or what you add by hand ("manual").

export const mainGoal = (state) => (state.goals || []).find((g) => !g.doneAt && !g.archived) || (state.goals || [])[0] || { ...state.settings.goal, id: 'g-main' };

// Reservations share one cash/bank pool. Stable ordering prevents concurrent
// offline allocations from funding the same income or account balance twice.
export function goalAllocationSummary(state, asOf = null) {
  const base = state.settings.currency;
  const cash = Math.max(0, accountValues(state, asOf).filter((v) => !v.account.archived && v.account.kind !== 'crypto').reduce((sum, v) => sum + (v.inBase || 0), 0));
  const rows = (state.goalAllocations || []).filter((a) => !asOf || a.date <= asOf).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.id.localeCompare(b.id));
  const byGoal = {}, byIncome = {}, effectiveById = {}, unpriced = [];
  let reserved = 0, requested = 0;
  for (const a of rows) {
    const amount = a.currency && a.currency !== base ? convert(a.amount, a.currency, base, state.rates) : a.amount;
    if (amount == null) unpriced.push(a.id);
    const validAmount = Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
    const goal = (state.goals || []).find((g) => g.id === a.goalId);
    const income = a.incomeId ? state.tx.find((t) => t.id === a.incomeId && t.type === 'income' && !t.loan && (!asOf || t.date <= asOf)) : null;
    const incomeLeft = a.incomeId ? Math.max(0, (income ? B(income) : 0) - (byIncome[a.incomeId] || 0)) : Infinity;
    const funded = goal?.account === 'allocated' ? Math.min(validAmount, Math.max(0, cash - reserved), incomeLeft) : 0;
    requested += validAmount;
    effectiveById[a.id] = funded;
    byGoal[a.goalId] = (byGoal[a.goalId] || 0) + funded;
    if (a.incomeId) byIncome[a.incomeId] = (byIncome[a.incomeId] || 0) + validAmount;
    reserved += funded;
  }
  return { cash, reserved, requested, unallocated: Math.max(0, cash - reserved), unfunded: requested - reserved, byGoal, byIncome, effectiveById, unpriced };
}

export function allocateToGoals(state, entries, { incomeId = null, date, now = Date.now() } = {}) {
  if (!entries.length || !isValidISO(date || '')) throw new Error('Choose a date and at least one goal.');
  const summary = goalAllocationSummary(state);
  if (summary.unpriced.length) throw new Error('Update exchange rates for existing reservations before allocating more.');
  if (summary.unfunded > 0) throw new Error('Review and release unfunded reservations before allocating more.');
  let total = 0;
  for (const entry of entries) {
    const g = (state.goals || []).find((g) => g.id === entry.goalId && !g.doneAt && !g.archived);
    if (!g) throw new Error('Choose an active goal.');
    if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0) throw new Error('Enter amounts greater than zero.');
    total += entry.amount;
  }
  if (!Number.isSafeInteger(total) || total > summary.unallocated) throw new Error('The total exceeds your unallocated cash and bank balances.');
  if (incomeId) {
    const income = state.tx.find((t) => t.id === incomeId && t.type === 'income' && !t.loan);
    if (!income || total > Math.max(0, B(income) - (summary.byIncome[incomeId] || 0))) throw new Error('The total exceeds the unallocated amount of this income.');
  }
  // Validate the whole batch before changing anything.
  const records = entries.map((e) => ({ id: `ga-${uid()}`, goalId: e.goalId, amount: e.amount, currency: state.settings.currency, incomeId, date, createdAt: now, updatedAt: now }));
  for (const e of entries) {
    const g = state.goals.find((g) => g.id === e.goalId);
    g.account = 'allocated';
    touch(g, now);
  }
  (state.goalAllocations ||= []).push(...records);
  return records;
}

export function releaseGoalAllocation(state, id, amount, now = Date.now()) {
  const a = (state.goalAllocations || []).find((a) => a.id === id);
  if (!a || !Number.isSafeInteger(amount) || amount <= 0 || amount > a.amount) throw new Error('Release an amount within this reservation.');
  if (amount === a.amount) {
    state.goalAllocations = state.goalAllocations.filter((x) => x.id !== id);
    state.deleted[id] = now;
  } else { a.amount -= amount; touch(a, now); }
}

// The goal's money in the base currency at the end of a day (null = now).
// Past values use today's rates; good enough for a pace estimate.
function goalValueAt(state, iso, goal = mainGoal(state)) {
  if (goal.account === 'allocated') return goalAllocationSummary(state, iso).byGoal[goal.id] || 0;
  if (goal.account === 'manual') return goal.saved || 0;
  const vals = accountValues(state, iso);
  const isSaving = (a) => a.savings || a.kind === 'savings';
  const pick = goal.account === 'savings' ? vals.filter((v) => !v.account.archived && isSaving(v.account))
    : goal.account && goal.account !== 'all' ? vals.filter((v) => v.account.id === goal.account)
      : vals.filter((v) => !v.account.archived);
  return pick.reduce((a, v) => a + (v.inBase ?? 0), 0);
}

// Average monthly growth of the goal's money over your last (up to 3) months
// with records, before this one. Gaps where you logged nothing are skipped,
// so a break from logging doesn't read as "saved zero". Used for the ETA.
export function goalStatus(state, today, goal = mainGoal(state)) {
  const current = goalValueAt(state, null, goal);
  const target = goal.target || 0;
  const thisMonth = monthKey(today);
  const end = (k) => `${k}-${String(daysInMonth(k)).padStart(2, '0')}`;
  const active = new Set((goal.account === 'allocated' ? (state.goalAllocations || []).filter((a) => a.goalId === goal.id) : state.tx).map((t) => monthKey(t.date)));
  const months = [...active].filter((k) => k < thisMonth).sort().slice(-3);
  let pace = null;
  if (goal.account !== 'manual') {
    if (months.length) {
      const growth = months.map((k) => goalValueAt(state, end(k), goal) - goalValueAt(state, end(addMonths(k, -1)), goal));
      pace = Math.round(growth.reduce((a, b) => a + b, 0) / months.length);
    } else if (active.has(thisMonth)) {
      // Only this month so far: use what it grew by until today.
      pace = goalValueAt(state, today, goal) - goalValueAt(state, end(addMonths(thisMonth, -1)), goal);
    }
  } else if (goal.history?.length) {
    // Manual goals: what you added over the last 90 days, per month.
    const since = addDays(today, -90);
    const added = goal.history.filter((h) => h.date >= since).reduce((a, h) => a + h.amount, 0);
    pace = added ? Math.round(added / 3) : null;
  }
  const remaining = Math.max(0, target - current);
  let monthsLeft = null;
  let eta = null;
  if (remaining === 0 && target > 0) monthsLeft = 0;
  else if (pace && pace > 0) {
    monthsLeft = Math.ceil(remaining / pace);
    eta = addMonths(thisMonth, monthsLeft);
  }
  // With a deadline: what you'd need to put away each month from now.
  let perMonth = null;
  let deadlineMonths = null;
  if (goal.deadline && remaining > 0) {
    deadlineMonths = Math.max(1, monthsBetweenKeys(thisMonth, monthKey(goal.deadline)) + (goal.deadline.slice(8) >= '15' ? 1 : 0));
    perMonth = Math.ceil(remaining / deadlineMonths / 100) * 100;
  }
  const ratio = target ? Math.min(1, Math.max(0, current / target)) : 0;
  const milestone = [100, 75, 50, 25].find((m) => ratio * 100 >= m) || 0;
  const onTrack = perMonth == null ? null : pace != null && pace >= perMonth;
  return { target, current, remaining, ratio, pace, monthsLeft, eta, perMonth, deadlineMonths, milestone, onTrack };
}

// Six months of your usual spending: a sensible emergency fund.
export function emergencyTarget(state, today, months = 6) {
  const key = monthKey(today);
  let total = 0;
  let n = 0;
  for (let i = 1; i <= 3; i++) {
    const s = monthSummary(state, addMonths(key, -i));
    if (s.count) { total += s.expense; n++; }
  }
  const monthly = n ? total / n : monthSummary(state, key).expense;
  return Math.ceil((monthly * months) / 100000) * 100000; // round up to 1 000
}

// An encouraging line for where you are.
export function goalMessage(st) {
  if (!st.target) return 'Set a target and watch it fill up.';
  const p = Math.round(st.ratio * 100);
  if (p >= 100) return 'You did it. Enjoy it, then dream bigger.';
  if (p >= 90) return 'Almost there. One more push!';
  if (p >= 75) return 'Three quarters done. The finish line is in sight.';
  if (p >= 50) return 'Halfway there. Every lei counts from here.';
  if (p >= 25) return 'A quarter of the way. The habit is working.';
  if (p > 0) return 'Good start. Small steps add up fast.';
  return 'Every big goal starts with the first lei.';
}

export function yearOverview(state, year) {
  const rows = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    const s = monthSummary(state, key);
    rows.push({ key, income: s.income, expense: s.expense, net: s.net, savingsRate: s.savingsRate });
  }
  const total = rows.reduce((a, r) => ({ income: a.income + r.income, expense: a.expense + r.expense, net: a.net + r.net }),
    { income: 0, expense: 0, net: 0 });
  total.savingsRate = total.income ? total.net / total.income : null;
  return { rows, total };
}

// Last n months ending with `key`, oldest first.
export function trend(state, key, n = 6) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = addMonths(key, -i);
    const s = monthSummary(state, k);
    out.push({ key: k, income: s.income, expense: s.expense, net: s.net });
  }
  return out;
}

// Average spend per category over the `n` months before `key` (months with no
// data at all are skipped so a new user is not compared against zeros).
function categoryBaseline(state, key, n = 3) {
  const totals = {};
  let months = 0;
  for (let i = 1; i <= n; i++) {
    const s = monthSummary(state, addMonths(key, -i));
    if (!s.count) continue;
    months++;
    for (const c of s.byCategory) totals[c.id] = (totals[c.id] || 0) + c.amount;
  }
  if (!months) return null;
  for (const id in totals) totals[id] = Math.round(totals[id] / months);
  return totals;
}

export function categoryComparison(state, key) {
  const s = monthSummary(state, key);
  const base = categoryBaseline(state, key) || {};
  return s.byCategory.map((c) => ({ ...c, avg: base[c.id] ?? null, share: s.expense ? c.amount / s.expense : 0 }));
}

// Honest, specific tips computed from your own numbers. Each has a level
// (good / warn / bad / info) so the most important ones show first.
// ---------- Quick picks ----------
// Records you log again and again (same type, note, category, account and
// amount) in the last 90 days, most used first, after your pinned favorites.

const pickKey = (t) => [t.type, String(t.note || '').trim().toLowerCase(), t.category, t.account, t.amount, t.currency || ''].join('|');

export function quickPicks(state, today, n = 8) {
  const favs = (state.settings.favorites || []).map((f) => ({ ...f, fav: true }));
  const pinned = new Set(favs.map(pickKey));
  const since = addDays(today, -90);
  const groups = new Map();
  for (const t of state.tx) {
    if (t.type === 'transfer' || t.loan || t.date < since || t.date > today) continue;
    const k = pickKey(t);
    if (pinned.has(k)) continue;
    const g = groups.get(k) || { type: t.type, amount: t.amount, currency: t.currency, note: t.note || '', category: t.category, account: t.account, count: 0, last: '' };
    g.count++;
    if (t.date > g.last) g.last = t.date;
    groups.set(k, g);
  }
  const auto = [...groups.values()].filter((g) => g.count >= 2).sort((a, b) => b.count - a.count || b.last.localeCompare(a.last));
  return [...favs, ...auto].slice(0, n);
}

export const isFavorite = (state, t) => (state.settings.favorites || []).some((f) => pickKey(f) === pickKey(t));

// Pins or unpins a record as a favorite quick pick. Returns the new state.
export function toggleFavorite(state, t, now = Date.now()) {
  const list = state.settings.favorites || [];
  const on = !isFavorite(state, t);
  state.settings.favorites = on
    ? [...list, { type: t.type, amount: t.amount, currency: t.currency, note: t.note || '', category: t.category, account: t.account }].slice(-12)
    : list.filter((f) => pickKey(f) !== pickKey(t));
  state.settings.updatedAt = now;
  return on;
}

// ---------- Budgets ----------
// A category can have a monthly budget (category.budget, in the main
// currency's cents). Loans don't count, same as everywhere else.

const spentIn = (state, key, catId) => txInMonth(state, key)
  .filter((t) => t.type === 'expense' && counts(t) && t.category === catId)
  .reduce((a, t) => a + B(t), 0);

// Average spent per month in a category over the `months` full months before `key`.
export function averageSpend(state, catId, key, months = 3) {
  let total = 0;
  for (let i = 1; i <= months; i++) total += spentIn(state, addMonths(key, -i), catId);
  return Math.round(total / months);
}

export function budgetStatus(state, key, today) {
  const dim = daysInMonth(key);
  const isNow = monthKey(today) === key;
  const day = isNow ? Number(today.slice(8, 10)) : dim;
  const rows = state.settings.categories
    .filter((c) => c.type === 'expense' && c.budget > 0)
    .map((c) => {
      const spent = spentIn(state, key, c.id);
      const projected = isNow ? Math.round((spent / day) * dim / 100) * 100 : spent; // whole lei
      const pct = spent / c.budget;
      const level = pct > 1 ? 'over' : pct >= 0.8 ? 'near' : isNow && day >= 5 && projected > c.budget * 1.05 ? 'pace' : 'ok';
      return { category: c, budget: c.budget, spent, left: c.budget - spent, pct, projected, level };
    })
    .sort((a, b) => b.pct - a.pct);
  const budget = rows.reduce((a, r) => a + r.budget, 0);
  const spent = rows.reduce((a, r) => a + r.spent, 0);
  return { rows, budget, spent, left: budget - spent, daysLeft: dim - day, isNow };
}

// After a new expense: did it cross 80% or 100% of its category's budget?
export function budgetAlert(state, t) {
  const c = category(state, t.category);
  if (t.type !== 'expense' || !counts(t) || !(c?.budget > 0)) return null;
  const after = spentIn(state, monthKey(t.date), c.id);
  const before = after - B(t);
  const fmt = (x) => formatMoney(x, state.settings.currency);
  if (before <= c.budget && after > c.budget) return { level: 'over', text: `${c.name} is over budget: ${fmt(after)} of ${fmt(c.budget)} (${fmt(after - c.budget)} over).` };
  if (before < c.budget * 0.8 && after >= c.budget * 0.8) return { level: 'near', text: `${c.name}: ${Math.round((after / c.budget) * 100)}% of the budget used. ${fmt(c.budget - after)} left this month.` };
  return null;
}

export function insights(state, key, today) {
  const cur = state.settings.currency;
  const fmt = (c) => formatMoney(c, cur);
  const s = monthSummary(state, key);
  const out = [];
  const isCurrent = monthKey(today) === key;
  const savingsTarget = savingsJar(state)?.pct ?? 0;
  const cat = (id) => category(state, id) || { name: id, emoji: '•' };

  if (!s.count) {
    out.push({ level: 'info', icon: '✍️', title: 'Nothing logged yet', text: `Log every expense in ${monthLabel(key)}, even 5 MDL. You can't control money you don't see.` });
    return out;
  }

  // 1. Savings rate against the plan.
  if (s.income > 0) {
    const rate = Math.round(s.savingsRate * 100);
    if (rate >= savingsTarget) {
      out.push({ level: 'good', icon: '🏆', title: `You kept ${rate}% of your income`, text: `Your target is ${savingsTarget}%. ${fmt(s.net)} stays with you this month. Move it to the safe so it doesn't leak.` });
    } else if (s.net >= 0) {
      const gap = Math.round((s.income * savingsTarget) / 100) - s.net;
      out.push({ level: 'warn', icon: '🎯', title: `Savings at ${rate}%, target ${savingsTarget}%`, text: `You are ${fmt(gap)} short of your ${savingsTarget}% plan this month.` });
    } else {
      out.push({ level: 'bad', icon: '🚨', title: 'You spent more than you earned', text: `${fmt(-s.net)} more went out than came in. That money came from your savings.` });
    }
  } else if (s.expense > 0) {
    out.push({ level: 'warn', icon: '💸', title: 'No income logged this month', text: `${fmt(s.expense)} spent with no income logged. If you got paid, log it so the split works.` });
  }

  // Category budgets: over, nearly used, or on pace to go over.
  const bs = budgetStatus(state, key, today);
  for (const r of bs.rows.filter((x) => x.level !== 'ok').slice(0, 2)) {
    const n = r.category.name;
    if (r.level === 'over') out.push({ level: 'bad', icon: '🧾', title: `${n}: over budget`, text: `${fmt(r.spent)} spent of ${fmt(r.budget)}, ${fmt(-r.left)} over.` });
    else if (r.level === 'near') out.push({ level: 'warn', icon: '🧾', title: `${n}: ${Math.round(r.pct * 100)}% of the budget used`, text: `${fmt(r.left)} left${bs.isNow ? ` for ${bs.daysLeft} more day${bs.daysLeft === 1 ? '' : 's'}` : ''}.` });
    else out.push({ level: 'warn', icon: '🧾', title: `${n}: on pace to go over`, text: `At this pace you spend about ${fmt(r.projected)} this month, budget ${fmt(r.budget)}.` });
  }

  // 2. Jars that went over budget.
  for (const j of jarStatus(state, key, today)) {
    if (j.savings || !j.used) continue;
    if (j.used > j.budget) {
      const rows = s.byCategory.filter((c) => jarOf(state, c.id) === j.jar.id);
      const inside = rows.slice(0, 3).map((c) => `${cat(c.id).name} ${fmt(c.amount)}`).join(', ');
      // Most of it is a category that sounds like work: maybe it is a work cost, not a personal one.
      const big = rows[0] && rows[0].amount >= j.used / 2 && WORKISH.test(cat(rows[0].id).name) ? cat(rows[0].id).name : '';
      const hint = big ? ` If ${big} is a work cost, set it to "Business, outside the jars" in Settings → Categories.` : '';
      out.push({ level: 'bad', icon: j.jar.emoji, title: `${j.jar.name}: over by ${fmt(j.used - j.budget)}`, text: `Plan was ${j.jar.pct}% of ${j.estimated ? 'your usual ' : ''}income (${fmt(j.budget)}), you spent ${fmt(j.used)}: ${inside}. The difference comes out of your deposit.${hint}` });
    }
  }

  // 3. Categories growing compared with your normal months.
  const base = categoryBaseline(state, key);
  if (base) {
    for (const c of s.byCategory) {
      const avg = base[c.id];
      if (avg && c.amount > avg * 1.3 && c.amount - avg >= 20000) {
        out.push({ level: 'warn', icon: cat(c.id).emoji, title: `${cat(c.id).name} is up ${Math.round((c.amount / avg - 1) * 100)}%`, text: `${fmt(c.amount)} this month vs ${fmt(avg)} on a normal month.` });
      }
    }
  }

  // 4. Biggest single expense.
  const biggest = [...s.expenses].sort((a, b) => B(b) - B(a))[0];
  if (biggest && s.expense && B(biggest) / s.expense >= 0.25) {
    out.push({ level: 'info', icon: '🔎', title: `One expense is ${Math.round((B(biggest) / s.expense) * 100)}% of the month`, text: `${fmt(B(biggest))}${biggest.note ? ` for "${biggest.note}"` : ''} (${cat(biggest.category).name}). Big ones are where planning pays most.` });
  }

  // 5. Small purchases add up.
  const small = s.expenses.filter((t) => B(t) < state.settings.smallPurchase);
  const smallSum = small.reduce((a, t) => a + B(t), 0);
  if (small.length >= 5) {
    out.push({ level: 'info', icon: '🪙', title: `${small.length} small purchases = ${fmt(smallSum)}`, text: `Each was under ${fmt(state.settings.smallPurchase)}. Over a year that pace is about ${fmt(smallSum * 12)}.` });
  }

  // 6. Spending pace for the current month.
  if (isCurrent && s.expense) {
    const day = Number(today.slice(8, 10));
    const dim = daysInMonth(key);
    if (day < dim) {
      const lei = (c) => Math.round(c / 100) * 100; // whole lei for estimates
      const projected = lei((s.expense / day) * dim);
      out.push({ level: 'info', icon: '📅', title: `On pace to spend ${fmt(projected)}`, text: `${fmt(lei(s.expense / day))} per day so far. ${dim - day} days left in ${monthLabel(key)}.` });
    }
  }

  // 7. No-spend days.
  const lastDay = isCurrent ? Number(today.slice(8, 10)) : daysInMonth(key);
  const spendDays = new Set(s.expenses.map((t) => t.date)).size;
  const noSpend = Math.max(0, lastDay - spendDays);
  if (noSpend >= 5) {
    out.push({ level: 'good', icon: '🧊', title: `${noSpend} no-spend days`, text: `Out of ${lastDay} days, ${noSpend} cost you nothing. Keep the streak going.` });
  }

  // 8. Where the money comes from: one source is a risk, more sources = more money.
  if (s.bySource.length && s.income >= 100000) {
    const top = s.bySource[0];
    const share = top.amount / s.income;
    if (share >= 0.8 && s.bySource.length <= 2) {
      out.push({ level: 'info', icon: '🌱', title: `${Math.round(share * 100)}% of income is ${cat(top.id).name}`, text: 'One source is fragile. A second income (side jobs, competitions, selling a skill) grows your safe faster than cutting coffee.' });
    } else if (s.bySource.length >= 3) {
      out.push({ level: 'good', icon: '🌳', title: `${s.bySource.length} income sources`, text: `Best one: ${cat(top.id).name} with ${fmt(top.amount)}. Find out what made it work and do more of it.` });
    }
  }

  // 9. Recurring costs, priced for the year.
  const subs = s.expenses.filter((t) => t.category === 'subscriptions');
  if (subs.length) {
    const subSum = subs.reduce((a, t) => a + B(t), 0);
    out.push({ level: 'info', icon: '📱', title: `Subscriptions: ${fmt(subSum * 12)} a year`, text: `${fmt(subSum)} this month. Cancel any you didn't use this week.` });
  }

  const order = { bad: 0, warn: 1, good: 2, info: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// Suggest a category for a note: first from your own history (the last time
// you wrote the same note), then from keywords in English, Romanian and Russian.
const KEYWORDS = {
  expense: [
    ['food', /food|mancare|mâncare|еда|продукт|magazin|market|lidl|kaufland|linella|pizza|burger|cafe|cafea|coffee|lunch|dinner|breakfast/i],
    ['transport', /transport|taxi|yandex|bolt|uber|bus|autobuz|troleibuz|metro|benzin|fuel|petrol|бензин|такси/i],
    ['gifts', /gift|cadou|подар|birthday|zi de nastere/i],
    ['subscriptions', /subscri|abonament|подписк|google|netflix|spotify|youtube|icloud|chatgpt|claude/i],
    ['hygiene', /hair|igien|cosmet|shampoo|sampon|soap|sapun|barber|frizer|uhod|косметик/i],
    ['health', /medic|pharm|farmac|doctor|dentist|аптек|лекар|vitamin/i],
    ['sport', /sport|gym|sala|black belt|centura|karate|judo|competi|turneu|dame|шашк|спорт/i],
    ['learning', /book|carte|course|curs|printer|culori|material|school|scoala|universit|math|matem|teach/i],
    ['clothes', /cloth|haine|shoe|pantofi|adidas|nike|одежд|обув/i],
    ['home', /rent|chirie|electric|gaz|apa|water|internet|telefon|phone|bill|factur|комм/i],
    ['fun', /cinema|film|movie|party|club|bar|game|joc|concert/i],
    ['family', /mother|mama|mom|brother|frate|sister|sora|family|familie|мама|брат/i],
  ],
  income: [
    ['competitions', /competi|turneu|prize|premiu|dame|tournament|donation from/i],
    ['work', /work|job|salar|lucru|munca|serviciu|services|работ|зарплат|from work/i],
    ['side', /interview|freelance|client|order|comand|tutor|lesson|lectie|repair|sold|vandut/i],
    ['family', /mother|mama|mom|brother|frate|family|familie|father|tata|bunic|мама|папа|семь/i],
    ['gift-in', /gift|cadou|birthday|подар/i],
  ],
};

// ---------- Category rules ----------
// Your own rules ("contains linella -> Food") win; then what you chose for
// the same note before; then words your records always file the same way
// (so "Plata la LINELLA SRL #4411" is learned from a few bank lines); then
// built-in keywords.

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// Words that say nothing about the category (bank and shop boilerplate).
const STOP = new Set('plata platii pentru from with the and for card pos srl sa ii md mda chisinau chisinaului moldova str nr via transfer payment purchase achitare cumparare comision operatiune tranzactie оплата покупка перевод платеж для www com shop store magazin'.split(' '));
const words = (note) => [...new Set(fold(note).match(/[\p{L}]{3,}/gu) || [])].filter((w) => !STOP.has(w));

export function matchRule(state, note, type) {
  const n = fold(note);
  if (!n) return null;
  return (state.settings.rules || [])
    .filter((r) => r.match && (r.type === type || r.type === 'any') && n.includes(fold(r.match)))
    .sort((a, b) => b.match.length - a.match.length)[0] || null;
}

// word -> category counts from your records, per type (cached per tx list).
const statsCache = new WeakMap();
function wordStats(state, type) {
  let last = 0;
  for (const t of state.tx) if (t.updatedAt > last) last = t.updatedAt;
  const key = `${type}|${state.tx.length}|${last}`;
  const hit = statsCache.get(state.tx);
  if (hit?.[key]) return hit[key];
  const out = new Map();
  for (const t of state.tx) {
    if (t.type !== type || !t.note || t.category === 'other' || t.category === 'other-in') continue;
    for (const w of words(t.note)) {
      const m = out.get(w) || new Map();
      m.set(t.category, (m.get(t.category) || 0) + 1);
      out.set(w, m);
    }
  }
  statsCache.set(state.tx, { ...(Object.keys(hit || {}).length < 4 ? hit : {}), [key]: out });
  return out;
}

// A word seen at least twice, always (or 85%+) in one category.
export function learnedCategory(state, note, type) {
  const stats = wordStats(state, type);
  let best = null;
  for (const w of words(note)) {
    const m = stats.get(w);
    if (!m) continue;
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [cat, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n >= 2 && n / total >= 0.85 && (!best || n > best.n)) best = { cat, n };
  }
  return best?.cat || null;
}

// The word to build a rule from: the longest meaningful one.
export function ruleWord(note) {
  return words(note).filter((w) => !/^\d+$/.test(w)).sort((a, b) => b.length - a.length)[0] || fold(note).trim().slice(0, 30);
}

export function addRule(state, { match, type, category }, now = Date.now()) {
  const m = fold(match).trim();
  if (!m || !category) return null;
  const rules = (state.settings.rules || []).filter((r) => !(fold(r.match) === m && r.type === type));
  const rule = { id: uid(), match: m, type, category, createdAt: now };
  state.settings.rules = [...rules, rule];
  state.settings.updatedAt = now;
  return rule;
}

export function removeRule(state, id, now = Date.now()) {
  state.settings.rules = (state.settings.rules || []).filter((r) => r.id !== id);
  state.settings.updatedAt = now;
}

// Records a rule would file differently. `onlyOther` limits it to records
// still in Other (safe default: never undo choices you made yourself).
export function ruleTargets(state, rule, { onlyOther = true } = {}) {
  return state.tx.filter((t) => (t.type === rule.type || rule.type === 'any') && t.type !== 'transfer'
    && t.category !== rule.category && fold(t.note).includes(fold(rule.match))
    && (!onlyOther || t.category === 'other' || t.category === 'other-in'));
}

export function applyRule(state, rule, list = ruleTargets(state, rule), now = Date.now()) {
  for (const t of list) { t.category = rule.category; t.updatedAt = now; }
  return list.length;
}

export function suggestCategory(state, note, type) {
  const n = (note || '').trim().toLowerCase();
  if (!n || type === 'transfer') return null;
  const valid = (id) => state.settings.categories.some((c) => c.id === id && c.type === type);
  const rule = matchRule(state, note, type);
  if (rule && valid(rule.category)) return rule.category;
  const past = sortTx(state.tx).find((t) => t.type === type && (t.note || '').trim().toLowerCase() === n);
  if (past && valid(past.category)) return past.category;
  const learned = learnedCategory(state, note, type);
  if (learned && valid(learned)) return learned;
  for (const [id, re] of KEYWORDS[type] || []) {
    if (re.test(n) && valid(id)) return id;
  }
  return null;
}

// Recent distinct notes for autocomplete, most used first.
export function noteSuggestions(state, type, limit = 30) {
  const counts = new Map();
  for (const t of state.tx) {
    if (t.type !== type || !t.note) continue;
    counts.set(t.note, (counts.get(t.note) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([n]) => n);
}

// ---------- People ----------

// Everything that happened with each person: money received from them, money
// given to them, and open loans. `owesMe` > 0 means they owe you; < 0 means
// you owe them.
export function peopleSummary(state, { from = null, to = null } = {}) {
  const rows = new Map(state.people.map((p) => [p.id, { person: p, received: 0, given: 0, owesMe: 0, owes: {}, count: 0, last: null }]));
  for (const t of state.tx) {
    if (!t.person || !rows.has(t.person) || t.type === 'transfer') continue;
    const r = rows.get(t.person);
    const v = B(t);
    if (t.loan) {
      r.owesMe += t.type === 'expense' ? v : -v;
      // Loans are owed in the currency they were made in (a debt in USD
      // stays 100 USD whatever the rate), see loanAmount().
      const { amount, currency } = loanAmount(t);
      r.owes[currency] = (r.owes[currency] || 0) + (t.type === 'expense' ? amount : -amount);
      if (!r.owes[currency]) delete r.owes[currency];
    }
    if (from && t.date < from) continue;
    if (to && t.date > to) continue;
    if (t.type === 'income') r.received += v; else r.given += v;
    r.count++;
    if (!r.last || t.date > r.last) r.last = t.date;
  }
  return [...rows.values()].sort((a, b) => (b.last || '').localeCompare(a.last || '') || a.person.name.localeCompare(b.person.name));
}

// An amount typed in another currency than the account's (10 USD paid from
// an MDL wallet): the record is in the account's currency, so balances stay
// right, and keeps what you typed in `orig`. A loan also owes it in that
// currency (`debt`). `rate` is 1 typed unit in the account's currency.
export function entryAmounts(typed, typedCur, accountCur, rate, { loan = false } = {}) {
  if (!typedCur || typedCur === accountCur) return { amount: typed, orig: null, debt: null };
  const amount = Math.round(typed * rate);
  const orig = { amount: typed, currency: typedCur, rate };
  return { amount, orig, debt: loan ? { amount: typed, currency: typedCur } : null };
}

// What a record was typed as: { amount, currency } in the typed currency, or
// null when it was typed in the account's own currency.
export const typedAs = (t) => (t.orig?.currency && t.orig.currency !== t.currency ? t.orig
  : t.debt?.currency && t.debt.currency !== t.currency ? t.debt : null);

// A loan record's debt: in its own currency unless it carries `debt`
// (lent 100 USD out of an MDL card: the record is in MDL, the debt in USD).
export const loanAmount = (t) => (t.debt && Number.isInteger(t.debt.amount) && t.debt.currency ? { amount: t.debt.amount, currency: t.debt.currency } : { amount: t.amount, currency: t.currency });

export const PERSON_GROUPS = ['Family', 'Friends', 'Work', 'Clients', 'Other'];

// Removes a person but keeps their records (with the name written on them).
export function deletePerson(state, id, now = Date.now()) {
  const p = state.people.find((x) => x.id === id);
  if (!p) return null;
  state.people = state.people.filter((x) => x.id !== id);
  state.deleted[id] = now;
  for (const t of state.tx) {
    if (t.person !== id) continue;
    delete t.person;
    t.personName = p.name;
    touch(t, now);
  }
  return p;
}

// Merges sourcePerson into targetPerson: reassigns all records, removes source,
// updates sync markers.
export function mergePeople(state, sourceId, targetId, now = Date.now()) {
  if (sourceId === targetId) return null;
  const src = state.people.find((x) => x.id === sourceId);
  const tgt = state.people.find((x) => x.id === targetId);
  if (!src || !tgt) return null;
  let remapped = 0;
  for (const t of state.tx) {
    if (t.person === sourceId) {
      t.person = targetId;
      touch(t, now);
      remapped++;
    }
  }
  state.people = state.people.filter((x) => x.id !== sourceId);
  state.deleted[sourceId] = now;
  touch(tgt, now);
  return { source: src, target: tgt, count: remapped };
}

// Finds a person by name (any case) or adds them. Returns the id.
export function ensurePerson(state, name, now = Date.now()) {
  const n = String(name || '').trim();
  if (!n) return null;
  const found = state.people.find((p) => p.name.toLowerCase() === n.toLowerCase());
  if (found) return found.id;
  const p = { id: `p-${uid()}`, name: n, note: '', updatedAt: now };
  state.people.push(p);
  return p.id;
}

// Adds a category while logging ("+ New" in the picker). Returns its id.
export function ensureCategory(state, name, type, now = Date.now()) {
  const n = String(name || '').trim();
  if (!n) return null;
  const found = state.settings.categories.find((c) => c.type === type && c.name.toLowerCase() === n.toLowerCase());
  if (found) return found.id;
  const jarId = type === 'expense' ? (state.settings.jars.find((j) => !j.savings)?.id) : undefined;
  const c = { id: `c-${uid()}`, type, name: n, emoji: '', ...(jarId ? { jar: jarId } : {}), updatedAt: now };
  state.settings.categories.push(c);
  return c.id;
}

// Marks a record as changed now (sync uses this to pick the newest copy).
export const touch = (obj, now = Date.now()) => Object.assign(obj, { updatedAt: now });

export function removeTx(state, id, now = Date.now()) {
  const i = state.tx.findIndex((t) => t.id === id);
  if (i < 0) return null;
  const [t] = state.tx.splice(i, 1);
  state.deleted[id] = now;
  return t;
}

export function restoreTx(state, t, now = Date.now()) {
  delete state.deleted[t.id];
  state.tx.push(touch(t, now));
}

// ---------- Spending by category over a period ----------

export const PERIODS = [
  { id: 'month', name: 'This month' },
  { id: 'last', name: 'Last month' },
  { id: '3m', name: '3 months' },
  { id: 'year', name: 'This year' },
];

// Date range for a named period, inclusive, as YYYY-MM-DD.
export function periodRange(id, today) {
  const m = monthKey(today);
  const end = (k) => `${k}-${String(daysInMonth(k)).padStart(2, '0')}`;
  if (id === 'last') { const k = addMonths(m, -1); return { from: `${k}-01`, to: end(k), label: monthLabel(k) }; }
  if (id === '3m') { const k = addMonths(m, -2); return { from: `${k}-01`, to: today, label: `${monthLabel(k, true)} – ${monthLabel(m, true)}` }; }
  if (id === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today, label: today.slice(0, 4) };
  return { from: `${m}-01`, to: end(m), label: monthLabel(m) };
}

// Spending (or income) per category between two dates, in the base currency,
// biggest first, each with its share and number of records.
export function totalsByCategory(state, from, to, type = 'expense') {
  const list = state.tx.filter((t) => t.type === type && !t.loan && t.date >= from && t.date <= to);
  const total = list.reduce((a, t) => a + B(t), 0);
  const count = {};
  for (const t of list) count[t.category] = (count[t.category] || 0) + 1;
  const rows = sumBy(list, (t) => t.category).map((r) => ({ ...r, share: total ? r.amount / total : 0, count: count[r.id] }));
  return { total, rows, list };
}

// ---------- Reports for any period ----------

const DAY = 864e5;
const isoDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY) + 1;
const shiftIso = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

// The same length of time right before [from, to] (for "vs previous").
export function previousRange(from, to) {
  const n = isoDays(from, to);
  return { from: shiftIso(from, -n), to: shiftIso(from, -1) };
}

function group(list, key) {
  const m = new Map();
  for (const t of list) {
    const k = key(t);
    if (k == null) continue;
    const r = m.get(k) || { id: k, income: 0, expense: 0, count: 0 };
    if (t.type === 'income') r.income += B(t); else r.expense += B(t);
    r.count++;
    m.set(k, r);
  }
  return [...m.values()];
}

// Everything a report shows for [from, to], in the base currency unless
// noted. `prev` holds the same numbers for the period just before.
export function report(state, from, to, { withPrev = true, today = null } = {}) {
  const inRange = state.tx.filter((t) => t.date >= from && t.date <= to);
  const real = inRange.filter((t) => t.type !== 'transfer' && !t.loan);
  const income = real.filter((t) => t.type === 'income').reduce((a, t) => a + B(t), 0);
  const expense = real.filter((t) => t.type === 'expense').reduce((a, t) => a + B(t), 0);
  const days = isoDays(from, to);
  // A period still running counts only the days that have passed so far.
  const end = today && today >= from && today < to ? today : to;
  const counted = isoDays(from, end);
  const spending = totalsByCategory(state, from, to, 'expense');
  const sources = totalsByCategory(state, from, to, 'income');
  const byAccount = group(real, (t) => t.account).sort((a, b) => b.expense + b.income - a.expense - a.income);
  const byPerson = group(inRange.filter((t) => t.person && t.type !== 'transfer'), (t) => t.person).sort((a, b) => b.expense + b.income - a.expense - a.income);
  const cur = new Map();
  for (const t of real) {
    const k = t.currency || state.settings.currency;
    const r = cur.get(k) || { id: k, income: 0, expense: 0 };
    r[t.type === 'income' ? 'income' : 'expense'] += t.amount;
    cur.set(k, r);
  }
  const loans = inRange.filter((t) => t.loan);
  const biggest = real.filter((t) => t.type === 'expense').sort((a, b) => B(b) - B(a)).slice(0, 10);
  const spendDays = new Set(real.filter((t) => t.type === 'expense' && t.date <= end).map((t) => t.date)).size;
  const out = {
    from, to, days, counted,
    income, expense, net: income - expense,
    savingsRate: income > 0 ? (income - expense) / income : null,
    perDay: counted ? Math.round(expense / counted) : 0,
    noSpendDays: Math.max(0, counted - spendDays),
    count: inRange.length,
    spending, sources, byAccount, byPerson,
    byCurrency: [...cur.values()],
    loansOut: loans.filter((t) => t.type === 'expense').reduce((a, t) => a + B(t), 0),
    loansIn: loans.filter((t) => t.type === 'income').reduce((a, t) => a + B(t), 0),
    biggest,
    list: inRange,
  };
  if (withPrev) {
    const p = previousRange(from, to);
    out.prev = report(state, p.from, p.to, { withPrev: false });
  }
  return out;
}

// Income and spending per day (short periods) or per month (long ones).
export function reportSeries(state, from, to) {
  const days = isoDays(from, to);
  const real = state.tx.filter((t) => t.date >= from && t.date <= to && t.type !== 'transfer' && !t.loan);
  const buckets = new Map();
  const keyOf = days <= 62 ? (iso) => iso : (iso) => iso.slice(0, 7);
  if (days <= 62) for (let i = 0; i < days; i++) buckets.set(shiftIso(from, i), { key: shiftIso(from, i), income: 0, expense: 0 });
  else for (let k = from.slice(0, 7); k <= to.slice(0, 7); k = addMonths(k, 1)) buckets.set(k, { key: k, income: 0, expense: 0 });
  for (const t of real) {
    const b = buckets.get(keyOf(t.date));
    if (b) b[t.type === 'income' ? 'income' : 'expense'] += B(t);
  }
  return { unit: days <= 62 ? 'day' : 'month', rows: [...buckets.values()] };
}
