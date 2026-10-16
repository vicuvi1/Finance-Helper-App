// "Safe to spend today": the money on cards and in cash, minus the bills due
// before your next income and what this month's savings plan still needs,
// spread over the days until that income (or the end of the month).
// With a monthly spending limit (settings.limit = { on, amount }), each day
// also gets no more than what's left of the limit over the days left in the
// month: today's share is the smaller of the two.
// Pure and tested; Home and the Telegram bot show it.

import { accountBalances, personalMonth, savingsJar, isBillCategory, isWorkCost, payOn, B } from './model.js';
import { payStatus } from './payyourself.js';
import { dueItems, upcomingItems } from './recurring.js';
import { isLiquid } from './forecast.js';
import { daysBetween, monthKey, addMonths, addDays, daysInMonth } from './dates.js';
import { convert } from './fx.js';

const lei = (c) => Math.floor(c / 100) * 100; // whole lei, rounded down: never promise more

// Everyday spending: what a daily share and a spending limit are about. Not
// bills (rent, internet), repeating payments, loans or work costs.
export const isEveryday = (state, t) => t.type === 'expense' && !t.loan && !t.recurring
  && !isBillCategory(state, t.category) && !isWorkCost(state, t.category);
export const everydaySpent = (state, from, to) => state.tx
  .filter((t) => t.date >= from && t.date <= to && isEveryday(state, t)).reduce((a, t) => a + B(t), 0);

export const limitOn = (state) => !!(state.settings.limit?.on && state.settings.limit.amount > 0);

// This month against your spending limit: spent so far, what's left, and the
// fair share per day for the days left (today included).
export function limitStatus(state, today) {
  if (!limitOn(state)) return null;
  const amount = state.settings.limit.amount;
  const key = monthKey(today);
  const daysLeft = daysInMonth(key) - Number(today.slice(8)) + 1;
  const before = everydaySpent(state, `${key}-01`, addDays(today, -1));
  const spentToday = everydaySpent(state, today, today);
  const leftBefore = amount - before;
  const perDay = leftBefore > 0 ? lei(leftBefore / daysLeft) : 0;
  const spent = before + spentToday;
  return { amount, spent, left: amount - spent, perDay, daysLeft, ratio: spent / amount,
    // Where the month is heading at today's pace (from the 3rd on).
    projected: Number(today.slice(8)) >= 3 ? Math.round((spent / Number(today.slice(8))) * daysInMonth(key) / 100) * 100 : null };
}

// A limit to suggest: your usual everyday spending a month (the last 3 full
// months that had any), in whole hundreds of lei.
export function suggestLimit(state, today) {
  const key = monthKey(today);
  const months = [1, 2, 3].map((n) => addMonths(key, -n))
    .map((k) => everydaySpent(state, `${k}-01`, `${k}-${String(daysInMonth(k)).padStart(2, '0')}`)).filter((v) => v > 0);
  if (!months.length) return 0;
  return Math.round(months.reduce((a, v) => a + v, 0) / months.length / 10000) * 10000;
}

export function safeToSpend(state, today) {
  const base = state.settings.currency;
  const toBase = (c, cur) => (!cur || cur === base ? c : convert(c, cur, base, state.rates));
  // Paying yourself a salary: the buffer isn't spending money, and payday is
  // your salary day.
  const pay = payOn(state) ? payStatus(state, today) : null;
  const spendable = (a) => isLiquid(a) && !(pay && a.id === state.settings.pay.buffer);
  const accs = state.settings.accounts;
  const liquidIds = new Set(accs.filter(spendable).map((a) => a.id));
  const bal = accountBalances(state);
  const liquid = accs.filter(spendable).reduce((a, acc) => a + (toBase(bal[acc.id] || 0, acc.currency) || 0), 0);

  // Next income: your next salary, or the next recurring income after today,
  // else the 1st of next month.
  const ahead = upcomingItems(state, today, 45);
  const inc = pay ? null : ahead.find((x) => x.rule.type === 'income');
  const payday = pay ? pay.next : inc ? inc.date : `${addMonths(monthKey(today), 1)}-01`;
  const days = Math.max(1, daysBetween(today, payday));

  // Bills still to pay before then (late ones too).
  const bills = [...dueItems(state, today), ...ahead.filter((x) => x.date < payday)]
    .filter((x) => x.rule.type !== 'income')
    .map((x) => ({ label: x.rule.note || 'Bill', date: x.date, amount: toBase(x.rule.amount, x.rule.currency) || 0 }));
  const billsTotal = bills.reduce((a, b) => a + b.amount, 0);

  // This month's savings plan, minus what already went to savings accounts.
  const key = monthKey(today);
  const jar = savingsJar(state);
  const income = personalMonth(state, key).personalIncome; // what came in for you, not for the work
  const plan = jar?.savings ? Math.round((income * jar.pct) / 10000) * 100 : 0;
  let moved = 0;
  for (const t of state.tx) {
    if (t.type !== 'transfer' || monthKey(t.date) !== key) continue;
    const v = B(t);
    if (liquidIds.has(t.from) && !liquidIds.has(t.to)) moved += v;
    else if (!liquidIds.has(t.from) && liquidIds.has(t.to)) moved -= v;
  }
  // With a salary, saving happens in the buffer (what stays after the salary),
  // so the salary itself is money to live on.
  const savingsLeft = pay ? 0 : Math.max(0, plan - moved);

  // Today's everyday spending counts against today's share, not the pool.
  // Bills paid today (rent, internet…) are not today's spending: they already
  // left your balance, so they shrink every day's share a little instead.
  const spentToday = everydaySpent(state, today, today);
  const pool = liquid + spentToday - billsTotal - savingsLeft;
  const moneyPerDay = pool > 0 ? lei(pool / days) : 0;
  // Spent more than today's share: what each day after today gets instead.
  let tomorrow = days > 1 && pool - spentToday > 0 ? lei((pool - spentToday) / (days - 1)) : 0;
  // Your spending limit, when it is the tighter of the two.
  const limit = limitStatus(state, today);
  const byLimit = !!limit && limit.perDay < moneyPerDay;
  const perDay = byLimit ? limit.perDay : moneyPerDay;
  if (limit) {
    const lt = limit.daysLeft > 1 && limit.left > 0 ? lei(limit.left / (limit.daysLeft - 1)) : 0;
    tomorrow = Math.min(tomorrow, lt);
  }
  const leftToday = perDay - spentToday;
  return {
    liquid, bills, billsTotal, plan, moved, savingsLeft, spentToday, pool, perDay, leftToday, tomorrow,
    payday, days, paydayFrom: pay ? 'salary' : inc ? inc.rule.note || 'Income' : null,
    short: pool <= 0 ? -pool : 0, moneyPerDay, limit, byLimit,
  };
}

// One line for the bot: "🟢 Safe to spend today: 295 MDL left (of 340)".
export function safeLine(state, today, fmt) {
  const s = safeToSpend(state, today);
  if (s.pool <= 0) return `🔴 Nothing safe to spend until ${shortDay(s.payday)}: bills and savings need ${fmt(s.short)} more.`;
  if (s.limit && s.limit.left <= 0 && s.leftToday <= 0) return `🔴 Your ${fmt(s.limit.amount)} limit for the month is used up${s.limit.left < 0 ? ` (${fmt(-s.limit.left)} over)` : ''}.`;
  if (s.leftToday >= 0) return `${s.leftToday >= s.perDay / 4 ? '🟢' : '🟡'} Safe to spend today: <b>${fmt(s.leftToday)}</b> left (of ${fmt(s.perDay)})`;
  return `🟠 ${fmt(-s.leftToday)} over today's ${fmt(s.perDay)}. From tomorrow: ${fmt(s.tomorrow)} a day until ${shortDay(s.payday)}.`;
}

export const shortDay = (iso) => `${Number(iso.slice(8))} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(iso.slice(5, 7)) - 1]}`;
