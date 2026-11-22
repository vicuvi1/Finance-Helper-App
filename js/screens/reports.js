// Reports for any period: a month, quarter, year or your own dates. Totals
// with "vs the period before", money over time, and breakdowns by category,
// source, account, person and currency. Exports to Excel.
//
// "Where it went" goes one level deeper: a treemap of your categories; click
// one (there, in the table or in the flow chart) to see its subcategories,
// then the records and the shops behind them. A breadcrumb (or Esc) goes
// back up. Filters (account, tag, person) and a search ("all coffee this
// year") narrow everything on the page.

import { ctx, esc } from '../ctx.js';
import { spendingMap } from '../habits.js';
import { streaks, streakLine } from '../streaks.js';
import * as ReportSheet from './report.js';
import * as M from '../model.js';
import * as T from '../cattree.js';
import { formatMoney } from '../money.js';
import { todayISO, monthKey, monthLabel, addMonths, daysInMonth, isValidISO } from '../dates.js';
import { trendChart, dailyChart, sankeyChart } from '../charts.js';
import { monthSheet } from '../importer.js';
import { workbook } from '../xlsx.js';
import { parseQuery, searchTx, relRange } from '../search.js';
import { expandSplits } from '../splits.js';
import { catIcon, subColor } from './categories.js';
import * as Spending from './spending.js';
import * as IncomeSources from './incomesources.js';
import * as IS from '../incomesources.js';
import { countsAsSpending, signed, isRefund } from '../catshare.js';
import { withArchive, cutoffOf } from '../archive.js';

const PRESETS = [
  { id: 'month', name: 'Month' },
  { id: 'quarter', name: 'Quarter' },
  { id: 'year', name: 'Year' },
  { id: 'lastyear', name: 'Last year' },
  { id: 'all', name: 'All time' },
  { id: 'custom', name: 'Custom' },
];

const rs = {
  preset: 'month', month: null, from: null, to: null, sankeyMode: 'jars',
  drill: { cat: null, sub: null }, zoom: null, origin: null,
  q: '', acc: '', tag: '', person: '',
};

function range() {
  const today = todayISO();
  const m = rs.month || monthKey(today);
  const end = (k) => `${k}-${String(daysInMonth(k)).padStart(2, '0')}`;
  switch (rs.preset) {
    case 'quarter': {
      const q = Math.floor((Number(m.slice(5)) - 1) / 3);
      const first = `${m.slice(0, 4)}-${String(q * 3 + 1).padStart(2, '0')}`;
      return { from: `${first}-01`, to: end(addMonths(first, 2)), label: `Q${q + 1} ${m.slice(0, 4)}`, step: 3 };
    }
    case 'year': return { from: `${m.slice(0, 4)}-01-01`, to: `${m.slice(0, 4)}-12-31`, label: m.slice(0, 4), step: 12 };
    case 'lastyear': { const y = Number(today.slice(0, 4)) - 1; return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) }; }
    case 'all': {
      const dates = withArchive(ctx.state).tx.map((t) => t.date).sort();
      return { from: dates[0] || today, to: dates.at(-1) > today ? dates.at(-1) : today, label: 'All time' };
    }
    case 'custom': {
      const from = isValidISO(rs.from || '') ? rs.from : `${monthKey(today)}-01`;
      const to = isValidISO(rs.to || '') && rs.to >= from ? rs.to : today;
      return { from, to, label: `${from} → ${to}` };
    }
    default: return { from: `${m}-01`, to: end(m), label: monthLabel(m), step: 1 };
  }
}

// The records this page looks at (filters and search) and the period: a
// search that names one ("this year", "2025", "march") picks it.
function scope() {
  const today = todayISO();
  let r0 = range();
  // Archived years (js/archive.js) are read when the period, its year before or a search reaches back there.
  const cut = cutoffOf(ctx.state);
  const state = cut && (`${Number(r0.from.slice(0, 4)) - 1}-01-01` < cut || rs.q.trim()) ? withArchive(ctx.state) : ctx.state;
  // Split records as their lines (js/splits.js), so a tag or search on one line finds that part.
  const all = expandSplits(state.tx);
  let list = all;
  if (rs.acc) list = list.filter((t) => t.account === rs.acc || t.from === rs.acc || t.to === rs.acc);
  if (rs.tag) list = list.filter((t) => M.tagsOf(t.note).includes(rs.tag));
  if (rs.person) list = list.filter((t) => t.person === rs.person);
  const q = rs.q.trim();
  if (q) {
    const pq = parseQuery(q);
    const rr = relRange(pq.rel, today)
      || (pq.year && !pq.months.length ? { from: `${pq.year}-01-01`, to: `${pq.year}-12-31` } : null)
      || (pq.from || pq.to ? { from: pq.from || r0.from, to: pq.to || r0.to } : null);
    if (rr) r0 = { ...rr, label: `"${q}"`, searched: true };
    list = searchTx({ ...state, tx: list }, pq, today);
  }
  const filtered = list !== all;
  return { r0, fs: filtered ? { ...state, tx: list } : state, filtered };
}

function delta(now, before, { goodWhenUp = true } = {}) {
  if (!before) return '<span class="delta muted">no data before</span>';
  const p = Math.round(((now - before) / Math.abs(before)) * 100);
  if (!p) return '<span class="delta muted">same as before</span>';
  const good = goodWhenUp ? p > 0 : p < 0;
  return `<span class="delta ${good ? 'income' : 'expense'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p)}% vs before</span>`;
}

// "▲ 12%" for spending: up is red, down is green.
function change(now, before, title = '') {
  if (!before) return now ? '<span class="muted" title="Nothing to compare with">new</span>' : '<span class="muted">–</span>';
  const p = Math.round(((now - before) / before) * 100);
  if (!p) return `<span class="muted" title="${esc(title)}">same</span>`;
  return `<span class="delta ${p > 0 ? 'expense' : 'income'}" title="${esc(title)}">${p > 0 ? '▲' : '▼'}${Math.abs(p)}%</span>`;
}

function table(head, rows, cls = '') {
  return `<div class="table-wrap"><table class="rep-table ${cls}"><thead><tr>${head.map((h, i) => `<th${i > 0 ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="muted" style="text-align:center; padding:18px;">Nothing in this period.</td></tr>`}</tbody></table></div>`;
}

// ---------- "Where it went" ----------

function drillState(state) {
  const d = rs.drill;
  const c = d.cat && M.category(state, d.cat);
  if (!c || c.type !== 'expense') return { cat: null, sub: null };
  const sub = d.sub === T.NO_SUB ? T.NO_SUB : (T.subById(state, d.sub)?.parent === c.id ? d.sub : null);
  return { cat: c.id, sub };
}

function whereItWent(state, fs, r, r0) {
  const money = ctx.money;
  const { cat, sub } = drillState(state);
  const expenses = r.list.filter((t) => countsAsSpending(t));
  const prevExpenses = r.prev.list.filter((t) => countsAsSpending(t));
  const months = Math.max(1, r.days / 30.44);
  const c = cat ? M.category(state, cat) : null;
  const s = sub && sub !== T.NO_SUB ? T.subById(state, sub) : null;
  const inCat = (t) => t.category === cat;
  const inSub = (t) => inCat(t) && (sub === T.NO_SUB ? !T.subOf(state, t) : t.sub === sub && !!T.subOf(state, t));
  const levelList = !cat ? expenses : !sub ? expenses.filter(inCat) : expenses.filter(inSub);
  const levelTotal = levelList.reduce((a, t) => a + signed(t, M.B(t)), 0);
  const subName = (id) => (id === T.NO_SUB ? 'No subcategory' : T.subById(state, id)?.name || 'Unknown');

  // Rows for the treemap and the table at this level.
  let items = [];
  if (!cat) {
    const prev = new Map(r.prev.spending.rows.map((x) => [x.id, x.amount]));
    const { avg, months: n } = T.monthlyAverage(fs, r.from, (t) => t.category);
    items = r.spending.rows.map((x) => {
      const cc = M.category(state, x.id);
      return { id: x.id, act: `data-act="rep-drill" data-cat="${esc(x.id)}"`, icon: cc?.emoji || '', name: cc?.name || 'Unknown', color: ctx.catColor(x.id), amount: x.amount, share: x.share, count: x.count, prev: prev.get(x.id) || 0, avg: n ? avg.get(x.id) || 0 : null, subs: T.subsOf(state, x.id).length };
    });
  } else if (!sub) {
    const cur = T.totalsBySub(state, expenses, cat);
    const prev = new Map(T.totalsBySub(state, prevExpenses, cat).rows.map((x) => [x.id, x.amount]));
    const { avg, months: n } = T.monthlyAverage(fs, r.from, (t) => (t.category === cat ? T.subOf(state, t)?.id || T.NO_SUB : null));
    items = cur.rows.map((x) => {
      const ss = x.id === T.NO_SUB ? null : T.subById(state, x.id);
      return { id: x.id, act: `data-act="rep-drill" data-cat="${esc(cat)}" data-sub="${esc(x.id)}"`, icon: ss?.emoji || (ss ? '' : '❔'), name: subName(x.id), color: ss ? subColor(state, ss) : 'var(--faint)', amount: x.amount, share: x.share, count: x.count, prev: prev.get(x.id) || 0, avg: n ? avg.get(x.id) || 0 : null };
    });
  } else {
    // The shops and notes inside one subcategory.
    items = T.topMerchants(levelList, 12).map((m, i) => ({ id: m.key, act: `data-act="rep-search" data-q="${esc(m.key)}"`, icon: '', name: m.label, color: `color-mix(in srgb, ${s ? subColor(state, s) : ctx.catColor(cat)} ${Math.max(40, 100 - i * 8)}%, var(--surface))`, amount: m.amount, share: levelTotal ? m.amount / levelTotal : 0, count: m.count }));
  }

  const rects = T.treemap(items.map((x) => x.amount), 2.1);
  const tiles = items.map((x, i) => {
    const rc = rects[i];
    if (!rc) return '';
    const area = rc.w * rc.h;
    const size = area < 180 ? 'xs' : area < 520 ? 's' : '';
    return `<button type="button" class="tm-tile ${size}" ${x.act} data-tm="${rc.x.toFixed(2)},${rc.y.toFixed(2)},${rc.w.toFixed(2)},${rc.h.toFixed(2)}" style="left:${rc.x.toFixed(3)}%;top:${rc.y.toFixed(3)}%;width:${rc.w.toFixed(3)}%;height:${rc.h.toFixed(3)}%;--c:${x.color};--d:${Math.min(i, 14)}" title="${esc(`${x.name}: ${money(x.amount)} · ${Math.round(x.share * 100)}%`)}">
      <span class="tm-in">${x.icon ? `<span class="tm-ic" aria-hidden="true">${esc(x.icon)}</span>` : ''}<span class="tm-n">${esc(x.name)}</span><span class="tm-v">${money(x.amount, { compact: true })} · ${Math.round(x.share * 100)}%</span></span>
    </button>`;
  }).join('');
  const zoom = rs.zoom ? ` tm-zoom-${rs.zoom}` : '';
  const origin = rs.origin ? `--ox:${rs.origin.x}%;--oy:${rs.origin.y}%;` : '';
  rs.zoom = null;

  const crumbs = [`<button type="button" class="crumb" data-act="rep-drill" ${!cat ? 'aria-current="page"' : ''}>All spending</button>`];
  if (c) crumbs.push(`<button type="button" class="crumb" data-act="rep-drill" data-cat="${esc(c.id)}" ${!sub ? 'aria-current="page"' : ''}>${c.emoji ? `${esc(c.emoji)} ` : ''}${esc(c.name)}</button>`);
  if (sub) crumbs.push(`<button type="button" class="crumb" aria-current="page">${s?.emoji ? `${esc(s.emoji)} ` : ''}${esc(subName(sub))}</button>`);

  const waiting = levelList.filter((t) => T.needsSub(state, t));
  const avgTitle = (x) => (x.avg == null ? 'No earlier months to compare with' : `Average month: ${money(x.avg)}`);
  const head = !cat ? ['Category', 'Spent', 'Share', 'vs before', 'vs avg month', 'Records'] : ['Subcategory', 'Spent', 'Share', 'vs before', 'vs avg month', 'Records'];
  const rowsHtml = items.map((x) => `<tr class="click" ${x.act} tabindex="0">
      <td><div class="rep-cat-name">${x.icon ? `<span class="ci">${esc(x.icon)}</span>` : ctx.dot(x.color)}<span>${esc(x.name)}</span>${x.subs ? `<span class="muted small rep-subcount">${x.subs}</span>` : ''}</div></td>
      <td class="num font-num"><b>${money(x.amount)}</b></td>
      <td class="num"><div class="rep-share-cell"><div class="rep-share-bar"><i style="width:${Math.round(x.share * 100)}%; background:${x.color}"></i></div><span class="font-num muted">${Math.round(x.share * 100)}%</span></div></td>
      <td class="num">${change(x.amount, x.prev, x.prev ? `Before: ${money(x.prev)}` : '')}</td>
      <td class="num">${x.avg == null ? '<span class="muted" title="No earlier months">–</span>' : change(Math.round(x.amount / months), x.avg, avgTitle(x))}</td>
      <td class="num font-num muted">${x.count}</td>
    </tr>`);

  const merchants = sub ? [] : T.topMerchants(levelList, 8);
  const maxM = merchants[0]?.amount || 1;
  const records = sub ? M.sortTx(levelList) : [];
  const empty = !items.length;

  return `<section class="card rep-where" id="rep-where">
    <div class="rep-where-head">
      <div><h2 style="margin:0">Where it went</h2>
        <nav class="crumbs" aria-label="Where you are">${crumbs.join('<span class="crumb-sep" aria-hidden="true">›</span>')}</nav></div>
      <div class="rep-where-side"><b class="expense font-num">${money(levelTotal)}</b>
        ${waiting.length ? `<button type="button" class="pill-btn" data-act="rep-needs" title="File these one level deeper">${waiting.length} need${waiting.length === 1 ? 's' : ''} a subcategory</button>` : ''}</div>
    </div>
    ${empty ? `<p class="muted" style="margin:8px 0 0">Nothing spent here in ${esc(r0.label)}.</p>` : `<div class="rep-where-grid">
      <div class="tm${zoom}" style="${origin}" role="group" aria-label="Treemap: ${cat ? (sub ? 'shops and notes' : 'subcategories') : 'categories'} by money spent"><div class="tm-box">${tiles}</div></div>
      <div class="rep-where-detail">${sub
    ? `<h3 class="rep-mini-h">${records.length} record${records.length === 1 ? '' : 's'}</h3><div class="list rep-records">${records.slice(0, 40).map((t) => ctx.txRow(t, { showDate: true })).join('')}</div>${records.length > 40 ? `<p class="muted small">…and ${records.length - 40} more. Export to Excel for all of them.</p>` : ''}`
    : table(head, rowsHtml, 'rep-where-table')}</div>
    </div>
    ${merchants.length ? `<div class="rep-merchants"><h3 class="rep-mini-h">Top shops & notes${c ? ` in ${esc(c.name)}` : ''}</h3>
      <div class="rep-merch-list">${merchants.map((m) => `<button type="button" class="rep-merch" data-act="rep-search" data-q="${esc(m.key)}" title="Search for “${esc(m.label)}”">
        <span class="rm-n">${esc(m.label)}</span><span class="rm-c muted small">${m.count}×</span><span class="rm-v font-num">${money(m.amount)}</span>
        <span class="rm-bar"><i style="transform:scaleX(${(m.amount / maxM).toFixed(3)})"></i></span></button>`).join('')}</div></div>` : ''}`}
  </section>`;
}

export function view() {
  const { state } = ctx;
  const { r0, fs, filtered } = scope();
  const r = M.report(fs, r0.from, r0.to, { today: todayISO() });
  const p = r.prev;
  const money = ctx.money;
  const catName = (id) => M.category(state, id)?.name || 'Unknown';
  const withIcon = (id) => { const c = M.category(state, id); return c ? `${c.emoji ? `${c.emoji} ` : ''}${c.name}` : 'Unknown'; };
  const acc = (id) => M.account(state, id)?.name || 'Unknown';
  const who = (id) => M.person(state, id)?.name || 'Unknown';
  const series = M.reportSeries(fs, r0.from, r0.to);
  const today = todayISO();
  const chart = series.unit === 'day'
    ? dailyChart(series.rows.map((x, i) => ({ day: i + 1, iso: x.key, amount: x.expense, future: x.key > today })), (c) => money(c))
    : trendChart(series.rows.map((x) => ({ key: x.key, income: x.income, expense: x.expense })), (c) => money(c));

  const kpi = (k, v, d, cls = '', icon = '') => `<div class="rep-kpi-card ${cls}">
    <div class="rep-kpi-head"><span class="k">${k}</span>${icon ? `<span class="rep-kpi-icon">${icon}</span>` : ''}</div>
    <b class="rep-kpi-val ${cls}">${v}</b>
    <div class="rep-kpi-sub">${d || ''}</div>
  </div>`;

  const savingsPct = r.savingsRate == null ? null : Math.round(r.savingsRate * 100);
  const savingsVal = savingsPct == null ? '–' : (savingsPct < 0 ? '0%' : `${savingsPct}%`);
  const savingsSub = savingsPct != null && savingsPct < 0
    ? `<span class="delta expense">Deficit: ${money(Math.abs(r.net))}</span>`
    : `<span class="delta muted">target ${M.savingsJar(state)?.pct ?? 0}%</span>`;
  const savingsClass = savingsPct != null && savingsPct < 0 ? 'deficit' : (savingsPct >= (M.savingsJar(state)?.pct ?? 0) ? 'income' : '');
  const netClass = r.net < 0 ? 'deficit' : (r.net > 0 ? 'income' : '');

  const tips = rs.preset === 'month' && !filtered && !r0.searched ? M.insights(state, r0.from.slice(0, 7), today) : [];
  const year = !filtered && (rs.preset === 'year' || rs.preset === 'lastyear') ? M.yearOverview(state, Number(r0.from.slice(0, 4))) : null;

  const expenses = r.list.filter((t) => countsAsSpending(t));
  const sankeyData = {
    income: r.income,
    expense: r.expense,
    sources: r.sources.rows.map((x) => ({ id: x.id, name: withIcon(x.id), amount: x.amount, color: ctx.catColor(x.id) })),
    jars: state.settings.jars.map((j, i) => ({ id: j.id, name: j.name, emoji: j.emoji, pct: j.pct, savings: j.savings, color: j.savings ? 'var(--gold)' : `var(--c${(i % 8) + 1})` })),
    categories: r.spending.rows.map((x) => {
      const c = M.category(state, x.id);
      return { id: x.id, name: rs.sankeyMode === 'detailed' ? catName(x.id) : withIcon(x.id), emoji: c?.emoji || '', amount: x.amount, jarId: M.jarOf(state, x.id), color: ctx.catColor(x.id) };
    }),
    subs: T.totalsAllSubs(state, expenses).map((x) => ({ id: x.id, parent: x.parent, name: x.sub ? x.sub.name : `${catName(x.parent)} · not sorted`, emoji: x.sub?.emoji || '', amount: x.amount, color: x.sub ? subColor(state, x.sub) : ctx.catColor(x.parent) })),
  };
  const sankey = sankeyChart(sankeyData, (c) => money(c), { mode: rs.sankeyMode || 'jars' });

  // Drill-down also narrows "Biggest expenses".
  const d = drillState(state);
  const noRefunds = expenses.filter((t) => !isRefund(t));
  const bigList = d.cat ? noRefunds.filter((t) => t.category === d.cat && (!d.sub || (d.sub === T.NO_SUB ? !T.subOf(state, t) : t.sub === d.sub))) : noRefunds;
  const biggest = [...bigList].sort((a, b) => M.B(b) - M.B(a)).slice(0, 10);
  const bigWhere = d.cat ? ` in ${d.sub && d.sub !== T.NO_SUB ? T.subById(state, d.sub)?.name : catName(d.cat)}` : '';

  const tags = M.allTags(state);
  const opt = (v, label, sel) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(label)}</option>`;
  const anyFilter = rs.acc || rs.tag || rs.person || rs.q;

  ReportSheet.init();
  return `<header class="top"><div><h1>Reports</h1><div class="sub">${esc(r0.label)} · ${r.days} day${r.days === 1 ? '' : 's'} · ${r.count} record${r.count === 1 ? '' : 's'}${filtered ? ' · filtered' : ''}</div></div>
    <div class="btns rep-head-btns"><button class="btn" data-act="recap-open" data-key="${rs.preset === 'month' ? rs.month || monthKey(today) : addMonths(monthKey(today), -1)}">✨ ${rs.preset === 'month' && (rs.month || monthKey(today)) === monthKey(today) ? 'Recap so far' : 'Month recap'}</button><button class="btn" data-go="review" data-testid="year-open">📅 Year</button><button class="btn" data-act="rep-export">Export to Excel</button><button class="btn primary" data-rep-open data-testid="report-open">📄 Report</button></div></header>
  <div class="rep-bar">
    <div class="chips">${PRESETS.map((x) => `<button class="chip" data-act="rep-preset" data-preset="${x.id}" aria-pressed="${rs.preset === x.id && !r0.searched}">${x.name}</button>`).join('')}</div>
    ${r0.step && !r0.searched ? `<div class="month-switch"><button class="icon-btn" data-act="rep-step" data-step="-1" aria-label="Previous">‹</button><b>${esc(r0.label)}</b><button class="icon-btn" data-act="rep-step" data-step="1" aria-label="Next">›</button></div>` : ''}
    ${rs.preset === 'custom' && !r0.searched ? `<div class="rep-dates"><input type="date" id="rep-from" value="${r0.from}" aria-label="From"><span class="muted">to</span><input type="date" id="rep-to" value="${r0.to}" aria-label="To"></div>` : ''}
  </div>
  <div class="rep-filters">
    <label class="rep-search"><span aria-hidden="true">🔎</span><input type="search" id="rep-q" value="${esc(rs.q)}" placeholder="Search, e.g. all coffee this year" aria-label="Search records in this report" enterkeyhint="search"></label>
    <select id="rep-acc" aria-label="Account">${opt('', 'All accounts', rs.acc)}${M.activeAccounts(state).map((a) => opt(a.id, a.name, rs.acc)).join('')}</select>
    ${tags.length ? `<select id="rep-tag" aria-label="Tag">${opt('', 'Any tag', rs.tag)}${tags.map((g) => opt(g.tag, `#${g.tag}`, rs.tag)).join('')}</select>` : ''}
    ${state.people.length ? `<select id="rep-person" aria-label="Person">${opt('', 'Anyone', rs.person)}${state.people.map((x) => opt(x.id, x.name, rs.person)).join('')}</select>` : ''}
    ${anyFilter ? '<button type="button" class="btn small" data-act="rep-clear">Clear</button>' : ''}
  </div>

  <section class="rep-kpi-grid rep-kpis">
    ${kpi('Earned', ctx.countUp(r.income, 'r-in'), delta(r.income, p.income), 'income', '💰')}
    ${kpi('Spent', ctx.countUp(r.expense, 'r-out'), delta(r.expense, p.expense, { goodWhenUp: false }), 'expense', '💸')}
    ${kpi(r.net < 0 ? 'Net Deficit' : 'Kept (Net)', ctx.countUp(r.net, 'r-net'), delta(r.net, p.net), netClass, r.net < 0 ? '⚠️' : '🏦')}
    ${kpi('Saved', savingsVal, savingsSub, savingsClass, '🎯')}
    ${kpi(r.counted < r.days ? 'Spent / day so far' : 'Spent / day', money(Math.round(r.perDay / 100) * 100), delta(r.perDay, p.perDay, { goodWhenUp: false }), '', '📅')}
    ${kpi('No-spend days', String(r.noSpendDays), `<span class="delta muted">of ${r.counted}${r.counted < r.days ? ' so far' : ''}</span>`, r.noSpendDays > 0 ? 'income' : '', '✨')}
    ${r.loansOut || r.loansIn ? kpi('Loans', `${money(r.loansOut)} out`, `<span class="delta muted">${money(r.loansIn)} back in</span>`, '', '🤝') : ''}
  </section>

  ${Spending.spendingCard({ key: 'reports', title: 'Where my money goes', range: { from: r0.from, to: r0.to, label: r0.label, prev: { ...M.previousRange(r0.from, r0.to), word: 'the period before' } }, list: fs.tx })}

  ${whereItWent(state, fs, r, r0)}

  <div class="rep-row-visuals">
    <section class="card rep-sankey-card">
      <div class="rep-card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
        <div>
          <h2 style="margin:0;">Cash flow flowchart</h2>
          <span class="sub muted">${rs.sankeyMode === 'detailed' ? 'Income, categories and the subcategories they end in' : 'Visual money flow across income, smart jars, and spending'}</span>
        </div>
        <div class="chips small">
          <button class="chip" data-act="rep-sankey-mode" data-mode="jars" aria-pressed="${(rs.sankeyMode || 'jars') === 'jars'}">Smart Jars</button>
          <button class="chip" data-act="rep-sankey-mode" data-mode="direct" aria-pressed="${rs.sankeyMode === 'direct'}">Direct</button>
          <button class="chip" data-act="rep-sankey-mode" data-mode="detailed" aria-pressed="${rs.sankeyMode === 'detailed'}">Detailed</button>
        </div>
      </div>
      <div class="rep-sankey-wrap">
        ${sankey}
      </div>
    </section>

    <section class="card rep-activity-card">
      <div>
        <h2 style="margin:0 0 4px 0;">${series.unit === 'day' ? 'Spending per day' : 'Earned and spent per month'}</h2>
        <span class="sub muted">${series.unit === 'day' ? 'Daily expenses timeline' : 'Monthly trend comparison'}</span>
      </div>
      <div style="margin: 14px 0;">${chart}</div>
      ${series.unit === 'month' ? '<div class="legend"><span><i style="background:var(--income)"></i>Earned</span><span><i style="background:var(--expense)"></i>Spent</span></div>' : ''}
    </section>
  </div>

  ${habitsCard(fs, r0)}

  ${IncomeSources.reportCard(today)}

  <div class="rep-row-tables">
    <div class="rep-col-left">
      <div class="rep-sub-grid">
        <section class="card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h2 style="margin:0;">Income by category</h2>
            <b class="income">${money(r.income)}</b>
          </div>
          ${table(['Category', 'Earned', 'Share', 'Records'], r.sources.rows.map((x) => {
            const sharePct = Math.round(x.share * 100);
            const c = M.category(state, x.id);
            return `<tr class="click" data-act="rep-cat" data-cat="${esc(x.id)}" data-type="income">
              <td><div class="rep-cat-name">${catIcon(c || { id: x.id })}<span>${esc(catName(x.id))}</span></div></td>
              <td class="num income font-num"><b>${money(x.amount)}</b></td>
              <td class="num"><div class="rep-share-cell"><div class="rep-share-bar"><i style="width:${sharePct}%; background:${ctx.catColor(x.id)}"></i></div><span class="font-num muted">${sharePct}%</span></div></td>
              <td class="num font-num muted">${x.count}</td>
            </tr>`;
          }))}
        </section>

        <section class="card">
          <h2 style="margin:0 0 12px 0;">By account</h2>
          ${table(['Account', 'In', 'Out', 'Records'], r.byAccount.map((x) => `<tr class="click" data-act="acc-open" data-id="${esc(x.id)}">
            <td><b>${esc(acc(x.id))}</b></td>
            <td class="num income font-num">${x.income ? money(x.income) : '<span class="muted">–</span>'}</td>
            <td class="num expense font-num">${x.expense ? money(x.expense) : '<span class="muted">–</span>'}</td>
            <td class="num font-num muted">${x.count}</td>
          </tr>`))}
        </section>
      </div>

      ${r.byPerson.length ? `<section class="card">
        <h2 style="margin:0 0 12px 0;">With people</h2>
        ${table(['Person', 'Received', 'Given', 'Records'], r.byPerson.map((x) => `<tr class="click" data-act="person-open" data-id="${esc(x.id)}">
          <td><b>${esc(who(x.id))}</b></td>
          <td class="num income font-num">${x.income ? money(x.income) : '<span class="muted">–</span>'}</td>
          <td class="num expense font-num">${x.expense ? money(x.expense) : '<span class="muted">–</span>'}</td>
          <td class="num font-num muted">${x.count}</td>
        </tr>`))}
      </section>` : ''}

      ${r.byCurrency.length > 1 || (r.byCurrency[0] && r.byCurrency[0].id !== state.settings.currency) ? `<section class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h2 style="margin:0;">By currency</h2>
          <span class="sub muted">in each currency</span>
        </div>
        ${table(['Currency', 'In', 'Out'], r.byCurrency.map((x) => `<tr>
          <td><b>${esc(x.id)}</b></td>
          <td class="num income font-num">${formatMoney(x.income, '')}</td>
          <td class="num expense font-num">${formatMoney(x.expense, '')}</td>
        </tr>`))}
      </section>` : ''}
    </div>

    <div class="rep-col-right">
      <section class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h2 style="margin:0;">Biggest expenses${esc(bigWhere)}</h2>
          <span class="sub muted">Top outflows</span>
        </div>
        ${biggest.length ? `<div class="rep-top-list">${biggest.map((t, idx) => `
          <div class="rep-top-tx">
            <span class="rep-tx-rank">#${idx + 1}</span>
            <div class="rep-tx-main">${ctx.txRow(t, { showDate: true })}</div>
          </div>`).join('')}</div>` : '<p class="muted" style="margin:0">None in this period.</p>'}
      </section>

      ${tips.length ? `<section class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h2 style="margin:0;">What your money says</h2>
          <span class="sub muted">Smart insights</span>
        </div>
        <div class="rep-tips-list">${tips.map(ctx.tipCard).join('')}</div>
      </section>` : ''}

      ${year ? `<section class="card">
        <h2 style="margin:0 0 12px 0;">Month by month · ${esc(r0.from.slice(0, 4))}</h2>
        ${table(['Month', 'Earned', 'Spent', 'Kept', '%'], year.rows.map((x) => `<tr class="${x.income || x.expense ? '' : 'dim'}">
          <td><b>${monthLabel(x.key, true).slice(0, 3)}</b></td>
          <td class="num income font-num">${x.income ? formatMoney(x.income, '', { compact: true }) : '<span class="muted">–</span>'}</td>
          <td class="num expense font-num">${x.expense ? formatMoney(x.expense, '', { compact: true }) : '<span class="muted">–</span>'}</td>
          <td class="num font-num">${x.income || x.expense ? formatMoney(x.net, '', { compact: true }) : '<span class="muted">–</span>'}</td>
          <td class="num font-num">${x.savingsRate == null ? '<span class="muted">–</span>' : `${Math.round(x.savingsRate * 100)}%`}</td>
        </tr>`))}
      </section>` : ''}
    </div>
  </div>`;
}

function exportReport() {
  const { state } = ctx;
  const { r0, fs } = scope();
  const r = M.report(fs, r0.from, r0.to, { today: todayISO() });
  const b = state.settings.currency;
  const v = (c) => ({ v: c / 100, t: 'money' });
  const cat = (id) => M.category(state, id)?.name || 'Unknown';
  const expenses = r.list.filter((t) => countsAsSpending(t));
  const subRows = T.totalsAllSubs(state, expenses);
  const srcTot = IS.sourceTotals(state, r0.from, r0.to);
  const sheets = [
    { name: 'Summary', header: false, cols: [24, 18, 18], rows: [
      [{ v: `Report ${r0.label}`, bold: true }], [`${r0.from} to ${r0.to}`], [],
      ['', { v: 'This period', bold: true }, { v: 'Period before', bold: true }],
      [`Earned (${b})`, v(r.income), v(r.prev.income)], [`Spent (${b})`, v(r.expense), v(r.prev.expense)], [`Kept (${b})`, v(r.net), v(r.prev.net)],
      ['Saved %', r.savingsRate == null ? '' : `${Math.round(r.savingsRate * 100)}%`, r.prev.savingsRate == null ? '' : `${Math.round(r.prev.savingsRate * 100)}%`],
      [`Spent per day (${b})`, v(r.perDay), v(r.prev.perDay)], ['No-spend days', r.noSpendDays, r.prev.noSpendDays], ['Records', r.count, r.prev.count],
    ] },
    { name: 'Records', ...monthSheet(state, r0.label, r.list) },
    { name: 'Categories', cols: [26, 16, 10, 10], rows: [['Category', `Spent (${b})`, 'Share', 'Records'], ...r.spending.rows.map((x) => [cat(x.id), v(x.amount), `${Math.round(x.share * 100)}%`, x.count])], filterRows: r.spending.rows.length },
    { name: 'Subcategories', cols: [22, 24, 16, 10, 10], rows: [['Category', 'Subcategory', `Spent (${b})`, 'Share', 'Records'], ...subRows.map((x) => [cat(x.parent), x.sub ? x.sub.name : '(none)', v(x.amount), r.expense ? `${Math.round((x.amount / r.expense) * 100)}%` : '', x.count])], filterRows: subRows.length },
    { name: 'Income sources', cols: [26, 16, 10, 10], rows: [['Source', `Earned (${b})`, 'Share', 'Records'], ...r.sources.rows.map((x) => [cat(x.id), v(x.amount), `${Math.round(x.share * 100)}%`, x.count])] },
    ...(srcTot.rows.some((x) => x.id !== IS.NONE) ? [{ name: 'Income by source', cols: [26, 16, 10, 10], rows: [['Source', `Earned (${b})`, 'Share', 'Records'], ...srcTot.rows.map((x) => [x.id === IS.NONE ? 'No source' : IS.sourceName(state, x.id), v(x.amount), `${Math.round(x.share * 100)}%`, x.count])] }] : []),
    { name: 'People', cols: [24, 16, 16, 10], rows: [['Person', `Received (${b})`, `Given (${b})`, 'Records'], ...r.byPerson.map((x) => [M.person(state, x.id)?.name || '', v(x.income), v(x.expense), x.count])] },
  ];
  ctx.download(`finance-report-${r0.from}_${r0.to}.xlsx`, workbook(sheets), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// Opens Reports on one category (or subcategory), e.g. from Home.
export function drillTo(cat, sub = null) {
  rs.drill = { cat: cat || null, sub: sub || null };
  rs.zoom = 'in';
  rs.origin = null;
}

function drill(el) {
  const before = (rs.drill.cat ? 1 : 0) + (rs.drill.sub ? 1 : 0);
  const next = { cat: el.dataset.cat || null, sub: el.dataset.sub || null };
  const after = (next.cat ? 1 : 0) + (next.sub ? 1 : 0);
  if (next.cat === rs.drill.cat && next.sub === rs.drill.sub) return;
  rs.drill = next;
  rs.zoom = after > before ? 'in' : after < before ? 'out' : 'in';
  // Zoom from the tile you clicked.
  const tm = el.dataset.tm?.split(',').map(Number);
  rs.origin = tm ? { x: (tm[0] + tm[2] / 2).toFixed(1), y: (tm[1] + tm[3] / 2).toFixed(1) } : null;
  const fromBelow = !el.closest('#rep-where');
  ctx.render();
  if (fromBelow) document.getElementById('rep-where')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

export function onClick(act, el) {
  if (IncomeSources.onClick(act, el)) return true;
  if (act === 'rep-preset') {
    rs.preset = el.dataset.preset;
    if (rs.q && relRange(parseQuery(rs.q).rel, todayISO())) rs.q = '';
    if (rs.preset === 'custom' && !rs.from) { const r0 = range(); rs.from = r0.from; rs.to = r0.to; }
    ctx.render({ enter: true });
    return true;
  }
  if (act === 'rep-step') {
    const r0 = range();
    rs.month = addMonths(rs.month || monthKey(todayISO()), Number(el.dataset.step) * (r0.step || 1));
    ctx.render({ enter: true });
    return true;
  }
  if (act === 'rep-drill') { drill(el); return true; }
  if (act === 'rep-cat') {
    // Spending opens the drill-down; income keeps its sheet of records.
    if (el.dataset.type === 'expense') { drill(el); return true; }
    const { r0 } = scope();
    Spending.openCategory(el.dataset.cat, r0, el.dataset.type);
    return true;
  }
  if (act === 'rep-needs') {
    const { r0, fs } = scope();
    const r = M.report(fs, r0.from, r0.to, { withPrev: false });
    const d = drillState(ctx.state);
    const list = r.list.filter((t) => T.needsSub(ctx.state, t) && (!d.cat || t.category === d.cat));
    ctx.openNeedsSub(list);
    return true;
  }
  if (act === 'rep-search') {
    rs.q = el.dataset.q || '';
    ctx.render({ enter: true });
    return true;
  }
  if (act === 'rep-clear') {
    Object.assign(rs, { q: '', acc: '', tag: '', person: '' });
    ctx.render({ enter: true });
    return true;
  }
  if (act === 'rep-sankey-mode') {
    rs.sankeyMode = el.dataset.mode;
    ctx.render({ enter: true });
    return true;
  }
  if (act === 'rep-export') { exportReport(); return true; }
  return false;
}

export function onChange(el) {
  if (el.id === 'rep-from' || el.id === 'rep-to') {
    rs[el.id === 'rep-from' ? 'from' : 'to'] = el.value;
    ctx.render({ enter: true });
    return true;
  }
  if (el.id === 'rep-q' || el.id === 'rep-acc' || el.id === 'rep-tag' || el.id === 'rep-person') {
    rs[el.id.slice(4)] = el.value.trim();
    ctx.render({ enter: true });
    if (el.id === 'rep-q') document.getElementById('rep-q')?.focus();
    return true;
  }
  return false;
}

// Esc goes one level up in "Where it went"; Enter in the search box searches.
export function onKey(e) {
  if (ctx.ui?.tab !== 'reports') return false;
  if (e.key === 'Enter' && e.target.id === 'rep-q') { e.preventDefault(); onChange(e.target); return true; }
  if (e.key === 'Escape' && rs.drill.cat && !document.querySelector('.sheet') && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName || '')) {
    rs.drill = rs.drill.sub ? { cat: rs.drill.cat, sub: null } : { cat: null, sub: null };
    rs.zoom = 'out';
    rs.origin = null;
    ctx.render();
    return true;
  }
  return false;
}

// Your spending habits: weekdays and time of day (js/habits.js).
function habitsCard(state, r0) {
  const m = spendingMap(state, r0.from, r0.to);
  if (m.count < 5) return '';
  const max = Math.max(...m.weekdays.map((w) => w.perDay), 1);
  const cur = state.settings.currency;
  const days = m.weekdays.map((w) => `<div class="hb-day${w.ratio >= 1.4 ? ' hot' : ''}" title="${esc(w.name)}: about ${esc(formatMoney(Math.round(w.perDay), cur))} a day"><i style="height:${Math.max(3, (w.perDay / max) * 100).toFixed(0)}%"></i><span>${esc(w.name.slice(0, 2))}</span></div>`).join('');
  const times = m.timed ? m.times.map((t) => `<div class="hb-time"><span>${esc(t.label)} <small>${esc(t.hours)}</small></span><span class="hb-bar"><i style="width:${Math.max(1, Math.round(t.share * 100))}%"></i></span><b>${Math.round(t.share * 100)}%</b></div>`).join('') : '<p class="muted small">Log records on the day you spend and the time of day shows here.</p>';
  return `<section class="card hb-card" data-testid="habits-card"><h2 style="margin:0 0 4px">Your spending habits</h2>
    <p class="muted small" style="margin:0 0 12px">Everyday spending (bills and repeating payments left out). Time of day comes from when you logged it.</p>
    ${(() => { const sl = streakLine(streaks(state, todayISO())); return sl ? `<p class="hb-streak" data-testid="streak-line">${esc(sl)}</p>` : ''; })()}
    ${m.insights.length ? `<ul class="hb-insights">${m.insights.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <div class="hb-grid"><div><b class="small">By weekday (a day on average)</b><div class="hb-days">${days}</div></div><div><b class="small">By time of day</b>${times}</div></div>
  </section>`;
}
