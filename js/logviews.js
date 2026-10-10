// The Log screen's Table (edit like a spreadsheet) and Calendar views.
// Pure HTML builders; app.js wires up the clicks and edits.

import { formatMoney } from './money.js';
import { daysInMonth, weekday, todayISO, dowIndex, DOW_LONG, DOW_SHORT, MONTHS, addDays } from './dates.js';
import { TYPE_LABEL } from './importer.js';
import { B } from './model.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = (c) => formatMoney(c, '');
const compact = (c) => formatMoney(c, '', { compact: true });

export const COLUMNS = [
  { id: 'date', label: 'Date' },
  { id: 'type', label: 'Type' },
  { id: 'category', label: 'Category' },
  { id: 'note', label: 'Note' },
  { id: 'person', label: 'Who' },
  { id: 'account', label: 'Account' },
  { id: 'amount', label: 'Amount', num: true },
];

export function sortRows(state, list, { col = 'date', dir = 1 } = {}) {
  const name = (arr, id) => arr.find((x) => x.id === id)?.name || '';
  const key = {
    date: (t) => t.date,
    type: (t) => TYPE_LABEL[t.type],
    category: (t) => (t.type === 'transfer' ? '' : name(state.settings.categories, t.category)),
    note: (t) => (t.note || '').toLowerCase(),
    person: (t) => name(state.people, t.person).toLowerCase(),
    account: (t) => name(state.settings.accounts, t.account || t.from),
    amount: (t) => B(t),
  }[col] || ((t) => t.date);
  return [...list].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x < y) return -dir;
    if (x > y) return dir;
    return ((a.createdAt || 0) - (b.createdAt || 0)) * dir;
  });
}

function options(items, selected) {
  return items.map((i) => `<option value="${esc(i.id)}" ${i.id === selected ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
}

function cells(state, t) {
  const { categories, accounts } = state.settings;
  const typeSel = `<select data-col="type" aria-label="Type">${Object.entries(TYPE_LABEL).map(([v, l]) => `<option value="${v}" ${t.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const isT = t.type === 'transfer';
  const cat = isT
    ? `<label class="cell-pre"><span>from</span><select data-col="from" aria-label="From account">${options(accounts, t.from)}</select></label>`
    : `<select data-col="category" aria-label="Category">${t.category ? '' : '<option value="" selected>Pick…</option>'}${options(categories.filter((c) => c.type === t.type), t.category)}</select>`;
  const acc = isT
    ? `<label class="cell-pre"><span>to</span><select data-col="to" aria-label="To account">${options(accounts, t.to)}</select></label>`
    : `<select data-col="account" aria-label="Account">${options(accounts, t.account)}</select>`;
  const di = t.date ? dowIndex(t.date) : 0;
  const shown = t.date ? `<span class="dow-tag dow-${di}">${DOW_SHORT[di]}</span><span class="dtext">${Number(t.date.slice(8, 10))} ${MONTHS[Number(t.date.slice(5, 7)) - 1].slice(0, 3)}</span>` : '';
  return `<td><span class="dcell">${shown}<input type="date" class="dpick" data-col="date" value="${esc(t.date)}" aria-label="Date"></span></td>
    <td>${typeSel}</td><td>${cat}</td>
    <td><input type="text" data-col="note" value="${esc(t.note)}" placeholder="What for?" aria-label="Note"></td>
    <td>${isT ? '' : `<input type="text" data-col="person" list="people-list" value="${esc(state.people.find((p) => p.id === t.person)?.name || t.personName || '')}" placeholder="—" aria-label="Who" autocomplete="off">`}</td>
    <td>${acc}</td>
    <td><span class="amt-cell"><input type="text" inputmode="decimal" class="amt" data-col="amount" value="${t.amount ? plain(t.amount) : ''}" placeholder="0" aria-label="Amount" autocomplete="off">${t.currency && t.currency !== state.settings.currency ? `<span class="cur-tag">${esc(t.currency)}</span>` : ''}</span></td>`;
}

// "Saturday 10 October · Today" with the day's totals.
export function dayLabelHTML(date, today) {
  const di = dowIndex(date);
  const rel = date === today ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : date === addDays(today, 1) ? 'Tomorrow' : '';
  return `<span class="dow-pill dow-${di}">${DOW_LONG[di]}</span><b>${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}</b>${rel ? `<span class="rel-tag${rel === 'Today' ? ' today-tag' : ''}">${rel}</span>` : ''}`;
}

function dayRow(date, d, today, fmt) {
  const parts = [d.in ? `<span class="income">+${fmt(d.in)}</span>` : '', d.out ? `<span>−${fmt(d.out)}</span>` : '', `<span class="muted">${d.n} record${d.n === 1 ? '' : 's'}</span>`].filter(Boolean).join(' · ');
  return `<tr class="day-row dow-${dowIndex(date)}${date === today ? ' is-today' : ''}" aria-hidden="true"><td colspan="8"><span class="dr">${dayLabelHTML(date, today)}<span class="dr-sum">${parts}</span></span></td></tr>`;
}

export function tableHTML(state, list, { sort, draft, fmt }) {
  const rows = sortRows(state, list, sort);
  const today = todayISO();
  // Sorted by date: a header row for each day with its weekday and totals.
  const byDate = sort.col === 'date';
  const perDay = {};
  for (const t of rows) {
    const d = (perDay[t.date] ||= { in: 0, out: 0, n: 0 });
    d.n++;
    if (t.loan || t.type === 'transfer') continue;
    if (t.type === 'income') d.in += B(t); else d.out += B(t);
  }
  let prevDate = null;
  const body = rows.map((t) => {
    const newDay = t.date !== prevDate;
    prevDate = t.date;
    const head = byDate && newDay ? dayRow(t.date, perDay[t.date], today, fmt) : '';
    return `${head}<tr data-id="${esc(t.id)}" class="t-${t.type}${newDay ? ' newday' : ''}${t.date === today ? ' is-today' : ''}">${cells(state, t)}
      <td><button type="button" class="row-del" data-act="row-del" data-id="${esc(t.id)}" aria-label="Delete this record" title="Delete">×</button></td></tr>`;
  }).join('');
  const income = list.filter((t) => t.type === 'income' && !t.loan).reduce((a, t) => a + B(t), 0);
  const expense = list.filter((t) => t.type === 'expense' && !t.loan).reduce((a, t) => a + B(t), 0);
  const arrow = (id) => (sort.col === id ? (sort.dir > 0 ? ' ▲' : ' ▼') : '');
  return `<div class="grid-wrap"><table class="grid" id="tx-table">
    <colgroup><col style="width:128px"><col style="width:88px"><col style="width:160px"><col><col style="width:118px"><col style="width:132px"><col style="width:132px"><col style="width:36px"></colgroup>
    <thead><tr>${COLUMNS.map((c) => `<th class="${c.num ? 'num' : ''}"><button type="button" data-act="sort" data-col="${c.id}" aria-label="Sort by ${c.label}">${c.label}${arrow(c.id)}</button></th>`).join('')}<th></th></tr></thead>
    <tbody>${body}
      <tr class="draft t-${draft.type}" data-draft>${cells(state, { ...draft, amount: 0 })}
        <td><button type="button" class="row-add" data-act="row-add" aria-label="Add this record" title="Add (Enter)">＋</button></td></tr>
    </tbody>
    <tfoot><tr><td colspan="5">${list.length} record${list.length === 1 ? '' : 's'}</td>
      <td colspan="3" class="num"><span class="income">+${fmt(income)}</span> &nbsp; <span class="expense">−${fmt(expense)}</span> &nbsp; <b>= ${fmt(income - expense)}</b></td></tr></tfoot>
  </table></div>`;
}

// Month grid, Monday first, with what came in and went out each day and a
// weekly total. Darker days are the days you spent more.
export function calendarHTML(state, key) {
  const days = daysInMonth(key);
  const today = todayISO();
  const per = {};
  for (const t of state.tx) {
    if (!t.date.startsWith(key) || t.type === 'transfer') continue;
    const d = (per[t.date] ||= { in: 0, out: 0, n: 0 });
    if (t.loan) continue;
    if (t.type === 'income') d.in += B(t); else d.out += B(t);
    d.n++;
  }
  const maxOut = Math.max(1, ...Object.values(per).map((d) => d.out));
  const lead = (weekday(`${key}-01`) + 6) % 7;
  const cellsHtml = [];
  let weekOut = 0;
  let col = 0;
  const pushWeek = () => {
    cellsHtml.push(`<div class="cal-week" aria-label="Week spent">${weekOut ? `<span>week</span>−${compact(weekOut)}` : ''}</div>`);
    weekOut = 0;
    col = 0;
  };
  for (let i = 0; i < lead; i++) { cellsHtml.push('<div class="cal-blank"></div>'); col++; }
  for (let d = 1; d <= days; d++) {
    const iso = `${key}-${String(d).padStart(2, '0')}`;
    const v = per[iso];
    weekOut += v?.out || 0;
    const heat = v?.out ? (0.15 + 0.85 * (v.out / maxOut)).toFixed(2) : 0;
    cellsHtml.push(`<button type="button" class="cal-day dow-${dowIndex(iso)}${iso === today ? ' today' : ''}${iso > today ? ' future' : ''}" data-act="day" data-date="${iso}" style="--heat:${heat}" aria-label="${iso}">
      <span class="d">${d}${iso === today ? '<span class="today-dot">Today</span>' : ''}</span>
      ${v?.in ? `<span class="in">+${compact(v.in)}</span>` : ''}
      ${v?.out ? `<span class="out">−${compact(v.out)}</span>` : ''}
    </button>`);
    if (++col === 7) pushWeek();
  }
  if (col) {
    while (col < 7) { cellsHtml.push('<div class="cal-blank"></div>'); col++; }
    pushWeek();
  }
  const todayDow = today.startsWith(key) ? dowIndex(today) : -1;
  const dows = DOW_SHORT.map((d, i) => `<div class="cal-dow dow-${i}${i === todayDow ? ' on' : ''}">${d}</div>`).join('');
  return `<div class="cal">${dows}<div class="cal-dow cal-week-h">Week</div>${cellsHtml.join('')}</div>
    <p class="muted small">Darker days are days you spent more. Click a day to see or add its records.</p>`;
}
