// Reports → Year in review: the month-by-month table and net worth line (numbers: js/yearview.js).

import { ctx, esc } from '../ctx.js';
import { formatMoney } from '../money.js';
import { todayISO, monthLabel } from '../dates.js';
import { lineChart } from '../charts.js';
import { yearData } from '../yearview.js';

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

/** Month by month (kept, savings rate, net worth at each month's end) and the net worth line,
 * shown in Reports → Year in review under the Year summary. */
export function card(year, today = todayISO()) {
  const { state } = ctx;
  const y = yearData(state, year, today);
  if (!y.count) return '';
  const cur = state.settings.currency || 'MDL';
  const f = (c) => esc(formatMoney(c, cur));
  const fc = (c) => esc(formatMoney(c, cur, { compact: true }));
  const nwPoints = y.months.filter((m) => m.netWorth != null).map((m) => ({ value: m.netWorth, date: m.key, label: monthLabel(m.key, true).slice(0, 3) }));
  const rows = y.months.map((m) => `<tr class="${m.future || m.empty ? 'dim' : ''}">
      <td>${esc(monthLabel(m.key).split(' ')[0])}</td><td class="num income">${m.income ? f(m.income) : '—'}</td><td class="num expense">${m.expense ? f(m.expense) : '—'}</td>
      <td class="num">${m.income || m.expense ? f(m.net) : '—'}</td><td class="num">${pct(m.savingsRate)}</td><td class="num">${m.netWorth != null && !m.future ? fc(m.netWorth) : '—'}</td></tr>`).join('');
  return `<div class="yr-grid" data-testid="year-months">
    <section class="card"><h2>Month by month · ${year}</h2><div class="st-wrap"><table class="yr-table"><thead><tr><th>Month</th><th class="num">Earned</th><th class="num">Spent</th><th class="num">Kept</th><th class="num">Saved</th><th class="num">Net worth</th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><td><b>${year}</b></td><td class="num income"><b>${f(y.total.income)}</b></td><td class="num expense"><b>${f(y.total.expense)}</b></td><td class="num"><b>${f(y.total.net)}</b></td><td class="num"><b>${pct(y.total.savingsRate)}</b></td><td></td></tr></tfoot></table></div>
      <p class="muted small" style="margin-bottom:0">A month: about ${fc(y.avg.income)} in, ${fc(y.avg.expense)} out.${y.worst ? ` Hardest month: ${esc(monthLabel(y.worst.key).split(' ')[0])} (kept ${f(y.worst.net)}).` : ''}</p></section>
    <section class="card"><h2>Net worth at each month's end</h2>${nwPoints.length > 1 ? lineChart(nwPoints, (c) => formatMoney(c, cur), { label: 'Net worth' }) : '<p class="muted">Shows once there are two months.</p>'}
      ${y.netWorth ? `<p class="small" style="margin-bottom:0">${y.netWorth.change >= 0 ? '+' : ''}${f(y.netWorth.change)} since ${esc(monthLabel(y.netWorth.fromKey).split(' ')[0])}.</p>` : ''}</section>
  </div>`;
}
