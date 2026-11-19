// The money calendar (#calendar), next to Plan: a month where each day shows
// what was spent, the bills due, the income expected and big buys, with a
// "money left" line for days still to come, "tight" days under your safety
// floor, and a small mark on no-spend days. Tap a day for its records and
// what is due. Read only: nothing here changes a record.

import { ctx, esc } from '../ctx.js';
import { formatMoney, evalAmount, centsToPlain } from '../money.js';
import { todayISO, monthLabel, addMonths, dayLabel, DOW_SHORT, dowIndex, monthKey } from '../dates.js';
import { monthCalendar, floorOf } from '../moneycal.js';

const cal = { key: null };

const compact = (c) => formatMoney(Math.round(c / 100) * 100, '', { compact: true });
const sign = (c) => (c < 0 ? '−' : '');

function noSpendLine(m, today) {
  const word = (n) => `${n} no-spend day${n === 1 ? '' : 's'}`;
  if (!m.counted) return m.key > monthKey(today) ? 'No-spend days show once the month starts' : 'No-spend days show once you log spending';
  const cmp = m.prev.counted
    ? ` · last month: ${m.prev.count}${m.prev.upTo ? ` by the ${m.prev.upTo}${[11, 12, 13].includes(m.prev.upTo) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[m.prev.upTo % 10] || 'th')}` : ''}`
    : '';
  return `${word(m.noSpend)}${cmp}`;
}

export function view() {
  const { state } = ctx;
  const today = todayISO();
  const key = cal.key || monthKey(today);
  const m = monthCalendar(state, today, key);
  const lead = dowIndex(`${key}-01`);
  const cells = Array.from({ length: lead }, () => '<span class="mc-cell mc-pad" aria-hidden="true"></span>');
  for (const d of m.days) {
    const bills = d.bills.reduce((a, b) => a + b.amount, 0);
    const income = d.income.reduce((a, b) => a + b.amount, 0);
    const big = d.big.reduce((a, t) => a + (Number.isInteger(t.base) ? t.base : t.amount), 0);
    const cls = ['mc-cell', d.today ? 'today' : '', d.future ? 'future' : '', d.tight ? 'tight' : '', d.noSpend ? 'nospend' : ''].filter(Boolean).join(' ');
    const label = `${dayLabel(d.date)}${d.spent ? `, spent ${formatMoney(d.spent, state.settings.currency)}` : ''}${d.bills.length ? `, ${d.bills.length} bill${d.bills.length === 1 ? '' : 's'} due` : ''}${d.income.length ? ', income expected' : ''}${d.tight ? ', tight' : ''}${d.noSpend ? ', no-spend day' : ''}`;
    cells.push(`<button type="button" class="${cls}" data-act="mc-day" data-date="${d.date}"${d.left != null ? ` data-left="${Math.round(d.left)}"` : ''} data-testid="mc-day" aria-label="${esc(label)}">
      <span class="mc-n">${Number(d.date.slice(8))}${d.noSpend ? '<i class="mc-ns" title="No-spend day" aria-hidden="true">●</i>' : ''}</span>
      ${d.spent ? `<span class="mc-sp">−${compact(d.spent)}</span>` : ''}
      ${bills ? `<span class="mc-bill" title="Bills due">▾ ${compact(bills)}</span>` : ''}
      ${income ? `<span class="mc-inc" title="Income expected">▴ ${compact(income)}</span>` : ''}
      ${big ? `<span class="mc-big" title="Big buy">★ ${compact(big)}</span>` : ''}
      ${d.left != null ? `<span class="mc-left" title="Money left at the end of the day">${sign(d.left)}${compact(Math.abs(d.left))}</span>` : ''}
      ${d.tight ? '<span class="mc-tt">tight</span>' : ''}
    </button>`);
  }
  const floor = floorOf(state);
  const tightNote = m.tightDays ? `${m.tightDays} tight day${m.tightDays === 1 ? '' : 's'} (money left under ${formatMoney(floor, state.settings.currency)})` : (m.endLeft != null ? `Money left at month end: ${formatMoney(Math.round(m.endLeft / 100) * 100, state.settings.currency)}` : '');
  return `<header class="top"><div><h1>Money calendar</h1><div class="sub">Spending, bills and income by day · read only</div></div></header>
  <section class="card mc" data-testid="money-calendar">
    <div class="mc-head">
      <button type="button" class="btn sm" data-act="mc-prev" aria-label="Previous month">‹</button>
      <h2>${esc(monthLabel(key))}</h2>
      <button type="button" class="btn sm" data-act="mc-next" aria-label="Next month">›</button>
      ${key !== monthKey(today) ? '<button type="button" class="btn sm" data-act="mc-today">This month</button>' : ''}
    </div>
    <p class="mc-sum"><b data-testid="mc-nospend">${esc(noSpendLine(m, today))}</b>${tightNote ? `<br><span class="muted">${esc(tightNote)}</span>` : ''}</p>
    <div class="mc-grid" role="grid">${DOW_SHORT.map((n) => `<span class="mc-dow" aria-hidden="true">${n}</span>`).join('')}${cells.join('')}</div>
    <p class="muted small mc-key"><span class="mc-ns">●</span> no-spend day · <span class="mc-bill">▾</span> bills due · <span class="mc-inc">▴</span> income expected · ★ big buy · small number: money left from today's cards and cash, minus bills, plus income</p>
    <label class="field mc-floor"><span>Keep at least (safety floor)</span><input id="mc-floor" type="text" inputmode="decimal" value="${esc(centsToPlain(floor))}" aria-label="Safety floor in ${esc(state.settings.currency)}"></label>
  </section>`;
}

function openDay(date) {
  const { state } = ctx;
  const today = todayISO();
  const m = monthCalendar(state, today, date.slice(0, 7));
  const d = m.days.find((x) => x.date === date);
  if (!d) return;
  const cur = state.settings.currency;
  const f = (c) => formatMoney(c, cur);
  const due = [...d.bills.map((b) => ({ ...b, kind: 'Bill' })), ...d.income.map((b) => ({ ...b, kind: 'Income' }))];
  const recs = [...d.records].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  ctx.openSheet(`<h3>${esc(dayLabel(date))} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <div class="stats" style="margin-bottom:12px">
      <div class="stat"><span class="k">${d.future ? 'Planned' : 'Spent'}</span><b class="expense">${f(d.future ? d.ahead.filter((t) => t.type === 'expense').reduce((a, t) => a + (Number.isInteger(t.base) ? t.base : t.amount), 0) : d.spent)}</b></div>
      <div class="stat"><span class="k">Due</span><b>${due.length}</b></div>
      ${d.left != null ? `<div class="stat"><span class="k">Money left</span><b class="${d.tight ? 'expense' : ''}">${f(Math.round(d.left / 100) * 100)}</b></div>` : `<div class="stat"><span class="k">Records</span><b>${recs.length}</b></div>`}
    </div>
    ${d.tight ? `<p class="mc-warn">Tight: money left would be under ${f(m.floor)}.</p>` : ''}
    ${d.noSpend ? '<p class="muted">A no-spend day: nothing was spent.</p>' : ''}
    ${due.length ? `<h4 class="mc-h">Due this day</h4><div class="list">${due.map((x) => `<div class="tx"><span class="t"><b>${esc(x.label)}</b><span>${x.kind}${x.rule.every === 'once' ? ' · once' : ` · ${esc(x.rule.every === 'month' ? 'monthly' : x.rule.every)}`}${x.done ? ' · logged' : ''}</span></span><span class="v ${x.kind === 'Income' ? 'income' : 'expense'}">${x.kind === 'Income' ? '+' : '−'}${f(x.amount)}</span></div>`).join('')}</div>` : ''}
    <h4 class="mc-h">Records</h4>
    ${recs.length ? `<div class="list">${recs.map((t) => ctx.txRow(t)).join('')}</div>` : '<p class="muted">Nothing logged on this day.</p>'}`, (sheet) => {
    sheet.addEventListener('click', (e) => {
      const row = e.target.closest('[data-act="edit"]');
      if (row) { ctx.closeSheet(); ctx.openTxSheet(ctx.state.tx.find((t) => t.id === row.dataset.id)); }
    });
  });
}

export function onClick(act, el) {
  if (act === 'mc-day') { openDay(el.dataset.date); return true; }
  const today = todayISO();
  const cur = cal.key || monthKey(today);
  if (act === 'mc-prev' || act === 'mc-next') {
    const next = addMonths(cur, act === 'mc-prev' ? -1 : 1);
    // A year ahead at most: further out is guessing.
    if (next <= addMonths(monthKey(today), 12)) cal.key = next;
    ctx.render();
    return true;
  }
  if (act === 'mc-today') { cal.key = null; ctx.render(); return true; }
  return false;
}

// The safety floor: a setting that travels with the data.
export function onChange(el) {
  if (el.id !== 'mc-floor') return false;
  const { state } = ctx;
  const raw = el.value.trim();
  const c = raw === '' ? 0 : evalAmount(raw);
  if (c == null || c < 0) { ctx.toast('Type a number, e.g. 2000'); el.value = centsToPlain(floorOf(state)); return true; }
  state.settings.moneyFloor = c;
  state.settings.updatedAt = Date.now();
  ctx.persistSync();
  ctx.render();
  return true;
}
