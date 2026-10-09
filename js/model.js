// Everything the app knows how to calculate. Pure functions over the state,
// so it is all tested in Node without a browser.

import { splitByPercent, formatMoney } from './money.js';
import { monthKey, addMonths, daysInMonth, monthLabel } from './dates.js';

export const SCHEMA_VERSION = 1;

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
        { id: 'wallet', name: 'Wallet', emoji: '👛', start: 0 },
        { id: 'safe', name: 'Safe', emoji: '🔒', start: 0 },
        { id: 'card', name: 'Card', emoji: '💳', start: 0 },
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
      goal: { name: 'Safe goal', target: 10000000, account: 'all' },
      savingsAccount: 'safe', // where the "move to safe" button sends your deposit
      theme: 'system',
      smallPurchase: 10000, // under 100 MDL counts as a "small" purchase
    },
    tx: [],
    meta: { lastBackup: null, createdAt: null },
  };
}

// Brings any saved or imported state up to the current shape without losing data.
export function normalizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const s = raw.settings || {};
  const settings = {
    ...base.settings,
    ...s,
    goal: { ...base.settings.goal, ...(s.goal || {}) },
    jars: Array.isArray(s.jars) && s.jars.length ? s.jars : base.settings.jars,
    accounts: Array.isArray(s.accounts) && s.accounts.length ? s.accounts : base.settings.accounts,
    categories: Array.isArray(s.categories) && s.categories.length ? s.categories : base.settings.categories,
  };
  const tx = (Array.isArray(raw.tx) ? raw.tx : []).filter(validTx);
  return { version: SCHEMA_VERSION, settings, tx, meta: { ...base.meta, ...(raw.meta || {}) } };
}

function validTx(t) {
  return t && typeof t.id === 'string' && ['income', 'expense', 'transfer'].includes(t.type)
    && Number.isInteger(t.amount) && t.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.date);
}

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
export const jar = (state, id) => state.settings.jars.find((j) => j.id === id);
export const savingsJar = (state) => state.settings.jars.find((j) => j.savings) || state.settings.jars[0];

export function accountBalances(state, upTo = null) {
  const bal = Object.fromEntries(state.settings.accounts.map((a) => [a.id, a.start || 0]));
  for (const t of state.tx) {
    if (upTo && t.date > upTo) continue;
    if (t.type === 'income' && t.account in bal) bal[t.account] += t.amount;
    else if (t.type === 'expense' && t.account in bal) bal[t.account] -= t.amount;
    else if (t.type === 'transfer') {
      if (t.from in bal) bal[t.from] -= t.amount;
      if (t.to in bal) bal[t.to] += t.amount;
    }
  }
  return bal;
}

export function totalBalance(state) {
  return Object.values(accountBalances(state)).reduce((a, b) => a + b, 0);
}

export const txInMonth = (state, key) => state.tx.filter((t) => monthKey(t.date) === key);

function sumBy(list, keyFn) {
  const out = new Map();
  for (const t of list) out.set(keyFn(t), (out.get(keyFn(t)) || 0) + t.amount);
  return [...out.entries()].map(([id, amount]) => ({ id, amount })).sort((a, b) => b.amount - a.amount);
}

export function monthSummary(state, key) {
  const list = txInMonth(state, key);
  const incomes = list.filter((t) => t.type === 'income');
  const expenses = list.filter((t) => t.type === 'expense');
  const income = incomes.reduce((a, t) => a + t.amount, 0);
  const expense = expenses.reduce((a, t) => a + t.amount, 0);
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

// How each jar is doing this month. Spending jars get income × pct as a budget;
// the savings jar is measured by what you actually kept (income − spending).
export function jarStatus(state, key) {
  const sum = monthSummary(state, key);
  const spentByJar = {};
  for (const t of sum.expenses) {
    const j = category(state, t.category)?.jar || jarFallback(state);
    spentByJar[j] = (spentByJar[j] || 0) + t.amount;
  }
  return state.settings.jars.map((j) => {
    // Whole lei: nobody budgets 2 446,30.
    const budget = Math.round((sum.income * j.pct) / 10000) * 100;
    if (j.savings) {
      const kept = Math.max(0, sum.net);
      return { jar: j, budget, used: kept, left: kept - budget, ratio: budget ? kept / budget : null, savings: true };
    }
    const used = spentByJar[j.id] || 0;
    return { jar: j, budget, used, left: budget - used, ratio: budget ? used / budget : used ? Infinity : 0 };
  });
}

function jarFallback(state) {
  const nonSavings = state.settings.jars.find((j) => !j.savings);
  return nonSavings ? nonSavings.id : state.settings.jars[0].id;
}

function goalCurrent(state) {
  const { goal } = state.settings;
  const bal = accountBalances(state);
  if (goal.account && goal.account !== 'all' && goal.account in bal) return bal[goal.account];
  return Object.values(bal).reduce((a, b) => a + b, 0);
}

// Average monthly growth of the goal's money over your last (up to 3) months
// with records, before this one. Gaps where you logged nothing are skipped,
// so a break from logging doesn't read as "saved zero". Used for the ETA.
export function goalStatus(state, today) {
  const { goal } = state.settings;
  const current = goalCurrent(state);
  const target = goal.target || 0;
  const thisMonth = monthKey(today);
  const end = (k) => `${k}-${String(daysInMonth(k)).padStart(2, '0')}`;
  const active = new Set(state.tx.map((t) => monthKey(t.date)));
  const months = [...active].filter((k) => k < thisMonth).sort().slice(-3);
  let pace = null;
  if (months.length) {
    const growth = months.map((k) => goalValueAt(state, end(k)) - goalValueAt(state, end(addMonths(k, -1))));
    pace = Math.round(growth.reduce((a, b) => a + b, 0) / months.length);
  } else if (active.has(thisMonth)) {
    // Only this month so far: use what it grew by until today.
    pace = goalValueAt(state, today) - goalValueAt(state, end(addMonths(thisMonth, -1)));
  }
  const remaining = Math.max(0, target - current);
  let monthsLeft = null;
  let eta = null;
  if (remaining === 0 && target > 0) monthsLeft = 0;
  else if (pace && pace > 0) {
    monthsLeft = Math.ceil(remaining / pace);
    eta = addMonths(thisMonth, monthsLeft);
  }
  return { target, current, remaining, ratio: target ? Math.min(1, Math.max(0, current / target)) : 0, pace, monthsLeft, eta };
}

function goalValueAt(state, iso) {
  const { goal } = state.settings;
  const bal = accountBalances(state, iso);
  if (goal.account && goal.account !== 'all' && goal.account in bal) return bal[goal.account];
  return Object.values(bal).reduce((a, b) => a + b, 0);
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

  // 2. Jars that went over budget.
  for (const j of jarStatus(state, key)) {
    if (j.savings || !j.used) continue;
    if (j.used > j.budget) {
      const inside = s.byCategory.filter((c) => (category(state, c.id)?.jar || jarFallback(state)) === j.jar.id)
        .slice(0, 3).map((c) => `${cat(c.id).name} ${fmt(c.amount)}`).join(', ');
      out.push({ level: 'bad', icon: j.jar.emoji, title: `${j.jar.name}: over by ${fmt(j.used - j.budget)}`, text: `Plan was ${j.jar.pct}% of income (${fmt(j.budget)}), you spent ${fmt(j.used)}: ${inside}. The difference comes out of your deposit.` });
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
  const biggest = [...s.expenses].sort((a, b) => b.amount - a.amount)[0];
  if (biggest && s.expense && biggest.amount / s.expense >= 0.25) {
    out.push({ level: 'info', icon: '🔎', title: `One expense is ${Math.round((biggest.amount / s.expense) * 100)}% of the month`, text: `${fmt(biggest.amount)}${biggest.note ? ` for "${biggest.note}"` : ''} (${cat(biggest.category).name}). Big ones are where planning pays most.` });
  }

  // 5. Small purchases add up.
  const small = s.expenses.filter((t) => t.amount < state.settings.smallPurchase);
  const smallSum = small.reduce((a, t) => a + t.amount, 0);
  if (small.length >= 5) {
    out.push({ level: 'info', icon: '🪙', title: `${small.length} small purchases = ${fmt(smallSum)}`, text: `Each was under ${fmt(state.settings.smallPurchase)}. Over a year that pace is about ${fmt(smallSum * 12)}.` });
  }

  // 6. Spending pace for the current month.
  if (isCurrent && s.expense) {
    const day = Number(today.slice(8, 10));
    const dim = daysInMonth(key);
    if (day < dim) {
      const projected = Math.round((s.expense / day) * dim);
      out.push({ level: 'info', icon: '📅', title: `On pace to spend ${fmt(projected)}`, text: `${fmt(Math.round(s.expense / day))} per day so far. ${dim - day} days left in ${monthLabel(key)}.` });
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
    const subSum = subs.reduce((a, t) => a + t.amount, 0);
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

export function suggestCategory(state, note, type) {
  const n = (note || '').trim().toLowerCase();
  if (!n || type === 'transfer') return null;
  const valid = (id) => state.settings.categories.some((c) => c.id === id && c.type === type);
  const past = sortTx(state.tx).find((t) => t.type === type && (t.note || '').trim().toLowerCase() === n);
  if (past && valid(past.category)) return past.category;
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
