// What the Android app shows as phone notifications (it asks your server about once an hour,
// api/capture.mjs ?q=alerts). Each alert has an id that stays the same for that day or month,
// so the phone shows it once. Pure and tested (tests/phonealerts.test.js).
//   - a bill due today or tomorrow (or late, not marked paid)
//   - a category budget at 80% or over
//   - money running low before payday (js/smartwarn.js lowestPoint)

import { dueItems, upcomingItems } from './recurring.js';
import { budgetStatus } from './model.js';
import { lowestPoint } from './smartwarn.js';
import { formatMoney } from './money.js';
import { monthKey, addDays } from './dates.js';
import { shortDay } from './safespend.js';

export function phoneAlerts(state, today) {
  const out = [];
  const cur = state.settings?.currency || 'MDL';
  const fmt = (c, x = cur) => formatMoney(c, x, { reveal: true });
  const tomorrow = addDays(today, 1);
  for (const { rule, date } of [...dueItems(state, today), ...upcomingItems(state, today, 1)]) {
    if (rule.type !== 'expense' || rule.paused) continue;
    const when = date < today ? `was due ${shortDay(date)}` : date === today ? 'is due today' : date === tomorrow ? 'is due tomorrow' : null;
    if (!when) continue;
    out.push({ id: `bill:${rule.id}:${date}:${date < today ? 'late' : date === today ? 'today' : 'soon'}`, title: `${rule.note || 'A bill'} ${when}`, body: `${fmt(rule.amount, rule.currency)}. Paid it? Confirm it in the app so Safe to spend stays right.` });
  }
  const key = monthKey(today);
  for (const r of budgetStatus(state, key, today).rows) {
    if (r.level === 'over') out.push({ id: `budget:${r.category.id}:${key}:over`, title: `${r.category.name}: over the budget`, body: `${fmt(r.spent)} of ${fmt(r.budget)} this month.` });
    else if (r.level === 'near') out.push({ id: `budget:${r.category.id}:${key}:80`, title: `${r.category.name}: ${Math.round(r.pct * 100)}% of the budget used`, body: `${fmt(r.left)} left for the rest of the month.` });
  }
  const low = lowestPoint(state, today);
  if (low) out.push({ id: `low:${low.date}`, title: `Money runs low around ${shortDay(low.date)}`, body: `After the bills due by then, your cards and cash would be at about ${fmt(Math.round(low.left / 100) * 100)}.` });
  return out.slice(0, 8);
}
