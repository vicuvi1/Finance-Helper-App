// "Safe to spend today": the money on cards and in cash, minus the bills due
// before your next income and what this month's savings plan still needs,
// spread over the days until that income (or the end of the month).
// Pure and tested; Home and the Telegram bot show it.

import { accountBalances, monthSummary, savingsJar, B } from './model.js';
import { dueItems, upcomingItems } from './recurring.js';
import { isLiquid } from './forecast.js';
import { daysBetween, monthKey, addMonths } from './dates.js';
import { convert } from './fx.js';

const lei = (c) => Math.floor(c / 100) * 100; // whole lei, rounded down: never promise more

export function safeToSpend(state, today) {
  const base = state.settings.currency;
  const toBase = (c, cur) => (!cur || cur === base ? c : convert(c, cur, base, state.rates));
  const accs = state.settings.accounts;
  const liquidIds = new Set(accs.filter(isLiquid).map((a) => a.id));
  const bal = accountBalances(state);
  const liquid = accs.filter(isLiquid).reduce((a, acc) => a + (toBase(bal[acc.id] || 0, acc.currency) || 0), 0);

  // Next income: the next recurring income after today; else the 1st of next month.
  const ahead = upcomingItems(state, today, 45);
  const inc = ahead.find((x) => x.rule.type === 'income');
  const payday = inc ? inc.date : `${addMonths(monthKey(today), 1)}-01`;
  const days = Math.max(1, daysBetween(today, payday));

  // Bills still to pay before then (late ones too).
  const bills = [...dueItems(state, today), ...ahead.filter((x) => x.date < payday)]
    .filter((x) => x.rule.type !== 'income')
    .map((x) => ({ label: x.rule.note || 'Bill', date: x.date, amount: toBase(x.rule.amount, x.rule.currency) || 0 }));
  const billsTotal = bills.reduce((a, b) => a + b.amount, 0);

  // This month's savings plan, minus what already went to savings accounts.
  const key = monthKey(today);
  const jar = savingsJar(state);
  const income = monthSummary(state, key).income;
  const plan = jar?.savings ? Math.round((income * jar.pct) / 10000) * 100 : 0;
  let moved = 0;
  for (const t of state.tx) {
    if (t.type !== 'transfer' || monthKey(t.date) !== key) continue;
    const v = B(t);
    if (liquidIds.has(t.from) && !liquidIds.has(t.to)) moved += v;
    else if (!liquidIds.has(t.from) && liquidIds.has(t.to)) moved -= v;
  }
  const savingsLeft = Math.max(0, plan - moved);

  // Today's everyday spending counts against today's share, not the pool.
  const spentToday = state.tx.filter((t) => t.date === today && t.type === 'expense' && !t.loan && !t.recurring)
    .reduce((a, t) => a + B(t), 0);
  const pool = liquid + spentToday - billsTotal - savingsLeft;
  const perDay = pool > 0 ? lei(pool / days) : 0;
  const leftToday = perDay - spentToday;
  // Spent more than today's share: what each day after today gets instead.
  const tomorrow = days > 1 && pool - spentToday > 0 ? lei((pool - spentToday) / (days - 1)) : 0;
  return {
    liquid, bills, billsTotal, plan, moved, savingsLeft, spentToday, pool, perDay, leftToday, tomorrow,
    payday, days, paydayFrom: inc ? inc.rule.note || 'Income' : null,
    short: pool <= 0 ? -pool : 0,
  };
}

// One line for the bot: "🟢 Safe to spend today: 295 MDL left (of 340)".
export function safeLine(state, today, fmt) {
  const s = safeToSpend(state, today);
  if (s.pool <= 0) return `🔴 Nothing safe to spend until ${shortDay(s.payday)}: bills and savings need ${fmt(s.short)} more.`;
  if (s.leftToday >= 0) return `${s.leftToday >= s.perDay / 4 ? '🟢' : '🟡'} Safe to spend today: <b>${fmt(s.leftToday)}</b> left (of ${fmt(s.perDay)})`;
  return `🟠 ${fmt(-s.leftToday)} over today's ${fmt(s.perDay)}. From tomorrow: ${fmt(s.tomorrow)} a day until ${shortDay(s.payday)}.`;
}

export const shortDay = (iso) => `${Number(iso.slice(8))} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(iso.slice(5, 7)) - 1]}`;
