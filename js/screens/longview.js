// The long view (#longview), under Reports: net worth over time (chart, a
// table of month or year ends and what each account adds), the savings rate
// with its trend, this year against last year per category, and the runway.
// Read only: the numbers come from js/longview.js and nothing here changes a
// record. MDL (your main currency) by default; USD or EUR convert at the
// rate of each day. Its styles are css/longview.css (loaded once, below).

import { ctx, esc } from '../ctx.js';
import { formatMoney } from '../money.js';
import { todayISO, monthLabel, dayLabel } from '../dates.js';
import { lineChart } from '../charts.js';
import { netWorthHistory, contributions, savingsRates, yearOverYear, runway, booksIn, monthsText, viewCurrencies, rateBook } from '../longview.js';
import { withArchive } from '../archive.js';
import * as Tips from '../tips.js';

const lv = { book: 'all', cur: null, nw: 'months', pick: null, showAll: false, yoy: 'soFar', year: null };
let shownCur = 'MDL';

function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById('lv-css')) return;
  const link = document.createElement('link');
  link.id = 'lv-css';
  link.rel = 'stylesheet';
  link.href = 'css/longview.css';
  document.head.appendChild(link);
}

// Totals are whole units (the bani belong on single records).
const tot = (c, o) => formatMoney(Math.round(c / 100) * 100, shownCur, o);
const pct = (r) => (r == null ? '–' : `${Math.round(r * 100)}%`);
const signed = (c) => (c == null ? '–' : tot(c, { sign: true }));
const tone = (c, goodUp = true) => (!c ? 'muted' : (c > 0) === goodUp ? 'income' : 'expense');
const bookName = (b) => (b === 'all' ? 'All' : b.charAt(0).toUpperCase() + b.slice(1));

export function view() {
  ensureStyles();
  const state = withArchive(ctx.state); // archived years count here (js/archive.js)
  const today = todayISO();
  const books = booksIn(state);
  if (lv.book !== 'all' && !books.includes(lv.book)) lv.book = 'all';
  const book = lv.book === 'all' ? null : lv.book;
  const year = lv.year || Number(today.slice(0, 4));
  const base = state.settings.currency;
  const curs = viewCurrencies(state, today, rateBook(state));
  const cur = curs.includes(lv.cur) ? lv.cur : base;
  const nw = netWorthHistory(state, today, { book, cur });
  const sr = savingsRates(state, today, { book, cur });
  const yy = yearOverYear(state, year, today, { mode: lv.yoy, book, cur });
  const rw = runway(state, today, { book, cur });
  shownCur = nw.currency;
  const hasData = state.tx.some((t) => t && !t.deleted);

  return `<header class="top"><div><h1>Long view</h1><div class="sub">How your money grows over months and years · read only</div></div>
    ${curs.length > 1 ? `<div class="seg lv-cur" role="group" aria-label="Currency" data-testid="lv-currency" style="grid-template-columns:repeat(${curs.length},1fr)">${curs.map((c) => `<button type="button" data-act="lv-cur" data-cur="${esc(c)}" aria-pressed="${c === shownCur}">${esc(c)}</button>`).join('')}</div>` : ''}</header>
  ${shownCur !== base ? `<p class="muted small lv-note">In ${esc(shownCur)}: every record and month end at the rate of its day, today at today's rate.</p>` : ''}
  ${books.length > 1 ? `<div class="chips lv-books" role="group" aria-label="Book">${['all', ...books].map((b) => `<button type="button" class="chip" data-act="lv-book" data-book="${esc(b)}" aria-pressed="${lv.book === b}">${esc(bookName(b))}</button>`).join('')}</div>` : ''}
  ${!hasData ? Tips.EMPTY.longview() : `
  ${metrics(nw, sr, yy, rw)}
  ${netWorthCard(nw)}
  <div class="lv-two">${savingsCard(sr)}${runwayCard(rw)}</div>
  ${yoyCard(yy, today)}`}`;
}

function metrics(nw, sr, yy, rw) {
  const tile = (key, label, big, sub) => `<div class="lv-metric" data-metric="${key}"><span class="k">${label}</span><b>${big}</b><span class="muted small">${sub}</span></div>`;
  const trend = sr.trend.diff == null ? 'trend after 6 full months' : sr.trend.diff === 0 ? 'steady vs the 3 months before' : `${sr.trend.diff > 0 ? '▲' : '▼'} ${Math.abs(sr.trend.diff)} points vs the 3 months before`;
  const yyLine = yy.change == null ? `no ${yy.year - 1} spending to compare` : `${yy.change > 0 ? '▲' : yy.change < 0 ? '▼' : ''} ${Math.abs(Math.round(yy.change * 100))}% vs the same days of ${yy.year - 1}`;
  return `<div class="lv-metrics" data-testid="lv-metrics">
    ${tile('networth', 'Net worth', tot(nw.now), `<span class="${tone(nw.changeThisYear)}">${signed(nw.changeThisYear)}</span> this year${nw.missing.length ? ` · ${nw.missing.length} account${nw.missing.length === 1 ? '' : 's'} without a rate` : ''}`)}
    ${tile('savings', 'Savings rate this year', pct(sr.thisYear), esc(trend))}
    ${tile('yoy', `Spending ${yy.mode === 'full' ? yy.year : `${yy.year} so far`}`, tot(yy.total.now), esc(yyLine))}
    ${tile('runway', 'Runway', rw.main.runway == null ? '–' : `${monthsText(Math.min(rw.main.runway, 120))} mo`, esc(rw.text))}
  </div>`;
}

// ---------- Net worth ----------

function netWorthCard(nw) {
  const years = lv.nw === 'years';
  const rows = years
    ? nw.years.map((y) => ({ key: `${y.year}-12`, label: String(y.year), date: y.date, total: y.total, change: y.change }))
    : nw.months.map((m, i) => ({ key: m.key, label: monthLabel(m.key), date: m.date, total: m.total, change: m.total - (i ? nw.months[i - 1].total : nw.opening), estimated: m.estimated && m.source === 'rebuilt', source: m.source }));
  const points = rows.map((r) => ({ label: years ? r.label : monthLabel(r.key, true), date: r.date, value: r.total, snap: r.estimated ? false : undefined }));
  const months = nw.months.map((m) => m.key);
  const pick = lv.pick && months.includes(lv.pick) ? lv.pick : months.at(-1);
  // Years: a year's row picks its last month (December, or this month).
  const pickKey = (key) => (months.includes(key) ? key : months.filter((k) => k.startsWith(key.slice(0, 4))).at(-1));
  const shown = [...rows].reverse();
  const list = lv.showAll ? shown : shown.slice(0, 12);
  const parts = contributions(nw, pick);
  const pickLabel = monthLabel(pick);
  return `<section class="card lv-nw" data-testid="lv-networth">
    <h2>Net worth over time
      <span class="right seg two lv-seg" role="group" aria-label="Show"><button type="button" data-act="lv-nw-mode" data-mode="months" aria-pressed="${!years}">Months</button><button type="button" data-act="lv-nw-mode" data-mode="years" aria-pressed="${years}">Years</button></span></h2>
    ${points.length > 1 ? lineChart(points, (v) => tot(v), { label: 'Net worth over time' }) : `<p class="muted small">One point so far (${esc(dayLabel(rows[0].date))}). The chart grows month by month.</p>`}
    <p class="muted small lv-note" data-testid="lv-sources">${nw.months.some((m) => m.source === 'snapshot') ? `<span class="lv-dot snap"></span>${nw.months.filter((m) => m.source === 'snapshot').length} saved snapshot${nw.months.filter((m) => m.source === 'snapshot').length === 1 ? '' : 's'} · ` : ''}<span class="lv-dot"></span>rebuilt from your balances and records, other currencies at the saved rate of each month end${nw.months.some((m) => m.estimated) ? ' (dashed: the nearest rate we have)' : ''}. Coins count only today.</p>
    <div class="lv-nw-grid">
      <div class="table-wrap"><table class="lv-table">
        <thead><tr><th>${years ? 'Year end' : 'Month end'}</th><th class="num">Net worth</th><th class="num">Change</th></tr></thead>
        <tbody>${list.map((r) => {
          const k = pickKey(r.key);
          return `<tr class="lv-row${k === pick ? ' on' : ''}" data-act="lv-nw-pick" data-key="${esc(k)}" tabindex="0"><td>${esc(r.label)}${r.source === 'snapshot' ? ' <span class="lv-dot snap" title="Saved snapshot"></span>' : ''}</td><td class="num">${tot(r.total)}</td><td class="num ${tone(r.change)}">${signed(r.change)}</td></tr>`;
        }).join('')}</tbody></table>
        ${shown.length > 12 ? `<button type="button" class="card-link" data-act="lv-nw-all">${lv.showAll ? 'Show fewer' : `Show all (${shown.length})`}</button>` : ''}
      </div>
      <div class="table-wrap"><table class="lv-table" data-testid="lv-accounts">
        <caption>What each account adds · ${esc(pickLabel)}</caption>
        <thead><tr><th>Account</th><th class="num">Value</th><th class="num">Change</th></tr></thead>
        <tbody>${parts.length ? parts.map((a) => `<tr><td>${a.emoji ? `${esc(a.emoji)} ` : ''}${esc(a.name)}${a.currency !== ctx.state.settings.currency ? ` <span class="muted small">${esc(a.currency)}</span>` : ''}${a.archived ? ' <span class="muted small">archived</span>' : ''}</td><td class="num">${a.value == null ? '<span class="muted">no rate</span>' : tot(a.value)}</td><td class="num ${tone(a.change)}">${signed(a.change)}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">No accounts with money.</td></tr>'}</tbody>
      </table></div>
    </div>
  </section>`;
}

// ---------- Savings rate ----------

function savingsCard(sr) {
  const last = sr.months.slice(-12);
  const H = 64;
  const bars = last.map((m) => {
    const r = m.rate == null ? 0 : Math.max(-1, Math.min(1, m.rate));
    const h = Math.max(m.rate == null ? 0 : 2, Math.abs(r) * H);
    const tip = `${monthLabel(m.key)}${m.running ? ' (so far)' : ''}: ${m.rate == null ? 'no income' : pct(m.rate)} · earned ${tot(m.income)}, spent ${tot(m.spending)}`;
    return `<div class="lv-sb${m.rate == null ? ' none' : r < 0 ? ' neg' : ''}${m.running ? ' run' : ''}" title="${esc(tip)}" aria-label="${esc(tip)}"><div class="lv-sb-up"><i style="height:${r >= 0 ? h : 0}px"></i></div><div class="lv-sb-down"><i style="height:${r < 0 ? h : 0}px"></i></div><span>${esc(monthLabel(m.key, true).slice(0, 3))}</span></div>`;
  }).join('');
  const t = sr.trend;
  const trend = t.diff == null
    ? `Last 3 full months: ${pct(t.last3)}. The trend shows once there are 6 full months.`
    : `Last 3 full months: ${pct(t.last3)} · the 3 before: ${pct(t.prev3)} (${t.diff > 0 ? '▲' : t.diff < 0 ? '▼' : ''}${t.diff ? ` ${Math.abs(t.diff)} points` : 'no change'})`;
  return `<section class="card lv-sr" data-testid="lv-savings">
    <h2>Savings rate</h2>
    <p class="lv-lead"><b class="${sr.thisYear == null ? '' : sr.thisYear >= 0 ? 'income' : 'expense'}">${pct(sr.thisYear)}</b> of this year's income kept</p>
    <p class="muted small">${esc(trend)}</p>
    <div class="lv-sbars" role="img" aria-label="Savings rate per month">${bars}</div>
    <div class="table-wrap"><table class="lv-table"><thead><tr><th>Year</th><th class="num">Earned</th><th class="num">Spent</th><th class="num">Kept</th></tr></thead>
      <tbody>${[...sr.years].reverse().map((y) => `<tr><td>${y.year}${y.running ? ' <span class="muted small">so far</span>' : ''}</td><td class="num">${tot(y.income)}</td><td class="num">${tot(y.spending)}</td><td class="num">${pct(y.rate)}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted small lv-note">(income − spending) ÷ income, with the same rule as Reports: moves between your accounts, loans, reward buys paid with points and reconciliation adjustments are left out.</p>
  </section>`;
}

// ---------- Runway ----------

function runwayCard(rw) {
  return `<section class="card lv-rw" data-testid="lv-runway">
    <h2>Runway</h2>
    <p class="lv-lead lv-rw-text">${esc(rw.text)}</p>
    <div class="table-wrap"><table class="lv-table"><thead><tr><th>Average of</th><th class="num">Spending a month</th><th class="num">Months</th></tr></thead>
      <tbody>${rw.windows.map((w) => `<tr${w === rw.main ? ' class="on"' : ''}><td>Last ${w.months} months${w.estimated ? ' <span class="muted small">this month so far</span>' : w.used && w.used < w.months ? ` <span class="muted small">${w.used} with records</span>` : ''}</td><td class="num">${tot(w.average)}</td><td class="num">${w.runway == null ? '–' : monthsText(Math.min(w.runway, 120))}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted small lv-note">Liquid savings ${tot(rw.liquid)}: ${rw.counted.length ? esc(rw.counted.map((a) => a.name).join(', ')) : 'no accounts with money'}.${rw.leftOut.length ? ` Left out: ${esc(rw.leftOut.join(', '))} (crypto).` : ''}${rw.missing.length ? ` No rate yet: ${esc(rw.missing.join(', '))}.` : ''} A month with no records at all is skipped.</p>
  </section>`;
}

// ---------- This year against last year ----------

function yoyCard(yy, today) {
  const thisYear = Number(today.slice(0, 4));
  const full = yy.mode === 'full';
  const what = full ? `${yy.year} against ${yy.year - 1}` : `1 January to ${dayLabel(yy.to)} against the same days of ${yy.year - 1}`;
  const line = (r) => `<li><span>${r.emoji ? `${esc(r.emoji)} ` : ''}${esc(r.name)}</span><b class="${r.diff > 0 ? 'expense' : 'income'}">${signed(r.diff)}</b></li>`;
  return `<section class="card lv-yoy" data-testid="lv-yoy">
    <h2>This year against last year
      <span class="right lv-yoy-ctl"><span class="seg two lv-seg" role="group" aria-label="Compare"><button type="button" data-act="lv-yoy-mode" data-mode="soFar" aria-pressed="${!full}">So far</button><button type="button" data-act="lv-yoy-mode" data-mode="full" aria-pressed="${full}">Full year</button></span>
      <span class="month-switch"><button class="icon-btn" data-act="lv-yoy-step" data-step="-1" aria-label="Previous year">‹</button><b>${yy.year}</b><button class="icon-btn" data-act="lv-yoy-step" data-step="1" aria-label="Next year" ${yy.year >= thisYear ? 'disabled' : ''}>›</button></span></span></h2>
    <p class="muted small">${esc(what)}: ${tot(yy.total.now)} against ${tot(yy.total.before)}.</p>
    ${yy.rows.length ? `<div class="lv-movers">
      <div><h3>Biggest increases</h3>${yy.up.length ? `<ul>${yy.up.map(line).join('')}</ul>` : '<p class="muted small">None</p>'}</div>
      <div><h3>Biggest decreases</h3>${yy.down.length ? `<ul>${yy.down.map(line).join('')}</ul>` : '<p class="muted small">None</p>'}</div>
    </div>
    <div class="table-wrap"><table class="lv-table"><thead><tr><th>Category</th><th class="num">${yy.year - 1}</th><th class="num">${yy.year}</th><th class="num">Change</th></tr></thead>
      <tbody>${yy.rows.map((r) => `<tr><td>${r.emoji ? `${esc(r.emoji)} ` : ''}${esc(r.name)}</td><td class="num">${tot(r.before)}</td><td class="num">${tot(r.now)}</td><td class="num ${tone(r.diff, false)}">${r.change == null ? (r.now ? 'new' : '–') : `${r.change > 0 ? '+' : r.change < 0 ? '−' : ''}${Math.abs(Math.round(r.change * 100))}%`}</td></tr>`).join('')}</tbody></table></div>` : `<p class="muted small">No spending in ${yy.year} or ${yy.year - 1} to compare.</p>`}
  </section>`;
}

export function onClick(act, el) {
  if (act === 'lv-cur') { lv.cur = el.dataset.cur || null; ctx.render(); return true; }
  if (act === 'lv-book') { lv.book = el.dataset.book || 'all'; lv.pick = null; ctx.render(); return true; }
  if (act === 'lv-nw-mode') { lv.nw = el.dataset.mode === 'years' ? 'years' : 'months'; lv.showAll = false; ctx.render(); return true; }
  if (act === 'lv-nw-pick') { lv.pick = el.dataset.key || null; ctx.render(); return true; }
  if (act === 'lv-nw-all') { lv.showAll = !lv.showAll; ctx.render(); return true; }
  if (act === 'lv-yoy-mode') { lv.yoy = el.dataset.mode === 'full' ? 'full' : 'soFar'; ctx.render(); return true; }
  if (act === 'lv-yoy-step') {
    const now = Number(todayISO().slice(0, 4));
    lv.year = Math.min(now, (lv.year || now) + Number(el.dataset.step));
    ctx.render();
    return true;
  }
  return false;
}
