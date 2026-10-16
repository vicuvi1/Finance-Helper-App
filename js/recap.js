// A month in review, told as a short story: what came in and went out, where
// it went, the highlights, savings, and one thing to try next month.
// Pure and tested (tests/recap.test.js). The story screen is
// js/screens/recap.js; the bot's version is recapText().

import { personalMonth, monthSummary, savingsJar, category, isWorkCost, B } from './model.js';
import { isEveryday } from './safespend.js';
import { addMonths, daysInMonth, monthLabel, dowIndex, DOW_LONG } from './dates.js';
import { formatMoney } from './money.js';

const pad = (n) => String(n).padStart(2, '0');

export function monthRecap(state, key) {
  const p = personalMonth(state, key);
  const s = monthSummary(state, key);
  const prevKey = addMonths(key, -1);
  const prev = monthSummary(state, prevKey);
  const prevP = personalMonth(state, prevKey);
  const personal = (list) => list.filter((t) => !isWorkCost(state, t.category));
  const sum = (list) => list.reduce((a, t) => a + B(t), 0);

  // Where it went: your own spending by category (work costs apart).
  const mine = personal(s.expenses);
  const byCat = new Map();
  for (const t of mine) byCat.set(t.category, (byCat.get(t.category) || 0) + B(t));
  const spent = sum(mine);
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([id, amount]) => ({
    id, name: category(state, id)?.name || 'Other', emoji: category(state, id)?.emoji || '', amount, share: spent ? amount / spent : 0,
  }));
  const top = cats.slice(0, 5);
  if (cats.length > 5) top.push({ id: 'other', name: 'Everything else', emoji: '', amount: cats.slice(5).reduce((a, c) => a + c.amount, 0), share: cats.slice(5).reduce((a, c) => a + c.share, 0) });

  // Against last month, per category: the biggest rise and the biggest drop.
  const prevBy = new Map();
  for (const t of personal(prev.expenses)) prevBy.set(t.category, (prevBy.get(t.category) || 0) + B(t));
  const changes = [...new Set([...byCat.keys(), ...prevBy.keys()])]
    .map((id) => ({ id, name: category(state, id)?.name || 'Other', now: byCat.get(id) || 0, before: prevBy.get(id) || 0 }))
    .map((c) => ({ ...c, diff: c.now - c.before }))
    .filter((c) => c.before > 0 || c.now > 0);
  const hasPrev = prev.expenses.length > 0;
  const up = hasPrev ? changes.filter((c) => c.diff > 0 && c.before > 0).sort((a, b) => b.diff - a.diff)[0] || null : null;
  const down = hasPrev ? changes.filter((c) => c.diff < 0).sort((a, b) => a.diff - b.diff)[0] || null : null;

  // Highlights.
  const biggest = [...mine].sort((a, b) => B(b) - B(a))[0] || null;
  const days = daysInMonth(key);
  const spendDays = new Map();
  for (const t of mine.filter((x) => isEveryday(state, x))) spendDays.set(t.date, (spendDays.get(t.date) || 0) + B(t));
  const noSpend = Array.from({ length: days }, (_, i) => `${key}-${pad(i + 1)}`).filter((d) => !spendDays.has(d)).length;
  const dowTotals = [0, 0, 0, 0, 0, 0, 0];
  for (const [d, v] of spendDays) dowTotals[dowIndex(d)] += v;
  const busiest = dowTotals.some((v) => v > 0) ? dowTotals.indexOf(Math.max(...dowTotals)) : null;

  // Saving.
  const savingsIds = new Set(state.settings.accounts.filter((a) => a.savings || a.kind === 'savings').map((a) => a.id));
  const toSavings = state.tx.filter((t) => t.type === 'transfer' && t.date.startsWith(key) && savingsIds.has(t.to) && !savingsIds.has(t.from)).reduce((a, t) => a + B(t), 0)
    - state.tx.filter((t) => t.type === 'transfer' && t.date.startsWith(key) && savingsIds.has(t.from) && !savingsIds.has(t.to)).reduce((a, t) => a + B(t), 0);
  const jar = savingsJar(state);
  const goalPct = jar?.savings ? jar.pct : null;
  const rate = p.personalIncome > 0 ? p.kept / p.personalIncome : null;
  const limit = state.settings.limit?.on && state.settings.limit.amount > 0 ? state.settings.limit.amount : null;
  const everyday = sum(mine.filter((t) => isEveryday(state, t)));

  // One thing to try next month.
  let tip;
  if (limit && everyday > limit) tip = { text: `You went ${formatMoney(everyday - limit, state.settings.currency)} over your limit. Check your daily Safe to spend before you buy.`, act: 'limit-setup', btn: 'See my limit' };
  else if (up && up.diff > 0) tip = { text: `${up.name} grew by ${formatMoney(up.diff, state.settings.currency)}. Try to keep it near ${formatMoney(Math.round(up.before / 10000) * 10000, state.settings.currency)} next month.`, act: limit ? null : 'limit-setup', btn: limit ? null : 'Set a limit' };
  else if (rate != null && goalPct != null && rate * 100 < goalPct) tip = { text: `You kept ${Math.round(rate * 100)}%, your plan is ${goalPct}%. Move the savings on payday, before the month gets to it.`, act: null };
  else if (!limit && spent > 0) tip = { text: 'A good month. A spending limit would make next month just as easy: one daily number to follow.', act: 'limit-setup', btn: 'Set a limit' };
  else tip = { text: 'A good month. Same again: log as you go and check Safe to spend before bigger buys.', act: null };

  return {
    key, label: monthLabel(key), name: monthLabel(key).split(' ')[0],
    income: p.personalIncome, spent, kept: p.kept, rate, goalPct,
    work: { income: p.workIncome, costs: p.workCosts, profit: p.profit },
    prevSpent: hasPrev ? sum(personal(prev.expenses)) : null, prevKept: hasPrev ? prevP.kept : null,
    top, up, down, biggest: biggest && { note: biggest.note || category(state, biggest.category)?.name || 'Expense', amount: B(biggest), date: biggest.date, category: category(state, biggest.category)?.name || '' },
    noSpend, days, busiest: busiest == null ? null : DOW_LONG[busiest], toSavings, limit, everyday,
    count: s.count, tip,
  };
}

// The bot's version: a few lines for Telegram.
export function recapText(state, key) {
  const r = monthRecap(state, key);
  const f = (c) => formatMoney(c, state.settings.currency);
  const e = (x) => String(x).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  if (!r.count) return `✨ Nothing logged in ${e(r.label)}.`;
  const lines = [`✨ <b>Your ${e(r.label)}</b>`, ''];
  lines.push(`💰 Came in: ${f(r.income)}`, `💸 You spent: ${f(r.spent)}${r.prevSpent != null ? ` (${r.spent <= r.prevSpent ? '▼' : '▲'} ${f(Math.abs(r.spent - r.prevSpent))} vs the month before)` : ''}`);
  if (r.income > 0) lines.push(`🏦 Kept: <b>${f(r.kept)}</b> (${Math.round((r.rate || 0) * 100)}%${r.goalPct != null ? `, plan ${r.goalPct}%` : ''})`);
  if (r.limit) lines.push(`🚦 Limit: ${f(r.everyday)} of ${f(r.limit)}${r.everyday > r.limit ? ' ⚠️' : ' ✅'}`);
  if (r.top.length) lines.push('', '<b>Where it went</b>', ...r.top.slice(0, 4).map((c) => `${c.emoji || '•'} ${e(c.name)}: ${f(c.amount)} (${Math.round(c.share * 100)}%)`));
  lines.push('', `🌿 ${r.noSpend} no-spend day${r.noSpend === 1 ? '' : 's'}${r.biggest ? ` · biggest: ${e(r.biggest.note)} ${f(r.biggest.amount)}` : ''}`);
  lines.push('', `👉 ${e(r.tip.text)}`);
  return lines.join('\n');
}

// Months you can look back on: the ones with records, newest first.
export function recapMonths(state, today) {
  const now = today.slice(0, 7);
  return [...new Set(state.tx.map((t) => t.date.slice(0, 7)))].filter((k) => k < now).sort().reverse();
}
