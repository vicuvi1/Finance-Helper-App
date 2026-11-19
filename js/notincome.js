// "Not income?" (pure, tested). Money you already had, put into an account as
// "Earned · Other income" with no note, is easy to mistake for income. Nothing
// is changed on its own: these records are only suggested, and a record changes
// when you confirm (Undo puts it back). `notIncome: true` keeps the balance but
// leaves the record out of every income total (catshare.js isNotCounted).

import { isRefund, isCorrection, isPointsReward } from './catshare.js';

const isOtherIncome = (state, id) => {
  if (id === 'other-in') return true;
  const c = state.settings.categories.find((x) => x.id === id);
  return !!c && c.type === 'income' && /^other income$/i.test(String(c.name || '').trim());
};

// Earned records in "Other income" with no note, not yet marked and not
// answered with "It is income" (`notIncomeNo`). Newest first.
export function notIncomeSuggestions(state) {
  return state.tx
    .filter((t) => t.type === 'income' && !t.loan && !t.notIncome && !t.notIncomeNo && !isRefund(t) && !isCorrection(t) && !isPointsReward(t)
      && !String(t.note || '').trim() && isOtherIncome(state, t.category))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
}

export function markNotIncome(t, now = Date.now()) {
  if (!t || t.type !== 'income' || t.loan || isRefund(t) || isCorrection(t) || isPointsReward(t)) return false;
  t.notIncome = true;
  delete t.notIncomeNo;
  t.updatedAt = now;
  return true;
}

// "It is income": the suggestion stops showing for this record.
export function dismissNotIncome(t, now = Date.now()) {
  t.notIncomeNo = true;
  t.updatedAt = now;
}
