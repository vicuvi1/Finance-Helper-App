// Ask about your money: a local parser over your own records. It understands
// plain English questions about amounts, categories and months:
//   "how much on food in October?"   "biggest expense this month"
//   "how much did I earn in 2026"    "average spending per day last month"
// and answers with the number plus the records behind it (and a search to open
// the Log filtered to them). Pure: the clock is passed in. Refunds lower
// spending (catshare.signed). Nothing is sent anywhere.

import { B } from './model.js';
import { addDays, daysBetween, daysInMonth, monthLabel, monthKey } from './dates.js';
import { countsAsSpending, countsAsIncome, signed, isRefund } from './catshare.js';
import { formatMoney } from './money.js';
import { shortDay } from './safespend.js';
import { sourceInText } from './incomesources.js';
import { linesOf } from './splits.js';

export const CANT = 'I can answer questions about amounts, categories and months.';

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthIdx = (w) => {
  const i = MONTHS.findIndex((m) => m === w || (w.length === 3 && m.startsWith(w)) || (w === 'sept' && m === 'september'));
  return i;
};
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (key) => `${key}-${pad(daysInMonth(key))}`;

// Words that say nothing to filter by.
const STOP = new Set(('how much many did do does i we my me our the a an of on in for at to from by with and or is was were are be been had have has what whats which '
  + 'total sum spent spend spending spends expense expenses cost costs paid pay earn earned earning earnings income made make received get got '
  + 'biggest largest highest top most expensive average avg daily per day days month months monthly year this last current all money so far '
  + 'week today yesterday during between between show tell give list records record transactions did overall altogether '
  + 'lei mdl usd eur it that').split(' '));

/** The period named in the question, or null. `rest` is the text without it. */
function readPeriod(q, today) {
  const cur = monthKey(today);
  const y = Number(today.slice(0, 4));
  const cm = Number(today.slice(5, 7));
  let s = q;
  const take = (re) => { const m = s.match(re); if (m) s = s.replace(re, ' '); return m; };
  let m;
  if ((m = take(/\b(yesterday)\b/))) { const d = addDays(today, -1); return { from: d, to: d, label: 'yesterday', days: 1, rest: s }; }
  if ((m = take(/\b(today)\b/))) return { from: today, to: today, label: 'today', days: 1, rest: s };
  if ((m = take(/\blast month\b/))) { const k = addMonthsKey(cur, -1); return { from: `${k}-01`, to: lastDay(k), label: 'last month', days: daysInMonth(k), months: 1, rest: s }; }
  if ((m = take(/\b(this|current) month\b/))) return { from: `${cur}-01`, to: today, label: 'this month', days: Number(today.slice(8)), months: 1, rest: s };
  if ((m = take(/\blast year\b/))) return yearPeriod(y - 1, today, 'last year', s);
  if ((m = take(/\b(this|current) year\b/))) return yearPeriod(y, today, 'this year', s);
  if ((m = take(/\bthis week\b/))) { const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; const from = addDays(today, -dow); return { from, to: today, label: 'this week', days: dow + 1, rest: s }; }
  // "october 2025", "in oct", "2026"
  const words = s.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const mi = monthIdx(words[i]);
    if (mi < 0) continue;
    // "may" is also a verb: only a month after in/of/for/during or before a year.
    if (words[i] === 'may' && !(/^(in|of|for|during)$/.test(words[i - 1] || '') || /^\d{4}$/.test(words[i + 1] || ''))) continue;
    let yr = null;
    let used = 1;
    if (/^\d{4}$/.test(words[i + 1] || '')) { yr = Number(words[i + 1]); used = 2; }
    if (yr == null) yr = mi + 1 > cm ? y - 1 : y;
    const k = `${yr}-${pad(mi + 1)}`;
    words.splice(i, used);
    const isCur = k === cur;
    return { from: `${k}-01`, to: isCur ? today : lastDay(k), label: `in ${monthLabel(k)}`, days: isCur ? Number(today.slice(8)) : daysInMonth(k), months: 1, rest: words.join(' ') };
  }
  if ((m = take(/\b(?:in|during|for|of)?\s*(20\d{2})\b/))) return yearPeriod(Number(m[1]), today, `in ${m[1]}`, s);
  return null;
}
function addMonthsKey(key, n) {
  const [yy, mm] = key.split('-').map(Number);
  const idx = yy * 12 + (mm - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}
function yearPeriod(yr, today, label, rest) {
  const thisYear = Number(today.slice(0, 4));
  const to = yr === thisYear ? today : yr > thisYear ? today : `${yr}-12-31`;
  const from = `${yr}-01-01`;
  const months = yr === thisYear ? Number(today.slice(5, 7)) : 12;
  return { from, to, label, days: daysBetween(from, to) + 1, months, rest };
}

const catWords = (c) => fold(c.name).split(/[^\p{L}\p{N}]+/u).filter((p) => p.length >= 3);
const wordMatches = (w, p) => p === w || (w.length >= 4 && (p.startsWith(w) || w.startsWith(p) && p.length >= 4));

/** @returns {{ ok: boolean, text: string, kind?: string, value?: number, headline?: string, detail?: string, txs?: object[], search?: string }} */
export function askMoney(state, question, today) {
  const base = state.settings.currency || 'MDL';
  const no = { ok: false, text: CANT };
  let q = fold(question).replace(/[?!.,;:()"]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return no;
  const kindWord = /\b(biggest|largest|highest|most expensive|top)\b/.test(q) ? 'biggest'
    : /\b(average|avg|on average)\b|\bper (day|month)\b|\ba (day|month)\b|\bdaily\b|\bmonthly\b/.test(q) ? 'avg'
      : /\bhow many\b/.test(q) ? 'count'
        : /\b(how much|total|sum|spent|spend|spending|earn|earned|earning|earnings|income|expenses?|cost|paid|made|received)\b/.test(q) ? 'sum' : null;
  if (!kindWord) return no;
  // "how much from Job 2 this year": an income source of yours (it is always about Earned money).
  const type = sourceInText(state, q) || /\b(earn|earned|earning|earnings|income|incomes|made|salary|received)\b/.test(q) ? 'income' : 'expense';
  const perMonth = kindWord === 'avg' && /\b(per month|a month|monthly)\b/.test(q) && !/\b(per day|a day|daily)\b/.test(q);

  const per = readPeriod(q, today) || { from: `${monthKey(today)}-01`, to: today, label: 'this month', days: Number(today.slice(8)), months: 1, rest: q, assumed: true };
  const src = type === 'income' ? sourceInText(state, per.rest) : null;
  const words = (src ? src.rest : per.rest).split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w));

  const lines = linesOf(state); // a split record answers per line (js/splits.js)
  const inScope = lines.filter((t) => (type === 'income' ? countsAsIncome(t) : countsAsSpending(t)) && t.date >= per.from && t.date <= per.to);

  // Content words: a category (or subcategory) of yours, else a word in the notes; anything else is a question we can't answer.
  const cats = new Set();
  const subs = new Set();
  const noteWords = [];
  const catRows = (state.settings.categories || []).filter((c) => c.type === type);
  const subRows = state.settings.subcats || [];
  const catLabels = [];
  for (const w of words) {
    const w1 = w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w;
    const c = catRows.find((x) => x.id === w || catWords(x).some((p) => wordMatches(w, p) || wordMatches(w1, p)));
    const sc = !c && subRows.find((x) => !x.archived && catRows.some((r) => r.id === x.parent) && fold(x.name).split(/[^\p{L}\p{N}]+/u).some((p) => p.length >= 3 && wordMatches(w, p)));
    if (c) { cats.add(c.id); catLabels.push(c.name); }
    else if (sc) { subs.add(sc.id); catLabels.push(sc.name); }
    else if (inScope.length === 0 ? false : lines.some((t) => fold(t.note).includes(w))) noteWords.push(w);
    else return no;
  }

  const list = inScope.filter((t) => {
    if (src && t.incomeSource !== src.source.id) return false;
    if (cats.size || subs.size) {
      if (!(cats.has(t.category) || subs.has(t.sub))) return false;
    }
    const n = fold(t.note);
    return noteWords.every((w) => n.includes(w));
  });
  const amt = (t) => (type === 'income' ? B(t) : signed(t, B(t)));
  const total = list.reduce((a, t) => a + amt(t), 0);
  const what = type === 'income' ? 'Earned' : 'Spent';
  const scope = [src ? `from ${src.source.name}` : '', catLabels.length ? `on ${[...new Set(catLabels)].join(' and ')}` : '', noteWords.length ? `at ${noteWords.join(' ')}` : ''].filter(Boolean).join(' ');
  const where = `${scope ? `${scope} ` : ''}${per.label}`;
  const fm = (c) => formatMoney(Math.round(c), base);

  const searchParts = [];
  for (const id of cats) searchParts.push(`cat:${id}`);
  for (const id of subs) { const s = subRows.find((x) => x.id === id); if (s) searchParts.push(`sub:${fold(s.name).split(/\s+/)[0]}`); }
  if (!cats.size && !subs.size) searchParts.push(type === 'income' ? 'earned' : 'spent');
  if (src) searchParts.push(`source:"${src.source.name}"`);
  searchParts.push(...noteWords, `from:${per.from}`, `to:${per.to}`);
  const search = searchParts.join(' ');
  const byDate = [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const assumed = per.assumed ? ' (no period named, so this month)' : '';

  if (kindWord === 'biggest') {
    const real = list.filter((t) => !isRefund(t));
    if (!real.length) return { ok: true, kind: 'biggest', value: 0, headline: fm(0), detail: `No ${type === 'income' ? 'income' : 'expenses'} ${where}${assumed}.`, txs: [], search, text: '' };
    const top = [...real].sort((a, b) => B(b) - B(a));
    const t = top[0];
    return { ok: true, kind: 'biggest', value: B(t), headline: fm(B(t)), detail: `Biggest ${type === 'income' ? 'income' : 'expense'} ${where}: ${t.note || 'no note'}, ${shortDay(t.date)}${assumed}.`, txs: top.slice(0, 5), search, text: '' };
  }
  if (kindWord === 'count') {
    return { ok: true, kind: 'count', value: list.length, headline: String(list.length), detail: `Records ${where}${assumed}.`, txs: byDate.slice(0, 6), search, text: '' };
  }
  if (kindWord === 'avg') {
    const n = perMonth ? Math.max(1, per.months || 1) : Math.max(1, per.days);
    const unit = perMonth ? 'month' : 'day';
    const avg = total / n;
    return { ok: true, kind: 'avg', value: Math.round(avg), headline: `${fm(avg)} / ${unit}`, detail: `Average ${type === 'income' ? 'income' : 'spending'} per ${unit} ${where}: ${fm(total)} over ${n} ${unit}${n === 1 ? '' : 's'}${assumed}.`, txs: byDate.slice(0, 6), search, text: '' };
  }
  return { ok: true, kind: 'sum', value: Math.round(total), headline: fm(total), detail: `${what} ${where}, ${list.length} record${list.length === 1 ? '' : 's'}${assumed}.`, txs: byDate.slice(0, 6), search, count: list.length, text: '' };
}
