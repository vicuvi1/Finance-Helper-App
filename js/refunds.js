// Refunds (pure, tested). A refund is an income record with `refund: true` and
// an expense category: the money did arrive (balances see it) but it lowers its
// category's spending instead of counting as income (catshare.js isRefund).
// Existing records are never changed on their own: "Looks like a refund?" only
// suggests, and a record changes when you tap (Undo puts it back).

import { isRefund, isCorrection, isPointsReward } from './catshare.js';

export const REFUND_WORDS = /refund|return(ed|s)?\b|rambursare|restituire|возврат|вернул/i;

// Income records whose note looks like a refund and that you have not already
// marked (or told us are not one: `refundNo`). Newest first.
export function refundSuggestions(state) {
  return state.tx
    .filter((t) => t.type === 'income' && !t.loan && !isRefund(t) && !t.refundNo && !isCorrection(t) && !isPointsReward(t)
      && REFUND_WORDS.test(String(t.note || '')))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
}

const words = (s) => String(s || '').toLowerCase().replace(REFUND_WORDS, ' ').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);

// The expense category a refund most likely belongs to: the category of the
// latest expense whose note shares a word with the refund's note (the shop).
// Falls back to the first "other" expense category, else null.
export function guessRefundCategory(state, t) {
  const mine = new Set(words(t.note));
  if (mine.size) {
    const hit = state.tx
      .filter((x) => x.type === 'expense' && !x.loan && x.date <= t.date && words(x.note).some((w) => mine.has(w)))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
    if (hit && state.settings.categories.some((c) => c.id === hit.category && c.type === 'expense')) return hit.category;
  }
  const other = state.settings.categories.find((c) => c.type === 'expense' && c.id === 'other')
    || state.settings.categories.find((c) => c.type === 'expense' && /^other$/i.test(c.name));
  return other?.id || null;
}

// Marks an income record as a refund in an expense category. Returns false (and
// changes nothing) when it cannot be one. The subcategory belonged to the old
// (income) category, so it is dropped.
export function markRefund(state, t, categoryId, now = Date.now()) {
  if (!t || t.type !== 'income' || t.loan || isCorrection(t) || isPointsReward(t)) return false;
  if (!state.settings.categories.some((c) => c.id === categoryId && c.type === 'expense')) return false;
  t.refund = true;
  t.category = categoryId;
  delete t.sub;
  delete t.refundNo;
  t.catBy = 'you';
  t.updatedAt = now;
  return true;
}

// "Not a refund": the suggestion stops showing for this record.
export function dismissRefund(t, now = Date.now()) {
  t.refundNo = true;
  t.updatedAt = now;
}
