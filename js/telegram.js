// Telegram bot, the app's side (pure, tested): turns a message like
// "coffee 35", "taxi 45 maib", "+500 salary" or "120+45 groceries" into a
// record, builds the quick-button keyboard and the bot's short replies.
// The desktop main process (electron/telegram.cjs) only moves messages.

import { evalAmount, formatMoney } from './money.js';
import { suggestCategory, sortTx, monthSummary, totalBalance, quickPicks, budgetAlert, category, account, B } from './model.js';
import { monthKey } from './dates.js';
import { dueItems, upcomingItems } from './recurring.js';

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const INCOME_WORDS = /^(\+|got|earned|income|salary|salariu|venit|primit|зарплата|получил|доход)$/;
// Emoji and symbols the quick buttons start with.
const stripIcons = (s) => s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').trim();

// Accounts can be named in the message: "taxi 45 maib virtual", "lunch 120 cash".
function findAccount(state, words) {
  const accs = state.settings.accounts.filter((a) => !a.archived);
  let best = null;
  for (const a of accs) {
    for (const name of [a.name, a.bank, a.kind === 'cash' ? 'cash' : null].filter(Boolean)) {
      const n = fold(name);
      if (n.length < 3) continue;
      const hit = words.join(' ').includes(n);
      if (hit && (!best || n.length > best.len)) best = { id: a.id, len: n.length, name: n };
    }
  }
  return best;
}

// Text -> record fields, or null when there's no amount in it.
export function parseQuick(text, state) {
  let t = stripIcons(String(text || '')).replace(/\s+/g, ' ').trim();
  if (!t || t.startsWith('/')) return null;
  let type = 'expense';
  if (/^\+/.test(t)) { type = 'income'; t = t.slice(1).trim(); }
  // The amount: the first run of digits and + - * / ( ) with , or .
  const m = t.match(/(^|\s)(\(?\d[\d\s.,]*(?:[+\-*/x×]\s*\(?\d[\d.,]*\)?)*\)?)(?=\s|$|[a-zа-яăâîșț$€]|lei|mdl)/i);
  if (!m) return null;
  const amount = evalAmount(m[2].replace(/\s+/g, ''));
  if (!amount || amount <= 0) return null;
  let rest = `${t.slice(0, m.index)} ${t.slice(m.index + m[0].length)}`.replace(/\b(lei|mdl)\b/gi, '').replace(/\s+/g, ' ').trim();
  let words = fold(rest).split(' ').filter(Boolean);
  if (words.length && INCOME_WORDS.test(words[0]) && words[0] !== 'salary' && words[0] !== 'salariu' && words[0] !== 'зарплата') {
    type = 'income';
    words = words.slice(1);
    rest = rest.split(' ').slice(1).join(' ');
  }
  if (words.some((w) => ['salary', 'salariu', 'зарплата'].includes(w))) type = 'income';
  const acc = findAccount(state, words);
  let note = rest;
  if (acc) note = rest.replace(new RegExp(acc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').replace(/\s+/g, ' ').trim();
  // No account named: the one you used last for this note, else your last one.
  const recent = sortTx(state.tx).filter((x) => x.type !== 'transfer');
  const same = recent.find((x) => fold(x.note) === fold(note) && account(state, x.account) && !account(state, x.account).archived);
  const accountId = acc?.id || same?.account || recent[0]?.account || state.settings.accounts[0]?.id;
  const cat = suggestCategory(state, note, type) || (type === 'income' ? 'other-in' : 'other');
  return { type, amount, note, account: accountId, category: cat };
}

// A full record from a Telegram message (its own id, so the same message
// is never logged twice) at the rate of the account's currency.
export function recordFromMessage(fields, { updateId, date, rate = 1, currency, now = Date.now() }) {
  return { id: `tg-${updateId}`, createdAt: now, updatedAt: now, type: fields.type, amount: fields.amount, currency, rate, base: Math.round(fields.amount * rate), date, category: fields.category, account: fields.account, note: fields.note, source: 'telegram' };
}

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function loggedText(state, t) {
  const c = category(state, t.category)?.name || '';
  const a = account(state, t.account)?.name || '';
  const sign = t.type === 'income' ? '+' : '−';
  const alert = budgetAlert(state, t);
  return `✅ <b>${sign}${esc(formatMoney(t.amount, t.currency))}</b> · ${esc(t.note || c)}\n${esc(c)} · ${esc(a)}${alert ? `\n⚠️ ${esc(alert.text)}` : ''}`;
}

export function todayText(state, today) {
  const list = state.tx.filter((t) => t.date === today && t.type !== 'transfer' && !t.loan);
  const out = list.filter((t) => t.type === 'expense').reduce((a, t) => a + B(t), 0);
  const inc = list.filter((t) => t.type === 'income').reduce((a, t) => a + B(t), 0);
  const s = monthSummary(state, monthKey(today));
  const cur = state.settings.currency;
  const lines = list.slice(-8).map((t) => `${t.type === 'income' ? '+' : '−'}${formatMoney(t.amount, t.currency)} · ${esc(t.note || category(state, t.category)?.name || '')}`);
  return `📊 <b>Today</b>: spent ${esc(formatMoney(out, cur))}${inc ? `, earned ${esc(formatMoney(inc, cur))}` : ''}\n${lines.join('\n') || 'Nothing logged yet.'}\n\nThis month: +${esc(formatMoney(s.income, cur))} / −${esc(formatMoney(s.expense, cur))}`;
}

export function balanceText(state) {
  const { total } = totalBalance(state);
  return `💰 All my money: <b>${esc(formatMoney(Math.round(total / 100) * 100, state.settings.currency))}</b>`;
}

// The evening nudge.
export function reminderText(state, today) {
  const n = state.tx.filter((t) => t.date === today).length;
  return n ? `🌙 Anything else today? You logged ${n} record${n === 1 ? '' : 's'}.\n\n${todayText(state, today)}` : '🌙 Time to log today\'s spending. Tap a button or type e.g. <code>coffee 35</code>.';
}

// Bills due today or tomorrow (once a day, in the morning).
export function billsText(state, today) {
  const due = [...dueItems(state, today), ...upcomingItems(state, today, 1)];
  if (!due.length) return null;
  return `🔔 <b>Coming up</b>\n${due.map(({ rule, date }) => `${date < today ? 'Overdue' : date === today ? 'Today' : 'Tomorrow'} · ${esc(rule.note || 'payment')} ${rule.type === 'income' ? '+' : '−'}${esc(formatMoney(rule.amount, rule.currency))}`).join('\n')}`;
}

// The buttons under the message box: your quick picks and two helpers.
export function quickKeyboard(state, today) {
  const picks = quickPicks(state, today, 8).filter((p) => p.type === 'expense' || p.type === 'income');
  const btn = (p) => `${p.type === 'income' ? '+' : ''}${p.note || category(state, p.category)?.name || 'record'} ${String(p.amount / 100).replace('.', ',')}`;
  const rows = [];
  for (let i = 0; i < picks.length; i += 2) rows.push(picks.slice(i, i + 2).map((p) => ({ text: btn(p) })));
  rows.push([{ text: '📊 Today' }, { text: '💰 Balance' }, { text: '↩️ Undo' }]);
  return { keyboard: rows, resize_keyboard: true, is_persistent: true, input_field_placeholder: 'e.g. coffee 35' };
}

export const HELP = 'Send what you spent, like <code>coffee 35</code>, <code>taxi 45 maib</code> or <code>120+45 groceries</code>. Income starts with +: <code>+500 salary</code>. Buttons below log your usual things in one tap.\n\n/today · /balance · /undo';

// ---------- Weekly ritual ----------

const pct = (r) => `${Math.round(r * 100)}%`;

// Sunday evening: the week in a few lines.
export function weeklyText(state, r) {
  const cur = state.settings.currency;
  const f = (c) => esc(formatMoney(Math.round(c / 100) * 100, cur));
  const lines = [`🗓 <b>Your week</b> (${r.from.slice(8)}.${r.from.slice(5, 7)}–${r.to.slice(8)}.${r.to.slice(5, 7)})`];
  if (r.kept != null) lines.push(`${r.kept * 100 >= r.target ? '🏆' : '🎯'} Kept <b>${pct(Math.max(0, r.kept))}</b> of income (goal ${r.target}%)`);
  lines.push(`💸 Spent <b>${f(r.expense)}</b>${r.usual ? ` · ${r.change > 0.05 ? `${pct(r.change)} more than` : r.change < -0.05 ? `${pct(-r.change)} less than` : 'about'} a usual week (${f(r.usual)})` : ''}`);
  if (r.leak) lines.push(`🕳 Biggest leak: <b>${esc(category(state, r.leak.category)?.name || 'Other')}</b> ${f(r.leak.amount)}${r.leak.usual != null ? ` (usually ${f(r.leak.usual)})` : ''}`);
  lines.push(r.streak >= 2 ? `🔥 ${r.streak}-day logging streak` : '✍️ Log every day this week, even 5 lei');
  const grade = r.kept == null ? null : r.kept * 100 >= r.target && (r.change == null || r.change <= 0.1) ? 'Great week. Keep this rhythm!' : r.kept > 0 ? 'Not bad. Next week: a bit less on the leak above.' : 'Tough week. A fresh start on Monday 💪';
  if (grade) lines.push(`\n${grade}`);
  if (r.other.length) lines.push(`\n${r.other.length} record${r.other.length === 1 ? '' : 's'} still in "Other". Tap to file ${r.other.length === 1 ? 'it' : 'them'} 👇`);
  return lines.join('\n');
}

// One message per uncategorised record, with category buttons.
export function fixMessage(state, t) {
  const used = {};
  for (const x of state.tx) if (x.type === 'expense' && x.category !== 'other') used[x.category] = (used[x.category] || 0) + 1;
  const cats = state.settings.categories.filter((c) => c.type === 'expense' && c.id !== 'other').sort((a, b) => (used[b.id] || 0) - (used[a.id] || 0)).slice(0, 8);
  const rows = [];
  for (let i = 0; i < cats.length; i += 2) rows.push(cats.slice(i, i + 2).map((c) => ({ text: `${c.emoji || ''} ${c.name}`.trim(), callback_data: `cat:${t.id}:${c.id}` })));
  return { text: `❔ <b>${esc(t.note)}</b> · −${esc(formatMoney(t.amount, t.currency))} · ${t.date.slice(8)}.${t.date.slice(5, 7)}`, extra: { reply_markup: { inline_keyboard: rows } } };
}

export const cashQuestion = (accName) => `👛 <b>Cash check</b>: how much is in your <b>${esc(accName)}</b> right now? Just send the number, e.g. <code>1240</code>.`;

export function cashAnswer(state, r, accName) {
  const cur = state.settings.currency;
  if (!r.diff) return `✅ ${esc(accName)} matches exactly. Perfect tracking! 🏆`;
  return r.diff < 0
    ? `👛 ${esc(accName)} has ${esc(formatMoney(-r.diff, cur))} less than logged. I added it as <b>untracked cash</b>, so your balance is true again. Try logging cash right away next week 😉`
    : `👛 ${esc(accName)} has ${esc(formatMoney(r.diff, cur))} more than logged. I added it as <b>found cash</b>.`;
}
