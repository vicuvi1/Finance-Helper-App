// The Log screen's Table (edit like a spreadsheet) and Calendar views.
// Pure HTML builders; app.js wires up the clicks and edits.

import { formatMoney } from './money.js';
import { daysInMonth, weekday, todayISO } from './dates.js';
import { TYPE_LABEL } from './importer.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = (c) => formatMoney(c, '');
const compact = (c) => formatMoney(c, '', { compact: true });

export const COLUMNS = [
  { id: 'date', label: 'Date' },
  { id: 'type', label: 'Type' },
  { id: 'category', label: 'Category' },
  { id: 'note', label: 'Note' },
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
    account: (t) => name(state.settings.accounts, t.account || t.from),
    amount: (t) => t.amount,
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
  return items.map((i) => `<option value="${esc(i.id)}" ${i.id === selected ? 'selected' : ''}>${esc(i.emoji)} ${esc(i.name)}</option>`).join('');
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
  return `<td><input type="date" data-col="date" value="${esc(t.date)}" aria-label="Date"></td>
    <td>${typeSel}</td><td>${cat}</td>
    <td><input type="text" data-col="note" value="${esc(t.note)}" placeholder="What for?" aria-label="Note"></td>
    <td>${acc}</td>
    <td><input type="text" inputmode="decimal" class="amt" data-col="amount" value="${t.amount ? plain(t.amount) : ''}" placeholder="0" aria-label="Amount" autocomplete="off"></td>`;
}

export function tableHTML(state, list, { sort, draft, fmt }) {
  const rows = sortRows(state, list, sort);
  let prevDate = null;
  const body = rows.map((t) => {
    const newDay = t.date !== prevDate;
    prevDate = t.date;
    return `<tr data-id="${esc(t.id)}" class="t-${t.type}${newDay ? ' newday' : ''}">${cells(state, t)}
      <td><button type="button" class="row-del" data-act="row-del" data-id="${esc(t.id)}" aria-label="Delete this record" title="Delete">×</button></td></tr>`;
  }).join('');
  const income = list.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0);
  const expense = list.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
  const arrow = (id) => (sort.col === id ? (sort.dir > 0 ? ' ▲' : ' ▼') : '');
  return `<div class="grid-wrap"><table class="grid" id="tx-table">
    <colgroup><col style="width:142px"><col style="width:98px"><col style="width:190px"><col><col style="width:140px"><col style="width:120px"><col style="width:42px"></colgroup>
    <thead><tr>${COLUMNS.map((c) => `<th class="${c.num ? 'num' : ''}"><button type="button" data-act="sort" data-col="${c.id}" aria-label="Sort by ${c.label}">${c.label}${arrow(c.id)}</button></th>`).join('')}<th></th></tr></thead>
    <tbody>${body}
      <tr class="draft t-${draft.type}" data-draft>${cells(state, { ...draft, amount: 0 })}
        <td><button type="button" class="row-add" data-act="row-add" aria-label="Add this record" title="Add (Enter)">＋</button></td></tr>
    </tbody>
    <tfoot><tr><td colspan="4">${list.length} record${list.length === 1 ? '' : 's'}</td>
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
    if (t.type === 'income') d.in += t.amount; else d.out += t.amount;
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
    cellsHtml.push(`<button type="button" class="cal-day${iso === today ? ' today' : ''}${iso > today ? ' future' : ''}" data-act="day" data-date="${iso}" style="--heat:${heat}" aria-label="${iso}">
      <span class="d">${d}</span>
      ${v?.in ? `<span class="in">+${compact(v.in)}</span>` : ''}
      ${v?.out ? `<span class="out">−${compact(v.out)}</span>` : ''}
    </button>`);
    if (++col === 7) pushWeek();
  }
  if (col) {
    while (col < 7) { cellsHtml.push('<div class="cal-blank"></div>'); col++; }
    pushWeek();
  }
  const dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="cal-dow">${d}</div>`).join('');
  return `<div class="cal">${dows}<div class="cal-dow cal-week-h">Week</div>${cellsHtml.join('')}</div>
    <p class="muted small">Darker days are days you spent more. Click a day to see or add its records.</p>`;
}
