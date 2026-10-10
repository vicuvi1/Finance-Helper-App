// Year in review (the year's story in highlights) and the yearly income
// summary for taxes. Pure; js/screens/yearreview.js shows them.

import { report, yearOverview, rebuiltTotal, category, person, account, B } from './model.js';
import { addDays } from './dates.js';

// Longest run of days in a row with at least one record, within the year.
function longestStreak(dates) {
  const days = [...new Set(dates)].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

export function yearReview(state, year, today) {
  const from = `${year}-01-01`;
  const end = `${year}-12-31`;
  const to = end < today ? end : today;
  const r = report(state, from, to);
  const before = report(state, `${year - 1}-01-01`, `${year - 1}-12-31`);
  const months = yearOverview(state, year).rows.filter((m) => m.income || m.expense);
  const best = [...months].sort((a, b) => b.net - a.net)[0] || null;
  const priciest = [...months].sort((a, b) => b.expense - a.expense)[0] || null;
  const inYear = state.tx.filter((t) => t.date >= from && t.date <= to);
  const nameOf = (id) => category(state, id)?.name || 'Other';
  const topClient = (() => {
    const per = {};
    for (const t of inYear) if (t.type === 'income' && !t.loan && t.person) per[t.person] = (per[t.person] || 0) + B(t);
    const [id, amount] = Object.entries(per).sort((a, b) => b[1] - a[1])[0] || [];
    return id ? { name: person(state, id)?.name || 'Someone', amount } : null;
  })();
  return {
    year,
    partial: to < end,
    income: r.income,
    expense: r.expense,
    net: r.net,
    savingsRate: r.savingsRate,
    vs: before.count ? { income: before.income, expense: before.expense, net: before.net } : null,
    months,
    best,
    priciest,
    topCategories: r.spending.rows.slice(0, 3).map((x) => ({ id: x.id, name: nameOf(x.id), amount: x.amount, share: x.share })),
    topSource: r.sources.rows[0] ? { name: nameOf(r.sources.rows[0].id), amount: r.sources.rows[0].amount, share: r.sources.rows[0].share } : null,
    topClient,
    biggest: r.biggest[0] || null,
    records: inYear.length,
    loggedDays: new Set(inYear.map((t) => t.date)).size,
    streak: longestStreak(inYear.map((t) => t.date)),
    noSpendDays: r.noSpendDays,
    netWorth: { start: rebuiltTotal(state, `${year - 1}-12-31`), end: rebuiltTotal(state, to) },
    goalsDone: (state.goals || []).filter((g) => g.doneAt && String(g.doneAt).startsWith(String(year))).map((g) => g.name),
  };
}

// Every income of the year as you'd list it for a tax declaration: date,
// source, payer, original currency and amount, the rate used, and the
// amount in your currency. Loans and moves between accounts are left out.
export function taxSummary(state, year) {
  const rows = state.tx
    .filter((t) => t.type === 'income' && !t.loan && t.date.startsWith(String(year)))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((t) => ({
      id: t.id,
      date: t.date,
      source: category(state, t.category)?.name || '',
      payer: person(state, t.person)?.name || t.personName || '',
      note: t.note || '',
      account: account(state, t.account)?.name || '',
      currency: t.currency || state.settings.currency,
      amount: t.amount,
      rate: t.rate || 1,
      base: B(t),
    }));
  const sum = (list) => list.reduce((a, x) => a + x.base, 0);
  const group = (key) => {
    const m = new Map();
    for (const x of rows) {
      const g = m.get(x[key]) || { name: x[key], base: 0, amount: 0, count: 0 };
      g.base += x.base;
      g.amount += x.amount;
      g.count++;
      m.set(x[key], g);
    }
    return [...m.values()].sort((a, b) => b.base - a.base);
  };
  const byMonth = Array.from({ length: 12 }, (_, i) => {
    const k = `${year}-${String(i + 1).padStart(2, '0')}`;
    return { key: k, base: sum(rows.filter((x) => x.date.startsWith(k))) };
  });
  return { rows, total: sum(rows), byCurrency: group('currency'), bySource: group('source'), byPayer: group('payer').filter((g) => g.name), byMonth };
}
