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

/**
 * @returns {{ ok: boolean, missing: string|null, kind: 'expense'|'income'|'refund'|null,
 *   amount?: number, currency?: string, category?: string, level?: string, account?: string,
 *   note?: string, tx?: object }}
 * `tx` is the record to save (without id and times) when ok.
 */
export function parseQuick(state, text, { catOverride = null, today } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, missing: null, kind: null };
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
    date: today,
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
  return { ok: true, missing: null, kind, amount, currency: want, category: finalCat, level, account: acc.id, note, source: sourceId, sourceName: sourceId ? sourceName(state, sourceId) : '', tx };
}
