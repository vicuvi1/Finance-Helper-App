// The monthly match with the bank: after reading a statement (js/bank.js), what's already in the
// app is matched (exact copies, and rows you left unticked as "probably already logged"), those
// records are marked checked (their "to check" mark from the phone goes), and records in the app
// on that account and those dates that the bank doesn't show are listed for you to look at.
// Pure and tested (tests/bankmatch.test.js).

import { touch } from './model.js';

/** {matched: ids, missing: records the bank doesn't show}. `likelyIds`: rows left unticked as already logged. */
export function bankMatch(state, res, likelyIds = []) {
  const matched = new Set([...(res.exactIds || []), ...likelyIds]);
  const missing = (res.from && res.to ? state.tx : []).filter((t) => (t.type === 'expense' || t.type === 'income')
    && t.account === res.account && t.date >= res.from && t.date <= res.to && !matched.has(t.id) && !t.cashCheck && !t.reconcile)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { matched: [...matched], missing };
}

/** Marks the matched records as checked against the bank. Returns how many were waiting to be checked. */
export function confirmMatched(state, ids, day, now = Date.now()) {
  const set = new Set(ids);
  let checked = 0;
  for (const t of state.tx) {
    if (!set.has(t.id)) continue;
    if (t.review) { delete t.review; checked++; }
    t.bankOk = day;
    touch(t, now);
  }
  return checked;
}
