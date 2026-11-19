// Change many records at once (pure, tested). The Log's selection bar picks the
// records; this applies one change to all of them. The caller commits once, so
// one Undo (history.js) puts every record back exactly as it was.

import { touch, category, removeTx } from './model.js';
import { canHaveSource, setTxSource, sourceById, NONE } from './incomesources.js';

// kind: 'category' | 'date' | 'account' | 'source' (an income source id, or NONE to clear it; Earned records only). `rateFor(cur)` gives a rate when a
// record moves to an account in another currency. Transfers are skipped for
// category and account changes. Returns { changed, skipped }.
export function applyBulk(state, ids, kind, value, { rateFor = () => null, now = Date.now() } = {}) {
  const set = new Set(ids);
  let changed = 0;
  let skipped = 0;
  if (kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { changed, skipped };
  for (const t of state.tx) {
    if (!set.has(t.id)) continue;
    if (kind === 'source') {
      if (value !== NONE && !sourceById(state, value)) return { changed, skipped };
      if (!canHaveSource(t)) { skipped++; continue; }
      if (setTxSource(t, value === NONE ? null : value, now)) changed++;
      continue;
    }
    if (kind === 'date') t.date = value;
    else if (kind === 'income' || kind === 'spending') {
      // "Count as income / spending": yes puts the record back in the totals, no leaves it out.
      const type = kind === 'income' ? 'income' : 'expense';
      if (t.type !== type || t.loan || t.reconcile || t.refund) { skipped++; continue; }
      const field = kind === 'income' ? 'notIncome' : 'notSpending';
      if (value === 'no') { if (t[field]) continue; t[field] = true; } else { if (!t[field]) continue; delete t[field]; }
    } else if (t.type === 'transfer') { skipped++; continue; }
    else if (kind === 'category') {
      // A split record keeps its lines' categories (open it to change them).
      if (category(state, value)?.type !== t.type || t.splits) { skipped++; continue; }
      t.category = value;
    } else if (kind === 'account') {
      t.account = value;
      const cur = state.settings.accounts.find((a) => a.id === value)?.currency || state.settings.currency;
      if (cur !== t.currency) {
        t.currency = cur;
        t.rate = rateFor(cur) || t.rate || 1;
        t.base = Math.round(t.amount * t.rate);
      }
    } else continue;
    touch(t, now);
    changed++;
  }
  return { changed, skipped };
}

// How many of the selected records a change would touch (for the confirm text).
export function countApplicable(state, ids, kind, value) {
  const set = new Set(ids);
  if (kind === 'source') {
    return state.tx.filter((t) => set.has(t.id) && canHaveSource(t) && (value === NONE ? !!t.incomeSource : t.incomeSource !== value)).length;
  }
  if (kind === 'income' || kind === 'spending') {
    const type = kind === 'income' ? 'income' : 'expense';
    const field = kind === 'income' ? 'notIncome' : 'notSpending';
    return state.tx.filter((t) => set.has(t.id) && t.type === type && !t.loan && !t.reconcile && !t.refund && (value === 'no' ? !t[field] : !!t[field])).length;
  }
  return state.tx.filter((t) => set.has(t.id) && (kind === 'date' || (t.type !== 'transfer' && (kind !== 'category' || (category(state, value)?.type === t.type && !t.splits))))).length;
}

export function deleteMany(state, ids, now = Date.now()) {
  let n = 0;
  for (const id of ids) if (state.tx.some((t) => t.id === id)) { removeTx(state, id, now); n++; }
  return n;
}
