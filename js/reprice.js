// "Re-price past entries": records in another currency that were counted 1:1
// in the main currency (10 EUR counted as 10 MDL) because no rate was found
// when they were logged (Telegram, Life System's quick add, an import).
// Pure. Nothing changes until you confirm; every change keeps the old values
// in the record (`repricedFrom`), so Undo puts them back exactly.

import { rateOnDay } from './fx.js';

const KINDS = new Set(['expense', 'income']);

// A record that looks counted 1:1: another currency, and its value in the
// main currency is exactly its own amount.
export function countedOneToOne(t, base) {
  return !!t && KINDS.has(t.type) && !!t.currency && t.currency !== base
    && Number.isInteger(t.amount) && t.amount !== 0 && t.base === t.amount
    && (t.rate == null || t.rate === 1) && !t.repricedFrom;
}

// The records to re-price, each with the before and after values (bani in
// the main currency). A record whose rate is not known yet is left out.
export function repriceRows(state) {
  const base = state?.settings?.currency || 'MDL';
  const rows = [];
  for (const t of state?.tx || []) {
    if (!countedOneToOne(t, base)) continue;
    const r = rateOnDay(state, t.currency, t.date);
    if (!(r > 0) || Math.abs(r - 1) < 0.005) continue;
    const rate = Math.round(r * 10000) / 10000;
    rows.push({ id: t.id, date: t.date, type: t.type, note: t.note || '', currency: t.currency, amount: t.amount, before: t.base, after: Math.round(t.amount * rate), rate });
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// Applies the re-price to the given rows (from repriceRows). Each record keeps
// what it had in `repricedFrom`. Returns how many changed.
export function applyReprice(state, rows, now = Date.now()) {
  const base = state.settings.currency;
  const byId = new Map(rows.map((r) => [r.id, r]));
  let n = 0;
  for (const t of state.tx) {
    const r = byId.get(t.id);
    if (!r || !countedOneToOne(t, base) || t.amount !== r.amount || t.currency !== r.currency) continue;
    t.repricedFrom = { rate: t.rate ?? null, base: t.base, amount: t.amount, currency: t.currency, at: now };
    t.rate = r.rate;
    t.base = Math.round(t.amount * r.rate);
    t.updatedAt = now;
    n++;
  }
  return n;
}

// Records that were re-priced and can still be put back (not edited since:
// same amount and currency as when they were re-priced).
const undoable = (t) => !!t && !!t.repricedFrom && Number.isInteger(t.repricedFrom.base)
  && t.amount === t.repricedFrom.amount && t.currency === t.repricedFrom.currency;
export function repriced(state) {
  return (state?.tx || []).filter(undoable);
}

// Undo: the old rate and value come back (all re-priced records, or `ids`).
// A record you edited after the re-price keeps your edit.
export function undoReprice(state, ids = null, now = Date.now()) {
  const only = ids ? new Set(ids) : null;
  let n = 0;
  for (const t of state.tx) {
    if (!undoable(t) || (only && !only.has(t.id))) continue;
    const was = t.repricedFrom;
    t.rate = was.rate;
    t.base = was.base;
    delete t.repricedFrom;
    t.updatedAt = now;
    n++;
  }
  return n;
}
