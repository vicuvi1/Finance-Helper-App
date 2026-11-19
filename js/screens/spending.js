// "Where my money goes": a centred donut with callout labels ("Work fees 49%")
// and, below it, one full-width row per category: icon, name, a coloured share
// bar, the amount and the share in a round badge. The second line of a row holds
// the change against the period before (a small pill), the budget when there is
// one, and the number of records. Hover a row or a slice and both light up.
// Click a row to open its records right under it; "See all in the Log" opens
// the Log filtered to that category. Categories under 3% fold into "Other"
// (click it to see what is inside). "Everyday only" leaves out work costs and
// one-off buys (everyday.js). Numbers come from catshare.js (tested); drawn as
// inline SVG, no library.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import * as T from '../cattree.js';
import * as E from '../everyday.js';
import { todayISO, addMonths, monthKey, monthLabel } from '../dates.js';
import { categoryShares, changeText, spendRange, SPEND_PERIODS, OTHER_ID, countsAsSpending, isRefund } from '../catshare.js';
import { spreadLabels } from '../donutlabels.js';
import { expandSplits } from '../splits.js';

const TOP = 7; // openCategory's own fold ("Everything else"), kept for the old sheet

// Stable colour per category (its place in your category list, the same one the
// Log's chips use), moving to the next free colour only when two shown
// categories would share one.
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

const MODE_KEY = 'finance-helper.spend-mode';
// "Everything" or "Everyday only": a choice of this device, never in your data.
function getMode() {
  if (ctx.ui.spendMode) return ctx.ui.spendMode;
  let m = 'all';
  try { m = localStorage.getItem(MODE_KEY) === 'day' ? 'day' : 'all'; } catch { /* private mode */ }
  ctx.ui.spendMode = m;
  return m;
}
function setMode(m) {
  ctx.ui.spendMode = m;
  try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
}

// ---------- The donut ----------

const f = (n) => Math.round(n * 100) / 100;
const plain = (cents) => ctx.money(cents, { compact: false }).replace(/\s[A-Za-z]{3}$/, '');
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// A ring of stroked circles (pathLength 100), one per slice. `wide` adds a
// callout per slice either side (kept apart by spreadLabels); the narrow one
// has none, the rows under it are the legend. `mid` is the text in the hole.
function donutSvg(items, { total, wide, selected, label, mid, sub }) {
  const W = wide ? 600 : 240;
  const H = wide ? 300 : 240;
  const cx = W / 2;
  const cy = H / 2;
  const R = wide ? 100 : 84;
  const SW = wide ? 30 : 32;
  const gap = items.length > 1 ? 0.5 : 0;
  let at = 0;
  const segs = [];
  const labels = [];
  for (const it of items) {
    const len = it.share * 100;
    const ang = ((at + len / 2) / 100) * Math.PI * 2;
    segs.push(`<circle class="dn-seg${selected === it.id ? ' sel' : ''}" cx="${cx}" cy="${cy}" r="${R}" pathLength="100" data-act="cat-pick" data-cat="${esc(it.id)}" data-key="${esc(it.key)}" style="--c:${it.color};--len:${f(Math.max(0.2, len - gap))};--off:${f(-(at + gap / 2))};--i:${segs.length}" transform="rotate(-90 ${cx} ${cy})"><title>${esc(it.name)} ${it.pct}%</title></circle>`);
    if (wide) {
      const s = Math.sin(ang);
      const c = -Math.cos(ang);
      const ro = R + SW / 2;
      labels.push({ it, side: s >= 0 ? 1 : -1, x0: cx + ro * s, y0: cy + ro * c, x1: cx + (ro + 12) * s, y1: cy + (ro + 12) * c });
    }
    at += len;
  }
  let leaders = '';
  if (wide) {
    for (const side of [-1, 1]) {
      const mine = labels.filter((l) => l.side === side);
      const ys = spreadLabels(mine.map((l) => ({ y: l.y1 })), { gap: 18, top: 14, bottom: H - 14 });
      mine.forEach((l, k) => {
        const y = ys[k];
        const x2 = cx + side * (R + SW / 2 + 34);
        leaders += `<g class="dn-lab" data-act="cat-pick" data-cat="${esc(l.it.id)}" data-key="${esc(l.it.key)}" style="--c:${l.it.color}"><path d="M${f(l.x0)} ${f(l.y0)} L${f(l.x1)} ${f(l.y1)} L${f(x2)} ${f(y)}" fill="none" stroke="${l.it.color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><text x="${f(x2 + side * 6)}" y="${f(y + 4.5)}" text-anchor="${side > 0 ? 'start' : 'end'}">${esc(clip(l.it.name, 18))} <tspan class="dn-lab-p">${l.it.pct}%</tspan></text></g>`;
      });
    }
  }
  return `<div class="dn-donut ${wide ? 'dn-wide' : 'dn-narrow'}"><svg class="dn-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" class="dn-track" stroke-width="${SW}"/>
    <g class="dn-ring" stroke-width="${SW}">${segs.join('')}</g>
    ${leaders}
  </svg>
  <div class="dn-mid"><small>${esc(mid)}</small><strong>${esc(plain(total))}</strong><span>${esc(ctx.state.settings.currency || '')}</span>${wide && sub ? `<em class="dn-sub">${sub}</em>` : ''}</div></div>`;
}

// ---------- The card ----------

// Remembered so a tap can redraw just the card (no jump, no replayed animation).
const last = {};

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000) + 1;
const monthsIn = (range) => Math.max(1, (Number(range.to.slice(0, 4)) - Number(range.from.slice(0, 4))) * 12 + Number(range.to.slice(5, 7)) - Number(range.from.slice(5, 7)) + 1);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso) => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

export function spendingCard(opts = {}) {
  const { state, ui } = ctx;
  const key = opts.key || 'home';
  last[key] = opts;
  const today = todayISO();
  const period = opts.period || 'month';
  const range = opts.range || spendRange(period, today);
  const base = opts.base || M.B;
  const allList = opts.list || state.tx;
  const mode = getMode();
  const ed = mode === 'day' ? E.everydayList(allList, { settings: state.settings, rates: state.rates, base, from: range.from, to: range.to }) : null;
  const list = ed ? ed.list : expandSplits(allList); // split records as their lines (js/splits.js)
  const limit = E.everydayLimit(state.settings, state.rates);
  const { total, prevTotal, rows } = categoryShares(list, range, base);
  const word = range.prev?.word || 'before';
  const name = (id) => (id === OTHER_ID ? 'Other' : M.category(state, id)?.name || 'Unknown');
  const icon = (id) => (id === OTHER_ID ? '…' : M.category(state, id)?.emoji || '');
  const colors = colorsFor(state, rows.filter((r) => r.id !== OTHER_ID).map((r) => r.id));
  const item = (r) => ({ ...r, key, name: name(r.id), icon: icon(r.id), color: r.id === OTHER_ID ? 'var(--faint)' : colors[r.id] || `var(--c${(Math.max(0, state.settings.categories.findIndex((c) => c.id === r.id)) % 8) + 1})` });
  const items = rows.map(item);
  const sel = ui.catSel?.[key] || null;
  const otherOpen = !!ui.catOtherOpen?.[key];

  const stepper = !opts.range && (period === 'month' || period === 'last' || /^m:/.test(period));
  const cur = range.from.slice(0, 7);
  const chips = opts.range ? '' : `<div class="dn-pills" role="group" aria-label="Period">${SPEND_PERIODS.map((p) => `<button type="button" data-act="spend-period" data-key="${key}" data-period="${p.id}" aria-pressed="${p.id === period}">${p.name}</button>`).join('')}</div>${stepper ? `<span class="spend-step" role="group" aria-label="Pick a month"><button type="button" class="chip" data-act="spend-step" data-key="${key}" data-step="-1" aria-label="Month before">‹</button><button type="button" class="chip" data-act="spend-step" data-key="${key}" data-step="1" aria-label="Month after" ${cur >= monthKey(today) ? 'disabled' : ''}>›</button></span>` : ''}`;
  const modeSeg = `<div class="dn-pills" role="group" aria-label="What to count"><button type="button" data-act="spend-mode" data-key="${key}" data-mode="all" aria-pressed="${mode === 'all'}">Everything</button><button type="button" data-act="spend-mode" data-key="${key}" data-mode="day" aria-pressed="${mode === 'day'}" title="Leaves out work costs and one-off buys">Everyday only</button></div>`;
  const title = esc(opts.title || 'Where your money goes');
  const head = `<div class="dn-top"><h2>${title} <span class="muted dn-when">· ${esc(range.label)}</span></h2><div class="dn-controls">${chips}${modeSeg}</div></div>`;
  const leftOut = ed ? ed.leftOut : 0;
  const note = leftOut > 0 ? `<p class="dn-hidden">Not counted: ${esc(plain(leftOut))} ${esc(state.settings.currency || '')} of work costs and one-off buys.</p>` : '';
  if (!total) {
    return `<section class="card spend dn-card" data-spend="expense" data-key="${key}">${head}
      <p class="muted" style="margin:6px 0 0">${mode === 'day' ? 'No everyday spending' : 'Nothing spent'} in ${esc(range.label)}.</p>${note}</section>`;
  }

  // Under the total in the donut: change against the period before, and per day.
  const ch = prevTotal > 0 ? Math.round((total / prevTotal - 1) * 100) : null;
  const counted = daysBetween(range.from, range.to > today ? today : range.to);
  const vs = word === 'same days last month' || word === 'the month before' ? 'last month' : word;
  const perDay = `${esc(plain(Math.round(total / Math.max(1, counted) / 100) * 100))} a day`;
  const sub = ch == null ? perDay : `<b class="${ch > 0 ? 'up' : ch < 0 ? 'down' : ''}">${ch > 0 ? '↑ ' : ch < 0 ? '↓ ' : ''}${Math.abs(ch)}%</b> vs ${esc(vs)} · ${perDay}`;

  const aria = `Spending by category, ${range.label}: ${items.map((it) => `${it.name} ${it.pct}%`).join(', ')}. Total ${ctx.money(total)}.`;
  const midWord = mode === 'day' ? 'Everyday spending' : 'Spent';
  const donut = `<div class="dn-wrap">${donutSvg(items, { total, wide: true, selected: sel, label: aria, mid: midWord, sub })}${donutSvg(items, { total, wide: false, selected: sel, label: aria, mid: midWord })}</div>`;

  const months = monthsIn(range);
  const monthly = /^(month|last|m:)/.test(period) || (opts.range && range.from.slice(0, 7) === range.to.slice(0, 7));
  const row = (it, { child = false } = {}) => {
    const open = it.id === OTHER_ID ? otherOpen : sel === it.id;
    const cat = it.id === OTHER_ID ? null : M.category(state, it.id);
    const budget = cat?.budget > 0 ? cat.budget * months : 0;
    const over = budget > 0 && it.amount > budget;
    const p = it.change == null ? null : Math.round(it.change * 100);
    const pill = p == null ? `<span class="dn-tag first">${monthly ? 'first this month' : 'first this period'}</span>`
      : p === 0 ? '<span class="dn-tag first">no change</span>'
        : `<span class="dn-tag ${p > 0 ? 'up' : 'down'}" title="${Math.abs(p)}% ${p > 0 ? 'more' : 'less'} than ${esc(word)}">${p > 0 ? '↑' : '↓'} ${Math.abs(p)}%</span>`;
    const mid = budget > 0 ? `<span class="dn-bud${over ? ' over' : ''}">· ${esc(plain(it.amount))} of ${esc(plain(budget))} budget${over ? ' · over' : ''}</span>`
      : it.id === OTHER_ID ? `<span class="dn-inside">· ${esc(it.items.map((c) => name(c.id)).slice(0, 3).join(', ') + (it.items.length > 3 ? '…' : ''))}</span>`
        : cat?.workCost ? '<span class="dn-inside">· work cost</span>' : '';
    const recs = it.count ? `<span class="dn-n">· ${it.count} record${it.count === 1 ? '' : 's'}</span>` : '';
    const btn = `<button type="button" class="dn-row${child ? ' child' : ''}${open ? ' open' : ''}" data-act="cat-pick" data-cat="${esc(it.id)}" data-key="${key}" aria-expanded="${open}" aria-label="${esc(it.name)}: ${esc(plain(it.amount))}, ${it.pct} percent" style="--c:${it.color}">
      <span class="dn-ic" aria-hidden="true">${it.icon ? esc(it.icon) : '<i class="dot"></i>'}</span>
      <span class="dn-name">${esc(it.name)}${it.id === OTHER_ID ? ` <em>(${it.items.length})</em>` : ''}</span>
      <span class="dn-amt">${esc(plain(it.amount))}</span>
      <span class="dn-bar" aria-hidden="true"><i style="width:${Math.max(1.5, it.share * 100).toFixed(1)}%"></i></span>
      <span class="dn-line">${pill}${mid}${recs}</span>
      <span class="dn-pct" aria-hidden="true">${it.pct}%</span>
    </button>`;
    return btn + (open && it.id !== OTHER_ID ? recordsPanel(key, it, range, list, limit, base) : '');
  };
  const rowsHtml = items.map((it) => row(it) + (it.id === OTHER_ID && otherOpen ? it.items.map((c) => row(item(c), { child: true })).join('') : '')).join('');

  const table = `<table class="sr-only"><caption>Spending by category, ${esc(range.label)}</caption><thead><tr><th>Category</th><th>Amount</th><th>Share</th></tr></thead><tbody>${items.map((it) => `<tr><td>${esc(it.name)}</td><td>${esc(ctx.money(it.amount))}</td><td>${it.pct}%</td></tr>`).join('')}</tbody></table>`;

  return `<section class="card spend dn-card" data-spend="expense" data-key="${key}">${head}
    ${donut}${note}
    <div class="dn-list" role="group" aria-label="Categories, biggest first">${rowsHtml}</div>
    ${table}
  </section>`;
}

// The records of the opened category, right under its row.
function recordsPanel(key, it, range, list, limit, base) {
  const { state } = ctx;
  const id = it.id;
  const ids = new Set(id === OTHER_ID ? it.items.map((x) => x.id) : [id]);
  const recs = M.sortTx(list.filter((t) => countsAsSpending(t) && ids.has(t.category) && t.date >= range.from && t.date <= range.to));
  const nm = (cid) => M.category(state, cid)?.name || 'Unknown';
  const SHOWN = 6;
  return `<div class="dn-recs" role="region" aria-label="${esc(it.name)} records">
    ${recs.slice(0, SHOWN).map((t) => `<div class="dn-rec"><span class="d">${esc(shortDate(t.date))}</span><span class="n">${esc(t.note || (id === OTHER_ID ? nm(t.category) : it.name))}${id === OTHER_ID && t.note ? ` <em>${esc(nm(t.category))}</em>` : ''}${E.isOneOff(t, limit, base) ? '<span class="one">one-off</span>' : ''}${isRefund(t) ? '<span class="one">refund</span>' : ''}</span><span class="v">${isRefund(t) ? '−' : ''}${esc(ctx.money(t.amount, { currency: t.currency }))}</span></div>`).join('')}
    ${recs.length > SHOWN ? `<p class="muted small" style="margin:4px 0 0">${recs.length - SHOWN} more.</p>` : ''}
    <div class="dn-recs-foot"><span class="muted small">${recs.length} record${recs.length === 1 ? '' : 's'} · ${esc(range.label)}</span><button type="button" class="btn sm" data-act="cat-log" data-key="${key}" data-cat="${esc(id)}">See all in the Log</button></div>
  </div>`;
}

// Taps on the card. Returns true when handled. `redraw(el)` swaps the card in place.
export function onClick(act, el) {
  const { ui } = ctx;
  const key = el.dataset.key || el.closest('.spend')?.dataset.key || 'home';
  if (act === 'cat-pick') {
    const id = el.dataset.cat;
    const was = ui.catSel?.[key] === id;
    ui.catSel = { ...(ui.catSel || {}), [key]: was ? null : id };
    if (id === OTHER_ID) ui.catOtherOpen = { ...(ui.catOtherOpen || {}), [key]: !was };
    redraw(el, key);
    return true;
  }
  if (act === 'spend-mode') {
    setMode(el.dataset.mode === 'day' ? 'day' : 'all');
    ui.catSel = { ...(ui.catSel || {}), [key]: null };
    ui.catOtherOpen = { ...(ui.catOtherOpen || {}), [key]: false };
    redraw(el, key, true);
    return true;
  }
  if (act === 'spend-period') {
    ui.spendPeriod = el.dataset.period;
    ui.catSel = { ...(ui.catSel || {}), [key]: null };
    ui.catOtherOpen = { ...(ui.catOtherOpen || {}), [key]: false };
    redraw(el, key, true);
    return true;
  }
  if (act === 'spend-step') {
    const today = todayISO();
    const r = spendRange(ui.spendPeriod || 'month', today);
    const k = addMonths(r.from.slice(0, 7), Number(el.dataset.step));
    ui.spendPeriod = k === monthKey(today) ? 'month' : `m:${k}`;
    ui.catSel = { ...(ui.catSel || {}), [key]: null };
    ui.catOtherOpen = { ...(ui.catOtherOpen || {}), [key]: false };
    redraw(el, key, true);
    return true;
  }
  if (act === 'cat-log') {
    const o = last[key] || {};
    const range = o.range || spendRange(o.period || 'month', todayISO());
    const state = ctx.state;
    const id = el.dataset.cat;
    let cats = [id];
    if (id === OTHER_ID) {
      const { rows } = categoryShares(o.list || state.tx, range, o.base || M.B);
      cats = (rows.find((r) => r.id === OTHER_ID)?.items || []).map((r) => r.id);
    }
    ui.search = `${cats.map((c) => `cat:${c}`).join(' ')} from:${range.from} to:${range.to}`;
    ui.filter = 'all';
    location.hash = '#log';
    return true;
  }
  return false;
}

function redraw(el, key, replay = false) {
  const card = el.closest('.spend') || document.querySelector(`.spend[data-key="${key}"]`);
  const o = last[key];
  if (!card || !o) { ctx.render(); return; }
  const next = spendingCard({ ...o, period: key === 'home' ? ctx.ui.spendPeriod : o.period });
  const tpl = document.createElement('template');
  tpl.innerHTML = next.trim();
  const fresh = tpl.content.firstElementChild;
  if (replay) fresh.classList.add('flash-in');
  card.replaceWith(fresh);
}

// Records of one category in a period, with its last 6 months for context.
// `period` is a preset id ("month", "3m"...) or a { from, to, label } range.
export function openCategory(id, period = 'month', type = 'expense') {
  const { state } = ctx;
  const today = todayISO();
  const range = typeof period === 'string' ? M.periodRange(period, today) : period;
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
  // One level deeper: where the money went inside this category.
  const subs = type === 'expense' && id !== '__rest' && T.subsOf(state, id).length ? T.totalsBySub(state, list, id).rows : [];
  const subHtml = subs.length ? `<div class="sheet-subs">${subs.map((r) => {
    const sb = r.id === T.NO_SUB ? null : T.subById(state, r.id);
    return `<div class="sheet-sub"><span>${sb?.emoji ? `${esc(sb.emoji)} ` : ''}${esc(sb ? sb.name : 'No subcategory')}</span><span class="muted small">${Math.round(r.share * 100)}%</span><b class="font-num">${ctx.money(r.amount)}</b></div>`;
  }).join('')}<button type="button" class="btn small" data-drill="${esc(id)}">See it in Reports</button></div>` : '';
  ctx.openSheet(`<h3>${esc(title)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <div class="stats" style="margin-bottom:14px">
      <div class="stat"><span class="k">${esc(range.label)}</span><b>${ctx.money(sum)}</b></div>
      <div class="stat"><span class="k">Share</span><b>${total ? Math.round((sum / total) * 100) : 0}%</b></div>
      <div class="stat"><span class="k">Normal month</span><b>${avg == null ? '–' : ctx.money(avg)}</b></div>
    </div>
    <div class="mini-months">${months.map((m) => `<div class="mm"><span class="mm-bar"><i style="height:${((m.v / max) * 100).toFixed(1)}%"></i></span><span class="mm-l">${monthLabel(m.k, true).slice(0, 3)}</span><span class="mm-v">${m.v ? ctx.money(m.v).replace(/ [A-Z]+$/, '') : '–'}</span></div>`).join('')}</div>
    ${subHtml}
    ${items.length ? `<div class="list">${items.map((t) => ctx.txRow(t, { showDate: true })).join('')}</div>` : '<p class="muted">No records.</p>'}`, (sheet) => {
    sheet.addEventListener('click', (e) => {
      const d = e.target.closest('[data-drill]');
      if (d) { ctx.closeSheet(); ctx.drillReports?.(d.dataset.drill); return; }
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
