// Reports for any period: a month, quarter, year or your own dates. Totals
// with "vs the period before", money over time, and breakdowns by category,
// source, account, person and currency. Exports to Excel.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { formatMoney } from '../money.js';
import { todayISO, monthKey, monthLabel, addMonths, daysInMonth, isValidISO } from '../dates.js';
import { trendChart, dailyChart, sankeyChart } from '../charts.js';
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

const rs = { preset: 'month', month: null, from: null, to: null, sankeyMode: 'jars' };

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
  return `<div class="table-wrap"><table class="rep-table"><thead><tr>${head.map((h, i) => `<th${i > 0 ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="muted" style="text-align:center; padding:18px;">Nothing in this period.</td></tr>`}</tbody></table></div>`;
}

export function view() {
  const { state } = ctx;
  const r0 = range();
  const r = M.report(state, r0.from, r0.to, { today: todayISO() });
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

  const kpi = (k, v, d, cls = '', icon = '') => `<div class="rep-kpi-card ${cls}">
    <div class="rep-kpi-head"><span class="k">${k}</span>${icon ? `<span class="rep-kpi-icon">${icon}</span>` : ''}</div>
    <b class="rep-kpi-val ${cls}">${v}</b>
    <div class="rep-kpi-sub">${d || ''}</div>
  </div>`;

  const savingsPct = r.savingsRate == null ? null : Math.round(r.savingsRate * 100);
  const savingsVal = savingsPct == null ? '–' : (savingsPct < 0 ? '0%' : `${savingsPct}%`);
  const savingsSub = savingsPct != null && savingsPct < 0
    ? `<span class="delta expense">Deficit: ${money(Math.abs(r.net))}</span>`
    : `<span class="delta muted">target ${M.savingsJar(state)?.pct ?? 0}%</span>`;
  const savingsClass = savingsPct != null && savingsPct < 0 ? 'deficit' : (savingsPct >= (M.savingsJar(state)?.pct ?? 0) ? 'income' : '');
  const netClass = r.net < 0 ? 'deficit' : (r.net > 0 ? 'income' : '');

  const tips = rs.preset === 'month' ? M.insights(state, r0.from.slice(0, 7), today) : [];
  const year = rs.preset === 'year' || rs.preset === 'lastyear' ? M.yearOverview(state, Number(r0.from.slice(0, 4))) : null;

  const sankeyData = {
    income: r.income,
    expense: r.expense,
    sources: r.sources.rows.map((x) => ({
      id: x.id,
      name: cat(x.id),
      amount: x.amount,
      color: ctx.catColor(x.id),
    })),
    jars: state.settings.jars.map((j, i) => ({
      id: j.id,
      name: j.name,
      emoji: j.emoji,
      pct: j.pct,
      savings: j.savings,
      color: j.savings ? 'var(--gold)' : `var(--c${(i % 8) + 1})`,
    })),
    categories: r.spending.rows.map((x) => ({
      id: x.id,
      name: cat(x.id),
      amount: x.amount,
      jarId: M.jarOf(state, x.id),
      color: ctx.catColor(x.id),
    })),
  };
  const sankey = sankeyChart(sankeyData, (c) => money(c), { mode: rs.sankeyMode || 'jars' });

  return `<header class="top"><div><h1>Reports</h1><div class="sub">${esc(r0.label)} · ${r.days} day${r.days === 1 ? '' : 's'} · ${r.count} record${r.count === 1 ? '' : 's'}</div></div>
    <div class="btns rep-head-btns"><button class="btn" data-act="recap-open" data-key="${rs.preset === 'month' ? rs.month || monthKey(today) : addMonths(monthKey(today), -1)}">✨ ${rs.preset === 'month' && (rs.month || monthKey(today)) === monthKey(today) ? 'Recap so far' : 'Month recap'}</button><button class="btn" data-act="rep-export">Export to Excel</button></div></header>
  <div class="rep-bar">
    <div class="chips">${PRESETS.map((x) => `<button class="chip" data-act="rep-preset" data-preset="${x.id}" aria-pressed="${rs.preset === x.id}">${x.name}</button>`).join('')}</div>
    ${r0.step ? `<div class="month-switch"><button class="icon-btn" data-act="rep-step" data-step="-1" aria-label="Previous">‹</button><b>${esc(r0.label)}</b><button class="icon-btn" data-act="rep-step" data-step="1" aria-label="Next">›</button></div>` : ''}
    ${rs.preset === 'custom' ? `<div class="rep-dates"><input type="date" id="rep-from" value="${r0.from}" aria-label="From"><span class="muted">to</span><input type="date" id="rep-to" value="${r0.to}" aria-label="To"></div>` : ''}
  </div>

  <section class="rep-kpi-grid rep-kpis">
    ${kpi('Earned', ctx.countUp(r.income, 'r-in'), delta(r.income, p.income), 'income', '💰')}
    ${kpi('Spent', ctx.countUp(r.expense, 'r-out'), delta(r.expense, p.expense, { goodWhenUp: false }), 'expense', '💸')}
    ${kpi(r.net < 0 ? 'Net Deficit' : 'Kept (Net)', ctx.countUp(r.net, 'r-net'), delta(r.net, p.net), netClass, r.net < 0 ? '⚠️' : '🏦')}
    ${kpi('Saved', savingsVal, savingsSub, savingsClass, '🎯')}
    ${kpi(r.counted < r.days ? 'Spent / day so far' : 'Spent / day', money(Math.round(r.perDay / 100) * 100), delta(r.perDay, p.perDay, { goodWhenUp: false }), '', '📅')}
    ${kpi('No-spend days', String(r.noSpendDays), `<span class="delta muted">of ${r.counted}${r.counted < r.days ? ' so far' : ''}</span>`, r.noSpendDays > 0 ? 'income' : '', '✨')}
    ${r.loansOut || r.loansIn ? kpi('Loans', `${money(r.loansOut)} out`, `<span class="delta muted">${money(r.loansIn)} back in</span>`, '', '🤝') : ''}
  </section>

  <div class="rep-row-visuals">
    <section class="card rep-sankey-card">
      <div class="rep-card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
        <div>
          <h2 style="margin:0;">Cash flow flowchart</h2>
          <span class="sub muted">Visual money flow across income, smart jars, and spending</span>
        </div>
        <div class="chips small">
          <button class="chip" data-act="rep-sankey-mode" data-mode="jars" aria-pressed="${(rs.sankeyMode || 'jars') === 'jars'}">Smart Jars</button>
          <button class="chip" data-act="rep-sankey-mode" data-mode="direct" aria-pressed="${rs.sankeyMode === 'direct'}">Direct</button>
        </div>
      </div>
      <div class="rep-sankey-wrap">
        ${sankey}
      </div>
    </section>

    <section class="card rep-activity-card">
      <div>
        <h2 style="margin:0 0 4px 0;">${series.unit === 'day' ? 'Spending per day' : 'Earned and spent per month'}</h2>
        <span class="sub muted">${series.unit === 'day' ? 'Daily expenses timeline' : 'Monthly trend comparison'}</span>
      </div>
      <div style="margin: 14px 0;">${chart}</div>
      ${series.unit === 'month' ? '<div class="legend"><span><i style="background:var(--income)"></i>Earned</span><span><i style="background:var(--expense)"></i>Spent</span></div>' : ''}
    </section>
  </div>

  <div class="rep-row-tables">
    <div class="rep-col-left">
      <section class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h2 style="margin:0;">Spending by category</h2>
          <b class="expense">${money(r.expense)}</b>
        </div>
        ${table(['Category', 'Spent', 'Share', 'Before', 'Records'], r.spending.rows.map((x) => {
          const b = prevCat.get(x.id) || 0;
          const d = b ? Math.round(((x.amount - b) / b) * 100) : null;
          const sharePct = Math.round(x.share * 100);
          return `<tr class="click" data-act="rep-cat" data-cat="${esc(x.id)}" data-type="expense">
            <td><div class="rep-cat-name">${ctx.dot(ctx.catColor(x.id))}<span>${esc(cat(x.id))}</span></div></td>
            <td class="num font-num"><b>${money(x.amount)}</b></td>
            <td class="num"><div class="rep-share-cell"><div class="rep-share-bar"><i style="width:${sharePct}%; background:${ctx.catColor(x.id)}"></i></div><span class="font-num muted">${sharePct}%</span></div></td>
            <td class="num">${b ? `<span class="font-num">${money(b)}</span> <span class="delta ${d > 0 ? 'expense' : 'income'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}%</span>` : '<span class="muted">–</span>'}</td>
            <td class="num font-num muted">${x.count}</td>
          </tr>`;
        }))}
      </section>

      <div class="rep-sub-grid">
        <section class="card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h2 style="margin:0;">Income by source</h2>
            <b class="income">${money(r.income)}</b>
          </div>
          ${table(['Source', 'Earned', 'Share', 'Records'], r.sources.rows.map((x) => {
            const sharePct = Math.round(x.share * 100);
            return `<tr class="click" data-act="rep-cat" data-cat="${esc(x.id)}" data-type="income">
              <td><div class="rep-cat-name">${ctx.dot(ctx.catColor(x.id))}<span>${esc(cat(x.id))}</span></div></td>
              <td class="num income font-num"><b>${money(x.amount)}</b></td>
              <td class="num"><div class="rep-share-cell"><div class="rep-share-bar"><i style="width:${sharePct}%; background:${ctx.catColor(x.id)}"></i></div><span class="font-num muted">${sharePct}%</span></div></td>
              <td class="num font-num muted">${x.count}</td>
            </tr>`;
          }))}
        </section>

        <section class="card">
          <h2 style="margin:0 0 12px 0;">By account</h2>
          ${table(['Account', 'In', 'Out', 'Records'], r.byAccount.map((x) => `<tr class="click" data-act="acc-open" data-id="${esc(x.id)}">
            <td><b>${esc(acc(x.id))}</b></td>
            <td class="num income font-num">${x.income ? money(x.income) : '<span class="muted">–</span>'}</td>
            <td class="num expense font-num">${x.expense ? money(x.expense) : '<span class="muted">–</span>'}</td>
            <td class="num font-num muted">${x.count}</td>
          </tr>`))}
        </section>
      </div>

      ${r.byPerson.length ? `<section class="card">
        <h2 style="margin:0 0 12px 0;">With people</h2>
        ${table(['Person', 'Received', 'Given', 'Records'], r.byPerson.map((x) => `<tr class="click" data-act="person-open" data-id="${esc(x.id)}">
          <td><b>${esc(who(x.id))}</b></td>
          <td class="num income font-num">${x.income ? money(x.income) : '<span class="muted">–</span>'}</td>
          <td class="num expense font-num">${x.expense ? money(x.expense) : '<span class="muted">–</span>'}</td>
          <td class="num font-num muted">${x.count}</td>
        </tr>`))}
      </section>` : ''}

      ${r.byCurrency.length > 1 || (r.byCurrency[0] && r.byCurrency[0].id !== state.settings.currency) ? `<section class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h2 style="margin:0;">By currency</h2>
          <span class="sub muted">in each currency</span>
        </div>
        ${table(['Currency', 'In', 'Out'], r.byCurrency.map((x) => `<tr>
          <td><b>${esc(x.id)}</b></td>
          <td class="num income font-num">${formatMoney(x.income, '')}</td>
          <td class="num expense font-num">${formatMoney(x.expense, '')}</td>
        </tr>`))}
      </section>` : ''}
    </div>

    <div class="rep-col-right">
      <section class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h2 style="margin:0;">Biggest expenses</h2>
          <span class="sub muted">Top outflows</span>
        </div>
        ${r.biggest.length ? `<div class="rep-top-list">${r.biggest.map((t, idx) => `
          <div class="rep-top-tx">
            <span class="rep-tx-rank">#${idx + 1}</span>
            <div class="rep-tx-main">${ctx.txRow(t, { showDate: true })}</div>
          </div>`).join('')}</div>` : '<p class="muted" style="margin:0">None in this period.</p>'}
      </section>

      ${tips.length ? `<section class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h2 style="margin:0;">What your money says</h2>
          <span class="sub muted">Smart insights</span>
        </div>
        <div class="rep-tips-list">${tips.map(ctx.tipCard).join('')}</div>
      </section>` : ''}

      ${year ? `<section class="card">
        <h2 style="margin:0 0 12px 0;">Month by month · ${esc(r0.from.slice(0, 4))}</h2>
        ${table(['Month', 'Earned', 'Spent', 'Kept', '%'], year.rows.map((x) => `<tr class="${x.income || x.expense ? '' : 'dim'}">
          <td><b>${monthLabel(x.key, true).slice(0, 3)}</b></td>
          <td class="num income font-num">${x.income ? formatMoney(x.income, '', { compact: true }) : '<span class="muted">–</span>'}</td>
          <td class="num expense font-num">${x.expense ? formatMoney(x.expense, '', { compact: true }) : '<span class="muted">–</span>'}</td>
          <td class="num font-num">${x.income || x.expense ? formatMoney(x.net, '', { compact: true }) : '<span class="muted">–</span>'}</td>
          <td class="num font-num">${x.savingsRate == null ? '<span class="muted">–</span>' : `${Math.round(x.savingsRate * 100)}%`}</td>
        </tr>`))}
      </section>` : ''}
    </div>
  </div>`;
}

function exportReport() {
  const { state } = ctx;
  const r0 = range();
  const r = M.report(state, r0.from, r0.to, { today: todayISO() });
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
  if (act === 'rep-sankey-mode') {
    rs.sankeyMode = el.dataset.mode;
    ctx.render({ enter: true });
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
