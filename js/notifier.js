// The standalone app's own notifications (inside Life System, Life sent them):
// subscriptions due soon (js/subtable.js), budget warnings at 80% / 100%, the salary watch (salary or an income source
// late or low), and the reality check reminder. At most 4 a day, each one
// once (per month, or per budget period). On the desktop they are the
// system's notifications (Electron, through window.desktop.notify); on the
// web the browser's Notification API when allowed; otherwise nothing (the
// cards on Home still show it all). With amounts hidden, a notice shows no
// amounts. `dueNotices` is pure (tests/notifier.test.js); `runNotices` sends.

import { budgetCrossings, newWarnings, thisMonthKeys, warningsOn } from './budgetwarn.js';
import { salaryStatus, sourceAlerts } from './salary.js';
import { checkupDue } from './checkup.js';
import { monthKey } from './dates.js';
import { formatMoney } from './money.js';
import { subscriptionNotices } from './subtable.js';

export const SENT_KEY = 'finance-helper.notices';
export const PER_DAY = 4;

/** What to send today: [{key, title, body}], plus the new remembered keys. `sent`: {day, count, keys}. */
export function dueNotices(state, today, sent = {}, { hidden = false } = {}) {
  if (!state || state._sealed || !Array.isArray(state.tx)) return { notices: [], sent };
  const month = monthKey(today);
  const keys = thisMonthKeys(sent.keys || [], month);
  const count = sent.day === today ? Number(sent.count) || 0 : 0;
  const cur = state.settings?.currency || 'MDL';
  const amt = (c) => (hidden ? '' : ` (${formatMoney(c, cur)})`);
  const out = []; // {key, title, body, remember: [keys]}
  // Subscriptions first (a date can't wait): due soon, today, late, or the card it's paid from is too low.
  for (const n of subscriptionNotices(state, today, { hidden, money: (c, cur) => formatMoney(c, cur, { reveal: true }) })) {
    const k = `${month}:${n.key}`;
    if (!keys.includes(k)) out.push({ key: n.key, remember: [k], title: n.title, body: n.body });
  }
  if (warningsOn(state)) {
    const { warn } = newWarnings(budgetCrossings(state, today), keys);
    for (const c of warn) {
      const one = newWarnings([c], keys).keys.filter((k) => !keys.includes(k));
      out.push({ key: `${c.cat}:${c.level}`, remember: one, title: c.level >= 100 ? `${c.name}: budget used up` : `${c.name}: 80% of the budget used`, body: c.level >= 100 ? `You have spent ${c.pct}% of this budget${amt(c.spent)}.` : `${c.pct}% spent so far${amt(c.spent)}. Slow down a little to stay inside it.` });
    }
  }
  const salary = salaryStatus(state, today);
  if (salary?.late && !keys.includes(`${month}:salary`)) {
    out.push({ key: 'salary', remember: [`${month}:salary`], title: 'Salary not in yet', body: `It was due on ${salary.dueDate}. Log it when it arrives, or check with your employer.` });
  }
  for (const w of sourceAlerts(state, today)) {
    const k = `${month}:source:${w.source.id}`;
    if (keys.includes(k)) continue;
    out.push({ key: k, remember: [k], title: w.status === 'late' ? `${w.source.name}: payment late` : `${w.source.name}: less than usual`, body: w.status === 'late' ? `Expected around ${w.payDate}${amt(w.expected)}; nothing logged yet.` : `Got${amt(w.received)} of the usual${amt(w.expected)}.` });
  }
  // The reality check (js/checkup.js): one notice when it is due, one reminder 2 days later if skipped.
  const chk = checkupDue(state, today);
  if (chk) {
    const k = `${month}:checkup:${chk.cycle || chk.due}${chk.overdue ? ':late' : ''}`;
    const n = chk.left.length;
    if (!keys.includes(k)) out.push({ key: 'checkup', remember: [k], title: chk.overdue ? 'Reality check still waiting' : 'Reality check', body: `Compare ${n} account${n === 1 ? '' : 's'} with your bank (a minute). Money shows what could explain a difference.` });
  }
  // At most PER_DAY a day; one that doesn't fit today is not remembered, so it comes tomorrow.
  const notices = out.slice(0, Math.max(0, PER_DAY - count));
  const kept = [...new Set([...keys, ...notices.flatMap((n) => n.remember)])];
  return { notices: notices.map(({ key, title, body }) => ({ key, title, body })), sent: { day: today, count: count + notices.length, keys: kept } };
}

/** Sends one notice the best way this device has. Returns true when shown. */
export async function show(title, body) {
  try {
    if (typeof window !== 'undefined' && window.desktop?.notify) return !!(await window.desktop.notify(title, body));
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted') return false;
    new Notification(title, { body, icon: 'icons/icon-192.png' });
    return true;
  } catch { return false; }
}

/** Checks and sends what is due (call on start, after changes, and now and then). */
export async function runNotices(state, today, { store = globalThis.localStorage, hidden = false } = {}) {
  let sent = {};
  try { sent = JSON.parse(store?.getItem(SENT_KEY) || '{}') || {}; } catch { sent = {}; }
  const r = dueNotices(state, today, sent, { hidden });
  for (const n of r.notices) await show(n.title, n.body);
  try { store?.setItem(SENT_KEY, JSON.stringify(r.sent)); } catch { /* private window */ }
  return r.notices;
}
