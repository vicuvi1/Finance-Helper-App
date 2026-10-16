// Home's first answer: one sentence on how you're doing, then up to three
// things worth doing today ("Do this next"). Pure and tested
// (tests/nextsteps.test.js); app.js renders them and handles the taps.
// A step is { id, icon, title, text, btn, act, data, level } — `id` names the
// exact thing (bill and date, invoice…), so "Later" hides only that one, and
// only until tomorrow.

import { personalMonth, savingsJar, mainGoal, goalStatus, accountBalances } from './model.js';
import { safeToSpend, limitStatus, suggestLimit, shortDay } from './safespend.js';
import { payStatus } from './payyourself.js';
import { dueItems, upcomingItems } from './recurring.js';
import { invoiceStatus, invoiceTotal } from './invoices.js';
import { rateAdvice, heldIn } from './fxsmart.js';
import { monthKey, addMonths, daysBetween, monthLabel, DOW_LONG, dowIndex } from './dates.js';
import { formatMoney } from './money.js';

const pctOf = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

// "A good month so far" + "You kept 62% of what came in · payday in 4 days · nothing due this week".
export function verdict(state, today) {
  const fmt = (c) => formatMoney(c, state.settings.currency);
  const key = monthKey(today);
  const p = personalMonth(state, key);
  const sf = safeToSpend(state, today);
  const goal = savingsJar(state)?.savings ? savingsJar(state).pct : null;
  const week = [...dueItems(state, today), ...upcomingItems(state, today, 7)].filter((x) => x.rule.type !== 'income');
  const parts = [];
  if (p.personalIncome > 0) parts.push(p.kept >= 0 ? `you kept ${pctOf(p.kept, p.personalIncome)}% of what came in` : `${fmt(-p.kept)} more went out than came in`);
  else if (p.personalSpent > 0) parts.push(`${fmt(p.personalSpent)} spent, nothing came in yet`);
  const toPay = daysBetween(today, sf.payday);
  if (sf.paydayFrom && toPay > 0) parts.push(toPay === 1 ? 'payday tomorrow' : `payday in ${toPay} days`);
  parts.push(week.length ? `${week.length} bill${week.length === 1 ? '' : 's'} this week` : 'nothing due this week');
  const sub = parts.join(' · ').replace(/^./, (c) => c.toUpperCase());

  let title;
  let tone = 'good';
  if (!state.tx.length) { title = 'Let\'s set up your month'; tone = 'calm'; }
  else if (sf.pool <= 0) { title = `Tight until ${shortDay(sf.payday)}`; tone = 'bad'; }
  else if (sf.limit && sf.limit.left < 0) { title = 'Over your limit this month'; tone = 'bad'; }
  else if (sf.leftToday < 0) { title = 'A bit over today'; tone = 'warn'; }
  else if (sf.limit && sf.limit.projected > sf.limit.amount) { title = 'Spending faster than your limit'; tone = 'warn'; }
  else if (p.personalIncome > 0 && p.kept < 0) { title = 'Spending more than came in'; tone = 'warn'; }
  else if (p.personalIncome > 0 && goal != null && pctOf(p.kept, p.personalIncome) >= goal) title = 'A good month so far';
  else if (p.personalIncome > 0) title = 'On track this month';
  else { title = 'Quiet so far this month'; tone = 'calm'; }
  return { title, sub, tone };
}

export function nextSteps(state, today, { hidden = {}, max = 3, demo = false } = {}) {
  const fmt = (c) => formatMoney(c, state.settings.currency);
  const key = monthKey(today);
  const out = [];
  const add = (s) => { if (hidden[s.id] !== today) out.push(s); };
  const sf = safeToSpend(state, today);

  // 1. This month's salary is due.
  const pay = payStatus(state, today);
  if (pay.on && pay.due) {
    add(pay.short
      ? { id: `pay:${key}`, level: 'bad', icon: '💼', title: 'Salary day, but the buffer is short', text: `It holds ${fmt(Math.max(0, pay.bufferBalance))}, the salary is ${fmt(pay.amount)}.`, btn: 'Change salary', act: 'pay-setup' }
      : { id: `pay:${key}`, level: 'do', icon: '💼', title: `Pay yourself ${fmt(pay.amount)}`, text: `This month's salary, from your buffer. It still covers ${Math.max(0, Math.floor(pay.runway * 10) / 10)} months.`, btn: 'Pay now', act: 'pay-now' });
  }

  // 2. Bills due (late first), then the ones due tomorrow.
  const bills = [...dueItems(state, today), ...upcomingItems(state, today, 1)].filter((x) => x.rule.type !== 'income');
  for (const { rule, date } of bills.slice(0, 2)) {
    const late = date < today;
    add({ id: `bill:${rule.id}:${date}`, level: late ? 'bad' : 'do', icon: '🔔', title: `${late ? 'Late: ' : ''}${rule.note || 'Bill'} ${formatMoney(rule.amount, rule.currency)}`,
      text: late ? `Was due ${shortDay(date)}. Paid it? Mark it so the numbers stay right.` : date === today ? 'Due today.' : 'Due tomorrow.',
      btn: 'Paid', act: 'rec-log', data: { id: rule.id, date } });
  }

  // 3. A client is late paying.
  for (const inv of (state.invoices || []).filter((i) => invoiceStatus(i, today) === 'overdue').slice(0, 1)) {
    const who = (state.people || []).find((p) => p.id === inv.client)?.name || 'A client';
    add({ id: `inv:${inv.id}`, level: 'do', icon: '🧾', title: `${who} owes you ${formatMoney(invoiceTotal(inv), inv.currency)}`,
      text: `${inv.number || 'Invoice'} was due ${shortDay(inv.due)}, ${daysBetween(inv.due, today)} days ago. A short reminder usually does it.`, btn: 'Open', go: 'people' });
  }

  // 4. Your spending limit: going too fast.
  const lim = limitStatus(state, today);
  if (lim && lim.left >= 0 && lim.projected > lim.amount) {
    add({ id: `pace:${key}`, level: 'warn', icon: '🚦', title: 'Slow down a little', text: `At this pace you'd spend ${fmt(lim.projected)} this month, over your ${fmt(lim.amount)} limit. Keep to ${fmt(lim.perDay)} a day and you're fine.`, btn: 'See limit', act: 'limit-setup' });
  }

  // 5. Savings plan not moved yet (without a salary from a buffer).
  if (sf.savingsLeft > 0 && Number(today.slice(8)) >= 3 && sf.liquid > sf.savingsLeft) {
    const jar = savingsJar(state);
    add({ id: `save:${key}`, level: 'do', icon: '🏦', title: `Move ${fmt(sf.savingsLeft)} to savings`, text: `What's left of this month's ${jar?.pct || ''}% plan. Moved money is safe from everyday spending.`, btn: 'Move it', act: 'step-save', data: { amount: sf.savingsLeft } });
  }

  // 6. Last month's recap (first week of the month).
  const prev = addMonths(key, -1);
  if (Number(today.slice(8)) <= 7 && !(state.meta?.recapSeen || {})[prev] && state.tx.some((t) => monthKey(t.date) === prev)) {
    add({ id: `recap:${prev}`, level: 'nice', icon: '✨', title: `Your ${monthLabel(prev).split(' ')[0]} recap is ready`, text: 'Where the money went, what went well, and one thing to try this month.', btn: 'Watch', act: 'recap-open', data: { key: prev } });
  }

  // 7. Nothing logged for a while.
  const last = state.tx.filter((t) => t.type !== 'transfer' && t.date <= today).map((t) => t.date).sort().at(-1);
  if (last && daysBetween(last, today) >= 3) {
    add({ id: `log:${today}`, level: 'do', icon: '✍️', title: `Nothing logged since ${DOW_LONG[dowIndex(last)]}`, text: 'Add what you spent since, so Safe to spend stays true.', btn: 'Add', act: 'add' });
  }

  // 8. A good day to change dollars.
  const usd = state.settings.currency !== 'USD' ? rateAdvice(state, 'USD', today) : null;
  const held = usd?.verdict === 'high' ? heldIn(state, 'USD', accountBalances(state)) : 0;
  if (held > 0) {
    add({ id: `usd:${today}`, level: 'nice', icon: '💵', title: 'Good day to change dollars', text: `1 USD = ${usd.rate.toFixed(2)} ${state.settings.currency}, higher than ${Math.round(usd.pct * 100)}% of the last 90 days. You hold ${formatMoney(held, 'USD')}.`, btn: 'Rates', go: 'rates' });
  }

  // 9. A goal is nearly there.
  const g = mainGoal(state);
  const gs = g?.target ? goalStatus(state, today, g) : null;
  if (gs && gs.ratio >= 0.9 && gs.remaining > 0) {
    add({ id: `goal:${g.id || 'main'}:${key}`, level: 'nice', icon: g.emoji || '🎯', title: `${g.name} is ${Math.floor(gs.ratio * 100)}% there`, text: `${fmt(gs.remaining)} to go. One more push.`, btn: 'Goals', go: 'goals' });
  }

  // 10. No limit yet, and enough history to suggest one.
  if (!lim) {
    const usual = suggestLimit(state, today);
    if (usual > 0) add({ id: 'limit:suggest', level: 'nice', icon: '🚦', title: 'Set a spending limit', text: `You usually spend about ${fmt(usual)} a month on everyday things. A limit turns it into a daily amount.`, btn: 'Set it', act: 'limit-setup' });
  }

  // 11. No backup for two weeks (the desktop app backs up by itself).
  const lastSafe = Math.max(state.meta?.lastBackup || 0, state.meta?.lastAutoBackup || 0, state.meta?.lastSync || 0);
  if (!demo && state.tx.length >= 20 && Date.now() - lastSafe > 14 * 864e5) {
    add({ id: `backup:${today}`, level: 'warn', icon: '💾', title: 'Make a backup', text: 'Your data lives only on this device. One file, kept somewhere safe.', btn: 'Back up', act: 'export-json' });
  }

  return out.slice(0, max);
}
