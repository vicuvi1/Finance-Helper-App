// Home's first answer: one sentence on how you're doing, then up to three
// things worth doing today ("Do this next"). Pure and tested
// (tests/nextsteps.test.js); app.js renders them and handles the taps.
// A step is { id, icon, title, text, btn, act, data, level } — `id` names the
// exact thing (bill and date, invoice…), so "Later" hides only that one, and
// only until tomorrow.

import { personalMonth, savingsJar, mainGoal, goalStatus, accountBalances } from './model.js';
import { safeToSpend, limitStatus, suggestLimit, shortDay } from './safespend.js';
import { payStatus } from './payyourself.js';
import { spendingIds, spentFrom } from './forecast.js';
import { dueItems, upcomingItems } from './recurring.js';
import { invoiceStatus, invoiceTotal } from './invoices.js';
import { rateAdvice, heldIn } from './fxsmart.js';
import { monthKey, addMonths, daysBetween, monthLabel, DOW_LONG, dowIndex } from './dates.js';
import { formatMoney } from './money.js';
import { smartSteps } from './smartwarn.js';
import { monthToClose } from './closemonth.js';
import { toCheck } from './tocheck.js';
import { nameGroups } from './shopnames.js';
import { budgetAutoOn } from './budgetauto.js';
import { isDue as checkinDue, checkinData } from './checkin.js';
import { suggestBudgets } from './budgetsuggest.js';

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
  else if (sf.pool <= 0) { title = `Bills and savings first until ${shortDay(sf.payday)}`; tone = 'warn'; }
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

  // 0. Once: check which accounts count as spending money, when the app had
  // to guess (business money left out, a wallet marked as savings counted).
  if (!(Array.isArray(state.settings.spendFrom) && state.settings.spendFrom.length)) {
    const accs = state.settings.accounts.filter((a) => !a.archived);
    const ids = spendingIds(state, today);
    const bal = accountBalances(state);
    const biz = accs.filter((a) => a.kind === 'business' && (bal[a.id] || 0) > 0 && !ids.has(a.id));
    const guessed = spentFrom(state, today).map((x) => accs.find((a) => a.id === x.id)).filter((a) => a && ids.has(a.id) && (a.savings || a.kind === 'savings'));
    if (biz.length || guessed.length) {
      const names = accs.filter((a) => ids.has(a.id)).map((a) => a.name);
      add({ id: 'spend:check', level: 'do', icon: '👛', title: 'Check your spending money',
        text: `Safe to spend counts ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}.${biz.length ? ` ${biz.map((a) => a.name).join(', ')} is work money, so it's left out.` : ''}`,
        btn: 'Check', act: 'spend-setup' });
    }
  }

  // 1. This month's salary is due.
  const pay = payStatus(state, today);
  if (pay.on && pay.due) {
    add(pay.short
      ? { id: `pay:${key}`, level: 'bad', icon: '💼', title: 'Salary day, but the buffer is short', text: `It holds ${fmt(Math.max(0, pay.bufferBalance))}, the salary is ${fmt(pay.amount)}.`, btn: 'Change salary', act: 'pay-setup' }
      : { id: `pay:${key}`, level: 'do', icon: '💼', title: `Pay yourself ${fmt(pay.amount)}`, text: `This month's salary, from your buffer. It still covers ${Math.max(0, Math.floor(pay.runway * 10) / 10)} months.`, btn: 'Pay now', act: 'pay-now' });
  }

  // 2. Bills due today and tomorrow. Late ones (not marked paid) are on Home's "To confirm" card
  // with Confirm / Skip, so they aren't said twice.
  const bills = [...dueItems(state, today).filter((x) => x.date >= today), ...upcomingItems(state, today, 1)].filter((x) => x.rule.type !== 'income');
  for (const { rule, date } of bills.slice(0, 2)) {
    const late = date < today;
    add({ id: `bill:${rule.id}:${date}`, level: late ? 'bad' : 'do', icon: '🔔', title: `${late ? 'Late: ' : ''}${rule.note || 'Bill'} ${formatMoney(rule.amount, rule.currency)}`,
      text: late ? `Was due ${shortDay(date)}. Paid it? Mark it so the numbers stay right.` : date === today ? 'Due today.' : 'Due tomorrow.',
      btn: 'Paid', act: 'rec-log', data: { id: rule.id, date } });
  }

  // 2b. Client money mixed with your spending money: pay yourself a salary.
  if (!pay.on && pay.suggest?.amount > 0 && !state.meta?.payHide) {
    const bal = accountBalances(state);
    const biz = state.settings.accounts.find((a) => !a.archived && a.kind === 'business' && (bal[a.id] || 0) > 0);
    add({ id: 'pay:invite', level: 'nice', icon: '💸', title: `Pay yourself ${fmt(pay.suggest.amount)} a month`,
      text: `Client money comes in lumps. Keep it${biz ? ` in ${biz.name}` : ' in one account'} and move yourself a fixed salary: every month looks the same, and you see how long you'd be fine without clients.`,
      btn: 'Set it up', act: 'pay-setup' });
  }

  // 2c. Payments that came in by themselves (phone): one look, right category and card?
  const check = toCheck(state);
  if (check.length) add({ id: `tocheck:${check.length}`, level: 'do', icon: '📲', title: `${check.length} payment${check.length === 1 ? '' : 's'} to check`, text: `Recorded by themselves from your phone${check[0].note ? ` (latest: ${check[0].note})` : ''}. Right category and card? One tap each.`, btn: 'Check', act: 'tocheck-open' });

  // 2f. The same shop written several ways ("LINELLA SRL 123", "Linella"): one name each.
  const shops = nameGroups(state);
  if (shops.length) add({ id: `shops:${shops.length}`, level: 'nice', icon: '🏷️', title: `${shops.length} shop${shops.length === 1 ? '' : 's'} written different ways`, text: `${shops[0].variants.slice(0, 3).map((v) => `"${v.note}"`).join(', ')}… One name each, so reports group them right.`, btn: 'Tidy', act: 'shops-open' });

  // 2e. The 10-minute Sunday check-in (Saturday to Monday, until done).
  if (checkinDue(state, today)) {
    const d = checkinData(state, today);
    add({ id: `checkin:${d.week}`, level: 'nice', icon: '☕', title: 'Your 10-minute week check-in', text: d.todo ? `Your week in one number, then ${d.todo} thing${d.todo === 1 ? '' : 's'} to tidy and what's coming next week.` : 'Your week in one number, and what\'s coming next week. Nothing to tidy.', btn: 'Start', act: 'checkin-open' });
  }

  // 2d. Budgets that set themselves: what changed this month (once), or the offer to turn it on.
  const ba = state.settings.budgetAutoLast;
  if (budgetAutoOn(state) && ba?.month === key && ba.changes?.length && state.meta?.budgetAutoSeen !== key) {
    const list = ba.changes.slice(0, 3).map((c) => `${c.name} ${fmt(c.to)}`).join(', ');
    add({ id: `budgetauto:${key}`, level: 'nice', icon: '🔄', title: `Budgets for ${monthLabel(key).split(' ')[0]} are set`, text: `From your last 3 months: ${list}${ba.changes.length > 3 ? ` and ${ba.changes.length - 3} more` : ''}.`, btn: 'See them', act: 'budget-auto-seen', alt: { btn: 'Put the old ones back', act: 'budget-auto-undo' } });
  } else if (!budgetAutoOn(state) && !state.settings.categories.some((c) => c.budget > 0) && Number(today.slice(8)) <= 10) {
    const sug = suggestBudgets(state, today);
    if (sug.length >= 3) add({ id: `budgetoffer:${key}`, level: 'nice', icon: '🎯', title: 'Budgets that set themselves', text: `Each category gets the average of your last 3 months (e.g. ${sug[0].name} ${fmt(sug[0].suggested)}), updated on the 1st. You get a warning at 80%.`, btn: 'Turn on', act: 'budget-auto-on' });
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
  // 4a. Close last month (days 1–15, until it is checked).
  const toClose = monthToClose(state, today);
  if (toClose) add({ id: `close:${toClose}`, level: 'do', icon: '✅', title: `Close ${monthLabel(toClose).split(' ')[0]} in 5 minutes`, text: 'Check the accounts, file what is in Other, look at subscriptions, see the recap. Then the month is marked as checked.', btn: 'Start', act: 'cm-open', data: { key: toClose } });
  // 4b. Smart warnings (js/smartwarn.js): logged twice, a category well ahead of usual, a price rise, a forgotten subscription.
  for (const w of smartSteps(state, today)) add(w);


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
