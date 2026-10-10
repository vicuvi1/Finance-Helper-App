// Income split flow: when money comes in, one tap divides it. Taxes first
// (your %), then the rest by your jars (70 / 10 / 10 / 10), and each part
// is moved to the account it belongs in (Safe, a tax account…) as a
// transfer. Parts that stay where the income landed aren't moved.
// Pure; app.js shows it. Settings: settings.split = { taxPct, taxAccount },
// and each jar may have an `account` it goes to.

import { splitByPercent } from './money.js';
import { convert } from './fx.js';

export const splitPrefs = (state) => ({ taxPct: 0, taxAccount: null, ...(state.settings.split || {}) });

// The parts of an income, each with where it goes.
export function planSplit(state, tx, { taxPct = splitPrefs(state).taxPct, taxAccount = splitPrefs(state).taxAccount, accounts = {} } = {}) {
  const pct = Math.max(0, Math.min(100, Number(taxPct) || 0));
  const tax = Math.round((tx.amount * pct) / 100);
  const rows = [];
  if (pct > 0) rows.push({ id: 'tax', name: 'Taxes', emoji: '🧾', pct, amount: tax, to: accounts.tax ?? taxAccount ?? tx.account });
  const rest = tx.amount - tax;
  const jars = state.settings.jars;
  const parts = splitByPercent(rest, jars.map((j) => j.pct));
  jars.forEach((j, i) => {
    const def = j.account || (j.savings ? state.settings.savingsAccount : null) || tx.account;
    rows.push({ id: j.id, name: j.name, emoji: j.emoji || '', pct: j.pct, amount: parts[i], to: accounts[j.id] ?? def, savings: !!j.savings });
  });
  return rows;
}

// The transfers that carry it out, one per part going to another account.
// Parts that can't be priced in the other account's currency are skipped.
export function splitTransfers(state, tx, rows, { now = Date.now(), uid }) {
  const out = [];
  const skipped = [];
  const acc = (id) => state.settings.accounts.find((a) => a.id === id);
  const from = acc(tx.account);
  if (!from) return { transfers: out, skipped: rows.map((r) => r.id) };
  for (const r of rows) {
    if (!r.amount || !r.to || r.to === tx.account) continue;
    const to = acc(r.to);
    if (!to) { skipped.push(r.id); continue; }
    const cur = from.currency || state.settings.currency;
    const toCur = to.currency || state.settings.currency;
    const toAmount = cur === toCur ? null : convert(r.amount, cur, toCur, state.rates);
    if (cur !== toCur && toAmount == null) { skipped.push(r.id); continue; }
    const stamp = now + out.length;
    out.push({
      id: uid(), createdAt: stamp, updatedAt: stamp, type: 'transfer', amount: r.amount, currency: tx.currency || cur,
      ...(toAmount != null ? { toAmount } : {}),
      rate: tx.rate || 1, base: Math.round(r.amount * (tx.rate || 1)), date: tx.date,
      from: tx.account, to: r.to, note: `${r.name} ${r.pct}%${tx.note ? ` · ${tx.note}` : ''}`, splitOf: tx.id,
    });
  }
  return { transfers: out, skipped };
}

// Was this income split already? (Its transfers point back to it.)
export const isSplit = (state, txId) => state.tx.some((t) => t.splitOf === txId);
