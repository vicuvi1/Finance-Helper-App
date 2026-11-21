// A report for any month or year (Reports → Report): totals, categories, the
// months, subscriptions, account balances and every record. As an Excel file
// (js/xlsx.js) or a printable page you can save as PDF. Pure and tested
// (tests/report.test.js); js/screens/report.js shows the picker and prints.

import { monthSummary, accountBalances, category } from './model.js';
import { addMonths, monthLabel, todayISO } from './dates.js';
import { formatMoney } from './money.js';
import { txRows } from './moneyexport.js';
import { subscriptionTable } from './subtable.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The months from `from` to `to` ('YYYY-MM', both included). */
export function monthsBetweenKeys(from, to) {
  const out = [];
  for (let k = from; k <= to && out.length < 240; k = addMonths(k, 1)) out.push(k);
  return out;
}

/** The ready choices: this month, last month, this year, last year. */
export function periods(today = todayISO()) {
  const m = today.slice(0, 7);
  const y = Number(today.slice(0, 4));
  return [
    { id: 'this-month', label: monthLabel(m), from: m, to: m },
    { id: 'last-month', label: monthLabel(addMonths(m, -1)), from: addMonths(m, -1), to: addMonths(m, -1) },
    { id: 'this-year', label: `${y} so far`, from: `${y}-01`, to: m },
    { id: 'last-year', label: String(y - 1), from: `${y - 1}-01`, to: `${y - 1}-12` },
  ];
}

/** Everything the report shows, in the main currency (bani). */
export function reportData(state, from, to, { today = todayISO(), title = '' } = {}) {
  const months = monthsBetweenKeys(from, to).map((k) => monthSummary(state, k));
  const income = months.reduce((a, m) => a + m.income, 0);
  const expense = months.reduce((a, m) => a + m.expense, 0);
  const cats = new Map();
  for (const m of months) for (const { id, amount } of m.byCategory || []) cats.set(id, (cats.get(id) || 0) + amount);
  const categories = [...cats].filter(([, v]) => v > 0).map(([id, v]) => ({ id, name: category(state, id)?.name || 'Other', amount: v, share: expense > 0 ? v / expense : 0 })).sort((a, b) => b.amount - a.amount);
  const records = (state.tx || []).filter((t) => t.date && t.date.slice(0, 7) >= from && t.date.slice(0, 7) <= to);
  const bal = accountBalances(state);
  const accounts = (state.settings.accounts || []).filter((a) => !a.archived).map((a) => ({ name: a.name, currency: a.currency || state.settings.currency, balance: bal[a.id] || 0 }));
  const subs = subscriptionTable(state, today);
  return {
    title: title || (from === to ? monthLabel(from) : `${monthLabel(from)} – ${monthLabel(to)}`),
    from, to, currency: state.settings.currency || 'MDL',
    income, expense, kept: income - expense, rate: income > 0 ? (income - expense) / income : null,
    months: months.map((m) => ({ key: m.key, income: m.income, expense: m.expense, kept: m.net })),
    categories, records, accounts,
    subscriptions: subs.rows.filter((x) => x.status !== 'paused').map((x) => ({ name: x.name, amount: x.rule.amount, currency: x.rule.currency, every: x.rule.every, next: x.next, monthly: x.monthly })),
    subsMonth: subs.month,
  };
}

const lei = (c) => Math.round(c) / 100;

/** The Excel sheets: Summary, Categories, Months, Subscriptions, Accounts, Records. */
export function reportSheets(state, d) {
  const cur = d.currency;
  return [
    { name: 'Summary', rows: [
      ['Report', d.title], ['From', d.from], ['To', d.to], [],
      [`Earned (${cur})`, lei(d.income)], [`Spent (${cur})`, lei(d.expense)], [`Kept (${cur})`, lei(d.kept)],
      ['Kept %', d.rate == null ? '' : Math.round(d.rate * 1000) / 10], ['Records', d.records.length],
      [`Subscriptions a month (${cur})`, lei(d.subsMonth)],
    ] },
    { name: 'Categories', rows: [['Category', `Spent (${cur})`, 'Share %'], ...d.categories.map((c) => [c.name, lei(c.amount), Math.round(c.share * 1000) / 10])] },
    { name: 'Months', rows: [['Month', `Earned (${cur})`, `Spent (${cur})`, `Kept (${cur})`], ...d.months.map((m) => [monthLabel(m.key), lei(m.income), lei(m.expense), lei(m.kept)])] },
    { name: 'Subscriptions', rows: [['Name', 'Amount', 'Currency', 'How often', 'Next payment', `A month (${cur})`], ...d.subscriptions.map((s) => [s.name, lei(s.amount), s.currency, s.every, s.next || '', s.monthly == null ? '' : lei(s.monthly)])] },
    { name: 'Accounts', rows: [['Account', 'Balance now', 'Currency'], ...d.accounts.map((a) => [a.name, lei(a.balance), a.currency])] },
    { name: 'Records', rows: txRows(state, d.records), filterRows: d.records.length },
  ];
}

/** The printable page (Save as PDF from the print dialog). */
export function reportHTML(d, { hidden = false } = {}) {
  const f = (c, cur = d.currency) => (hidden ? '••••' : esc(formatMoney(c, cur, { reveal: true })));
  const bar = (share) => `<span class="rp-bar"><i style="width:${Math.max(1, Math.round(share * 100))}%"></i></span>`;
  return `<article class="report">
    <header><h1>${esc(d.title)}</h1><p>Finance Helper · made ${esc(new Date().toLocaleDateString())}</p></header>
    <section class="rp-totals">
      <div><span>Earned</span><b>${f(d.income)}</b></div><div><span>Spent</span><b>${f(d.expense)}</b></div>
      <div><span>Kept</span><b>${f(d.kept)}</b></div><div><span>Kept %</span><b>${d.rate == null ? '—' : `${Math.round(d.rate * 100)}%`}</b></div>
    </section>
    <h2>Where the money went</h2>
    <table><thead><tr><th>Category</th><th></th><th>Spent</th><th>Share</th></tr></thead><tbody>
      ${d.categories.map((c) => `<tr><td>${esc(c.name)}</td><td>${bar(c.share)}</td><td>${f(c.amount)}</td><td>${Math.round(c.share * 100)}%</td></tr>`).join('') || '<tr><td colspan="4">Nothing spent.</td></tr>'}
    </tbody></table>
    ${d.months.length > 1 ? `<h2>Month by month</h2><table><thead><tr><th>Month</th><th>Earned</th><th>Spent</th><th>Kept</th></tr></thead><tbody>${d.months.map((m) => `<tr><td>${esc(monthLabel(m.key))}</td><td>${f(m.income)}</td><td>${f(m.expense)}</td><td>${f(m.kept)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${d.subscriptions.length ? `<h2>Subscriptions</h2><table><thead><tr><th>Name</th><th>Amount</th><th>Next</th><th>A month</th></tr></thead><tbody>${d.subscriptions.map((s) => `<tr><td>${esc(s.name)}</td><td>${f(s.amount, s.currency)}</td><td>${esc(s.next || '')}</td><td>${s.monthly == null ? '—' : f(s.monthly)}</td></tr>`).join('')}<tr class="rp-sum"><td colspan="3">Total a month</td><td>${f(d.subsMonth)}</td></tr></tbody></table>` : ''}
    <h2>Accounts now</h2>
    <table><tbody>${d.accounts.map((a) => `<tr><td>${esc(a.name)}</td><td>${f(a.balance, a.currency)}</td></tr>`).join('')}</tbody></table>
    <p class="rp-foot">${d.records.length.toLocaleString()} records in this period. The Excel version lists every one.</p>
  </article>`;
}
