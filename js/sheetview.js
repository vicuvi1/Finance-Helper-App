// Log → Sheet: the month exactly like the owner's Google Sheet. A real
// grid (column letters, row numbers) with the sheet's columns: Date ·
// Amount earned✅ · Description · Amount invested❌ · Description2, a Total
// row, and month tabs at the bottom like the sheet tabs.
// Pure HTML builders; app.js saves the edits (onSheetChange).

import { formatMoney } from './money.js';
import { daysInMonth, dowIndex } from './dates.js';
import { B } from './model.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = (c) => formatMoney(c, '');

// Romanian, the way the sheet wrote its dates and tab names.
export const LUNI = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
export const roDate = (iso) => `${Number(iso.slice(8, 10))} ${LUNI[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
export const roMonth = (key) => { const n = LUNI[Number(key.slice(5, 7)) - 1]; return n[0].toUpperCase() + n.slice(1); };

const COLS = ['A', 'B', 'C', 'D', 'E'];

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
  const cur = t && t.currency && t.currency !== base ? ` <span class="gs-cur">${esc(t.currency)}</span>` : '';
  const id = esc(t?.id || '');
  const title = t ? ` title="${esc(t.categoryName || '')}"` : '';
  return `<td class="gs-num ${side}"${title}><span class="gs-flex"><input type="text" inputmode="decimal" autocomplete="off" data-sh="${key}|amount" data-id="${id}" value="${t ? plain(t.amount) : ''}" aria-label="${side === 'in' ? 'Amount earned' : 'Amount invested'}">${cur}</span></td>
    <td class="gs-text"><input type="text" autocomplete="off" data-sh="${key}|note" data-id="${id}" value="${esc(t?.note || '')}" aria-label="${side === 'in' ? 'Description' : 'Description2'}"></td>`;
}

export function sheetHTML(state, key, { today, extra = new Set(), fmt, tabs }) {
  const yearBtns = tabs.years.map((y) => `<button type="button" class="gs-year${y === tabs.year ? ' on' : ''}" data-act="sh-year" data-year="${y}" aria-pressed="${y === tabs.year}">${y}</button>`).join('');
  const base = state.settings.currency;
  const cat = (id) => state.settings.categories.find((x) => x.id === id)?.name || '';
  const rows = [`<tr class="gs-head-row"><th class="gs-rn">1</th><td class="gs-h">Date</td><td class="gs-h in">Amount earned✅</td><td class="gs-h in">Description</td><td class="gs-h out">Amount invested❌</td><td class="gs-h out">Description2</td></tr>`];
  let r = 2;
  let earned = 0;
  let spent = 0;
  for (const d of sheetDays(state, key, extra)) {
    const di = dowIndex(d.date);
    earned += d.inc.filter((t) => !t.loan).reduce((a, t) => a + B(t), 0);
    spent += d.exp.filter((t) => !t.loan).reduce((a, t) => a + B(t), 0);
    for (let k = 0; k < d.rows; k++) {
      const inc = d.inc[k] && { ...d.inc[k], categoryName: cat(d.inc[k].category) };
      const exp = d.exp[k] && { ...d.exp[k], categoryName: cat(d.exp[k].category) };
      const cls = [di >= 5 ? 'weekend' : '', d.date === today ? 'is-today' : '', d.date > today ? 'future' : '', k === 0 ? 'day-first' : 'day-more'].filter(Boolean).join(' ');
      const dateCell = k === 0
        ? `<td class="gs-date" title="${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][di]}"><span class="gs-flex"><span class="gs-dtext">${esc(roDate(d.date))}</span>${d.date === today ? '<span class="gs-today">azi</span>' : ''}<button type="button" class="gs-add" data-act="sh-add" data-date="${d.date}" title="Add a row for this day" aria-label="Add a row for ${esc(roDate(d.date))}">+</button></span></td>`
        : '<td class="gs-date gs-cont"></td>';
      rows.push(`<tr class="${cls}" data-date="${d.date}"><th class="gs-rn">${r}</th>${dateCell}${dataCells(inc, 'in', `${d.date}|in|${k}`, base)}${dataCells(exp, 'out', `${d.date}|out|${k}`, base)}</tr>`);
      r++;
    }
  }
  rows.push(`<tr class="gs-total"><th class="gs-rn">${r}</th><td class="gs-date"><b>Total</b></td><td class="gs-num in"><b class="income">${fmt(earned)}</b></td><td></td><td class="gs-num out"><b class="expense">${fmt(spent)}</b></td><td></td></tr>`);
  const letters = `<tr class="gs-letters"><th class="gs-corner"></th>${COLS.map((l) => `<th>${l}</th>`).join('')}</tr>`;
  const tabBar = `<nav class="gs-tabs" aria-label="Months"><span class="gs-years" role="group" aria-label="Year">${yearBtns}</span>
    ${tabs.months.map((t) => `<button type="button" class="gs-tab${t.key === key ? ' on' : ''}" data-act="goto-month" data-month="${t.key}">${esc(t.label)}</button>`).join('')}
    <button type="button" class="gs-tab gs-new" data-act="sh-new-month" title="Add the next month" aria-label="Add the next month">+</button></nav>`;
  return `<div class="gs-wrap"><div class="gs-scroll"><table class="gs-grid" id="sheet-grid">
    <colgroup><col class="w-rn"><col class="w-date"><col class="w-amt"><col class="w-desc"><col class="w-amt"><col class="w-desc"></colgroup>
    <thead>${letters}</thead><tbody>${rows.join('')}</tbody></table></div>${tabBar}</div>`;
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
