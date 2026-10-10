// Reports for any period: a month, quarter, year or your own dates. Totals
// with "vs the period before", money over time, and breakdowns by category,
// source, account, person and currency. Exports to Excel.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { formatMoney } from '../money.js';
import { todayISO, monthKey, monthLabel, addMonths, daysInMonth, isValidISO } from '../dates.js';
import { trendChart, dailyChart } from '../charts.js';
import { monthSheet } from '../importer.js';
import { workbook } from '../xlsx.js';
import * as Spending from './spending.js';

const PRESETS = [
  { id: 'month', name: 'Month' },
  { id: 'quarter', name: 'Quarter' },
  { id: 'year', name: 'Year' },
  { id: 'lastyear', name: 'Last year' },
  { id: 'all', name: 'All time' },
  { id: 'custom', name: 'Custom' },
];

const rs = { preset: 'month', month: null, from: null, to: null };

function range() {
  const today = todayISO();
  const m = rs.month || monthKey(today);
  const end = (k) => `${k}-${String(daysInMonth(k)).padStart(2, '0')}`;
  switch (rs.preset) {
    case 'quarter': {
      const q = Math.floor((Number(m.slice(5)) - 1) / 3);
      const first = `${m.slice(0, 4)}-${String(q * 3 + 1).padStart(2, '0')}`;
      return { from: `${first}-01`, to: end(addMonths(first, 2)), label: `Q${q + 1} ${m.slice(0, 4)}`, step: 3 };
    }
    case 'year': return { from: `${m.slice(0, 4)}-01-01`, to: `${m.slice(0, 4)}-12-31`, label: m.slice(0, 4), step: 12 };
    case 'lastyear': { const y = Number(today.slice(0, 4)) - 1; return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) }; }
    case 'all': {
      const dates = ctx.state.tx.map((t) => t.date).sort();
      return { from: dates[0] || today, to: dates.at(-1) > today ? dates.at(-1) : today, label: 'All time' };
    }
    case 'custom': {
      const from = isValidISO(rs.from || '') ? rs.from : `${monthKey(today)}-01`;
      const to = isValidISO(rs.to || '') && rs.to >= from ? rs.to : today;
      return { from, to, label: `${from} → ${to}` };
    }
    default: return { from: `${m}-01`, to: end(m), label: monthLabel(m), step: 1 };
  }
}

function delta(now, before, { goodWhenUp = true } = {}) {
  if (!before) return '<span class="delta muted">no data before</span>';
  const p = Math.round(((now - before) / Math.abs(before)) * 100);
  if (!p) return '<span class="delta muted">same as before</span>';
  const good = goodWhenUp ? p > 0 : p < 0;
  return `<span class="delta ${good ? 'income' : 'expense'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p)}% vs before</span>`;
}

function table(head, rows) {
  return `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="muted">Nothing in this period.</td></tr>`}</tbody></table></div>`;
}

export function view() {
  const { state } = ctx;
  const r0 = range();
  const r = M.report(state, r0.from, r0.to);
  const p = r.prev;
  const money = ctx.money;
  const cat = (id) => M.category(state, id)?.name || 'Unknown';
  const acc = (id) => M.account(state, id)?.name || 'Unknown';
  const who = (id) => M.person(state, id)?.name || 'Unknown';
  const series = M.reportSeries(state, r0.from, r0.to);
  const today = todayISO();
  const chart = series.unit === 'day'
    ? dailyChart(series.rows.map((x, i) => ({ day: i + 1, iso: x.key, amount: x.expense, future: x.key > today })), (c) => money(c))
    : trendChart(series.rows.map((x) => ({ key: x.key, income: x.income, expense: x.expense })), (c) => money(c));
  const prevCat = new Map(p.spending.rows.map((x) => [x.id, x.amount]));
  const kpi = (k, v, d, cls = '') => `<div class="kpi"><span class="k">${k}</span><b class="${cls}">${v}</b>${d || ''}</div>`;
  const tips = rs.preset === 'month' ? M.insights(state, r0.from.slice(0, 7), today) : [];
  const year = rs.preset === 'year' || rs.preset === 'lastyear' ? M.yearOverview(state, Number(r0.from.slice(0, 4))) : null;

  return `<header class="top"><div><h1>Reports</h1><div class="sub">${esc(r0.label)} · ${r.days} day${r.days === 1 ? '' : 's'} · ${r.count} record${r.count === 1 ? '' : 's'}</div></div>
    <div class="btns-inline"><a class="btn" href="#review">✨ Year in review</a><button class="btn" data-act="rep-export">Export to Excel</button></div></header>
  <div class="rep-bar">
    <div class="chips">${PRESETS.map((x) => `<button class="chip" data-act="rep-preset" data-preset="${x.id}" aria-pressed="${rs.preset === x.id}">${x.name}</button>`).join('')}</div>
    ${r0.step ? `<div class="month-switch"><button class="icon-btn" data-act="rep-step" data-step="-1" aria-label="Previous">‹</button><b>${esc(r0.label)}</b><button class="icon-btn" data-act="rep-step" data-step="1" aria-label="Next">›</button></div>` : ''}
    ${rs.preset === 'custom' ? `<div class="rep-dates"><input type="date" id="rep-from" value="${r0.from}" aria-label="From"><span class="muted">to</span><input type="date" id="rep-to" value="${r0.to}" aria-label="To"></div>` : ''}
  </div>
  <section class="card rep-kpis">
    ${kpi('Earned', ctx.countUp(r.income, 'r-in'), delta(r.income, p.income), 'income')}
    ${kpi('Spent', ctx.countUp(r.expense, 'r-out'), delta(r.expense, p.expense, { goodWhenUp: false }), 'expense')}
    ${kpi('Kept', ctx.countUp(r.net, 'r-net'), delta(r.net, p.net))}
    ${kpi('Saved', r.savingsRate == null ? '–' : `${Math.round(r.savingsRate * 100)}%`, `<span class="delta muted">target ${M.savingsJar(state)?.pct ?? 0}%</span>`)}
    ${kpi('Spent per day', money(Math.round(r.perDay / 100) * 100), delta(r.perDay, p.perDay, { goodWhenUp: false }))}
    ${kpi('No-spend days', String(r.noSpendDays), `<span class="delta muted">of ${r.days}</span>`)}
    ${r.loansOut || r.loansIn ? kpi('Loans', `${money(r.loansOut)} out`, `<span class="delta muted">${money(r.loansIn)} back in</span>`) : ''}
  </section>
  <section class="card"><h2>${series.unit === 'day' ? 'Spending per day' : 'Earned and spent per month'}</h2>${chart}
    ${series.unit === 'month' ? '<div class="legend"><span><i style="background:var(--income)"></i>Earned</span><span><i style="background:var(--expense)"></i>Spent</span></div>' : ''}</section>
  ${tips.length ? `<section class="card"><h2>What your money says</h2>${tips.map(ctx.tipCard).join('')}</section>` : ''}
  <section class="card"><h2>Spending by category <span class="right muted">${money(r.expense)}</span></h2>
    ${table(['Category', 'Spent', 'Share', 'Before', 'Records'], r.spending.rows.map((x) => {
    const b = prevCat.get(x.id) || 0;
    const d = b ? Math.round(((x.amount - b) / b) * 100) : null;
    return `<tr class="click" data-act="rep-cat" data-cat="${esc(x.id)}" data-type="expense"><td>${ctx.dot(ctx.catColor(x.id))}${esc(cat(x.id))}</td><td>${money(x.amount)}</td><td>${Math.round(x.share * 100)}%</td><td>${b ? `${money(b)} <span class="${d > 0 ? 'expense' : 'income'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}%</span>` : '–'}</td><td>${x.count}</td></tr>`;
  }))}</section>
  <section class="card"><h2>Income by source <span class="right muted">${money(r.income)}</span></h2>
    ${table(['Source', 'Earned', 'Share', 'Records'], r.sources.rows.map((x) => `<tr class="click" data-act="rep-cat" data-cat="${esc(x.id)}" data-type="income"><td>${ctx.dot(ctx.catColor(x.id))}${esc(cat(x.id))}</td><td class="income">${money(x.amount)}</td><td>${Math.round(x.share * 100)}%</td><td>${x.count}</td></tr>`))}</section>
  <section class="card"><h2>By account</h2>
    ${table(['Account', 'In', 'Out', 'Records'], r.byAccount.map((x) => `<tr class="click" data-act="acc-open" data-id="${esc(x.id)}"><td>${esc(acc(x.id))}</td><td class="income">${x.income ? money(x.income) : '–'}</td><td>${x.expense ? money(x.expense) : '–'}</td><td>${x.count}</td></tr>`))}</section>
  <section class="card"><h2>With people</h2>
    ${table(['Person', 'Received', 'Given', 'Records'], r.byPerson.map((x) => `<tr class="click" data-act="person-open" data-id="${esc(x.id)}"><td>${esc(who(x.id))}</td><td class="income">${x.income ? money(x.income) : '–'}</td><td>${x.expense ? money(x.expense) : '–'}</td><td>${x.count}</td></tr>`))}</section>
  ${r.byCurrency.length > 1 || (r.byCurrency[0] && r.byCurrency[0].id !== state.settings.currency) ? `<section class="card"><h2>By currency <span class="right muted">in each currency</span></h2>
    ${table(['Currency', 'In', 'Out'], r.byCurrency.map((x) => `<tr><td>${esc(x.id)}</td><td class="income">${formatMoney(x.income, '')}</td><td>${formatMoney(x.expense, '')}</td></tr>`))}</section>` : ''}
  <section class="card"><h2>Biggest expenses</h2>${r.biggest.length ? `<div class="list">${r.biggest.map((t) => ctx.txRow(t, { showDate: true })).join('')}</div>` : '<p class="muted" style="margin:0">None in this period.</p>'}</section>
  ${year ? `<section class="card"><h2>Month by month · ${esc(r0.from.slice(0, 4))}</h2>
    ${table(['Month', 'Earned', 'Spent', 'Kept', '%'], year.rows.map((x) => `<tr class="${x.income || x.expense ? '' : 'dim'}"><td>${monthLabel(x.key, true).slice(0, 3)}</td><td class="income">${x.income ? formatMoney(x.income, '', { compact: true }) : '–'}</td><td>${x.expense ? formatMoney(x.expense, '', { compact: true }) : '–'}</td><td>${x.income || x.expense ? formatMoney(x.net, '', { compact: true }) : '–'}</td><td>${x.savingsRate == null ? '–' : `${Math.round(x.savingsRate * 100)}%`}</td></tr>`))}</section>` : ''}`;
}

function exportReport() {
  const { state } = ctx;
  const r0 = range();
  const r = M.report(state, r0.from, r0.to);
  const b = state.settings.currency;
  const v = (c) => ({ v: c / 100, t: 'money' });
  const cat = (id) => M.category(state, id)?.name || 'Unknown';
  const sheets = [
    { name: 'Summary', header: false, cols: [24, 18, 18], rows: [
      [{ v: `Report ${r0.label}`, bold: true }], [`${r0.from} to ${r0.to}`], [],
      ['', { v: 'This period', bold: true }, { v: 'Period before', bold: true }],
      [`Earned (${b})`, v(r.income), v(r.prev.income)], [`Spent (${b})`, v(r.expense), v(r.prev.expense)], [`Kept (${b})`, v(r.net), v(r.prev.net)],
      ['Saved %', r.savingsRate == null ? '' : `${Math.round(r.savingsRate * 100)}%`, r.prev.savingsRate == null ? '' : `${Math.round(r.prev.savingsRate * 100)}%`],
      [`Spent per day (${b})`, v(r.perDay), v(r.prev.perDay)], ['No-spend days', r.noSpendDays, r.prev.noSpendDays], ['Records', r.count, r.prev.count],
    ] },
    { name: 'Records', ...monthSheet(state, r0.label, r.list) },
    { name: 'Categories', cols: [26, 16, 10, 10], rows: [['Category', `Spent (${b})`, 'Share', 'Records'], ...r.spending.rows.map((x) => [cat(x.id), v(x.amount), `${Math.round(x.share * 100)}%`, x.count])], filterRows: r.spending.rows.length },
    { name: 'Income sources', cols: [26, 16, 10, 10], rows: [['Source', `Earned (${b})`, 'Share', 'Records'], ...r.sources.rows.map((x) => [cat(x.id), v(x.amount), `${Math.round(x.share * 100)}%`, x.count])] },
    { name: 'People', cols: [24, 16, 16, 10], rows: [['Person', `Received (${b})`, `Given (${b})`, 'Records'], ...r.byPerson.map((x) => [M.person(state, x.id)?.name || '', v(x.income), v(x.expense), x.count])] },
  ];
  ctx.download(`finance-report-${r0.from}_${r0.to}.xlsx`, workbook(sheets), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

export function onClick(act, el) {
  if (act === 'rep-preset') {
    rs.preset = el.dataset.preset;
    if (rs.preset === 'custom' && !rs.from) { const r0 = range(); rs.from = r0.from; rs.to = r0.to; }
    ctx.render({ enter: true });
    return true;
  }
  if (act === 'rep-step') {
    const r0 = range();
    rs.month = addMonths(rs.month || monthKey(todayISO()), Number(el.dataset.step) * (r0.step || 1));
    ctx.render({ enter: true });
    return true;
  }
  if (act === 'rep-cat') {
    const r0 = range();
    Spending.openCategory(el.dataset.cat, r0, el.dataset.type);
    return true;
  }
  if (act === 'rep-export') { exportReport(); return true; }
  return false;
}

export function onChange(el) {
  if (el.id === 'rep-from' || el.id === 'rep-to') {
    rs[el.id === 'rep-from' ? 'from' : 'to'] = el.value;
    ctx.render({ enter: true });
    return true;
  }
  return false;
}
