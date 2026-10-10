// Search across all months (Log → search box). Plain words must all match
// the note, category, account, bank, person or currency; extras:
//   >1000  <50  >=200  <=80     amount limits (in your currency)
//   100-500                     amount between
//   35                          that exact amount (or "35" in a note)
//   march  mar 2025  2026       a month and/or year
//   today  yesterday            a day
//   spent  earned  moves        a type
// Pure; app.js shows the results and the summary.

import { addDays } from './dates.js';

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const MONTH_WORDS = [
  ['january', 'jan', 'ianuarie', 'январь', 'января'],
  ['february', 'feb', 'februarie', 'февраль', 'февраля'],
  ['march', 'mar', 'martie', 'март', 'марта'],
  ['april', 'apr', 'aprilie', 'апрель', 'апреля'],
  ['may', 'mai', 'май', 'мая'],
  ['june', 'jun', 'iunie', 'июнь', 'июня'],
  ['july', 'jul', 'iulie', 'июль', 'июля'],
  ['august', 'aug', 'august', 'август', 'августа'],
  ['september', 'sep', 'sept', 'septembrie', 'сентябрь', 'сентября'],
  ['october', 'oct', 'octombrie', 'октябрь', 'октября'],
  ['november', 'nov', 'noiembrie', 'ноябрь', 'ноября'],
  ['december', 'dec', 'decembrie', 'декабрь', 'декабря'],
];
const TYPE_WORDS = {
  spent: 'expense', spend: 'expense', expense: 'expense', expenses: 'expense',
  earned: 'income', income: 'income',
  moves: 'transfer', move: 'transfer', transfer: 'transfer', transfers: 'transfer',
};
const num = (s) => {
  const v = Number(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? Math.round(v * 100) : null;
};

export function parseQuery(q) {
  const out = { words: [], min: null, max: null, exact: null, months: [], year: null, day: null, type: null };
  // Join "1 000" into "1000", "> 1000" into ">1000", "100 - 500" into "100-500".
  const text = fold(q).replace(/(\d)[\s\u00a0](?=\d{3}(?!\d))/g, '$1').replace(/([<>]=?)\s+(?=\d)/g, '$1').replace(/(\d)\s*-\s*(\d)/g, '$1-$2').trim();
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    let m;
    if ((m = tok.match(/^(>=?|<=?)(\d+(?:[.,]\d+)?)$/))) {
      const v = num(m[2]);
      if (m[1] === '>') out.min = v + 1;
      else if (m[1] === '>=') out.min = v;
      else if (m[1] === '<') out.max = v - 1;
      else out.max = v;
    } else if ((m = tok.match(/^(\d+(?:[.,]\d+)?)-(\d+(?:[.,]\d+)?)$/))) {
      out.min = num(m[1]);
      out.max = num(m[2]);
    } else if (/^(19|20)\d\d$/.test(tok)) out.year = tok;
    else if (/^\d+(?:[.,]\d+)?$/.test(tok)) out.exact = { cents: num(tok), text: tok };
    else if (tok === 'today' || tok === 'azi' || tok === 'сегодня') out.day = 0;
    else if (tok === 'yesterday' || tok === 'ieri' || tok === 'вчера') out.day = -1;
    else if (TYPE_WORDS[tok] && !out.type) out.type = TYPE_WORDS[tok];
    else {
      const mi = MONTH_WORDS.findIndex((names) => names.includes(tok));
      if (mi >= 0) out.months.push(mi + 1);
      else out.words.push(tok);
    }
  }
  return out;
}

// Everything a word can match on a record.
function haystack(state, t) {
  const name = (arr, id) => arr.find((x) => x.id === id);
  const parts = [t.note, t.currency, t.personName];
  if (t.category) parts.push(name(state.settings.categories, t.category)?.name);
  for (const id of [t.account, t.from, t.to]) {
    const a = id && name(state.settings.accounts, id);
    if (a) parts.push(a.name, a.bank);
  }
  if (t.person) parts.push(name(state.people, t.person)?.name);
  return fold(parts.filter(Boolean).join(' '));
}

export function searchTx(state, query, today) {
  const q = typeof query === 'string' ? parseQuery(query) : query;
  const day = q.day == null ? null : addDays(today, q.day);
  return state.tx.filter((t) => {
    if (q.type && t.type !== q.type) return false;
    if (day && t.date !== day) return false;
    if (q.year && !t.date.startsWith(q.year)) return false;
    if (q.months.length && !q.months.includes(Number(t.date.slice(5, 7)))) return false;
    // Amounts are compared in the record's own currency, as you see them.
    if (q.min != null && t.amount < q.min) return false;
    if (q.max != null && t.amount > q.max) return false;
    const hay = q.words.length || q.exact ? haystack(state, t) : '';
    if (q.exact && Math.floor(t.amount / 100) * 100 !== q.exact.cents && t.amount !== q.exact.cents && !hay.includes(q.exact.text)) return false;
    return q.words.every((w) => hay.includes(w));
  });
}

// Totals for the result line: how many, spent / earned, first and last date,
// in how many months.
export function searchSummary(list, base = (t) => t.base ?? t.amount) {
  const real = list.filter((t) => !t.loan);
  const spent = real.filter((t) => t.type === 'expense').reduce((a, t) => a + base(t), 0);
  const earned = real.filter((t) => t.type === 'income').reduce((a, t) => a + base(t), 0);
  const dates = list.map((t) => t.date).sort();
  return {
    count: list.length,
    spent,
    earned,
    first: dates[0] || null,
    last: dates.at(-1) || null,
    months: new Set(dates.map((d) => d.slice(0, 7))).size,
  };
}

export const SEARCH_HINT = 'coffee · maib · >1000 · 50-200 · march 2026 · earned · today';
