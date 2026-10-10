// Log → Sheet: the month the way the owner's Google Sheet had it. Every day
// is a row: Date | Earned | Description | Spent | Description, typed in
// place. A day with several records gets a row for each (like adding a row
// in the sheet). Next to it, the sheet's "money management" corner: this
// month's totals, every account, smart sharing and a calculator.
// Pure HTML builders; app.js saves the edits (onSheetChange).

import { formatMoney } from './money.js';
import { daysInMonth, dowIndex, DOW_SHORT, MONTHS } from './dates.js';
import { B } from './model.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = (c) => formatMoney(c, '');

// The month's days, each with its incomes and expenses in the order logged.
export function sheetDays(state, key, extra = new Set()) {
  const days = [];
  const n = daysInMonth(key);
  const byDate = new Map();
  for (const t of state.tx) {
    if (!t.date.startsWith(key) || t.type === 'transfer') continue;
    if (!byDate.has(t.date)) byDate.set(t.date, { inc: [], exp: [] });
    byDate.get(t.date)[t.type === 'income' ? 'inc' : 'exp'].push(t);
  }
  const order = (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id));
  for (let d = 1; d <= n; d++) {
    const date = `${key}-${String(d).padStart(2, '0')}`;
    const v = byDate.get(date) || { inc: [], exp: [] };
    v.inc.sort(order);
    v.exp.sort(order);
    const rows = Math.max(1, v.inc.length, v.exp.length) + (extra.has(date) ? 1 : 0);
    days.push({ date, day: d, inc: v.inc, exp: v.exp, rows });
  }
  return days;
}

function catSelect(state, t, side, key) {
  const type = side === 'in' ? 'income' : 'expense';
  if (!t) return '<td class="sh-cat"></td>';
  const opts = state.settings.categories.filter((c) => c.type === type)
    .map((c) => `<option value="${esc(c.id)}" ${c.id === t.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  return `<td class="sh-cat"><select data-sh="${key}|category" data-id="${esc(t.id)}" aria-label="Category">${opts}</select></td>`;
}

function sideCells(state, t, side, key, base) {
  const cur = t && t.currency && t.currency !== base ? `<span class="sh-cur">${esc(t.currency)}</span>` : '';
  const loan = t?.loan ? '<span class="sh-loan" title="Loan">loan</span>' : '';
  return `<td class="sh-amt ${side}"><span class="sh-amt-in"><input type="text" inputmode="decimal" autocomplete="off" data-sh="${key}|amount" data-id="${esc(t?.id || '')}" value="${t ? plain(t.amount) : ''}" placeholder="" aria-label="${side === 'in' ? 'Earned' : 'Spent'}">${cur}</span></td>
    <td class="sh-note"><span class="sh-note-in"><input type="text" autocomplete="off" data-sh="${key}|note" data-id="${esc(t?.id || '')}" value="${esc(t?.note || '')}" aria-label="Description">${loan}</span></td>
    ${catSelect(state, t, side, key)}`;
}

export function sheetHTML(state, key, { today, extra = new Set(), fmt }) {
  const base = state.settings.currency;
  const days = sheetDays(state, key, extra);
  let earned = 0;
  let spent = 0;
  const body = days.map((d) => {
    const di = dowIndex(d.date);
    const dayIn = d.inc.filter((t) => !t.loan).reduce((a, t) => a + B(t), 0);
    const dayOut = d.exp.filter((t) => !t.loan).reduce((a, t) => a + B(t), 0);
    earned += dayIn;
    spent += dayOut;
    const cls = [di >= 5 ? 'weekend' : '', d.date === today ? 'is-today' : '', d.date > today ? 'future' : '', `dow-${di}`].filter(Boolean).join(' ');
    let html = '';
    for (let k = 0; k < d.rows; k++) {
      const first = k === 0;
      const dateCell = first ? `<th class="sh-date" rowspan="${d.rows}" scope="row">
        <span class="sh-d">${d.day}</span><span class="dow-tag dow-${di}">${DOW_SHORT[di]}</span>${d.date === today ? '<span class="sh-today">Today</span>' : ''}
        <button type="button" class="sh-add" data-act="sh-add" data-date="${d.date}" title="Add a row for this day" aria-label="Add a row for ${d.day} ${MONTHS[Number(key.slice(5)) - 1]}">+</button></th>` : '';
      html += `<tr class="${cls}${first ? ' day-first' : ''}" data-date="${d.date}">${dateCell}
        ${sideCells(state, d.inc[k], 'in', `${d.date}|in|${k}`, base)}
        ${sideCells(state, d.exp[k], 'out', `${d.date}|out|${k}`, base)}
        ${first ? `<td class="sh-day" rowspan="${d.rows}">${dayIn || dayOut ? `<span class="income">${dayIn ? `+${fmt(dayIn)}` : ''}</span><span class="expense">${dayOut ? `−${fmt(dayOut)}` : ''}</span>` : ''}</td>` : ''}
      </tr>`;
    }
    return html;
  }).join('');
  return `<div class="sheet-wrap"><table class="sheet-grid" id="sheet-grid">
    <colgroup><col class="c-date"><col class="c-amt"><col class="c-note"><col class="c-cat"><col class="c-amt"><col class="c-note"><col class="c-cat"><col class="c-day"></colgroup>
    <thead><tr><th class="sh-h-date">Date</th><th class="sh-h in">Earned ✅</th><th class="sh-h in">Description</th><th class="sh-h in">Source</th>
      <th class="sh-h out">Spent ❌</th><th class="sh-h out">Description</th><th class="sh-h out">Category</th><th class="sh-h">Day</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr><th>Total</th><td class="sh-amt in"><b class="income">+${fmt(earned)}</b></td><td colspan="2"></td>
      <td class="sh-amt out"><b class="expense">−${fmt(spent)}</b></td><td colspan="2"></td><td class="sh-day"><b>${earned - spent >= 0 ? '+' : '−'}${fmt(Math.abs(earned - spent))}</b></td></tr></tfoot>
  </table></div>`;
}

// The sheet's right-hand corner.
export function moneyPanelHTML(state, key, { summary, values, total, jars, calc, share, fmt, money }) {
  const target = jars.find((j) => j.savings)?.pct ?? 0;
  const kept = summary.income ? summary.net / summary.income : null;
  const keptOk = kept != null && kept * 100 >= target;
  const shareVal = share.value;
  return `<aside class="money-panel" aria-label="Money management">
    <section class="mp-card">
      <h3>Money management · ${esc(MONTHS[Number(key.slice(5)) - 1])}</h3>
      <div class="mp-tot">
        <div><span>Profit</span><b class="income">${fmt(summary.income)}</b></div>
        <div><span>Spent</span><b class="expense">${fmt(summary.expense)}</b></div>
        <div><span>Total</span><b class="${summary.net < 0 ? 'expense' : ''}">${summary.net < 0 ? '−' : ''}${fmt(Math.abs(summary.net))}</b></div>
      </div>
      ${kept != null ? `<div class="mp-kept"><span>Kept <b class="${keptOk ? 'income' : 'expense'}">${Math.round(kept * 100)}%</b> · target ${target}%</span>
        <div class="bar ${keptOk ? '' : 'over'}"><i style="width:${Math.max(0, Math.min(100, kept * 100)).toFixed(1)}%"></i><span class="mark" style="left:${target}%"></span></div></div>` : ''}
    </section>
    <section class="mp-card">
      <h3>Where the money is <button type="button" class="card-link" data-go="accounts">Accounts</button></h3>
      <div class="mp-accs">${values.map((v) => `<button type="button" class="mp-acc" data-act="acc-open" data-id="${esc(v.account.id)}"><span>${esc(v.account.name)}</span><b>${v.inBase == null ? formatMoney(v.own, v.account.currency) : money(v.inBase)}</b></button>`).join('')}</div>
      <div class="mp-all"><span>All my money</span><b>${money(Math.round(total / 100) * 100)}</b></div>
    </section>
    <section class="mp-card">
      <h3>Smart sharing</h3>
      <label class="mp-in"><span>Enter amount</span><input type="text" inputmode="decimal" id="mp-share" value="${esc(share.text)}" placeholder="e.g. 3800" autocomplete="off"></label>
      <div class="mp-jars">${jars.map((j, i) => `<div><span>${j.pct}% ${esc(j.name)}</span><b class="${j.savings ? 'gold' : ''}" data-jar="${i}">${shareVal ? fmt(share.parts[i]) : '–'}</b></div>`).join('')}</div>
    </section>
    <section class="mp-card">
      <h3>My calculator</h3>
      <label class="mp-in"><span>Type e.g. 150+400+240+35</span><input type="text" inputmode="decimal" id="mp-calc" value="${esc(calc.text)}" autocomplete="off"></label>
      <div class="mp-calc-out" id="mp-calc-out">${calc.text ? (calc.value == null ? '…' : `= ${fmt(calc.value)}`) : ''}</div>
    </section>
  </aside>`;
}
