// "Can I afford it?": what a purchase would do, without making any record.
// Safe to spend before and after, the days this month the money would run
// short, how many weeks later each goal is reached at its current pace, and
// one plain verdict. Pure and read only; js/screens/afford.js shows it.

import { goalStatus, isBillCategory, isWorkCost } from './model.js';
import { safeToSpend, shortDay, limitStatus } from './safespend.js';
import { spendingIds } from './forecast.js';
import { moneyLine, floorOf } from './moneycal.js';
import { addDays, daysInMonth, monthKey } from './dates.js';

const pad = (n) => String(n).padStart(2, '0');

const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`;
const dayWords = (iso, today) => (monthKey(iso) === monthKey(today) ? `the ${ordinal(Number(iso.slice(8)))}` : shortDay(iso));

// A copy of the data with the purchase as one more everyday expense. Only
// used for the numbers; nothing is saved.
function withPurchase(state, price, date) {
  const cat = state.settings.categories.find((c) => c.type === 'expense' && !isBillCategory(state, c.id) && !isWorkCost(state, c.id));
  const acc = [...spendingIds(state, date)][0] || state.settings.accounts[0]?.id;
  const fake = { id: '_afford', type: 'expense', amount: price, currency: state.settings.currency, rate: 1, base: price, date, category: cat?.id || 'other', account: acc, note: 'Can I afford it?' };
  return { ...state, tx: [...state.tx, fake] };
}

export const activeGoals = (state) => (state.goals || []).filter((g) => !g.doneAt && !g.archived);

export function affordCheck(state, today, { price, date = today }) {
  const day = date < today ? today : date;
  const before = safeToSpend(state, day);
  const after = safeToSpend(withPurchase(state, price, day), day);

  // The money-left line to the end of the month, minus the purchase.
  const key = monthKey(day);
  const monthEnd = `${key}-${pad(daysInMonth(key))}`;
  const floor = floorOf(state);
  const line = moneyLine(state, today, monthEnd);
  const tight = [];
  for (let d = day; d <= monthEnd; d = addDays(d, 1)) {
    const p = line.get(d);
    if (p && p.left - price < floor) tight.push(d);
  }
  const endLeft = (line.get(monthEnd)?.left ?? before.liquid) - price;
  const lastTight = tight.at(-1) || null;
  const recover = lastTight && lastTight < monthEnd ? addDays(lastTight, 1) : null;

  // A spending limit for the month, when set.
  const lim = limitStatus(state, day);
  const overLimit = lim && lim.left - price < 0 ? price - Math.max(0, lim.left) : 0;

  let verdict;
  let tone;
  if (endLeft < floor || after.pool <= 0) { verdict = 'Not this month'; tone = 'bad'; }
  else if (tight.length) { verdict = `Yes, but tight until ${dayWords(recover || after.payday, today)}`; tone = 'warn'; }
  else if (after.leftToday < 0 && day === today) { verdict = `Yes, but tight until ${dayWords(after.payday, today)}`; tone = 'warn'; }
  else { verdict = 'Yes, comfortably'; tone = 'ok'; }

  // Goals: weeks later at the pace of the last months.
  const goals = activeGoals(state).map((g) => {
    const st = goalStatus(state, today, g);
    const weeks = st.pace > 0 && st.remaining > 0 ? Math.max(1, Math.round((price / st.pace) * (52 / 12))) : null;
    return { id: g.id, name: g.name || 'Goal', emoji: g.emoji || '🎯', weeks, pace: st.pace, remaining: st.remaining };
  });

  return { price, date: day, before, after, tightDays: tight.length, tightUntil: recover, endLeft, overLimit, verdict, tone, goals };
}
