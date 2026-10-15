// The Log screen's Table (edit like a spreadsheet) and Calendar views.
// Pure HTML builders; app.js wires up the clicks and edits.

import { formatMoney } from './money.js';
import { daysInMonth, weekday, todayISO, dowIndex, DOW_LONG, DOW_SHORT, MONTHS, addDays } from './dates.js';
import { TYPE_LABEL } from './importer.js';
import { B, category } from './model.js';

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
  const typeLabel = (t) => (t.loan ? (t.type === 'expense' ? 'Lent' : 'Borrowed') : TYPE_LABEL[t.type] || t.type);
  const key = {
    date: (t) => t.date,
    type: (t) => typeLabel(t),
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

const accEmoji = (a) => {
  if (a.emoji) return `${a.emoji} `;
  const map = { cash: '💵', card: '💳', virtual: '🌐', business: '💼', savings: '🏦', crypto: '🪙' };
  return `${map[a.kind] || '👛'} `;
};

function options(items, selected, { emojiFn = null } = {}) {
  return items.map((i) => {
    const em = emojiFn ? emojiFn(i) : (i.emoji ? `${i.emoji} ` : '');
    return `<option value="${esc(i.id)}" ${i.id === selected ? 'selected' : ''}>${esc(`${em}${i.name}`.trim())}</option>`;
  }).join('');
}

export function typeOptions(t) {
  const isLoan = Boolean(t.loan);
  const curType = isLoan ? (t.type === 'income' ? 'loan-borrowed' : 'loan-lent') : t.type;
  return `<option value="expense" ${curType === 'expense' ? 'selected' : ''}>🔴 Spent</option>
    <option value="income" ${curType === 'income' ? 'selected' : ''}>🟢 Earned</option>
    <option value="transfer" ${curType === 'transfer' ? 'selected' : ''}>🔄 Move</option>
    <option value="loan-lent" ${curType === 'loan-lent' ? 'selected' : ''}>⚡ Lent</option>
    <option value="loan-borrowed" ${curType === 'loan-borrowed' ? 'selected' : ''}>⚡ Borrowed</option>`;
}

function cells(state, t) {
  const { categories, accounts } = state.settings;
  const isLoan = Boolean(t.loan);
  const typeSel = `<select data-col="type" aria-label="Type" class="${isLoan ? 'sel-loan' : `sel-${t.type}`}">${typeOptions(t)}</select>`;
  const isT = t.type === 'transfer';
  const cat = isT
    ? `<label class="cell-pre"><span>from</span><select data-col="from" aria-label="From account">${options(accounts, t.from, { emojiFn: accEmoji })}</select></label>`
    : `<select data-col="category" aria-label="Category">${t.category ? '' : '<option value="" selected>Pick…</option>'}${options(categories.filter((c) => c.type === t.type), t.category)}</select>`;
  const acc = isT
    ? `<label class="cell-pre"><span>to</span><select data-col="to" aria-label="To account">${options(accounts, t.to, { emojiFn: accEmoji })}</select></label>`
    : `<select data-col="account" aria-label="Account">${options(accounts, t.account, { emojiFn: accEmoji })}</select>`;
  const di = t.date ? dowIndex(t.date) : 0;
  const shown = t.date ? `<span class="dow-tag dow-${di}">${DOW_SHORT[di]}</span><span class="dtext">${Number(t.date.slice(8, 10))} ${MONTHS[Number(t.date.slice(5, 7)) - 1].slice(0, 3)}</span>` : '';
  const loanBadge = isLoan ? `<span class="tbl-loan-badge ${t.type === 'expense' ? 'lent' : 'borrowed'}" title="${t.type === 'expense' ? 'Loan given (Lent)' : 'Loan received (Borrowed)'}">⚡ ${t.type === 'expense' ? 'Lent' : 'Borrowed'}</span>` : '';
  const debtTag = t.debt ? `<span class="cur-tag debt-cur-tag" title="Original loan: ${formatMoney(t.debt.amount, t.debt.currency)}">⚡ ${t.debt.amount ? plain(t.debt.amount) : ''} ${esc(t.debt.currency)}</span>` : '';
  const signPrefix = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
  const isBaseCur = !t.currency || t.currency === state.settings.currency;
  return `<td><span class="dcell">${shown}<input type="date" class="dpick" data-col="date" value="${esc(t.date)}" aria-label="Date"></span></td>
    <td>${typeSel}</td><td>${cat}</td>
    <td><span class="note-cell">${loanBadge}<input type="text" data-col="note" value="${esc(t.note)}" placeholder="${isLoan ? 'Loan note' : 'What for?'}" aria-label="Note"></span></td>
    <td>${isT ? '' : `<input type="text" data-col="person" list="people-list" value="${esc(state.people.find((p) => p.id === t.person)?.name || t.personName || '')}" placeholder="—" aria-label="Who" autocomplete="off">`}</td>
    <td>${acc}</td>
    <td><span class="amt-cell ${t.type}"><span class="amt-sign" aria-hidden="true">${signPrefix}</span><input type="text" inputmode="decimal" class="amt" data-col="amount" value="${t.amount ? plain(t.amount) : ''}" placeholder="0" aria-label="Amount" autocomplete="off">${debtTag || (!isBaseCur ? `<span class="cur-tag">${esc(t.currency)}</span>` : `<span class="cur-tag cur-faint">${esc(state.settings.currency || 'MDL')}</span>`)}</span></td>`;
}

// "Saturday 10 October · Today" with the day's totals.
export function dayLabelHTML(date, today) {
  const di = dowIndex(date);
  const rel = date === today ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : date === addDays(today, 1) ? 'Tomorrow' : '';
  return `<span class="dow-pill dow-${di}">${DOW_LONG[di]}</span><b>${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}</b>${rel ? `<span class="rel-tag${rel === 'Today' ? ' today-tag' : ''}">${rel}</span>` : ''}`;
}

function dayRow(date, d, today, fmt, year) {
  const parts = [
    d.in ? `<span class="day-stat-pill in">+${fmt(d.in)}</span>` : '',
    d.out ? `<span class="day-stat-pill out">−${fmt(d.out)}</span>` : '',
    d.loanOut ? `<span class="day-stat-pill loan-out">⚡ −${fmt(d.loanOut)} lent</span>` : '',
    d.loanIn ? `<span class="day-stat-pill loan-in">⚡ +${fmt(d.loanIn)} back</span>` : '',
    `<span class="day-stat-pill count">${d.n} record${d.n === 1 ? '' : 's'}</span>`
  ].filter(Boolean).join('');
  return `<tr class="day-row dow-${dowIndex(date)}${date === today ? ' is-today' : ''}" aria-hidden="true"><td colspan="9"><div class="dr-wrap"><span class="dr">${dayLabelHTML(date, today)}${year ? `<span class="muted">${date.slice(0, 4)}</span>` : ''}</span><div class="dr-sum">${parts}</div></div></td></tr>`;
}

export function tableHTML(state, list, { sort, draft, fmt, selected = new Set(), years = false }) {
  const rows = sortRows(state, list, sort);
  const today = todayISO();
  // Sorted by date: a header row for each day with its weekday and totals.
  const byDate = sort.col === 'date';
  const perDay = {};
  for (const t of rows) {
    const d = (perDay[t.date] ||= { in: 0, out: 0, n: 0, loanIn: 0, loanOut: 0 });
    d.n++;
    if (t.type === 'transfer') continue;
    if (t.loan) {
      if (t.type === 'income') d.loanIn = (d.loanIn || 0) + B(t);
      else d.loanOut = (d.loanOut || 0) + B(t);
      continue;
    }
    if (t.type === 'income') d.in += B(t); else d.out += B(t);
  }
  let prevDate = null;
  const body = rows.map((t) => {
    const newDay = t.date !== prevDate;
    prevDate = t.date;
    const isLoan = Boolean(t.loan);
    const head = byDate && newDay ? dayRow(t.date, perDay[t.date], today, fmt, years) : '';
    const on = selected.has(t.id);
    return `${head}<tr data-id="${esc(t.id)}" class="t-${t.type}${isLoan ? ' is-loan' : ''}${newDay ? ' newday' : ''}${t.date === today ? ' is-today' : ''}${on ? ' selected' : ''}"><td class="selc"><input type="checkbox" class="sel" data-act="sel" data-id="${esc(t.id)}" ${on ? 'checked' : ''} aria-label="Select this record"></td>${cells(state, t)}
      <td><button type="button" class="row-del" data-act="row-del" data-id="${esc(t.id)}" aria-label="Delete this record" title="Delete">×</button></td></tr>`;
  }).join('');
  const income = list.filter((t) => t.type === 'income' && !t.loan).reduce((a, t) => a + B(t), 0);
  const expense = list.filter((t) => t.type === 'expense' && !t.loan).reduce((a, t) => a + B(t), 0);
  const loanOut = list.filter((t) => t.type === 'expense' && t.loan).reduce((a, t) => a + B(t), 0);
  const loanIn = list.filter((t) => t.type === 'income' && t.loan).reduce((a, t) => a + B(t), 0);
  const arrow = (id) => (sort.col === id ? (sort.dir > 0 ? ' ▲' : ' ▼') : '');
  return `<div class="grid-wrap"><table class="grid" id="tx-table">
    <colgroup>
      <col style="width:38px">
      <col style="width:124px">
      <col style="width:120px">
      <col style="width:170px">
      <col style="min-width:220px">
      <col style="width:130px">
      <col style="width:140px">
      <col style="width:145px">
      <col style="width:40px">
    </colgroup>
    <thead><tr><th class="selc"><input type="checkbox" class="sel" data-act="sel-all" ${list.length && list.every((t) => selected.has(t.id)) ? 'checked' : ''} aria-label="Select all shown"></th>${COLUMNS.map((c) => `<th class="${c.num ? 'num' : ''}"><button type="button" data-act="sort" data-col="${c.id}" aria-label="Sort by ${c.label}">${c.label}${arrow(c.id)}</button></th>`).join('')}<th></th></tr></thead>
    <tbody>${body}
      ${draft ? `<tr class="draft t-${draft.loan ? (draft.type === 'income' ? 'loan-borrowed' : 'loan-lent') : draft.type}" data-draft><td class="selc"></td>${cells(state, { ...draft, amount: 0 })}
        <td><button type="button" class="row-add" data-act="row-add" aria-label="Add this record" title="Add (Enter)">＋</button></td></tr>` : ''}
    </tbody>
    <tfoot><tr><td colspan="9" class="tbl-footer-td">
      <div class="tbl-footer-bar">
        <div class="tbl-footer-left">
          <span class="tbl-footer-badge count"><b>${list.length}</b> record${list.length === 1 ? '' : 's'}</span>
          ${selected.size ? `<span class="tbl-footer-badge sel"><b>${selected.size}</b> selected</span>` : ''}
        </div>
        <div class="tbl-footer-right">
          ${income ? `<span class="tbl-footer-pill in" title="Total Inflow">+${fmt(income)}</span>` : ''}
          ${expense ? `<span class="tbl-footer-pill out" title="Total Outflow">−${fmt(expense)}</span>` : ''}
          ${loanOut ? `<span class="tbl-footer-pill loan-out" title="Lent this month">⚡ −${fmt(loanOut)} lent</span>` : ''}
          ${loanIn ? `<span class="tbl-footer-pill loan-in" title="Borrowed/returned this month">⚡ +${fmt(loanIn)} back</span>` : ''}
          <span class="tbl-footer-pill net ${income - expense >= 0 ? 'good' : 'bad'}" title="Net Cash Flow (Inflow − Outflow)">
            <b>Net: ${income - expense >= 0 ? '+' : '−'}${fmt(Math.abs(income - expense))}</b>
          </span>
        </div>
      </div>
    </td></tr></tfoot>
  </table></div>`;
}

// Month grid, Monday first, with what came in and went out each day and a
// Month grid, Monday first, with what came in and went out each day and a
// weekly total. Modern financial calendar cards with emojis, week summaries, and insights.
export function calendarHTML(state, key) {
  const days = daysInMonth(key);
  const today = todayISO();
  const per = {};
  let totalMonthOut = 0;
  let totalMonthIn = 0;
  let highestSpendDay = null;
  let highestSpendAmt = 0;
  let activeDaysCount = 0;

  for (const t of state.tx) {
    if (!t.date.startsWith(key) || t.type === 'transfer') continue;
    const d = (per[t.date] ||= { in: 0, out: 0, n: 0, categories: [], topNote: '', maxSingleOut: 0 });
    if (t.loan) continue;
    if (t.type === 'income') {
      const bAmt = B(t);
      d.in += bAmt;
      totalMonthIn += bAmt;
    } else {
      const bAmt = B(t);
      d.out += bAmt;
      totalMonthOut += bAmt;
      if (bAmt > d.maxSingleOut) {
        d.maxSingleOut = bAmt;
        d.topNote = t.note || '';
      }
    }
    const cat = category(state, t.category);
    if (cat?.emoji && !d.categories.includes(cat.emoji)) {
      d.categories.push(cat.emoji);
    }
    d.n++;
  }

  for (let d = 1; d <= days; d++) {
    const iso = `${key}-${String(d).padStart(2, '0')}`;
    const v = per[iso];
    if (v?.out) {
      activeDaysCount++;
      if (v.out > highestSpendAmt) {
        highestSpendAmt = v.out;
        highestSpendDay = { day: d, iso, amt: v.out, topNote: v.topNote };
      }
    }
  }

  const maxOut = Math.max(1, ...Object.values(per).map((d) => d.out));
  const lead = (weekday(`${key}-01`) + 6) % 7;
  const cellsHtml = [];
  let weekOut = 0;
  let weekIn = 0;
  let col = 0;
  let weekIndex = 1;

  const pushWeek = () => {
    const hasData = weekOut > 0 || weekIn > 0;
    const net = weekIn - weekOut;
    cellsHtml.push(`
      <div class="cal-week-card" aria-label="Week summary">
        <div class="cal-week-head"><span class="cal-week-badge">W${weekIndex++}</span></div>
        ${hasData ? `
          <div class="cal-week-stats">
            ${weekOut ? `<span class="cw-out" title="Weekly outflow">−${compact(weekOut)}</span>` : ''}
            ${weekIn ? `<span class="cw-in" title="Weekly inflow">+${compact(weekIn)}</span>` : ''}
            ${weekIn && weekOut ? `<span class="cw-net ${net >= 0 ? 'pos' : 'neg'}" title="Weekly net">${net >= 0 ? '+' : '−'}${compact(Math.abs(net))}</span>` : ''}
          </div>
        ` : '<span class="cw-empty">·</span>'}
      </div>
    `);
    weekOut = 0;
    weekIn = 0;
    col = 0;
  };

  for (let i = 0; i < lead; i++) {
    cellsHtml.push('<div class="cal-blank"></div>');
    col++;
  }

  for (let d = 1; d <= days; d++) {
    const iso = `${key}-${String(d).padStart(2, '0')}`;
    const v = per[iso];
    const dayOut = v?.out || 0;
    const dayIn = v?.in || 0;
    const count = v?.n || 0;
    weekOut += dayOut;
    weekIn += dayIn;

    const heatRatio = dayOut ? dayOut / maxOut : 0;
    const heat = dayOut ? (0.15 + 0.85 * heatRatio).toFixed(2) : 0;
    const isToday = iso === today;
    const isFuture = iso > today;
    const isWeekend = dowIndex(iso) >= 5;
    const topEmojis = (v?.categories || []).slice(0, 3).join('');

    cellsHtml.push(`
      <div class="cal-day-cell dow-${dowIndex(iso)}${isWeekend ? ' weekend' : ''}">
        <div class="cal-day${isToday ? ' today' : ''}${isFuture ? ' future' : ''}${dayOut ? ' has-spend' : ''}${dayIn ? ' has-income' : ''}" data-act="day" data-date="${iso}" style="--heat:${heat}" role="button" tabindex="0" aria-label="${iso}">
          <div class="cal-day-header">
            <span class="cal-date-badge">${d}</span>
            ${isToday ? '<span class="cal-today-pill">Today</span>' : ''}
            ${topEmojis ? `<span class="cal-emojis" title="Categories logged">${topEmojis}</span>` : ''}
            <button type="button" class="cal-quick-add" data-act="day-add" data-date="${iso}" title="Add record on day ${d}" aria-label="Add record on day ${d}">+</button>
          </div>

          <div class="cal-day-content">
            ${dayIn ? `<span class="cal-pill income" title="Earned: +${plain(dayIn)}"><span class="sign">+</span>${compact(dayIn)}</span>` : ''}
            ${dayOut ? `<span class="cal-pill expense" title="Spent: −${plain(dayOut)}"><span class="sign">−</span>${compact(dayOut)}</span>` : ''}
            ${count > 1 ? `<span class="cal-tx-count" title="${count} records">${count} items</span>` : ''}
          </div>

          ${dayOut ? `<div class="cal-intensity-bar" style="width:${Math.max(12, Math.round(heatRatio * 100))}%" title="Daily spend intensity"></div>` : ''}
        </div>
      </div>
    `);

    if (++col === 7) pushWeek();
  }

  if (col) {
    while (col < 7) {
      cellsHtml.push('<div class="cal-blank"></div>');
      col++;
    }
    pushWeek();
  }

  const todayDow = today.startsWith(key) ? dowIndex(today) : -1;
  const dows = DOW_SHORT.map((d, i) => `
    <div class="cal-dow dow-${i}${i >= 5 ? ' weekend' : ''}${i === todayDow ? ' on' : ''}">
      <span>${d}</span>
    </div>
  `).join('');

  const avgDaily = activeDaysCount ? Math.round(totalMonthOut / activeDaysCount) : 0;
  const zeroDays = days - activeDaysCount;

  return `
    <div class="cal-container">
      <div class="cal">
        ${dows}
        <div class="cal-dow cal-week-h"><span>Weekly</span></div>
        ${cellsHtml.join('')}
      </div>

      <div class="cal-insights-bar">
        <div class="cal-insight-pill">
          <span class="cip-icon">☕</span>
          <span>Daily avg: <strong>${compact(avgDaily)}</strong></span>
        </div>
        ${highestSpendDay ? `
          <div class="cal-insight-pill highlight">
            <span class="cip-icon">🏆</span>
            <span>Peak spend: <strong>Day ${highestSpendDay.day} (−${compact(highestSpendDay.amt)})</strong>${highestSpendDay.topNote ? ` <small class="muted">(${esc(highestSpendDay.topNote)})</small>` : ''}</span>
          </div>
        ` : ''}
        <div class="cal-insight-pill">
          <span class="cip-icon">🏖️</span>
          <span>No-spend days: <strong>${zeroDays}</strong></span>
        </div>
        <div class="cal-legend">
          <span class="leg-item"><span class="leg-dot income"></span> Inflow</span>
          <span class="leg-item"><span class="leg-dot expense"></span> Outflow</span>
          <span class="leg-item"><span class="leg-dot today"></span> Today</span>
        </div>
      </div>
    </div>
  `;
}
