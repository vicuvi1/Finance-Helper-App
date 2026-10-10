// Year in review (#review): the year's story in highlights, and the income
// summary for taxes with an Excel export. Opened from Reports.

import { ctx, esc } from '../ctx.js';
import { formatMoney } from '../money.js';
import { todayISO, monthLabel, dayLabel } from '../dates.js';
import { yearReview, taxSummary } from '../yearreview.js';
import { yearOverview } from '../model.js';
import { workbook } from '../xlsx.js';
import { workText } from '../workhours.js';

let year = null;
const curYear = () => year || Number(todayISO().slice(0, 4));

const pctChange = (now, before) => (before ? Math.round(((now - before) / Math.abs(before)) * 100) : null);
function vsLine(now, before, goodWhenUp = true) {
  const p = pctChange(now, before);
  if (p == null) return '';
  if (!p) return '<span class="delta muted">same as last year</span>';
  const good = goodWhenUp ? p > 0 : p < 0;
  return `<span class="delta ${good ? 'income' : 'expense'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p)}% vs ${curYear() - 1}</span>`;
}

const tile = (icon, label, big, sub = '') => `<div class="yr-tile"><span class="yr-ic" aria-hidden="true">${icon}</span><span class="k">${label}</span><b>${big}</b>${sub ? `<span class="muted small">${sub}</span>` : ''}</div>`;

export function view() {
  const { state } = ctx;
  const money = ctx.money;
  const y = curYear();
  const today = todayISO();
  const r = yearReview(state, y, today);
  const t = taxSummary(state, y);
  const base = state.settings.currency;
  const kept = r.savingsRate == null ? '–' : `${Math.round(r.savingsRate * 100)}%`;
  const nw = r.netWorth.end - r.netWorth.start;
  const work = workText(state, r.expense, today);
  const hasData = r.records > 0;
  const chart = yearBars(yearOverview(state, y).rows, money);

  return `<header class="top"><div><h1>${y} in review</h1><div class="sub">${r.partial ? `So far, up to ${dayLabel(today)}` : 'The whole year'} · ${r.records} records</div></div>
    <div class="month-switch"><button class="icon-btn" data-act="yr-step" data-step="-1" aria-label="Previous year">‹</button><b>${y}</b><button class="icon-btn" data-act="yr-step" data-step="1" aria-label="Next year" ${y >= Number(today.slice(0, 4)) ? 'disabled' : ''}>›</button></div></header>
  ${!hasData ? `<div class="empty"><b>Nothing logged in ${y}</b>Pick another year.</div>` : `
  <section class="card yr-hero">
    <div class="yr-big"><span class="k">You kept</span><span class="fig">${ctx.countUp(r.net, 'yr-net')}</span><span class="yr-pct">${kept} of what you earned</span>${vsLine(r.net, r.vs?.net)}</div>
    <div class="yr-split">
      <div><span class="k">Earned</span><b class="income">${ctx.countUp(r.income, 'yr-in')}</b>${vsLine(r.income, r.vs?.income)}</div>
      <div><span class="k">Spent</span><b class="expense">${ctx.countUp(r.expense, 'yr-out')}</b>${vsLine(r.expense, r.vs?.expense, false)}${work ? `<span class="muted small">≈ ${esc(work)} of work</span>` : ''}</div>
    </div>
  </section>
  <div class="yr-tiles">
    ${r.best ? tile('🏆', 'Best month', esc(monthLabel(r.best.key)), `kept ${money(r.best.net)}${r.best.savingsRate != null ? ` · ${Math.round(r.best.savingsRate * 100)}%` : ''}`) : ''}
    ${r.priciest ? tile('💸', 'Priciest month', esc(monthLabel(r.priciest.key)), `spent ${money(r.priciest.expense)}`) : ''}
    ${r.topCategories[0] ? tile('🛒', 'Most went to', esc(r.topCategories[0].name), r.topCategories.map((c) => `${esc(c.name)} ${Math.round(c.share * 100)}%`).join(' · ')) : ''}
    ${r.topSource ? tile('💼', 'Main income', esc(r.topSource.name), `${money(r.topSource.amount)} · ${Math.round(r.topSource.share * 100)}% of income`) : ''}
    ${r.topClient ? tile('🤝', 'Top client / payer', esc(r.topClient.name), money(r.topClient.amount)) : ''}
    ${r.biggest ? tile('🧾', 'Biggest expense', money(M_B(r.biggest)), `${esc(r.biggest.note || '')} · ${dayLabel(r.biggest.date)}`) : ''}
    ${tile('🔥', 'Logging', `${r.loggedDays} days`, `longest streak ${r.streak} days · ${r.noSpendDays} no-spend days`)}
    ${tile('📈', 'Net worth', `${nw >= 0 ? '+' : '−'}${money(Math.abs(Math.round(nw / 100) * 100))}`, `${money(Math.round(r.netWorth.start / 100) * 100)} → ${money(Math.round(r.netWorth.end / 100) * 100)}`)}
    ${r.goalsDone.length ? tile('🎯', 'Goals reached', String(r.goalsDone.length), esc(r.goalsDone.join(', '))) : ''}
  </div>
  <section class="card"><h2>Month by month</h2>${chart}<div class="legend"><span><i style="background:var(--income)"></i>Earned</span><span><i style="background:var(--expense)"></i>Spent</span></div></section>`}
  <section class="card yr-tax"><h2>Income for taxes · ${y} <button class="btn right" data-act="yr-tax-export" ${t.rows.length ? '' : 'disabled'}>Export for taxes (.xlsx)</button></h2>
    <div class="yr-tax-total"><span class="fig">${money(t.total)}</span><span class="muted">${t.rows.length} income record${t.rows.length === 1 ? '' : 's'} in ${esc(base)}, at the rate of each day</span></div>
    ${t.rows.length ? `<div class="yr-tax-grid">
      ${taxTable('By currency', t.byCurrency.map((g) => [esc(g.name), g.name === base ? '' : formatMoney(g.amount, g.name), money(g.base)]), ['Currency', 'Received', `In ${esc(base)}`])}
      ${taxTable('By source', t.bySource.map((g) => [esc(g.name || 'Other'), String(g.count), money(g.base)]), ['Source', 'Records', `In ${esc(base)}`])}
      ${t.byPayer.length ? taxTable('By payer', t.byPayer.map((g) => [esc(g.name), String(g.count), money(g.base)]), ['Payer', 'Records', `In ${esc(base)}`]) : ''}
    </div>` : ''}
    <p class="muted small" style="margin-bottom:0">Every income except loans and moves between your accounts. The export lists each one with its date, payer, original currency, rate and amount in ${esc(base)}. Tax rules depend on your status; check the numbers with an accountant or the tax office.</p>
  </section>`;
}

// Earned and spent for all 12 months, as bars; hover a month for its numbers.
function yearBars(rows, money) {
  const max = Math.max(1, ...rows.map((m) => Math.max(m.income, m.expense)));
  const h = (v) => (v ? Math.max(2, (v / max) * 100) : 0);
  return `<div class="yr-bars" role="img" aria-label="Earned and spent per month">${rows.map((m) => {
    const label = monthLabel(m.key);
    return `<div class="yr-m${m.income || m.expense ? '' : ' none'}" title="${label}: earned ${money(m.income)}, spent ${money(m.expense)}"><div class="yr-bb"><i class="in" style="height:${h(m.income)}%"></i><i class="out" style="height:${h(m.expense)}%"></i></div><span>${label.slice(0, 3)}</span></div>`;
  }).join('')}</div>`;
}

// Same as model B(): the amount in your currency.
const M_B = (t) => t.base ?? t.amount;

function taxTable(title, rows, head) {
  return `<div><h3 class="yr-h3">${title}</h3><div class="table-wrap"><table><thead><tr>${head.map((h, i) => `<th class="${i ? 'num' : ''}">${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'num' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}

function exportTax() {
  const { state } = ctx;
  const y = curYear();
  const t = taxSummary(state, y);
  const base = state.settings.currency;
  const v = (c) => ({ v: c / 100, t: 'money' });
  const sheets = [
    { name: 'Summary', header: false, cols: [26, 18, 18], rows: [
      [{ v: `Income ${y}`, bold: true }], [`All income except loans and moves between accounts, in ${base} at the rate of each day.`], [],
      [{ v: `Total (${base})`, bold: true }, { ...v(t.total), bold: true }], [],
      [{ v: 'By currency', bold: true }, { v: 'Received', bold: true }, { v: `In ${base}`, bold: true }],
      ...t.byCurrency.map((g) => [g.name, v(g.amount), v(g.base)]), [],
      [{ v: 'By month', bold: true }, '', { v: `In ${base}`, bold: true }],
      ...t.byMonth.map((m) => [monthLabel(m.key), '', v(m.base)]), [],
      [{ v: 'By source', bold: true }, { v: 'Records', bold: true }, { v: `In ${base}`, bold: true }],
      ...t.bySource.map((g) => [g.name || 'Other', g.count, v(g.base)]),
    ] },
    { name: 'Incomes', cols: [12, 18, 22, 28, 18, 9, 14, 10, 14], filterRows: t.rows.length, rows: [
      ['Date', 'Source', 'Payer', 'Note', 'Account', 'Currency', 'Amount', 'Rate', `In ${base}`],
      ...t.rows.map((x) => [{ v: x.date, t: 'date' }, x.source, x.payer, x.note, x.account, x.currency, v(x.amount), x.rate, v(x.base)]),
    ] },
  ];
  ctx.download(`income-${y}-for-taxes.xlsx`, workbook(sheets), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

export function onClick(act, el) {
  if (act === 'yr-step') { year = curYear() + Number(el.dataset.step); ctx.render({ enter: true }); return true; }
  if (act === 'yr-tax-export') { exportTax(); return true; }
  return false;
}
