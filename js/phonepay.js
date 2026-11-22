// Payments recorded by themselves from your phone. Your phone sends each
// payment to your server (api/capture.mjs):
//  - iPhone: a Shortcuts automation that runs when you pay with Apple Pay
//    (Wallet → "When I tap…") sends {amount, merchant, card};
//  - Android: MacroDroid (or Tasker) forwards your bank's notification or SMS
//    text: "Plata 120,50 MDL la LINELLA, card *4821. Sold: 3 400 MDL".
// This file reads either one into a record. Pure and tested (tests/phonepay.test.js).

import { parseQuick } from './quickadd.js';
import { activeAccounts } from './model.js';

const CURS = { MDL: 'MDL', LEI: 'MDL', LEU: 'MDL', L: 'MDL', USD: 'USD', $: 'USD', EUR: 'EUR', '€': 'EUR', RON: 'RON', RUB: 'RUB', UAH: 'UAH', GBP: 'GBP', '£': 'GBP' };
const CUR = '(MDL|LEI|LEU|USD|EUR|RON|RUB|UAH|GBP|\\$|€|£)';
const NUM = '(\\d[\\d\\s\\u00a0\\u202f.,]*\\d|\\d)';

/** "1 234,56" / "1,234.56" / "120.5" / "120" → bani (or null). */
export function parseAmount(text) {
  let s = String(text ?? '').replace(/[\s  ']/g, '');
  const m = s.match(/\d[\d.,]*/);
  if (!m) return null;
  s = m[0].replace(/[.,]$/, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let dec = -1;
  if (lastDot >= 0 && lastComma >= 0) dec = Math.max(lastDot, lastComma);
  else if (lastComma >= 0 || lastDot >= 0) {
    const at = Math.max(lastComma, lastDot);
    const sep = s[at];
    const after = s.length - at - 1;
    // One separator with 1–2 digits after it is the decimal point; with 3 it's thousands ("1.200", "1,200").
    if ((after === 1 || after === 2) && s.split(sep).length === 2) dec = at;
  }
  const whole = (dec >= 0 ? s.slice(0, dec) : s).replace(/[.,]/g, '');
  const frac = dec >= 0 ? s.slice(dec + 1).padEnd(2, '0').slice(0, 2) : '00';
  const v = Number(whole) * 100 + Number(frac);
  return Number.isFinite(v) && v > 0 ? v : null;
}

const SKIP = /refuz|respins|declin|insuficien|fonduri insuf|отказ|отклон|недостаточно|\bcod\b|codul|\bcode\b|parol|password|\bOTP\b|3-?D ?Secure|verificare/i;
const INCOME = /alimentar|primit|încasa|incasa|credit(ed|are)|received|top.?up|зачисл|поступ|пополн|rambursa|refund|возврат|anulare|reversal/i;
const BALANCE = /(sold|balance|disponibil|остаток|баланс|доступно)\W{0,3}$/i;

/** The amount and currency in a bank message, skipping the balance ("Sold: 3 400 MDL"). */
function findAmount(text) {
  const re = new RegExp(`${CUR}\\s*${NUM}|${NUM}\\s*${CUR}`, 'gi');
  let m;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 16), m.index);
    if (BALANCE.test(before)) continue;
    const cur = (m[1] || m[4] || '').toUpperCase();
    const amount = parseAmount(m[2] || m[3]);
    if (amount) return { amount, currency: CURS[cur] || CURS[cur.replace(/\W/g, '')] || 'MDL' };
  }
  return null;
}

function findMerchant(text) {
  const m = text.match(/(?:\bla\b|\bat\b|merchant|comerciant|beneficiar|magazin|\bв\b|продавец)\s*[:\-]?\s*([^\n,;|]+?)(?=\s*(?:[,;|\n]|\.\s|\s(?:sold|balance|disponibil|data|on|pe|card|остаток|карта)\b|$))/i);
  return m ? m[1].replace(/[.*"'«»]+$/g, '').trim().slice(0, 60) : '';
}

const tidy = (name) => {
  const s = String(name || '').replace(/\s+/g, ' ').trim();
  // "LINELLA SRL" → "Linella"; keep names with lower case as they are.
  const noForm = s.replace(/\b(S\.?R\.?L\.?|S\.?A\.?|I\.?I\.?|LLC|LTD|INC|ÎI)\b\.?/gi, '').replace(/\s+/g, ' ').trim() || s;
  return noForm === noForm.toUpperCase() ? noForm.toLowerCase().replace(/(^|[\s\-/&])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) : noForm;
};

/**
 * What the phone sent → {kind: 'expense'|'income'|'skip', amount, currency, merchant, last4, card, why}.
 * input: {text} (a notification or SMS) and/or {amount, merchant, card, currency} (iPhone Shortcuts).
 */
export function readPayment(input = {}) {
  const text = String(input.text || '').trim();
  const out = { kind: 'expense', amount: null, currency: null, merchant: '', last4: '', card: String(input.card || '').trim().slice(0, 60), why: '' };
  if (text && SKIP.test(text)) return { ...out, kind: 'skip', why: 'Not a payment (a code, or a payment that was declined).' };
  if (input.amount != null && input.amount !== '') {
    const a = String(input.amount);
    out.amount = parseAmount(a);
    const c = a.match(new RegExp(CUR, 'i'))?.[1]?.toUpperCase() || String(input.currency || '').toUpperCase();
    out.currency = CURS[c] || null;
    out.merchant = tidy(input.merchant || '');
  }
  if (text) {
    const f = findAmount(text);
    if (!out.amount && f) { out.amount = f.amount; out.currency = f.currency; }
    if (!out.merchant) out.merchant = tidy(findMerchant(text));
    if (INCOME.test(text)) out.kind = 'income';
  }
  const digits = `${text} ${out.card}`.match(/(?:\*+|x{2,}|•+|card\s*(?:nr\.?|no\.?)?\s*|карт\S*\s*)(\d{4})\b/i) || out.card.match(/(\d{4})\s*$/);
  if (digits) out.last4 = digits[1];
  if (!out.amount) return { ...out, kind: 'skip', why: 'No amount found.' };
  return out;
}

/** The account for a card: by its last 4 digits, else by the card's name ("maib Visa"). */
export function accountFor(state, p) {
  const accs = activeAccounts(state);
  if (p.last4) {
    const a = accs.find((x) => String(x.last4 || '') === p.last4);
    if (a) return a.id;
  }
  const name = String(p.card || '').toLowerCase();
  if (name) {
    const a = accs.find((x) => x.name && (name.includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(name)));
    if (a) return a.id;
  }
  return state.settings?.capture?.account || null;
}

const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

/** One id per payment: the same payment sent twice within the same 2 minutes is one record. */
export const captureId = (p, now) => `ph-${hash(`${p.kind}|${p.amount}|${p.currency}|${(p.merchant || '').toLowerCase()}|${Math.floor(now / 120000)}`)}`;

/**
 * A payment → {ok, tx} | {ok:false, skip?, why}. `now` and `today` (YYYY-MM-DD in Moldova).
 * The same amount already recorded in the last 10 minutes (by the phone, the bot or you) is skipped:
 * the bank's SMS and its app notification often come for one payment.
 */
export function paymentRecord(state, input, { now = Date.now(), today }) {
  const p = readPayment(input);
  if (p.kind === 'skip') return { ok: false, skip: true, why: p.why, p };
  const id = captureId(p, now);
  if ((state.tx || []).some((t) => t.id === id) || state.deleted?.[id]) return { ok: false, skip: true, why: 'Already recorded.', p };
  const recent = (state.tx || []).find((t) => t.type === p.kind && t.date === today && Math.abs((t.createdAt || 0) - now) < 10 * 60000 && (t.amount === p.amount || t.original?.amount === p.amount));
  if (recent) return { ok: false, skip: true, why: 'Already recorded a moment ago.', p, existing: recent.id };
  const what = p.merchant || (p.kind === 'income' ? 'Money in' : 'Card payment');
  const text = `${p.kind === 'income' ? '+' : ''}${(p.amount / 100).toFixed(2)} ${p.currency || ''} ${what}`.replace(/\s+/g, ' ');
  const r = parseQuick(state, text, { today, accountId: accountFor(state, p) });
  if (!r.ok) return { ok: false, why: r.missing || 'Could not read it.', p };
  return { ok: true, p, tx: { id, createdAt: now, updatedAt: now, ...r.tx, note: what, source: 'phone', review: true } };
}
