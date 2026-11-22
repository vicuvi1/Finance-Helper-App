// Small helpers for the Log table (pure, tested in tests/logextras.test.js):
//  - transferPurpose: what a Move is for when you didn't write a note
//    ("To savings", "Cash withdrawal", "Exchange USD → MDL"…), shown greyed, never saved;
//  - weekTotals: what a week cost, against a usual week (the 8 weeks before).
import { addDays, dowIndex } from './dates.js';
import { B } from './model.js';
import { countsAsSpending, signed } from './catshare.js';

const isSavings = (a) => !!a && (a.savings || a.kind === 'savings');

export function transferPurpose(state, t) {
  if (t.type !== 'transfer') return '';
  const accs = state.settings.accounts || [];
  const from = accs.find((a) => a.id === t.from);
  const to = accs.find((a) => a.id === t.to);
  if (!from || !to) return 'Between accounts';
  const fc = from.currency || state.settings.currency;
  const tc = to.currency || state.settings.currency;
  if (fc !== tc) return `Exchange ${fc} → ${tc}`;
  if (isSavings(to) && !isSavings(from)) return 'To savings';
  if (isSavings(from) && !isSavings(to)) return 'From savings';
  if (to.kind === 'cash' && from.kind !== 'cash') return 'Cash withdrawal';
  if (from.kind === 'cash' && to.kind !== 'cash') return 'Cash deposit';
  if (to.kind === 'crypto') return 'To crypto';
  if (from.kind === 'crypto') return 'From crypto';
  if (from.kind === 'business' && to.kind !== 'business') return 'Pay yourself';
  return `${from.name} → ${to.name}`;
}

/** The Monday of a date's week. */
export const weekStart = (iso) => addDays(iso, -dowIndex(iso));

const spentOn = (list, from, to) => list.filter((t) => t.date >= from && t.date <= to && countsAsSpending(t) && t.type === 'expense').reduce((a, t) => a + signed(t, B(t)), 0);

/** {from, to, spent, usual, change} for the week holding `iso` (Monday–Sunday). */
export function weekTotals(state, iso) {
  const from = weekStart(iso);
  const to = addDays(from, 6);
  const spent = spentOn(state.tx || [], from, to);
  let total = 0;
  let weeks = 0;
  const first = (state.tx || []).reduce((m, t) => (t.date && (!m || t.date < m) ? t.date : m), null);
  for (let i = 1; i <= 8; i++) {
    const a = addDays(from, -7 * i);
    if (first && addDays(a, 6) < first) break;
    total += spentOn(state.tx || [], a, addDays(a, 6));
    weeks++;
  }
  const usual = weeks ? Math.round(total / weeks) : 0;
  return { from, to, spent, usual, change: usual > 0 ? (spent - usual) / usual : null };
}
