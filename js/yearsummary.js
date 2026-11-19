// Yearly summary (pure, tested): one page of numbers for a year. Income and
// spending per month, the top 5 categories with their change from the year
// before, the savings rate, the biggest purchases, net worth from the start of
// the year to its end (longview.js), no-spend days, and income by source when
// records carry one. Every amount is the record's value in the main currency
// (a EUR record counts at its own day's rate, like everywhere else), and
// records that don't count as income or spending are left out, so the numbers
// are the Log's totals. A year still running covers up to today and is
// compared with the same days of the year before.

import { monthFlows, netWorthHistory } from './longview.js';
import { countsAsSpending, countsAsIncome, isRefund } from './catshare.js';
import { B } from './model.js';
import { txSourceId, sourceName } from './incomesources.js';

const pad = (n) => String(n).padStart(2, '0');
const sameDayLastYear = (iso) => {
  const y = Number(iso.slice(0, 4)) - 1;
  // 29 Feb has no twin in a common year.
  return iso.slice(5) === '02-29' && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? `${y}-02-28` : `${y}${iso.slice(4)}`;
};
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5) + 1;

function categoryTotals(state, from, to) {
  const out = new Map();
  for (const m of monthFlows(state, { from, to }).values()) for (const [cat, v] of m.byCat) out.set(cat, (out.get(cat) || 0) + v);
  return out;
}

export function yearSummary(state, year, today) {
  const y = Number(year);
  const end = `${y}-12-31`;
  const to = end < today ? end : today;
  const from = `${y}-01-01`;
  const partial = to < end;
  const flows = monthFlows(state, { from, to });
  const months = Array.from({ length: 12 }, (_, i) => {
    const key = `${y}-${pad(i + 1)}`;
    const m = flows.get(key);
    const income = m?.income || 0;
    const spending = m?.spending || 0;
    return { key, income, spending, net: income - spending, records: m?.records || 0, future: `${key}-01` > to };
  });
  const income = months.reduce((a, m) => a + m.income, 0);
  const spending = months.reduce((a, m) => a + m.spending, 0);

  const prevFrom = `${y - 1}-01-01`;
  const prevTo = partial ? sameDayLastYear(to) : `${y - 1}-12-31`;
  const now = categoryTotals(state, from, to);
  const before = categoryTotals(state, prevFrom, prevTo);
  const topCategories = [...now].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, amount]) => {
    const prev = before.get(id) || 0;
    return { id, amount, prev, change: prev > 0 ? (amount - prev) / prev : null, share: spending > 0 ? amount / spending : 0 };
  });

  const inYear = state.tx.filter((t) => t.date >= from && t.date <= to);
  const spendTx = inYear.filter((t) => t.type === 'expense' && countsAsSpending(t) && !isRefund(t));
  const biggest = [...spendTx].sort((a, b) => B(b) - B(a) || (a.date < b.date ? -1 : 1)).slice(0, 5).map((t) => ({ id: t.id, date: t.date, note: t.note || '', category: t.category, amount: B(t) }));

  // No-spend days: days with no spending record, counted from the first record of the log.
  const firstRecord = state.tx.reduce((m, t) => (!m || t.date < m ? t.date : m), null);
  const startCount = firstRecord && firstRecord > from ? firstRecord : from;
  const counted = startCount <= to ? days(startCount, to) : 0;
  const noSpendDays = Math.max(0, counted - new Set(spendTx.map((t) => t.date)).size);

  let netWorth = null;
  const hist = netWorthHistory(state, today);
  if (hist.months.length) {
    const startM = hist.months.find((m) => m.key === `${y - 1}-12`);
    const endM = partial ? hist.months.at(-1) : hist.months.find((m) => m.key === `${y}-12`);
    const first = hist.months[0].key;
    // The first year starts from the opening balances; a year the log doesn't reach has no net worth.
    if (endM && endM.key.slice(0, 4) === String(y) && `${y}-12` >= first) netWorth = { start: startM ? startM.total : hist.opening, end: endM.total };
  }

  const bySource = new Map();
  let anySource = false;
  for (const t of inYear) {
    if (!countsAsIncome(t)) continue;
    const s = txSourceId(state, t);
    if (s) anySource = true;
    bySource.set(s || '', (bySource.get(s || '') || 0) + B(t));
  }
  const sources = anySource ? [...bySource].map(([id, amount]) => ({ id, name: id ? sourceName(state, id) || id : 'No source', amount, share: income > 0 ? amount / income : 0 })).sort((a, b) => b.amount - a.amount) : null;

  return {
    year: y, from, to, partial, months, income, spending, net: income - spending,
    savingsRate: income > 0 ? (income - spending) / income : null,
    topCategories, biggest, noSpendDays, countedDays: counted, netWorth, sources, records: inYear.length,
    prevTo,
  };
}
