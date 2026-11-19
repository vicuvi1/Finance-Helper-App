// The Year summary card of Reports → Year in review (js/yearsummary.js):
// income and spending per month, top 5 categories against last year, savings
// rate, biggest purchases, net worth, no-spend days and income by source.
// The bars grow in (transform only) and the figures count up; with reduced
// motion both just appear.

import { ctx, esc } from '../ctx.js';
import { yearSummary } from '../yearsummary.js';
import { category } from '../model.js';
import { monthLabel, dayLabel } from '../dates.js';

const catOf = (id) => category(ctx.state, id) || { name: 'Other', emoji: '' };

function bars(months, money) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.income, m.spending)));
  const h = (v) => (v > 0 ? Math.max(2, (v / max) * 100) : 0);
  return `<div class="ys-bars" role="img" aria-label="Income and spending per month" data-testid="ys-bars">${months.map((m, i) => `<div class="ys-m${m.future ? ' none' : ''}" style="--i:${i}" title="${esc(monthLabel(m.key))}: income ${esc(money(m.income))}, spending ${esc(money(m.spending))}">
    <div class="ys-bb"><i class="in" style="height:${h(m.income)}%"></i><i class="out" style="height:${h(m.spending)}%"></i></div><span>${esc(monthLabel(m.key, true).slice(0, 3))}</span></div>`).join('')}</div>`;
}

const change = (c) => (c == null ? '<span class="muted small">new</span>' : `<span class="delta ${c > 0 ? 'expense' : 'income'}">${c > 0 ? '▲' : '▼'} ${Math.abs(Math.round(c * 100))}%</span>`);

export function card(year, today) {
  const money = ctx.money;
  const s = yearSummary(ctx.state, year, today);
  if (!s.records) return '';
  const rnd = (c) => Math.round(c / 100) * 100;
  const rate = s.savingsRate == null ? '–' : `${Math.round(s.savingsRate * 100)}%`;
  const nw = s.netWorth;
  return `<section class="card ys" data-testid="year-summary"><h2>Year summary · ${s.year}${s.partial ? ' <span class="muted small">so far</span>' : ''}</h2>
    <div class="ys-top">
      <div><span class="k">Income</span><b class="income" data-testid="ys-income">${ctx.countUp(s.income, 'ys-in')}</b></div>
      <div><span class="k">Spending</span><b class="expense" data-testid="ys-spending">${ctx.countUp(s.spending, 'ys-out')}</b></div>
      <div><span class="k">Savings rate</span><b data-testid="ys-rate">${rate}</b></div>
      <div><span class="k">No-spend days</span><b data-testid="ys-nospend">${s.noSpendDays}</b></div>
    </div>
    ${bars(s.months, money)}
    <div class="legend"><span><i style="background:var(--income)"></i>Income</span><span><i style="background:var(--expense)"></i>Spending</span></div>
    ${nw ? `<p class="ys-nw" data-testid="ys-networth"><span class="k">Net worth</span> <b>${money(rnd(nw.start))}</b> → <b>${money(rnd(nw.end))}</b> <span class="muted small">(${nw.end - nw.start >= 0 ? '+' : '−'}${money(Math.abs(rnd(nw.end - nw.start)))})</span></p>` : ''}
    <div class="ys-cols">
      <div><h3 class="yr-h3">Top categories${s.partial ? '' : ''} <span class="muted small">vs last year</span></h3>
        ${s.topCategories.length ? `<div class="list">${s.topCategories.map((c, i) => `<div class="tx" style="--i:${i}" data-testid="ys-cat"><span class="t"><b>${esc(`${catOf(c.id).emoji ? `${catOf(c.id).emoji} ` : ''}${catOf(c.id).name}`)}</b><span>${Math.round(c.share * 100)}% of spending</span></span><span class="amount">${money(c.amount)} ${change(c.change)}</span></div>`).join('')}</div>` : '<p class="muted">No spending yet.</p>'}</div>
      <div><h3 class="yr-h3">Biggest purchases</h3>
        ${s.biggest.length ? `<div class="list">${s.biggest.map((t, i) => `<div class="tx" style="--i:${i}" data-testid="ys-big"><span class="t"><b>${esc(t.note || catOf(t.category).name)}</b><span>${esc(dayLabel(t.date))}</span></span><span class="amount expense">${money(t.amount)}</span></div>`).join('')}</div>` : '<p class="muted">Nothing yet.</p>'}</div>
    </div>
    ${s.sources ? `<h3 class="yr-h3">Income by source</h3><div class="list" data-testid="ys-sources">${s.sources.map((x) => `<div class="tx"><span class="t"><b>${esc(x.name)}</b><span>${Math.round(x.share * 100)}% of income</span></span><span class="amount income">${money(x.amount)}</span></div>`).join('')}</div>` : ''}
    <p class="muted small" style="margin-bottom:0">Same numbers as the Log: records that don't count as income or spending are left out, and other currencies are valued at the rate of their day.</p>
  </section>`;
}
