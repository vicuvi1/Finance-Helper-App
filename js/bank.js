// Bank statements (maib, Victoriabank, any bank that exports CSV or Excel):
// find the header row, guess which column is the date, the amount (one
// signed column, or separate debit / credit columns), the description and
// the currency, in Romanian, Russian or English. The user can fix the
// guess; the mapping is remembered per statement layout.

import { parseAmount } from './money.js';
import { parseLooseDate } from './dates.js';
import { suggestCategory, uid } from './model.js';
import { txKey } from './importer.js';
import { pairRate } from './fx.js';

export const FIELDS = [
  { id: 'date', label: 'Date', need: true },
  { id: 'amount', label: 'Amount (+ in, − out)' },
  { id: 'debit', label: 'Money out (debit)' },
  { id: 'credit', label: 'Money in (credit)' },
  { id: 'desc', label: 'Description' },
  { id: 'currency', label: 'Currency' },
];

const norm = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

const WORDS = {
  date: /^(data|date|дата)(?![a-zа-я])|data (tranzact|operat|inregistr|contabil|efectuar)|transaction date|posting date|дата (операц|транзак|проведен)/,
  amount: /^(suma|amount|сумма|valoare|sum)(?![a-zа-я])|suma (tranzact|operat|in valuta)|amount in|сумма (операц|в валюте)/,
  debit: /debit|дебет|retrager|withdraw|списан|расход|iesiri|plati/,
  credit: /credit|кредит|incas|intrari|deposit|поступ|зачисл|приход/,
  desc: /descri|detal|destinat|explicat|beneficiar|merchant|description|details|narrat|назначен|описан|детал|comerciant|partener|contragent|контрагент/,
  currency: /^(valuta|currency|валюта|moneda)(?![a-zа-я])/,
};
// Running balances look like amounts; never take them.
const NOT_AMOUNT = /sold|balance|остаток|баланс|comision|fee|комисс/;

// Finds the header row and guesses the columns. Null when nothing fits.
export function guessMapping(rows) {
  let best = null;
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const h = (rows[r] || []).map(norm);
    if (h.filter(Boolean).length < 2) continue;
    const used = new Set();
    const map = {};
    for (const f of ['date', 'debit', 'credit', 'amount', 'currency', 'desc']) {
      const i = h.findIndex((v, idx) => v && !used.has(idx) && WORDS[f].test(v) && !(f !== 'desc' && f !== 'date' && f !== 'currency' && NOT_AMOUNT.test(v)));
      if (i >= 0) { map[f] = i; used.add(i); }
    }
    if (map.date == null || (map.amount == null && map.debit == null && map.credit == null)) continue;
    const score = Object.keys(map).length;
    if (!best || score > best.score) best = { headerRow: r, map, score };
  }
  return best && { headerRow: best.headerRow, map: best.map };
}

// Same layout next time: the header names, joined.
export const signature = (rows, headerRow) => (rows[headerRow] || []).map(norm).filter(Boolean).join('|');

const cleanDate = (v) => (typeof v === 'string' ? v.replace(/[ T]\d{1,2}:\d{2}(:\d{2})?.*$/, '').trim() : v);
const cleanNote = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);

// Turns the statement into records for `account`. `flip` is for banks that
// show money out as positive numbers in a single amount column.
export function parseStatement(rows, { headerRow, map }, state, { account, flip = false } = {}) {
  const baseCur = state.settings.currency;
  const acc = state.settings.accounts.find((a) => a.id === account) || state.settings.accounts[0];
  const existing = new Map();
  for (const t of state.tx) existing.set(txKey(t), (existing.get(txKey(t)) || 0) + 1);
  const cell = (row, i) => (i != null && i >= 0 ? row[i] : '');
  const out = [];
  let duplicates = 0;
  let skipped = 0;
  let stamp = Date.now();
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (row.every((c) => !String(c ?? '').trim())) continue;
    const date = parseLooseDate(cleanDate(cell(row, map.date)));
    let v = null;
    if (map.amount != null && String(cell(row, map.amount)).trim()) v = parseAmount(cell(row, map.amount)) * (flip ? -1 : 1);
    else {
      const out_ = Math.abs(parseAmount(cell(row, map.debit)) || 0);
      const in_ = Math.abs(parseAmount(cell(row, map.credit)) || 0);
      v = in_ - out_;
    }
    if (!date || !v) { skipped++; continue; }
    const type = v < 0 ? 'expense' : 'income';
    const amount = Math.abs(v);
    const note = cleanNote(cell(row, map.desc));
    const code = String(cell(row, map.currency)).trim().toUpperCase();
    const currency = /^[A-Z]{3}$/.test(code) ? code : acc?.currency || baseCur;
    const t = { type, amount, date, note, account: acc.id, category: suggestCategory(state, note, type) || (type === 'income' ? 'other-in' : 'other') };
    const key = txKey(t);
    if (existing.get(key) > 0) { existing.set(key, existing.get(key) - 1); duplicates++; continue; }
    const rate = currency === baseCur ? 1 : pairRate(currency, baseCur, state.rates);
    stamp++;
    out.push({ id: uid(), createdAt: stamp, updatedAt: stamp, ...t, currency, rate, base: rate ? Math.round(amount * rate) : amount });
  }
  const income = out.filter((t) => t.type === 'income').reduce((a, t) => a + t.base, 0);
  const expense = out.filter((t) => t.type === 'expense').reduce((a, t) => a + t.base, 0);
  const months = [...new Set(out.map((t) => t.date.slice(0, 7)))].sort();
  return { tx: out, duplicates, skipped, income, expense, months };
}
