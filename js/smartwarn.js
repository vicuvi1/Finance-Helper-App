// Smart warnings: things worth knowing, found in your own records. They show
// as steps in Home's "Do this next" (js/nextsteps.js) and the best one goes
// in the bot's morning message. Pure and tested (tests/smartwarn.test.js).
//   - a category running well ahead of a usual month
//   - a repeating payment that got more expensive
//   - two records that look like the same thing logged twice
//   - a subscription with several payments not logged (cancelled?)

import { monthKey, addMonths, daysInMonth, addDays } from './dates.js';
import { formatMoney } from './money.js';
import { countsAsSpending, signed } from './catshare.js';
import { B, category, isBillCategory } from './model.js';
import { dueItems } from './recurring.js';
import { isSubscription } from './subtable.js';

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Categories well ahead of a usual month (top first). */
export function categoryPace(state, today) {
  const key = monthKey(today);
  const d = Number(today.slice(8));
  const n = daysInMonth(key);
  if (d < 7) return [];
  const prev = [1, 2, 3].map((i) => addMonths(key, -i));
  const by = new Map(); // cat -> {now, months: {key: sum}}
  for (const t of state.tx || []) {
    if (!t.date || !countsAsSpending(t) || t.type !== 'expense' || t.recurring) continue;
    const mk = t.date.slice(0, 7);
    if (mk !== key && !prev.includes(mk)) continue;
    if (mk === key && t.date > today) continue;
    if (isBillCategory(state, t.category)) continue;
    const e = by.get(t.category) || { now: 0, months: {} };
    const v = signed(t, B(t));
    if (mk === key) e.now += v; else e.months[mk] = (e.months[mk] || 0) + v;
    by.set(t.category, e);
  }
  const out = [];
  for (const [cat, e] of by) {
    const months = Object.values(e.months).filter((v) => v > 0);
    if (months.length < 2) continue;
    const usual = months.reduce((a, b) => a + b, 0) / months.length;
    const byToday = (usual * d) / n;
    if (byToday <= 0 || e.now < byToday * 1.4 || e.now - byToday < 30000) continue;
    out.push({ cat, name: category(state, cat)?.name || 'Other', now: e.now, byToday: Math.round(byToday), usual: Math.round(usual), pct: Math.round((e.now / byToday - 1) * 100), daysLeft: n - d });
  }
  return out.sort((a, b) => b.now - b.byToday - (a.now - a.byToday));
}

/** Repeating payments whose last logged amount went up (in the last 45 days). */
export function priceRises(state, today) {
  const out = [];
  for (const r of state.recurring || []) {
    if (r.type !== 'expense') continue;
    const paid = (state.tx || []).filter((t) => t.recurring === r.id && t.currency === r.currency).sort((a, b) => a.date.localeCompare(b.date));
    if (paid.length < 2) continue;
    const [a, b] = paid.slice(-2);
    if (b.date < addDays(today, -45) || !(b.amount > a.amount * 1.05)) continue;
    out.push({ rule: r, from: a.amount, to: b.amount, currency: r.currency, date: b.date, name: r.note || 'A repeating payment' });
  }
  return out;
}

/** Pairs that look like the same thing logged twice (last 14 days). */
export function duplicates(state, today) {
  const from = addDays(today, -14);
  const list = (state.tx || []).filter((t) => t.type === 'expense' && t.date >= from && t.date <= today && !t.loan);
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.date !== b.date || a.amount !== b.amount || a.currency !== b.currency) continue;
      if (a.recurring && a.recurring === b.recurring) continue;
      const sameWhat = fold(a.note) && fold(a.note) === fold(b.note) ? true : !fold(a.note) && !fold(b.note) && a.category === b.category;
      if (!sameWhat) continue;
      if (state.settings?.notDuplicates?.[`${a.id}|${b.id}`] || state.settings?.notDuplicates?.[`${b.id}|${a.id}`]) continue;
      const later = (b.createdAt || 0) >= (a.createdAt || 0) ? b : a;
      if (seen.has(later.id)) continue;
      seen.add(later.id);
      out.push({ a, b, later });
    }
  }
  return out;
}

/** Subscriptions with 3 or more payments not logged: maybe cancelled. */
export function staleSubscriptions(state, today) {
  const due = dueItems(state, today);
  const out = [];
  for (const r of state.recurring || []) {
    if (r.paused || !isSubscription(state, r)) continue;
    const missed = due.filter((x) => x.rule.id === r.id).length;
    if (missed >= 3) out.push({ rule: r, missed, name: r.note || 'A subscription' });
  }
  return out;
}

/** All of them as Home steps ({id, level, icon, title, text, btn, act|go, data}), most useful first. */
export function smartSteps(state, today) {
  const cur = state.settings?.currency || 'MDL';
  const fmt = (c, x = cur) => formatMoney(Math.round(c / 100) * 100, x);
  const steps = [];
  for (const d of duplicates(state, today).slice(0, 2)) {
    steps.push({ id: `dup:${d.later.id}`, level: 'warn', icon: '👯', title: `Logged twice? ${formatMoney(d.a.amount, d.a.currency)}${d.a.note ? ` · ${d.a.note}` : ''}`, text: `Two records on the same day with the same amount${d.a.note ? ' and note' : ''}. Open the newer one to delete it if it's a repeat.`, btn: 'Open it', act: 'edit', data: { id: d.later.id } });
  }
  const pace = categoryPace(state, today)[0];
  if (pace) steps.push({ id: `catpace:${pace.cat}:${monthKey(today)}`, level: 'warn', icon: '📈', title: `${pace.name}: ${pace.pct}% more than usual`, text: `${fmt(pace.now)} so far; by this day of a usual month it's about ${fmt(pace.byToday)}. ${pace.daysLeft} day${pace.daysLeft === 1 ? '' : 's'} left.`, btn: 'See it', go: 'reports' });
  for (const p of priceRises(state, today).slice(0, 1)) {
    steps.push({ id: `rise:${p.rule.id}:${p.date}`, level: 'warn', icon: '💸', title: `${p.name} went up`, text: `From ${formatMoney(p.from, p.currency)} to ${formatMoney(p.to, p.currency)}. Still worth it? You can change or pause it in Plan → Subscriptions.`, btn: 'Check', go: 'plan' });
  }
  for (const s of staleSubscriptions(state, today).slice(0, 1)) {
    steps.push({ id: `stale:${s.rule.id}:${monthKey(today)}`, level: 'do', icon: '🧾', title: `${s.name}: ${s.missed} payments not logged`, text: 'Did you cancel it? Pause or delete it in Plan → Subscriptions, or log the payments.', btn: 'Check', go: 'plan' });
  }
  return steps;
}
