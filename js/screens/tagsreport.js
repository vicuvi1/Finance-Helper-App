// Reports → Tags (#5): spending and income per tag over a period, month by
// month, and the records behind each (split records by their lines, so a
// line's own #tag counts only its part). Read only; numbers from js/tags.js.

import { ctx, esc } from '../ctx.js';
import { addMonths, monthLabel, todayISO } from '../dates.js';
import { tagTotals, tagRecords } from '../tags.js';
import { tagChip } from './recordx.js';
import { forRange } from '../archive.js';

const tr = { period: '12m', open: null };
const PERIODS = [['month', 'This month'], ['3m', '3 months'], ['12m', '12 months'], ['year', 'This year'], ['all', 'All time']];

function range(today) {
  const m = today.slice(0, 7);
  if (tr.period === 'month') return { from: `${m}-01`, to: today, months: [m] };
  if (tr.period === '3m') { const k = addMonths(m, -2); return { from: `${k}-01`, to: today, months: [k, addMonths(m, -1), m] }; }
  if (tr.period === 'year') { const y = today.slice(0, 4); const months = []; for (let k = `${y}-01`; k <= m; k = addMonths(k, 1)) months.push(k); return { from: `${y}-01-01`, to: today, months }; }
  if (tr.period === 'all') {
    const first = (ctx.state.tx || []).reduce((a, t) => (t?.date && t.date < a ? t.date : a), today).slice(0, 7);
    const start = first < addMonths(m, -23) ? addMonths(m, -23) : first;
    const months = [];
    for (let k = start; k <= m; k = addMonths(k, 1)) months.push(k);
    return { from: '0000-01-01', to: today, months };
  }
  const k = addMonths(m, -11);
  const months = [];
  for (let x = k; x <= m; x = addMonths(x, 1)) months.push(x);
  return { from: `${k}-01`, to: today, months };
}

function bars(r, months) {
  const max = Math.max(1, ...months.map((k) => r.months[k] || 0));
  return `<span class="rx-bars" aria-hidden="true">${months.map((k) => `<i style="height:${Math.max(2, Math.round(((r.months[k] || 0) / max) * 26))}px" title="${esc(monthLabel(k, true))}"></i>`).join('')}</span>`;
}

export function view() {
  const today = todayISO();
  const rg = range(today);
  const state = forRange(ctx.state, rg.from); // archived years (js/archive.js) when the period reaches them
  const rows = tagTotals(state, rg.from, rg.to);
  const money = ctx.money;
  const body = rows.map((r) => {
    const open = tr.open === r.tag;
    const recs = open ? tagRecords(state, r.tag, rg.from, rg.to) : [];
    return `<div class="rx-rep-row${open ? ' open' : ''}" data-testid="tag-report-row" data-tag="${esc(r.tag)}">
      <button type="button" class="rx-rep-head" data-act="tagrep-open" data-tag="${esc(r.tag)}" aria-expanded="${open}">
        ${tagChip(r.tag)}
        <span class="muted small">${r.count} record${r.count === 1 ? '' : 's'}</span>
        ${bars(r, rg.months)}
        <span class="rx-rep-amt">${r.spent ? `<b class="expense" data-testid="tag-spent">${money(r.spent)}</b>` : ''}${r.earned ? ` <b class="income">+${money(r.earned)}</b>` : ''}</span>
      </button>
      ${open ? `<div class="list rx-rep-list">${recs.map((t) => ctx.txRow(t, { showDate: true })).join('') || '<p class="muted small">Nothing in this period.</p>'}</div>` : ''}
    </div>`;
  }).join('');
  return `<header class="top"><div><h1>Tags</h1><div class="sub">What each #tag cost and brought in · split records by their lines</div></div></header>
    <div class="chips" role="group" aria-label="Period">${PERIODS.map(([id, name]) => `<button type="button" class="chip" data-act="tagrep-period" data-period="${id}" aria-pressed="${tr.period === id}">${name}</button>`).join('')}</div>
    <section class="card" data-testid="tag-report">${body || '<div class="empty"><b>No tags in this period</b>Type #trip in a record\'s note, or add tags to many records at once in Log → Table.</div>'}
    <p class="muted small">Colours, archive and merge: Settings → Categories &amp; rules → Tags.</p></section>`;
}

export function onClick(act, el) {
  if (act === 'tagrep-period') { tr.period = el.dataset.period; tr.open = null; ctx.render(); return true; }
  if (act === 'tagrep-open') { tr.open = tr.open === el.dataset.tag ? null : el.dataset.tag; ctx.render(); return true; }
  return false;
}
