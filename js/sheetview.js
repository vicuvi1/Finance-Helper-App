// Log → Sheet: modern financial spreadsheet with Google Sheets / Excel aesthetics.
// Includes interactive formula bar, month KPI summary chips, Day Net (B−D) column,
// category chips, sticky headers, jump-to-today, and live status footer metrics.

import { formatMoney } from './money.js';
import { daysInMonth, dowIndex } from './dates.js';
import { B } from './model.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = (c) => formatMoney(c, '');

// Romanian, the way the sheet wrote its dates and tab names.
export const LUNI = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
const DOW_RO = ['Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sâ', 'Du'];

export const roDate = (iso) => `${Number(iso.slice(8, 10))} ${LUNI[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
export const roMonth = (key) => { const n = LUNI[Number(key.slice(5, 7)) - 1]; return n[0].toUpperCase() + n.slice(1); };

const COLS = ['A', 'B', 'C', 'D', 'E', 'F'];

// The month's days, each with its incomes and expenses in the order logged.
export function sheetDays(state, key, extra = new Set()) {
  const byDate = new Map();
  for (const t of state.tx) {
    if (!t.date.startsWith(key) || t.type === 'transfer') continue;
    if (!byDate.has(t.date)) byDate.set(t.date, { inc: [], exp: [] });
    byDate.get(t.date)[t.type === 'income' ? 'inc' : 'exp'].push(t);
  }
  const order = (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id));
  const days = [];
  for (let d = 1; d <= daysInMonth(key); d++) {
    const date = `${key}-${String(d).padStart(2, '0')}`;
    const v = byDate.get(date) || { inc: [], exp: [] };
    v.inc.sort(order);
    v.exp.sort(order);
    days.push({ date, day: d, inc: v.inc, exp: v.exp, rows: Math.max(1, v.inc.length, v.exp.length) + (extra.has(date) ? 1 : 0) });
  }
  return days;
}

function dataCells(t, side, key, base) {
  const cur = t && t.currency && t.currency !== base ? `<span class="gs-cur-tag">${esc(t.currency)}</span>` : '';
  const id = esc(t?.id || '');
  const catTag = t?.categoryName ? `<span class="gs-cat-tag" title="Category: ${esc(t.categoryName)}">${esc(t.categoryName)}</span>` : '';
  return `<td class="gs-num ${side}"><span class="gs-flex"><input type="text" inputmode="decimal" autocomplete="off" data-sh="${key}|amount" data-id="${id}" value="${t ? plain(t.amount) : ''}" placeholder="0" aria-label="${side === 'in' ? 'Amount earned' : 'Amount invested'}">${cur}</span></td>
    <td class="gs-text"><span class="gs-flex gs-desc-flex"><input type="text" autocomplete="off" data-sh="${key}|note" data-id="${id}" value="${esc(t?.note || '')}" placeholder="Note…" aria-label="${side === 'in' ? 'Description' : 'Description2'}">${catTag}</span></td>`;
}

export function sheetHTML(state, key, { today, extra = new Set(), fmt, tabs }) {
  const yearBtns = tabs.years.map((y) => `<button type="button" class="gs-year${y === tabs.year ? ' on' : ''}" data-act="sh-year" data-year="${y}" aria-pressed="${y === tabs.year}">${y}</button>`).join('');
  const base = state.settings.currency;
  const cat = (id) => state.settings.categories.find((x) => x.id === id)?.name || '';

  const rows = [`<tr class="gs-head-row">
    <th class="gs-rn">1</th>
    <td class="gs-h"><span class="gs-h-flex">📅 Date</span></td>
    <td class="gs-h in"><span class="gs-h-flex"><span class="gs-col-pill in">+</span> Amount Earned</span></td>
    <td class="gs-h in"><span class="gs-h-flex">Income Note &amp; Category</span></td>
    <td class="gs-h out"><span class="gs-h-flex"><span class="gs-col-pill out">−</span> Amount Invested</span></td>
    <td class="gs-h out"><span class="gs-h-flex">Expense Note &amp; Category</span></td>
    <td class="gs-h net"><span class="gs-h-flex">Day Net (B−D)</span></td>
  </tr>`];

  let r = 2;
  let earned = 0;
  let spent = 0;
  let txCount = 0;
  let activeDays = 0;

  for (const d of sheetDays(state, key, extra)) {
    const di = dowIndex(d.date);
    const dayEarned = d.inc.filter((t) => !t.loan).reduce((a, t) => a + B(t), 0);
    const daySpent = d.exp.filter((t) => !t.loan).reduce((a, t) => a + B(t), 0);
    const dayNet = dayEarned - daySpent;
    const hasActivity = dayEarned > 0 || daySpent > 0;

    earned += dayEarned;
    spent += daySpent;
    txCount += d.inc.length + d.exp.length;
    if (hasActivity) activeDays++;

    for (let k = 0; k < d.rows; k++) {
      const inc = d.inc[k] && { ...d.inc[k], categoryName: cat(d.inc[k].category) };
      const exp = d.exp[k] && { ...d.exp[k], categoryName: cat(d.exp[k].category) };
      const isToday = d.date === today;
      const cls = [di >= 5 ? 'weekend' : '', isToday ? 'is-today' : '', d.date > today ? 'future' : '', k === 0 ? 'day-first' : 'day-more'].filter(Boolean).join(' ');
      const todayId = isToday && k === 0 ? ' id="gs-today-row"' : '';

      const dateCell = k === 0
        ? `<td class="gs-date" title="${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][di]}"><span class="gs-flex"><span class="gs-d-dow ${di >= 5 ? 'wknd' : ''}">${DOW_RO[di]}</span><span class="gs-dtext">${esc(roDate(d.date))}</span>${isToday ? '<span class="gs-today">azi</span>' : ''}<button type="button" class="gs-add" data-act="sh-add" data-date="${d.date}" title="Add a row for this day" aria-label="Add a row for ${esc(roDate(d.date))}">+</button></span></td>`
        : '<td class="gs-date gs-cont"></td>';

      const netCell = k === 0
        ? (hasActivity
          ? `<td class="gs-net ${dayNet >= 0 ? 'pos' : 'neg'}" title="Day net: ${dayNet >= 0 ? '+' : ''}${fmt(dayNet)}"><span class="gs-net-pill">${dayNet > 0 ? '+' : ''}${fmt(dayNet)}</span></td>`
          : '<td class="gs-net empty"><span class="gs-net-empty">—</span></td>')
        : '<td class="gs-net gs-cont"></td>';

      rows.push(`<tr class="${cls}" data-date="${d.date}"${todayId}><th class="gs-rn">${r}</th>${dateCell}${dataCells(inc, 'in', `${d.date}|in|${k}`, base)}${dataCells(exp, 'out', `${d.date}|out|${k}`, base)}${netCell}</tr>`);
      r++;
    }
  }

  const netTotal = earned - spent;
  rows.push(`<tr class="gs-total"><th class="gs-rn">${r}</th><td class="gs-date"><b>Month Total</b></td><td class="gs-num in"><b class="income">+${fmt(earned)}</b></td><td></td><td class="gs-num out"><b class="expense">-${fmt(spent)}</b></td><td></td><td class="gs-net ${netTotal >= 0 ? 'pos' : 'neg'}"><b class="gs-net-pill ${netTotal >= 0 ? 'pos' : 'neg'}">${netTotal > 0 ? '+' : ''}${fmt(netTotal)}</b></td></tr>`);

  const letters = `<tr class="gs-letters"><th class="gs-corner"></th>${COLS.map((l) => `<th>${l}</th>`).join('')}</tr>`;

  const totalDays = daysInMonth(key);
  const saveRate = earned > 0 ? Math.max(0, Math.min(100, Math.round((netTotal / earned) * 100))) : 0;
  const avgDay = Math.round(spent / totalDays);

  const toolbar = `<div class="gs-toolbar">
    <div class="gs-formula-box">
      <span class="gs-fx">fx</span>
      <span class="gs-cell-addr" id="gs-cell-addr">A1</span>
      <div class="gs-formula-text" id="gs-formula-text">${esc(roMonth(key))} ${key.slice(0, 4)} Sheet · ${totalDays} days</div>
    </div>
    <div class="gs-kpis">
      <div class="gs-kpi-chip in" title="Earned this month">
        <span class="gs-kpi-lbl">Earned</span>
        <b class="income">+${fmt(earned)}</b>
      </div>
      <div class="gs-kpi-chip out" title="Invested / Spent this month">
        <span class="gs-kpi-lbl">Spent</span>
        <b class="expense">-${fmt(spent)}</b>
      </div>
      <div class="gs-kpi-chip net ${netTotal >= 0 ? 'pos' : 'neg'}" title="Net balance">
        <span class="gs-kpi-lbl">Net</span>
        <b>${netTotal >= 0 ? '+' : ''}${fmt(netTotal)}</b>
      </div>
      ${earned > 0 ? `<div class="gs-kpi-chip save" title="Savings rate"><span class="gs-kpi-lbl">Saved</span><b class="gold">${saveRate}%</b></div>` : ''}
    </div>
    <div class="gs-tools">
      <button type="button" class="gs-btn" data-act="sh-jump-today" title="Scroll to today's row">📅 Jump to Today</button>
      <button type="button" class="gs-btn" data-act="copy-table" title="Copy to clipboard for Excel / Google Sheets">📋 Copy</button>
      <button type="button" class="gs-btn gs-btn-primary" data-act="export-month" title="Export this month to Excel">📥 Excel</button>
    </div>
  </div>`;

  const tabBar = `<footer class="gs-bottom-bar">
    <nav class="gs-tabs" aria-label="Months">
      <span class="gs-years" role="group" aria-label="Year">${yearBtns}</span>
      <div class="gs-tabs-scroll">
        ${tabs.months.map((t) => `<button type="button" class="gs-tab${t.key === key ? ' on' : ''}" data-act="goto-month" data-month="${t.key}">${esc(t.label)}</button>`).join('')}
      </div>
      <button type="button" class="gs-tab gs-new" data-act="sh-new-month" title="Add next month tab" aria-label="Add next month tab">+</button>
    </nav>
    <div class="gs-status-metrics">
      <span class="gs-metric"><b>${totalDays}</b> days</span>
      <span class="gs-metric-sep">·</span>
      <span class="gs-metric"><b>${txCount}</b> records</span>
      <span class="gs-metric-sep">·</span>
      <span class="gs-metric"><b>${activeDays}</b> active days</span>
      <span class="gs-metric-sep">·</span>
      <span class="gs-metric">Avg <b>${fmt(avgDay)}</b>/day</span>
    </div>
  </footer>`;

  return `<div class="gs-wrap">
    ${toolbar}
    <div class="gs-scroll">
      <table class="gs-grid" id="sheet-grid">
        <colgroup><col class="w-rn"><col class="w-date"><col class="w-amt"><col class="w-desc"><col class="w-amt"><col class="w-desc"><col class="w-net"></colgroup>
        <thead>${letters}</thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
    ${tabBar}
  </div>`;
}

// The sheet tabs: the years you have, and the chosen year's months (every
// month with records, the current one and months added with +).
export function monthTabs(state, current, today, added = []) {
  const keys = new Set([...state.tx.map((t) => t.date.slice(0, 7)), ...added, today.slice(0, 7), current]);
  const all = [...keys].sort();
  const year = current.slice(0, 4);
  return {
    years: [...new Set(all.map((k) => k.slice(0, 4)))],
    year,
    months: all.filter((k) => k.startsWith(year)).map((k) => ({ key: k, label: roMonth(k) })),
    last: all.at(-1),
  };
}

