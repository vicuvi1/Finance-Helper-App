// One-line quick add on Money Home: "120 lunch", "45.5 coffee card",
// "3000 salary +" (+ = income), "-300 tech refund" (minus = money back).
// Pure: turns the text into the record it would save, with what was guessed
// (category from what you chose before, account by name) and what is missing.
// Nothing is stored here; screens/moneyb.js shows the preview and saves.

import * as M from './model.js';
import { suggest } from './learn.js';
import { evalAmount } from './money.js';
import { pairRate, rateToBase } from './fx.js';
import { findSourceByName, rememberedSource, sourceName, hasSources } from './incomesources.js';
import { addDays, isValidISO, dowIndex } from './dates.js';

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const CUR_WORDS = { usd: 'USD', eur: 'EUR', mdl: 'MDL', lei: 'MDL', leu: 'MDL', ron: 'RON', gbp: 'GBP', uah: 'UAH', rub: 'RUB', dollar: 'USD', dollars: 'USD', euro: 'EUR', euros: 'EUR' };
const SYMBOLS = { $: 'USD', '€': 'EUR', '£': 'GBP' };
const isAmountTok = (t) => /\d/.test(t) && /^[\d.,+\-*/x×÷()]+$/i.test(t);

const catsOf = (state, type) => (state.settings.categories || []).filter((c) => c.type === type && !c.archived);

/** The expense or income categories you can pick for a quick record. */
export const quickCategories = (state, kind) => catsOf(state, kind === 'income' ? 'income' : 'expense');

// A category named by a word you typed ("food", "tech"): its id, or a word of its name.
function nameMatch(state, words, type) {
  for (const w of words) {
    if (w.length < 3) continue;
    for (const c of catsOf(state, type)) {
      const name = fold(c.name).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      if (fold(c.id) === w || name.some((p) => p === w || (w.length >= 4 && p.startsWith(w)))) return c.id;
    }
  }
  return null;
}

// ---- Another day: "yesterday 120 lunch", "120 taxi 12 nov", "2 days ago 50 bread", "mon 80 gym" ----
const MON = [
  ['jan', 'january', 'ian', 'ianuarie'], ['feb', 'february', 'febr', 'februarie'], ['march', 'martie'],
  ['apr', 'april', 'aprilie'], ['may'], ['jun', 'june', 'iun', 'iunie'], ['jul', 'july', 'iul', 'iulie'],
  ['aug', 'august'], ['sep', 'sept', 'september', 'septembrie'], ['oct', 'october', 'octombrie'],
  ['nov', 'november', 'noiembrie'], ['dec', 'december', 'decembrie'],
];
const DOW = [['mon', 'monday', 'luni'], ['tue', 'tues', 'tuesday', 'marti'], ['wed', 'wednesday', 'miercuri'], ['thu', 'thur', 'thurs', 'thursday', 'joi'], ['fri', 'friday', 'vineri'], ['sat', 'saturday', 'sambata'], ['sun', 'sunday', 'duminica']];
const monthOf = (w) => { const f = fold(w).replace(/\.$/, ''); const i = MON.findIndex((n) => n.includes(f)); return i < 0 ? 0 : i + 1; };
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Takes a day out of quick-add text. Returns {text, date} where date is
 * 'YYYY-MM-DD' (or null when no day was typed). A day/month with no year that
 * would be in the future means last year (you remembered something you spent).
 * Weekdays mean the latest one, today included. Numbers like "12.5" stay amounts.
 */
export function takeDate(text, today) {
  let t = ` ${String(text ?? '')} `;
  let date = null;
  // The first match that reads as a day is taken out; anything else stays as typed.
  const cut = (re, fn) => {
    if (date) return;
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    t = t.replace(g, (...m) => { if (date) return m[0]; const d = fn(...m); if (!d) return m[0]; date = d; return ' '; });
  };
  cut(/\s(yesterday|ieri|вчера)(?=\s)/i, () => addDays(today, -1));
  cut(/\s(today|azi|astazi|сегодня)(?=\s)/i, () => today);
  cut(/\s(\d{1,2})\s+(days?|zile)\s+(ago|in urma)(?=\s)/i, (_, n) => (Number(n) <= 366 ? addDays(today, -Number(n)) : null));
  const dayMonth = (d, mw, y) => {
    const m = monthOf(mw);
    if (!m) return null;
    const thisYear = Number(today.slice(0, 4));
    let year = y ? Number(y.length === 2 ? `20${y}` : y) : thisYear;
    // "12 nov 4500 rent": 4500 is the amount, not a year. A year is one near today's.
    if (y && (year < thisYear - 10 || year > thisYear + 1)) return null;
    let iso = `${year}-${pad2(m)}-${pad2(Number(d))}`;
    if (!isValidISO(iso)) return null;
    if (!y && iso > today) { year -= 1; iso = `${year}-${pad2(m)}-${pad2(Number(d))}`; if (!isValidISO(iso)) return null; }
    return iso;
  };
  cut(/\s(\d{1,2})\s+([a-zăâîșț]{3,10}\.?)\s+(\d{4})(?=\s)/i, (_, d, mw, y) => dayMonth(d, mw, y));
  cut(/\s(\d{1,2})\s+([a-zăâîșț]{3,10}\.?)(?=\s)/i, (_, d, mw) => dayMonth(d, mw));
  cut(/\s([a-zăâîșț]{3,10}\.?)\s+(\d{1,2}),?\s+(\d{4})(?=\s)/i, (_, mw, d, y) => dayMonth(d, mw, y));
  cut(/\s([a-zăâîșț]{3,10}\.?)\s+(\d{1,2})(?=\s)/i, (_, mw, d) => dayMonth(d, mw));
  cut(/\s(\d{4}-\d{2}-\d{2})(?=\s)/, (_, iso) => (isValidISO(iso) ? iso : null));
  cut(/\s(?:on\s+|last\s+)?([a-zăâîșț]{3,9})(?=\s)/i, (_, w) => {
    const i = DOW.findIndex((n) => n.includes(fold(w)));
    if (i < 0) return null;
    return addDays(today, -((dowIndex(today) - i + 7) % 7));
  });
  return { text: t.replace(/\s+/g, ' ').trim(), date };
}

/**
 * @returns {{ ok: boolean, missing: string|null, kind: 'expense'|'income'|'refund'|null,
 *   amount?: number, currency?: string, category?: string, level?: string, account?: string,
 *   note?: string, tx?: object }}
 * `tx` is the record to save (without id and times) when ok.
 */
export function parseQuick(state, text, { catOverride = null, today } = {}) {
  const typed = String(text ?? '').trim();
  if (!typed) return { ok: false, missing: null, kind: null };
  // "yesterday", "12 nov", "2 days ago", "mon": the record goes on that day.
  const day = today ? takeDate(typed, today) : { text: typed, date: null };
  const raw = day.text;
  if (!raw) return { ok: false, missing: 'No amount yet. Start with a number, like "120 lunch".', kind: null };
  const base = state.settings.currency || 'MDL';
  const toks = raw.split(/\s+/);
  let income = false;
  let refund = false;
  let typedCur = null;
  const amounts = [];
  const words = [];
  const at = []; // "@job2": an income source
  for (let tok of toks) {
    if (/^@[^\s@]+$/.test(tok)) { at.push(tok); words.push(tok); continue; }
    if (tok === '+') { income = true; continue; }
    // "$45", "45$", "€12", "12eur"
    let m;
    if ((m = tok.match(/^([$€£])(.+)$/)) && isAmountTok(m[2])) { typedCur = SYMBOLS[m[1]]; tok = m[2]; }
    else if ((m = tok.match(/^(.+?)([$€£])$/)) && isAmountTok(m[1])) { typedCur = SYMBOLS[m[2]]; tok = m[1]; }
    else if ((m = tok.match(/^([\d.,]+)([a-z]{3,6})$/i)) && CUR_WORDS[m[2].toLowerCase()]) { typedCur = CUR_WORDS[m[2].toLowerCase()]; tok = m[1]; }
    if (SYMBOLS[tok]) { typedCur = SYMBOLS[tok]; continue; }
    const cw = CUR_WORDS[tok.toLowerCase()];
    if (cw && !isAmountTok(tok)) { typedCur = cw; continue; }
    if (isAmountTok(tok)) {
      let t = tok;
      let neg = false;
      let pos = false;
      if (/^-\d/.test(t) && !/[+*/x×÷()]/i.test(t.slice(1)) && !/\d-/.test(t)) { neg = true; t = t.slice(1); }
      else if (/^\+\d/.test(t) && !/[-*/x×÷()]/i.test(t.slice(1))) { pos = true; t = t.slice(1); }
      const v = evalAmount(t);
      if (v == null) { words.push(tok); continue; }
      amounts.push({ v, neg, pos });
      continue;
    }
    words.push(tok);
  }
  if (!amounts.length) return { ok: false, missing: 'No amount yet. Start with a number, like "120 lunch".', kind: null };
  if (amounts.length > 1) return { ok: false, missing: `Two amounts found (${amounts.map((a) => a.v / 100).join(' and ')}). Type just one.`, kind: null };
  const { v: amount, neg, pos } = amounts[0];
  if (!(amount > 0)) return { ok: false, missing: 'The amount must be bigger than 0.', kind: null };
  if (pos) income = true;
  if (neg) refund = true;
  if (income && refund) return { ok: false, missing: 'Pick one: income (+) or a refund (−).', kind: null };
  const kind = refund ? 'refund' : income ? 'income' : 'expense';
  const catType = kind === 'income' ? 'income' : 'expense';

  // "@job2" names an income source (Earned only); anywhere else it stays in the note.
  let source = null;
  if (kind === 'income' && at.length) {
    if (at.length > 1) return { ok: false, missing: 'Pick one source: type only one @name.', kind };
    source = findSourceByName(state, at[0]);
    if (!source) return { ok: false, missing: hasSources(state) ? `No income source called "${at[0]}". Create it in Settings → Income sources, or check the spelling.` : `No income source called "${at[0]}" yet. Create it in Settings → Income sources.`, kind };
    const i = words.indexOf(at[0]);
    if (i >= 0) words.splice(i, 1);
  }

  // An account named in the text ("card", "wallet"): its word leaves the note.
  const accounts = (M.activeAccounts(state).length ? M.activeAccounts(state) : state.settings.accounts);
  let named = null;
  const rest = [];
  for (const w of words) {
    const f = fold(w).replace(/[^\p{L}\p{N}]/gu, '');
    const a = !named && f.length >= 3 ? accounts.find((x) => fold(x.name).split(/\s+/).includes(f) || fold(x.id) === f) : null;
    if (a) named = a; else rest.push(w);
  }
  const note = rest.join(' ').trim();

  // Category: what you chose before for a note like this, else a category named in the text, else the app's keyword guess.
  const guessKw = note ? M.suggestCategory(state, note, catType) : null;
  const s = note ? suggest(state, { note, type: catType }, { guess: guessKw }) : null;
  let category = null;
  let level = 'none';
  if (catOverride && catsOf(state, catType).some((c) => c.id === catOverride)) { category = catOverride; level = 'chosen'; }
  else if (s?.category && s.why !== 'keyword') { category = s.category; level = s.level; }
  else {
    const byName = nameMatch(state, rest.map((w) => fold(w).replace(/[^\p{L}\p{N}]/gu, '')), catType);
    if (byName) { category = byName; level = 'name'; }
    else if (s?.category) { category = s.category; level = 'guess'; }
  }
  const finalCat = category || (catType === 'income' ? 'other-in' : 'other');

  // Account: named, else one in the typed currency, else the usual one for this category.
  const want = typedCur || base;
  let account = named || null;
  if (!account && typedCur && typedCur !== base) account = accounts.find((a) => (a.currency || base) === typedCur && !a.savings && a.kind !== 'crypto') || null;
  const acc = account || M.account(state, M.defaultAccount(state, catType, category)) || accounts[0];
  if (!acc) return { ok: false, missing: 'No account to put it in. Add one in Settings → Accounts.', kind };
  const accCur = acc.currency || base;
  let er = 1;
  if (want !== accCur) {
    er = pairRate(want, accCur, M.knownRates(state));
    if (!(er > 0)) return { ok: false, missing: `No exchange rate for ${want} yet (Accounts → Rates).`, kind, amount, currency: want };
  }
  const rate = rateToBase(state, accCur);
  if (!(rate > 0)) return { ok: false, missing: `No exchange rate for ${accCur} yet (Accounts → Rates).`, kind, amount, currency: want };
  const entry = M.entryAmounts(amount, want, accCur, er);
  // No @name typed: the source you used last for this note or category.
  const sourceId = source ? source.id : kind === 'income' ? rememberedSource(state, { category: finalCat, note }) : null;
  const tx = {
    type: kind === 'expense' ? 'expense' : 'income',
    amount: entry.amount,
    currency: accCur,
    date: day.date || today,
    note,
    account: acc.id,
    category: finalCat,
    rate,
    base: Math.round(entry.amount * rate),
    ...(entry.orig ? { orig: entry.orig } : {}),
    ...(kind === 'refund' ? { refund: true } : {}),
    ...(sourceId ? { incomeSource: sourceId } : {}),
    // A guess you did not pick is not your choice: the app must not learn from itself.
    ...(level === 'guess' || level === 'none' || level === 'name' ? { catBy: 'auto' } : {}),
  };
  return { ok: true, missing: null, kind, amount, currency: want, category: finalCat, level, account: acc.id, note, date: day.date || today, otherDay: !!day.date && day.date !== today, source: sourceId, sourceName: sourceId ? sourceName(state, sourceId) : '', tx };
}
