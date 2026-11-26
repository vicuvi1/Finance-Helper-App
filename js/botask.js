// The bot understands questions in plain words, no AI: English, plus common Romanian and Russian.
//   "food this month", "how much on taxi in October", "linella last month", "and last month?",
//   "can I afford 3000", "what's left today", "when is rent", "where did my money go this week",
//   "how much did I earn this month".
// Several records in one message ("lunch 120, taxi 45, coffee 30") and reminders ("remind me to pay
// internet on the 27th") are read here too. Pure and tested (tests/botask.test.js); the server bot
// (api/_tgbot.mjs) uses it and keeps the last question so a follow-up ("and taxi?") works.

import { addDays, addMonths, monthKey, daysInMonth, dowIndex, monthLabel, MONTH_NAMES } from './dates.js';
import { countsAsSpending, countsAsIncome, signed } from './catshare.js';
import { B, category } from './model.js';
import { formatMoney } from './money.js';
import { safeLine, shortDay } from './safespend.js';
import { affordCheck } from './afford.js';
import { upcomingItems } from './recurring.js';
import { evalAmount } from './money.js';

export const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ё/g, 'е');
const esc = (v) => String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Russian "in October" is "в октябре": the stems of each month.
const RU_STEMS = ['январ', 'феврал', 'март', 'апрел', 'ма[йяе]', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const monthIndex = (word) => {
  const w = fold(word);
  const i = MONTH_NAMES.findIndex((names) => names.some((n) => fold(n) === w));
  if (i >= 0) return i;
  return RU_STEMS.findIndex((st) => new RegExp(`^${st}`).test(w));
};

const PERIODS = [
  { re: /(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(today|azi|astazi)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))|сегодня/u, get: (t) => ({ from: t, to: t, label: 'today' }) },
  { re: /(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(yesterday|ieri)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))|вчера/u, get: (t) => ({ from: addDays(t, -1), to: addDays(t, -1), label: 'yesterday' }) },
  { re: /(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(this week|saptamana (asta|aceasta|curenta))(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))|(на )?этой неделе/u, get: (t) => ({ from: addDays(t, -dowIndex(t)), to: t, label: 'this week' }) },
  { re: /(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(last week|saptamana trecuta)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))|(на )?прошлой неделе/u, get: (t) => { const m = addDays(t, -dowIndex(t) - 7); return { from: m, to: addDays(m, 6), label: 'last week' }; } },
  { re: /(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(last month|luna trecuta)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))|(в )?прошлом месяце/u, get: (t) => { const k = addMonths(monthKey(t), -1); return { from: `${k}-01`, to: `${k}-${daysInMonth(k)}`, label: monthLabel(k) }; } },
  { re: /(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(this year|anul (asta|acesta|curent))(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))|(в )?этом году/u, get: (t) => ({ from: `${t.slice(0, 4)}-01-01`, to: t, label: t.slice(0, 4) }) },
  { re: /(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(last year|anul trecut)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))|(в )?прошлом году/u, get: (t) => { const y = Number(t.slice(0, 4)) - 1; return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) }; } },
  { re: /(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(this month|luna (asta|aceasta|curenta))(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))|(в )?этом месяце/u, get: (t) => ({ from: `${monthKey(t)}-01`, to: t, label: 'this month' }) },
];

/** The period a question is about, and the text with it taken out. Default: this month. */
export function readPeriod(text, today) {
  let t = fold(text);
  for (const p of PERIODS) {
    if (p.re.test(t)) return { ...p.get(today), rest: t.replace(p.re, ' ') };
  }
  // "since October", "din octombrie", "с октября"
  let m = t.match(/(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(since|din|de la|с)\s+(\p{L}+)/u);
  if (m && monthIndex(m[2]) >= 0) {
    const i = monthIndex(m[2]);
    let y = Number(today.slice(0, 4));
    if (`${y}-${String(i + 1).padStart(2, '0')}` > monthKey(today)) y--;
    return { from: `${y}-${String(i + 1).padStart(2, '0')}-01`, to: today, label: `since ${monthLabel(`${y}-${String(i + 1).padStart(2, '0')}`)}`, rest: t.replace(m[0], ' ') };
  }
  // "in October (2025)", "in octombrie", "в октябре", or just "october"
  m = t.match(/(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(?:in|în|в)?\s*(\p{L}+)(?:\s+(20\d\d))?\s*\??$/u) || t.match(/(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(?:in|в)\s+(\p{L}+)(?:\s+(20\d\d))?/u);
  if (m && monthIndex(m[1]) >= 0) {
    const i = monthIndex(m[1]);
    let y = m[2] ? Number(m[2]) : Number(today.slice(0, 4));
    let key = `${y}-${String(i + 1).padStart(2, '0')}`;
    if (!m[2] && key > monthKey(today)) { y--; key = `${y}-${String(i + 1).padStart(2, '0')}`; }
    return { from: `${key}-01`, to: key === monthKey(today) ? today : `${key}-${daysInMonth(key)}`, label: monthLabel(key), rest: t.replace(m[0], ' ') };
  }
  return { from: `${monthKey(today)}-01`, to: today, label: 'this month', rest: t, assumed: true };
}

const FILLER = /(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(how|much|many|did|do|i|we|my|our|on|for|at|in|the|spend|spent|spending|cost|costs|pay|paid|buy|bought|what|whats|was|is|are|a|an|so|far|total|money|cat|cati|cate|am|ai|cheltuit|pe|la|in|de|pentru|bani|sau|si|and|сколько|я|мы|на|потратил|потратила|потратили|ушло|за|в|и|а|денег)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))|[?!.,:;'"]/gu;

/** What the question is about: a category, a subcategory, a shop/note, or everything. */
export function readSubject(state, rest) {
  const words = fold(rest).replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  if (!words) return { kind: 'all', label: 'everything' };
  const cats = (state.settings?.categories || []).filter((c) => !c.archived);
  const byName = cats.find((c) => fold(c.name) === words) || cats.find((c) => words.length >= 3 && fold(c.name).split(/[\s&,]+/).some((w) => w.length >= 3 && (w.startsWith(words) || words.startsWith(w))));
  if (byName) return { kind: 'category', id: byName.id, label: byName.name, type: byName.type || 'expense' };
  const subs = state.settings?.subcats || [];
  const sub = subs.find((s) => fold(s.name) === words || (words.length >= 3 && fold(s.name).startsWith(words)));
  if (sub) return { kind: 'sub', id: sub.id, label: sub.name, words };
  return { kind: 'note', words, label: `"${words}"` };
}

const matches = (state, t, subj) => {
  if (subj.kind === 'all') return true;
  if (subj.kind === 'category') return t.category === subj.id;
  // A subcategory, or a record without one whose note says it ("taxi home").
  if (subj.kind === 'sub') return t.sub === subj.id || (!t.sub && fold(t.note).includes(subj.words));
  return fold(t.note).includes(subj.words) || fold(category(state, t.category)?.name).includes(subj.words);
};

/** Total spent (or earned) on a subject in a period, with the count and the biggest one. */
export function totalFor(state, subj, per, { income = false } = {}) {
  const list = (state.tx || []).filter((t) => t.date >= per.from && t.date <= per.to && (income ? countsAsIncome(t) && t.type === 'income' : countsAsSpending(t)) && matches(state, t, subj));
  const sum = list.reduce((a, t) => a + (income ? B(t) : signed(t, B(t))), 0);
  const biggest = list.filter((t) => t.type !== 'income' || income).sort((a, b) => B(b) - B(a))[0] || null;
  return { sum, count: list.length, biggest };
}

const QWORDS = /^(how|what|whats|when|where|can|could|is|are|do|did|cat|cati|cand|unde|pot|сколько|когда|куда|можно|могу|что|где)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))/u;
const FOLLOW = /^(and|but|si|iar|а|и)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))/u;

const WB = String.raw`(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))`;
// Words that only ever start a question. The other question words also start records
// ("cat food 120", "is 300 gas", "can of paint 80"), as do "and 50 taxi" / "si 30 cafea".
const STRONG = new RegExp(`^(how|what|whats|when|where|cati|cand|unde|сколько|когда|куда|что|где)${WB}`, 'u');
const ASKS = new RegExp(`${WB}(afford|imi permit|pot sa cumpar|ramas|left|safe|remind|aminteste|напомни)${WB}|могу (ли )?(себе )?позволить|могу купить`, 'u');
const YEAR = new RegExp(`${WB}20\\d\\d${WB}`, 'gu');
const IN_MONTH = new RegExp(`${WB}(?:in|din|since|de la|в|с)\\s+(\\p{L}+)`, 'gu');

/**
 * Does the message ask something (rather than log a record)?
 * With an amount and no "?" it is a record, unless it starts with a word that only asks ("how much is 20…").
 * Without an amount: a question word, a follow-up ("and taxi"), or a time ("food this month", "taxi in October").
 */
export function isQuestion(text) {
  const t = fold(text).trim();
  if (!t || t.startsWith('/')) return false;
  if (/\?\s*$/.test(t) || ASKS.test(t)) return true;
  // Years like 2025 are not an amount.
  const amount = /\d/.test(t.replace(YEAR, ''));
  if (amount) return STRONG.test(t);
  if (QWORDS.test(t) || FOLLOW.test(t)) return true;
  if (PERIODS.some((p) => p.re.test(t))) return true;
  return [...t.matchAll(IN_MONTH)].some((m) => monthIndex(m[1]) >= 0);
}

/**
 * Answers a question: {text (HTML), ctx} or null when it isn't one it understands.
 * `prev`: the last question's {subject, period} (for "and last month?", "and taxi?").
 */
export function answer(state, text, today, prev = null) {
  const cur = state.settings?.currency || 'MDL';
  const fm = (c) => esc(formatMoney(Math.round(c / 100) * 100, cur));
  const t = fold(text).trim();

  // "can I afford 3000"
  const aff = t.match(/(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(afford|permit|imi permit|pot sa cumpar|могу (ли )?(себе )?позволить|могу купить)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))\D*(\d[\d\s.,+]*)/u);
  if (aff) {
    const price = evalAmount(aff[aff.length - 1].replace(/\s/g, ''));
    if (price > 0) {
      const r = affordCheck(state, today, { price });
      const icon = r.tone === 'ok' ? '✅' : r.tone === 'warn' ? '🟡' : '🔴';
      return { text: `${icon} <b>${esc(r.verdict)}</b> for ${fm(price)}.${r.after ? `\nSafe to spend after it: ${fm(Math.max(0, r.after.leftToday))} today.` : ''}`, ctx: prev };
    }
  }
  // "what's left today", "how much can I spend"
  if (/(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(left|ramas|ramane|safe|can i spend|pot cheltui)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))|остал|можно потратить/u.test(t)) {
    return { text: safeLine(state, today, (c) => fm(c)), ctx: prev };
  }
  // "when is rent", "next netflix"
  const when = t.match(/^(when|cand|когда)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(?:\s+(?:is|do i pay|e|este|платить|плачу))?\s*(?:the|my)?\s*(.+?)\??$/u) || t.match(/^next\s+(.+?)\??$/);
  if (when) {
    const what = fold((when[2] ?? when[1]).replace(/(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(due|paid|payment|plata|платеж)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))/gu, '')).trim();
    const up = upcomingItems(state, today, 400).find((x) => fold(x.rule.note).includes(what) || fold(category(state, x.rule.category)?.name).includes(what));
    if (up) return { text: `📅 <b>${esc(up.rule.note || 'It')}</b>: ${esc(formatMoney(up.rule.amount, up.rule.currency))} on <b>${esc(shortDay(up.date))}</b>.`, ctx: prev };
    if (/^(bills|what|ce)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))/u.test(what)) {
      const next = upcomingItems(state, today, 14).filter((x) => x.rule.type === 'expense').slice(0, 5);
      return { text: next.length ? `📅 Next 2 weeks:\n${next.map((x) => `• ${esc(shortDay(x.date))}: ${esc(x.rule.note || 'Bill')} ${esc(formatMoney(x.rule.amount, x.rule.currency))}`).join('\n')}` : 'No bills in the next 2 weeks. 👌', ctx: prev };
    }
    return { text: `🤔 I don't see a repeating payment called "${esc(what)}". Plan → Subscriptions lists them.`, ctx: prev };
  }

  if (!isQuestion(text)) return null;
  const follow = FOLLOW.test(t);
  const per0 = readPeriod(follow ? t.replace(FOLLOW, '') : t, today);
  const income = /(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(earn|earned|income|venit|castigat|incasat)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))|заработ|доход|получил/u.test(t);
  let per = per0;
  let subj = readSubject(state, per0.rest.replace(FOLLOW, '').replace(/(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(earn|earned|income|venit|castigat|incasat)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))|заработ\S*|доход\S*|получил\S*/gu, ' '));
  // A follow-up keeps what it doesn't say again: "and last month?" keeps the subject; "and taxi?" keeps the period.
  if (follow && prev) {
    if (subj.kind === 'all' && prev.subject) subj = prev.subject;
    if (per0.assumed && prev.period) per = prev.period;
  }
  // "where did my money go", "top", "biggest"
  if (/(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(where|unde|top|biggest|most|cel mai mult)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))|куда|больше всего/u.test(t) && subj.kind !== 'category') {
    const by = new Map();
    for (const x of (state.tx || []).filter((r) => r.date >= per.from && r.date <= per.to && countsAsSpending(r))) by.set(x.category, (by.get(x.category) || 0) + signed(x, B(x)));
    const total = [...by.values()].reduce((a, b) => a + b, 0);
    const top = [...by.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (!top.length) return { text: `Nothing spent ${esc(per.label)}.`, ctx: { subject: null, period: per } };
    return { text: `🧭 <b>Where it went</b> (${esc(per.label)}, ${fm(total)}):\n${top.map(([id, v]) => `• ${esc(category(state, id)?.name || 'Other')}: ${fm(v)} (${Math.round((v / total) * 100)}%)`).join('\n')}`, ctx: { subject: null, period: per } };
  }
  const r = totalFor(state, subj, per, { income });
  const what = subj.kind === 'all' ? (income ? 'Earned' : 'Spent') : `${income ? 'Earned from' : 'On'} ${esc(subj.label)}`;
  if (!r.count) return { text: `${what}, ${esc(per.label)}: nothing${subj.kind === 'note' ? `. (I looked for "${esc(subj.words)}" in notes and categories.)` : '.'}`, ctx: { subject: subj, period: per } };
  // Against the month before, for a month or "this month".
  let vs = '';
  if (per.from.endsWith('-01') && per.from.slice(0, 7) === per.to.slice(0, 7)) {
    const pk = addMonths(per.from.slice(0, 7), -1);
    const day = Number(per.to.slice(8));
    const before = totalFor(state, subj, { from: `${pk}-01`, to: `${pk}-${String(Math.min(day, daysInMonth(pk))).padStart(2, '0')}` }, { income }).sum;
    if (before > 0) {
      const ch = (r.sum - before) / before;
      vs = Math.abs(ch) < 0.05 ? ' · about the same as the month before' : ` · ${Math.round(Math.abs(ch) * 100)}% ${ch > 0 ? 'more' : 'less'} than ${per.assumed || per.label === 'this month' ? 'by this day last month' : 'the month before'}`;
    }
  }
  const big = r.biggest && r.count > 1 ? `\nBiggest: ${esc(r.biggest.note || category(state, r.biggest.category)?.name || '')} ${fm(B(r.biggest))} (${esc(shortDay(r.biggest.date))})` : '';
  return { text: `${income ? '💰' : '💸'} ${what}, ${esc(per.label)}: <b>${fm(r.sum)}</b> in ${r.count} record${r.count === 1 ? '' : 's'}${vs}.${big}`, ctx: { subject: subj, period: per } };
}

/** "lunch 120, taxi 45; coffee 30" → ['lunch 120', 'taxi 45', 'coffee 30'] when each part has an amount (else null). */
export function splitRecords(text) {
  const parts = String(text || '').split(/;|\n|,\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 15) return null;
  return parts.every((p) => /\d/.test(p)) ? parts : null;
}

const DOW_WORDS = [['monday', 'mon', 'luni', 'понедельник'], ['tuesday', 'tue', 'marti', 'вторник'], ['wednesday', 'wed', 'miercuri', 'среда', 'среду'], ['thursday', 'thu', 'joi', 'четверг'], ['friday', 'fri', 'vineri', 'пятница', 'пятницу'], ['saturday', 'sat', 'sambata', 'суббота', 'субботу'], ['sunday', 'sun', 'duminica', 'воскресенье']];

/** "remind me to pay internet on the 27th" → {text: 'pay internet', date} (null when it isn't a reminder). */
export function readReminder(text, today) {
  const raw = String(text || '').trim();
  const t = fold(raw);
  const m = t.match(/^(?:\/remind|remind me|aminteste-mi|aminteste mi|напомни( мне)?)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))\s*(?:to|sa|să|că|ca)?\s*(.+)$/u);
  if (!m) return null;
  let body = m[m.length - 1];
  let date = null;
  const take = (re, fn) => { if (date) return; const x = body.match(re); if (x) { date = fn(x); body = body.replace(x[0], ' '); } };
  take(/(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(tomorrow|maine)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))|завтра/u, () => addDays(today, 1));
  take(/(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(today|azi)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))|сегодня/u, () => today);
  take(/(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))in (\d{1,3}) days?(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))|(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))peste (\d{1,3}) zile(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))|через (\d{1,3}) дн\S*/u, (x) => addDays(today, Number(x[1] || x[2] || x[3])));
  take(/(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(?:on the |on |pe |la )?(\d{1,2})(?:st|nd|rd|th|-?го)?\s+(\p{L}+)(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))/u, (x) => {
    const i = monthIndex(x[2]);
    if (i < 0) return null;
    // A day the month doesn't have ("30 feb") is its last day, never a date that doesn't exist.
    const on = (y) => { const k = `${y}-${String(i + 1).padStart(2, '0')}`; return `${k}-${String(Math.min(Math.max(1, Number(x[1])), daysInMonth(k))).padStart(2, '0')}`; };
    const y = Number(today.slice(0, 4));
    return on(y) < today ? on(y + 1) : on(y);
  });
  take(/(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))(?:on the |on |pe |la )(\d{1,2})(?:st|nd|rd|th)?(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))|(\d{1,2})-?го(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))/u, (x) => {
    const n = Math.min(Number(x[1] || x[2]), 31);
    let k = monthKey(today);
    if (n < Number(today.slice(8))) k = addMonths(k, 1);
    return `${k}-${String(Math.min(n, daysInMonth(k))).padStart(2, '0')}`;
  });
  for (let i = 0; i < 7 && !date; i++) {
    const w = DOW_WORDS[i].find((n) => new RegExp(`(?<![\\p{L}])(on |pe |в )?${n}(?![\\p{L}])`, 'u').test(body));
    if (w) {
      let d = addDays(today, 1);
      while (dowIndex(d) !== i) d = addDays(d, 1);
      date = d;
      body = body.replace(new RegExp(`(?<![\\p{L}])(on |pe |в )?${w}(?![\\p{L}])`, 'u'), ' ');
    }
  }
  if (!date) date = addDays(today, 1);
  // Keep the person's own words (not folded) for the reminder text where possible.
  const words = body.replace(/\s+/g, ' ').trim();
  const i = fold(raw).indexOf(words);
  const textOut = i >= 0 ? raw.slice(i, i + words.length) : words;
  return words ? { text: textOut, date } : null;
}
