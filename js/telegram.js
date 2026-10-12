// Telegram bot, the app's side (pure, tested): turns a message like
// "coffee 35", "taxi 45 maib", "+500 salary" or "120+45 groceries" into a
// record, builds the quick-button keyboard and the bot's short replies.
// The desktop main process (electron/telegram.cjs) only moves messages.

import { evalAmount, formatMoney } from './money.js';
import { suggestCategory, sortTx, monthSummary, totalBalance, accountValues, jarStatus, budgetAlert, category, account, B } from './model.js';
import { monthKey, addMonths, addDays, MONTHS, DOW_SHORT, dowIndex } from './dates.js';
import { blockKeyboard } from './blocks.js';
import { dueItems, upcomingItems } from './recurring.js';
import { workText } from './workhours.js';
import { safeLine } from './safespend.js';

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
  // "coffee 35 yesterday": a day back.
  let daysAgo = 0;
  t = t.replace(/(^|\s)(yesterday|ieri|вчера)(?=\s|$)/i, () => { daysAgo = 1; return ' '; }).replace(/\s+/g, ' ').trim();
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
  return { type, amount, note, account: accountId, category: cat, ...(daysAgo ? { daysAgo } : {}) };
}

// The day a record belongs to: the day the message was sent, minus "yesterday".
export const recordDay = (sentDay, f) => (f?.daysAgo ? addDays(sentDay, -f.daysAgo) : sentDay);

// A full record from a Telegram message (its own id, so the same message
// is never logged twice) at the rate of the account's currency.
export function recordFromMessage(fields, { updateId, date, rate = 1, currency, now = Date.now() }) {
  return { id: `tg-${updateId}`, createdAt: now, updatedAt: now, type: fields.type, amount: fields.amount, currency, rate, base: Math.round(fields.amount * rate), date, category: fields.category, account: fields.account, note: fields.note, source: 'telegram' };
}

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const fm = (state, c) => esc(formatMoney(Math.round(c / 100) * 100, state.settings.currency));
const spentOn = (state, from, to) => state.tx.filter((t) => t.type === 'expense' && !t.loan && t.date >= from && t.date <= to).reduce((a, t) => a + B(t), 0);
const catName = (state, id) => { const c = category(state, id); return c ? `${c.emoji ? `${c.emoji} ` : ''}${c.name}` : 'Other'; };

// The reply to a logged record: what it was, then where you stand today and
// this month, and how its category is doing.
export function loggedText(state, t, today = null) {
  const c = category(state, t.category)?.name || '';
  const a = account(state, t.account)?.name || '';
  const sign = t.type === 'income' ? '+' : '−';
  const alert = budgetAlert(state, t);
  const work = t.type === 'expense' ? workText(state, B(t), t.date) : '';
  const lines = [`✅ <b>${sign}${esc(formatMoney(t.amount, t.currency))}</b> · ${esc(t.note || c)}`, `${esc(c)} · ${esc(a)}${t.date ? ` · ${dayShort(t.date)}` : ''}`];
  if (work) lines.push(`⏱ ${esc(work)} of your work`);
  if (t.type === 'expense' && t.date) {
    const key = monthKey(t.date);
    const catMonth = state.tx.filter((x) => x.type === 'expense' && !x.loan && x.category === t.category && monthKey(x.date) === key).reduce((s, x) => s + B(x), 0);
    lines.push(`\n📊 Spent that day: <b>${fm(state, spentOn(state, t.date, t.date))}</b> · month: ${fm(state, monthSummary(state, key).expense)}`);
    lines.push(`${esc(c || 'This category')} this month: ${fm(state, catMonth)}`);
  }
  if (alert) lines.push(`⚠️ ${esc(alert.text)}`);
  if (today && t.type === 'expense' && (state.recurring?.length || state.tx.length > 10)) lines.push(safeLine(state, today, (c) => fm(state, c)));
  return lines.join('\n');
}

const dayShort = (iso) => `${DOW_SHORT[dowIndex(iso)]} ${Number(iso.slice(8))}`;

export function todayText(state, today) {
  const list = state.tx.filter((t) => t.date === today && t.type !== 'transfer' && !t.loan);
  const out = list.filter((t) => t.type === 'expense').reduce((a, t) => a + B(t), 0);
  const inc = list.filter((t) => t.type === 'income').reduce((a, t) => a + B(t), 0);
  const s = monthSummary(state, monthKey(today));
  const cur = state.settings.currency;
  const lines = list.slice(-8).map((t) => `${t.type === 'income' ? '+' : '−'}${formatMoney(t.amount, t.currency)} · ${esc(t.note || category(state, t.category)?.name || '')}`);
  return `📊 <b>Today</b>: spent ${esc(formatMoney(out, cur))}${inc ? `, earned ${esc(formatMoney(inc, cur))}` : ''}\n${lines.join('\n') || 'Nothing logged yet.'}\n\nThis month: +${esc(formatMoney(s.income, cur))} / −${esc(formatMoney(s.expense, cur))}${state.tx.length ? `\n${safeLine(state, today, (c) => fm(state, c))}` : ''}`;
}

// All your money, then each account in its own currency.
export function balanceText(state) {
  const { total } = totalBalance(state);
  const rows = accountValues(state).filter((v) => !v.account.archived && (v.own || v.coins))
    .sort((a, b) => (b.inBase ?? 0) - (a.inBase ?? 0))
    .map((v) => `${v.account.savings || v.account.kind === 'savings' ? '🏦' : v.account.kind === 'cash' ? '💵' : v.account.kind === 'crypto' ? '🪙' : '💳'} ${esc(v.account.name)}: <b>${esc(formatMoney(v.own, v.account.currency || state.settings.currency))}</b>${v.coins && v.inBase != null ? ` (+coins ≈ ${fm(state, v.coins)})` : ''}`);
  return `💰 All my money: <b>${fm(state, total)}</b>${rows.length ? `\n\n${rows.join('\n')}` : ''}`;
}

// The month so far: totals, the same days of last month, top categories, jars.
export function monthText(state, today) {
  const key = monthKey(today);
  const s = monthSummary(state, key);
  const day = Number(today.slice(8));
  const prevKey = addMonths(key, -1);
  const prevSame = spentOn(state, `${prevKey}-01`, `${prevKey}-${String(day).padStart(2, '0')}`);
  const lines = [`📅 <b>${MONTHS[Number(key.slice(5)) - 1]}</b> so far (day ${day})`,
    `💚 Earned <b>+${fm(state, s.income)}</b>`, `💸 Spent <b>−${fm(state, s.expense)}</b>`,
    s.net >= 0 ? `🏦 Kept <b>${fm(state, s.net)}</b>${s.savingsRate != null ? ` (${Math.round(s.savingsRate * 100)}% of income)` : ''}` : `🔻 Spent <b>${fm(state, -s.net)}</b> more than you earned`];
  if (prevSame) {
    const ch = s.expense / prevSame - 1;
    lines.push(Math.abs(ch) < 0.05 ? '↔️ About the same as last month by this day' : ch < 0 ? `👍 ${Math.round(-ch * 100)}% less than last month by this day` : `👀 ${Math.round(ch * 100)}% more than last month by this day`);
  }
  if (s.expense) {
    lines.push('', '<b>Where it went</b>');
    for (const c of s.byCategory.slice(0, 6)) {
      const share = c.amount / s.expense;
      lines.push(`${esc(catName(state, c.id))} ${fm(state, c.amount)} · ${Math.round(share * 100)}%`);
    }
  }
  const over = jarStatus(state, key).filter((j) => !j.savings && j.budget && j.used > j.budget);
  if (over.length) lines.push('', ...over.map((j) => `⚠️ ${esc(j.jar.name)}: over by ${fm(state, j.used - j.budget)}`));
  return lines.join('\n');
}

// The last records, newest first.
export function lastText(state, n = 10) {
  const list = sortTx(state.tx).filter((t) => t.type !== 'transfer').slice(0, n);
  if (!list.length) return 'Nothing logged yet.';
  return `🧾 <b>Last ${list.length}</b>\n${list.map((t) => `${dayShort(t.date)} · ${t.type === 'income' ? '+' : '−'}${esc(formatMoney(t.amount, t.currency))} · ${esc(t.note || category(state, t.category)?.name || '')}`).join('\n')}`;
}

// What you sent while the app was closed, in one message once it opens.
export function catchUpText(state, list, today) {
  const rows = list.slice(0, 25).map((t) => `${dayShort(t.date)} · ${t.type === 'income' ? '+' : '−'}${esc(formatMoney(t.amount, t.currency))} · ${esc(t.note || category(state, t.category)?.name || '')}`);
  return `📥 <b>Synced ${list.length} record${list.length === 1 ? '' : 's'}</b> you sent while the app was closed:\n${rows.join('\n')}${list.length > 25 ? `\n…and ${list.length - 25} more` : ''}\n\n📊 Today: spent ${fm(state, spentOn(state, today, today))} · this month: ${fm(state, monthSummary(state, monthKey(today)).expense)}`;
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

// The buttons under the message box: your blocks (js/blocks.js) and helpers.
export const quickKeyboard = (state) => blockKeyboard(state);

export const HELP = `Tap a block below to log it for today, or type: <code>coffee 35</code>, <code>taxi 45 maib</code>, <code>120+45 groceries</code>. Income starts with +: <code>+500 salary</code>. Another day: <code>coffee 35 yesterday</code>.

📊 /today · 📅 /month · 💰 /balance · 🧾 /last · ↩️ /undo
🧱 /blocks: your buttons · <code>/addblock 🍕 Pizza 120</code> · <code>/delblock pizza</code>

PC off? Keep sending: your messages are kept and the app logs them, with the right day, when it opens.`;

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
