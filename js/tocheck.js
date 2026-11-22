// "To check": records that arrived by themselves (from your phone's payments, js/phonepay.js)
// wait here until you look at them once: right category and card? ✓ (or change it), or delete.
// They already count everywhere (Safe to spend is never wrong because of a click you didn't make);
// this is only the "is it right?" look. Marked with `review: true`. Pure and tested.

import { touch } from './model.js';

export const toCheck = (state) => (state.tx || []).filter((t) => t.review === true).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));

/** ✓ one record, with any change you made (category, account). */
export function approve(state, id, patch = {}, now = Date.now()) {
  const t = (state.tx || []).find((x) => x.id === id);
  if (!t) return false;
  Object.assign(t, patch);
  if (patch.category) delete t.sub;
  delete t.review;
  touch(t, now);
  return true;
}

export function approveAll(state, now = Date.now()) {
  const list = toCheck(state);
  for (const t of list) { delete t.review; touch(t, now); }
  return list.length;
}
