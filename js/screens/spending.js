// "Where the money goes": one bar split by category (part of the whole) and a
// ranked list with name, amount, share and count, so every color also has a
// label. Hover links the bar and the list; click opens the category's records.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { todayISO, addMonths, monthKey, monthLabel } from '../dates.js';

const TOP = 7; // more than this folds into "Everything else"

// Stable color per category (its place in your category list), moving to the
// next free color only when two shown categories would share one.
function colorsFor(state, ids) {
  const used = new Set();
  const out = {};
  for (const id of ids) {
    const i = Math.max(0, state.settings.categories.findIndex((c) => c.id === id));
    let slot = (i % 8) + 1;
    for (let k = 0; k < 8 && used.has(slot); k++) slot = (slot % 8) + 1;
    used.add(slot);
    out[id] = `var(--c${slot})`;
  }
  return out;
}

export function spendingCard({ period = 'month', type = 'expense', title } = {}) {
  const { state } = ctx;
  const today = todayISO();
  const range = M.periodRange(period, today);
  const { total, rows } = M.totalsByCategory(state, range.from, range.to, type);
  const shown = rows.slice(0, TOP);
  const rest = rows.slice(TOP);
  const restSum = rest.reduce((a, r) => a + r.amount, 0);
  const colors = colorsFor(state, shown.map((r) => r.id));
  const name = (id) => M.category(state, id)?.name || 'Unknown';
  const items = [...shown.map((r) => ({ ...r, name: name(r.id), color: colors[r.id] })),
    ...(restSum ? [{ id: '__rest', name: `Everything else (${rest.length})`, amount: restSum, share: total ? restSum / total : 0, count: rest.reduce((a, r) => a + r.count, 0), color: 'var(--faint)' }] : [])];

  const chips = M.PERIODS.map((p) => `<button class="chip" data-act="spend-period" data-type="${type}" data-period="${p.id}" aria-pressed="${p.id === period}">${p.name}</button>`).join('');
  const verb = type === 'expense' ? 'spent' : 'earned';
  const bar = items.map((it) => `<button class="part" data-act="cat-open" data-cat="${esc(it.id)}" data-type="${type}" data-period="${period}" style="flex:${it.amount} 1 0;--c:${it.color}" aria-label="${esc(it.name)}: ${ctx.money(it.amount)}, ${Math.round(it.share * 100)}%"><span class="tip-bubble">${esc(it.name)} · ${ctx.money(it.amount)}</span></button>`).join('');
  const list = items.map((it) => `<button class="cat-row-btn" data-act="cat-open" data-cat="${esc(it.id)}" data-type="${type}" data-period="${period}">
      <span class="name"><i class="dot" style="--c:${it.color}"></i>${esc(it.name)}</span>
      <span class="share">${Math.round(it.share * 100)}%</span>
      <span class="money">${ctx.money(it.amount)}</span>
      <span class="meter"><i style="width:${(it.amount / (items[0]?.amount || 1) * 100).toFixed(1)}%;background:${it.color}"></i></span>
      <span class="count muted">${it.count} record${it.count === 1 ? '' : 's'}</span>
    </button>`).join('');

  return `<section class="card spend" data-spend="${type}"><h2>${esc(title || (type === 'expense' ? 'Where your money goes' : 'Where your money comes from'))} <span class="right muted">${esc(range.label)}</span></h2>
    <div class="chips">${chips}</div>
    ${total ? `<div class="spend-total"><span class="fig">${ctx.money(total)}</span> <span class="muted">${verb}</span></div>
    <div class="partbar" role="group" aria-label="Share of each category">${bar}</div>
    <div class="cat-list">${list}</div>` : `<p class="muted" style="margin:6px 0 0">Nothing ${verb} in ${esc(range.label)}.</p>`}
  </section>`;
}

// Records of one category in a period, with its last 6 months for context.
export function openCategory(id, period = 'month', type = 'expense') {
  const { state } = ctx;
  const today = todayISO();
  const range = M.periodRange(period, today);
  const { total, rows, list } = M.totalsByCategory(state, range.from, range.to, type);
  const restIds = new Set(rows.slice(TOP).map((r) => r.id));
  const match = (t) => (id === '__rest' ? restIds.has(t.category) : t.category === id);
  const items = M.sortTx(list.filter(match));
  const sum = items.reduce((a, t) => a + M.B(t), 0);
  const title = id === '__rest' ? 'Everything else' : (M.category(state, id)?.name || 'Unknown');
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const k = addMonths(monthKey(today), -i);
    const r = M.totalsByCategory(state, `${k}-01`, `${k}-31`, type);
    months.push({ k, v: id === '__rest' ? r.rows.filter((x) => restIds.has(x.id)).reduce((a, x) => a + x.amount, 0) : (r.rows.find((x) => x.id === id)?.amount || 0) });
  }
  const max = Math.max(1, ...months.map((m) => m.v));
  // Normal month = average of the earlier months that have any spending here.
  const prior = months.slice(0, 5).filter((m) => m.v > 0);
  const avg = prior.length ? Math.round(prior.reduce((a, m) => a + m.v, 0) / prior.length) : null;
  ctx.openSheet(`<h3>${esc(title)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <div class="stats" style="margin-bottom:14px">
      <div class="stat"><span class="k">${esc(range.label)}</span><b>${ctx.money(sum)}</b></div>
      <div class="stat"><span class="k">Share</span><b>${total ? Math.round((sum / total) * 100) : 0}%</b></div>
      <div class="stat"><span class="k">Normal month</span><b>${avg == null ? '–' : ctx.money(avg)}</b></div>
    </div>
    <div class="mini-months">${months.map((m) => `<div class="mm"><span class="mm-bar"><i style="height:${((m.v / max) * 100).toFixed(1)}%"></i></span><span class="mm-l">${monthLabel(m.k, true).slice(0, 3)}</span><span class="mm-v">${m.v ? ctx.money(m.v).replace(/ [A-Z]+$/, '') : '–'}</span></div>`).join('')}</div>
    ${items.length ? `<div class="list">${items.map((t) => ctx.txRow(t, { showDate: true })).join('')}</div>` : '<p class="muted">No records.</p>'}`, (sheet) => {
    sheet.addEventListener('click', (e) => {
      const row = e.target.closest('[data-act="edit"]');
      if (row) { ctx.closeSheet(); ctx.openTxSheet(ctx.state.tx.find((t) => t.id === row.dataset.id)); }
    });
  });
}

// Hovering a category in the list or the bar lights up both.
export function bindHover(root) {
  root.addEventListener('mouseover', (e) => {
    const el = e.target.closest('.spend [data-cat]');
    const card = el?.closest('.spend') || null;
    for (const c of root.querySelectorAll('.spend.hovering')) if (c !== card) c.classList.remove('hovering');
    if (!el) return;
    card.classList.add('hovering');
    for (const x of card.querySelectorAll('[data-cat]')) x.classList.toggle('hot', x.dataset.cat === el.dataset.cat);
  });
}
