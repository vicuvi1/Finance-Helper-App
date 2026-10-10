// Log → Sheet: the month exactly like the owner's Google Sheet. A real
// grid (column letters, row numbers), columns A–E as in the sheet
// (Date · Amount earned✅ · Description · Amount invested❌ · Description2),
// and the sheet's "MONEY MANAGEMENT" corner in columns G–N: this month's
// PROFIT / SPENT / TOTAL, My CALCULATOR (Sum, Dif, Multiplicator), SMART
// SHARING, the accounts row (SAFE, wallet, cards, crypto…) and the GOAL.
// Month tabs at the bottom, like the sheet tabs.
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

const COLS = 'ABCDEFGHIJKLMN'.split('');

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

// The calculator rows, as in the sheet: Sum adds, Dif subtracts the rest
// from the first, Multiplicator multiplies.
export function calcResult(kind, cells) {
  const vals = cells.map((v) => Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'))).filter((v, i) => String(cells[i] ?? '').trim() !== '' && Number.isFinite(v));
  if (!vals.length) return null;
  if (kind === 'sum') return vals.reduce((a, v) => a + v, 0);
  if (kind === 'dif') return vals.slice(1).reduce((a, v) => a - v, vals[0]);
  return vals.reduce((a, v) => a * v, 1);
}
const num = (v) => (v == null ? '' : (Math.round(v * 100) / 100).toLocaleString('ro-RO').replace(/\./g, ' '));

function dataCells(t, side, key, base) {
  const cur = t && t.currency && t.currency !== base ? ` <span class="gs-cur">${esc(t.currency)}</span>` : '';
  const id = esc(t?.id || '');
  const title = t ? ` title="${esc(t.categoryName || '')}"` : '';
  return `<td class="gs-num ${side}"${title}><span class="gs-flex"><input type="text" inputmode="decimal" autocomplete="off" data-sh="${key}|amount" data-id="${id}" value="${t ? plain(t.amount) : ''}" aria-label="${side === 'in' ? 'Amount earned' : 'Amount invested'}">${cur}</span></td>
    <td class="gs-text"><input type="text" autocomplete="off" data-sh="${key}|note" data-id="${id}" value="${esc(t?.note || '')}" aria-label="${side === 'in' ? 'Description' : 'Description2'}"></td>`;
}

// What goes in columns F–N of each row (the sheet's right-hand corner).
function corner(state, key, o) {
  const { summary, values, total, jars, calc, share, goal, today, fmt } = o;
  const c = {};
  const put = (row, col, html, cls = '', span = 1) => { (c[row] ||= {})[col] = { html, cls, span }; };
  put(1, 'G', 'MONEY MANAGEMENT', 'gs-title', 3);
  put(1, 'L', 'REFRESHED', 'gs-label');
  put(1, 'M', esc(roDate(today)), 'gs-muted', 2);
  put(3, 'G', 'PROFIT (this month)', 'gs-label', 2);
  put(3, 'I', 'SPENT (this month)', 'gs-label', 2);
  put(3, 'K', 'TOTAL (for this month)', 'gs-label', 2);
  put(4, 'G', fmt(summary.income), 'gs-big income', 2);
  put(4, 'I', fmt(summary.expense), 'gs-big expense', 2);
  put(4, 'K', `${summary.net < 0 ? '−' : ''}${fmt(Math.abs(summary.net))}`, `gs-big${summary.net < 0 ? ' expense' : ''}`, 2);
  const target = jars.find((j) => j.savings)?.pct ?? 0;
  if (summary.income) put(5, 'G', `kept <b class="${summary.net / summary.income * 100 >= target ? 'income' : 'expense'}">${Math.round((summary.net / summary.income) * 100)}%</b> · target ${target}%`, 'gs-muted', 4);
  put(7, 'G', 'My CALCULATOR', 'gs-title', 5);
  put(7, 'L', 'SMART SHARING', 'gs-title', 3);
  ['sum', 'dif', 'mul'].forEach((kind, i) => {
    const r = 8 + i;
    put(r, 'F', { sum: 'Sum', dif: 'Dif', mul: 'Multiplicator' }[kind], 'gs-label gs-right');
    ['G', 'H', 'I', 'J'].forEach((col, j) => put(r, col, `<input type="text" inputmode="decimal" autocomplete="off" data-calc="${kind}|${j}" value="${esc(calc[kind][j] || '')}" aria-label="${kind} ${j + 1}">`, 'gs-in'));
    put(r, 'K', `<b data-calc-out="${kind}">${num(calcResult(kind, calc[kind]))}</b>`, 'gs-num gs-result');
  });
  put(8, 'L', 'Enter amount', 'gs-label');
  put(8, 'M', `<input type="text" inputmode="decimal" autocomplete="off" id="mp-share" value="${esc(share.text)}" aria-label="Amount to share">`, 'gs-in gs-share', 2);
  jars.forEach((j, i) => {
    if (i > 4) return;
    put(9 + i, 'L', `${j.pct}% ${esc(j.name)}`, 'gs-label', 2);
    put(9 + i, 'N', `<b data-jar="${i}" class="${j.savings ? 'gold' : ''}">${share.value ? fmt(share.parts[i]) : ''}</b>`, 'gs-num');
  });
  // Accounts: names, then balances (like SAFE · wallet · Maib card1 …).
  const accs = values.slice(0, 8);
  const accCols = COLS.slice(6, 6 + accs.length);
  put(15, 'F', 'Accounts', 'gs-label gs-right');
  accs.forEach((v, i) => {
    put(15, accCols[i], `<button type="button" data-act="acc-open" data-id="${esc(v.account.id)}">${esc(v.account.name)}</button>`, 'gs-label gs-acc');
    put(16, accCols[i], v.inBase == null ? esc(formatMoney(v.own, v.account.currency)) : fmt(v.inBase), 'gs-num');
  });
  put(17, 'F', 'All', 'gs-label gs-right');
  put(17, 'G', `<b class="gold">${fmt(Math.round(total / 100) * 100)}</b>`, 'gs-num gs-left', 2);
  if (goal) {
    put(19, 'G', 'GOAL', 'gs-title');
    put(19, 'H', esc(goal.name), 'gs-text-cell', 2);
    put(19, 'J', fmt(goal.target), 'gs-num', 2);
    put(20, 'H', `${Math.round(goal.ratio * 100)}%`, 'gs-muted', 2);
    put(20, 'J', goal.left > 0 ? `${fmt(goal.left)} to go` : 'reached ✓', 'gs-muted', 2);
  }
  return c;
}

export function sheetHTML(state, key, o) {
  const { today, extra = new Set(), fmt, tabs } = o;
  const base = state.settings.currency;
  const days = sheetDays(state, key, extra);
  const right = corner(state, key, o);
  const cat = (id) => state.settings.categories.find((x) => x.id === id)?.name || '';
  const rowsHtml = [];
  // Row 1: the sheet's own headings.
  const r1 = right[1] || {};
  const rightCells = (r, cells) => {
    let out = '';
    for (let i = 5; i < COLS.length;) {
      const cell = cells[COLS[i]];
      if (cell) {
        out += `<td class="gs-c ${cell.cls}"${cell.span > 1 ? ` colspan="${cell.span}"` : ''}>${cell.html}</td>`;
        i += cell.span;
      } else { out += '<td class="gs-c"></td>'; i++; }
    }
    return out;
  };
  rowsHtml.push(`<tr class="gs-head-row"><th class="gs-rn">1</th><td class="gs-h">Date</td><td class="gs-h in">Amount earned✅</td><td class="gs-h in">Description</td><td class="gs-h out">Amount invested❌</td><td class="gs-h out">Description2</td>${rightCells(1, r1)}</tr>`);
  let r = 2;
  let earned = 0;
  let spent = 0;
  for (const d of days) {
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
      rowsHtml.push(`<tr class="${cls}" data-date="${d.date}"><th class="gs-rn">${r}</th>${dateCell}${dataCells(inc, 'in', `${d.date}|in|${k}`, base)}${dataCells(exp, 'out', `${d.date}|out|${k}`, base)}${rightCells(r, right[r] || {})}</tr>`);
      r++;
    }
  }
  // Rows the corner still needs (short months) and the total row.
  const lastRight = Math.max(...Object.keys(right).map(Number));
  while (r <= lastRight) {
    rowsHtml.push(`<tr class="gs-empty"><th class="gs-rn">${r}</th><td class="gs-date"></td><td></td><td></td><td></td><td></td>${rightCells(r, right[r] || {})}</tr>`);
    r++;
  }
  rowsHtml.push(`<tr class="gs-total"><th class="gs-rn">${r}</th><td class="gs-date"><b>Total</b></td><td class="gs-num in"><b class="income">${fmt(earned)}</b></td><td></td><td class="gs-num out"><b class="expense">${fmt(spent)}</b></td><td></td>${rightCells(r, {})}</tr>`);

  const letters = `<tr class="gs-letters"><th class="gs-corner"></th>${COLS.map((l) => `<th>${l}</th>`).join('')}</tr>`;
  const tabBar = `<nav class="gs-tabs" aria-label="Months">${tabs.map((t) => `<button type="button" class="gs-tab${t.key === key ? ' on' : ''}" data-act="goto-month" data-month="${t.key}">${esc(t.label)}</button>`).join('')}</nav>`;
  return `<div class="gs-wrap"><div class="gs-scroll"><table class="gs-grid" id="sheet-grid">
    <colgroup><col class="w-rn"><col class="w-date"><col class="w-amt"><col class="w-desc"><col class="w-amt"><col class="w-desc"><col class="w-f">${COLS.slice(6).map(() => '<col class="w-x">').join('')}</colgroup>
    <thead>${letters}</thead><tbody>${rowsHtml.join('')}</tbody></table></div>${tabBar}</div>`;
}

// The sheet tabs: every month with records, plus the current one.
export function monthTabs(state, current, today) {
  const keys = new Set(state.tx.map((t) => t.date.slice(0, 7)));
  keys.add(today.slice(0, 7));
  keys.add(current);
  const thisYear = today.slice(0, 4);
  return [...keys].sort().map((k) => ({ key: k, label: k.startsWith(thisYear) ? roMonth(k) : `${roMonth(k)} ${k.slice(2, 4)}` }));
}
