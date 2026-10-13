// The app: screens, the add/edit sheet, import and backup. All numbers come
// from model.js; this file only turns them into HTML and handles taps.

import { load, save, backupText, restoreJSON, requestPersistence, isSealed, openImported, wipeStore, hasSession, reopen, STORAGE_KEYS } from './store.js';
import * as M from './model.js';
import { formatMoney, evalAmount, centsToPlain } from './money.js';
import { todayISO, monthKey, monthLabel, addMonths, daysInMonth, dayLabel, dowIndex, DOW_LONG, MONTHS, addDays } from './dates.js';
import { convert, pairRate } from './fx.js';
import { parseCSV, toCSV } from './csv.js';
import { importRows, importWorkbook, importCheck, exportRows, toTSV, monthSheet, overviewSheet, detectColumns } from './importer.js';
import { readWorkbook } from './xlsx-read.js';
import { workbook } from './xlsx.js';
import { refreshRates, backfillRates, recordRates } from './rates.js';
import { rateAdvice, heldIn } from './fxsmart.js';
import { ctx } from './ctx.js';
import * as RatesScreen from './screens/rates.js';
import * as AccountsScreen from './screens/accounts.js';
import * as Spending from './screens/spending.js';
import * as PeopleScreen from './screens/people.js';
import * as ReportsScreen from './screens/reports.js';
import * as Security from './screens/security.js';
import * as Updates from './screens/updates.js';
import * as Binance from './screens/binance.js';
import * as Sync from './screens/sync.js';
import * as SelfCheck from './screens/selfcheck.js';
import * as Backups from './screens/backups.js';
import * as Plan from './screens/plan.js';
import * as Clients from './screens/clients.js';
import * as Rules from './screens/rules.js';
import * as Goals from './screens/goals.js';
import * as Telegram from './screens/telegram.js';
import * as TgBlocks from './screens/tgblocks.js';
import * as Motion from './motion.js';
import * as Calc from './screens/calc.js';
import * as Buddy from './screens/buddy.js';
import * as ImportCheck from './screens/importcheck.js';
import * as WorkHour from './screens/workhour.js';
import * as YearReview from './screens/yearreview.js';
import { workText } from './workhours.js';
import { planSplit, splitTransfers, splitPrefs, isSplit } from './split.js';
import { openBankImport, rowsFromFile, decodeText } from './screens/bankimport.js';
import { guessMapping } from './bank.js';
import { forecast } from './forecast.js';
import { bindTilt } from './cards.js';
import { FREQS, markDone, dueItems } from './recurring.js';
import { invoiceStatus } from './invoices.js';
import { tableHTML, calendarHTML, dayLabelHTML } from './logviews.js';
import { sheetHTML, monthTabs } from './sheetview.js';
import { createHistory } from './history.js';
import { searchTx, searchSummary, SEARCH_HINT } from './search.js';
import { safeToSpend, shortDay } from './safespend.js';

let state = load();
// Undo / redo for this session (js/history.js).
const history = createHistory();
history.reset(state);
const ui = {
  tab: 'home',
  month: monthKey(todayISO()),
  year: Number(todayISO().slice(0, 4)),
  filter: 'all',
  search: '',
  sort: { col: 'date', dir: 1 },
  spendPeriod: 'month',
  incomePeriod: 'month',
  // Table view's empty "new row": keeps date/type/account between adds.
  draft: null,
  // Table rows ticked for a bulk change.
  selected: new Set(),
  // Sheet view: days with an extra empty row.
  sheetExtra: new Set(),
  lastSel: null,
};
let installPrompt = null;
let toastTimer = null;
// The live preview on claude.ai runs with example data and no downloads.
const DEMO = globalThis.FH_DEMO === true;
// Only undo a theme we set ourselves; the host page may set its own.
let ownTheme = false;

const app = document.getElementById('app');
const sheetRoot = document.getElementById('sheet-root');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c, opts) => formatMoney(c, state.settings.currency, opts);
const pct = (r) => (r == null ? '–' : `${Math.round(r * 100)}%`);
const catOf = (id) => M.category(state, id) || { name: 'Unknown', emoji: '❔' };
const accOf = (id) => M.account(state, id) || { name: 'Unknown', emoji: '❔' };

// Each category gets one of 8 theme colors (by its position), shown as a dot
// or as the colored initial on a record.
function catColor(id) {
  const i = state.settings.categories.findIndex((c) => c.id === id);
  return i < 0 ? 'var(--muted)' : `var(--c${(i % 8) + 1})`;
}
function jarColor(j) {
  if (j.savings) return 'var(--gold)';
  const i = state.settings.jars.filter((x) => !x.savings).findIndex((x) => x.id === j.id);
  return `var(--c${((i * 3) % 8) + 1})`;
}
const dot = (color) => `<i class="dot" style="--c:${color}" aria-hidden="true"></i>`;
const initial = (name) => esc((String(name).match(/\p{L}|\p{N}/u) || ['•'])[0].toUpperCase());

// Big figure with the currency set smaller beside it.
function bigMoney(c) {
  c = Math.round(c / 100) * 100; // whole lei for headline totals
  return `<span class="fig" data-count="${c}" data-ck="total">${formatMoney(c, '')}</span><span class="cur-sm">${esc(state.settings.currency)}</span>`;
}

// Money that counts up to its value when a screen opens.
const countUp = (c, key, opts) => `<span data-count="${c}" data-ck="${key}" data-cur="1"${opts?.sign ? ' data-sign="1"' : ''}>${money(c, opts)}</span>`;

// Save. Each save is an undo step, except quiet ones: changes that didn't
// come from you (sync, the daily net-worth snapshot, Binance balances).
function persist({ quiet = false } = {}) {
  if (!save(state)) toast('Could not save. Is your browser storage full or blocked?');
  if (quiet) history.reset(state);
  else history.record(state);
}

function commit(opts) {
  persist(opts);
  render();
  Sync.changed();
}

// Ctrl+Z / Ctrl+Y and the Undo / Redo buttons.
function undoRedo(dir) {
  if (state._sealed) return;
  const e = dir < 0 ? history.undo(state) : history.redo(state);
  if (!e) { toast(dir < 0 ? 'Nothing to undo' : 'Nothing to redo'); return; }
  if (!save(state)) toast('Could not save. Is your browser storage full or blocked?');
  ui.selected?.clear();
  render();
  Sync.changed();
  toast(`${dir < 0 ? 'Undone' : 'Redone'}: ${e.label}`, dir < 0 ? 'Redo' : 'Undo', () => undoRedo(-dir));
}

const THEME_STYLES = [
  ['dark', 'Midnight', 'Golden stars in a midnight sky', '#0b0d12', '#e3b95f'],
  ['ocean', 'Ocean', 'Blue tides and drifting bubbles', '#08131f', '#82caff'],
  ['forest', 'Forest', 'Soft greens and falling leaves', '#0b1712', '#b8d88d'],
  ['paper', 'Paper', 'Warm pages and floating flecks', '#f5f0e6', '#875523'],
  ['light', 'Classic light', 'Clean whites and a soft shimmer', '#f3f4f7', '#8a6a22'],
  ['system', 'Follow system', 'Matches your device appearance', '#303b4b', '#c6d3e2'],
];
function themePicker(st) {
  return '<fieldset class="style-picker"><legend>Choose your atmosphere</legend><div class="style-grid">' + THEME_STYLES.map(([id, name, detail, bg, accent]) =>
    `<label class="style-choice"><input type="radio" name="app-theme" data-set="theme" value="${id}" ${st.theme === id ? 'checked' : ''}><span class="style-preview style-${id}" style="--preview-bg:${bg};--preview-accent:${accent}"><span class="preview-sidebar"></span><span class="preview-heading"></span><span class="preview-panel"></span><span class="preview-panel second"></span><span class="preview-motif"></span><span class="style-check" aria-hidden="true">✓</span></span><span class="style-name">${name}</span><span class="style-detail">${detail}</span></label>`
  ).join('') + '</div></fieldset>';
}
let ambientKey = '';
function applyAtmosphere() {
  const active = state.settings.themeMotion !== false && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const key = active ? state.settings.theme || 'system' : '';
  if (key === ambientKey) return;
  ambientKey = key;
  document.getElementById('theme-atmosphere')?.remove();
  if (!key) return;
  const layer = document.createElement('div');
  layer.id = 'theme-atmosphere';
  layer.className = 'theme-atmosphere atmosphere-' + key;
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 12; i++) {
    const particle = document.createElement('span');
    particle.className = 'atmosphere-particle';
    particle.style.cssText = `--x:${(i * 37 + 9) % 100}%;--delay:-${i * 2.7}s;--duration:${18 + i % 5 * 3}s;--size:${9 + i % 4 * 4}px;--drift:${i % 2 ? -70 : 70}px;`;
    layer.append(particle);
  }
  document.body.prepend(layer);
  layer.classList.toggle('paused', document.hidden);
}
document.addEventListener('visibilitychange', () => document.getElementById('theme-atmosphere')?.classList.toggle('paused', document.hidden));
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', applyAtmosphere);

function applyTheme() {
  applyAtmosphere();
  const choice = state.settings.theme;
  const design = ['ocean', 'forest', 'paper'].includes(choice) ? choice : '';
  document.documentElement.dataset.design = design;
  const t = design ? (design === 'paper' ? 'light' : 'dark') : choice;
  if (t === 'dark' || t === 'light') {
    document.documentElement.dataset.theme = t;
    ownTheme = true;
  } else if (ownTheme) {
    delete document.documentElement.dataset.theme;
    ownTheme = false;
  }
}

// ---------- Shared pieces ----------

// Log: the year and its 12 months, each with a bar for what you spent;
// one click jumps to any month.
function monthNav() {
  const now = monthKey(todayISO());
  const year = Number(ui.month.slice(0, 4));
  const firstYear = Math.min(year, Number((state.tx.reduce((m, t) => (t.date < m ? t.date : m), todayISO())).slice(0, 4)));
  const spent = {};
  const count = {};
  for (const t of state.tx) {
    if (!t.date.startsWith(String(year))) continue;
    const k = t.date.slice(0, 7);
    count[k] = (count[k] || 0) + 1;
    if (t.type === 'expense' && !t.loan) spent[k] = (spent[k] || 0) + M.B(t);
  }
  const max = Math.max(1, ...Object.values(spent));
  const pills = MONTHS.map((name, i) => {
    const k = `${year}-${String(i + 1).padStart(2, '0')}`;
    const future = k > now;
    const h = spent[k] ? 0.12 + 0.88 * (spent[k] / max) : 0;
    return `<button type="button" class="mpill${k === ui.month ? ' on' : ''}${k === now ? ' now' : ''}" data-act="goto-month" data-month="${k}" ${future ? 'disabled' : ''} style="--h:${h.toFixed(3)};--i:${i}" title="${monthLabel(k)}${spent[k] ? `: spent ${money(spent[k])}` : ''}${count[k] ? ` · ${count[k]} records` : ''}">
      <span class="mp-bar"><i></i></span><span class="mp-name">${name.slice(0, 3)}</span><span class="mp-amt">${spent[k] ? formatMoney(spent[k], '', { compact: true }) : count[k] ? '·' : ''}</span></button>`;
  }).join('');
  return `<section class="mnav" aria-label="Choose a month">
    <div class="mnav-year">
      <button class="icon-btn" data-act="year" data-step="-1" aria-label="Previous year" ${year <= firstYear - 1 ? 'disabled' : ''}>‹</button>
      <b>${year}</b>
      <button class="icon-btn" data-act="year" data-step="1" aria-label="Next year" ${year >= Number(now.slice(0, 4)) ? 'disabled' : ''}>›</button>
    </div>
    <div class="mnav-months">${pills}</div>
    <div class="mnav-side">
      <button class="icon-btn" data-act="month" data-step="-1" aria-label="Previous month" title="Previous month (←)">‹</button>
      <button class="icon-btn" data-act="month" data-step="1" aria-label="Next month" title="Next month (→)" ${ui.month >= now ? 'disabled' : ''}>›</button>
      <button class="btn today-btn" data-act="goto-month" data-month="${now}" ${ui.month === now ? 'disabled' : ''}>Today</button>
    </div>
  </section>`;
}

// ---------- Sidebar (desktop) ----------
// A live balance card with a net-worth sparkline, badges on the sections
// that need you, and the main goal plus today at the bottom.

function sparkline(values, w = 172, h = 36) {
  if (values.length < 2) return '';
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 8)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="spark-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--gold);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--gold);stop-opacity:0"/></linearGradient></defs>
    <path d="${line} L${w} ${h} L0 ${h} Z" fill="url(#spark-g)"/><path d="${line}" class="spark-line" pathLength="1"/>
    <circle cx="${pts.at(-1)[0].toFixed(1)}" cy="${pts.at(-1)[1].toFixed(1)}" r="3" class="spark-dot"/></svg>`;
}

function renderSidebar() {
  const top = document.getElementById('side-top');
  const bottom = document.getElementById('side-bottom');
  if (!top || state._sealed) return;
  const today = todayISO();
  const { total } = M.totalBalance(state);
  const series = M.netWorthSeries(state, today, 6).map((p) => p.value);
  const s = M.monthSummary(state, monthKey(today));
  const shown = Math.round(total / 100) * 100;
  const before = renderSidebar.last;
  renderSidebar.last = shown;
  top.innerHTML = `<button type="button" class="sc-body" data-go="accounts" title="Open Accounts">
    <span class="sc-label">All my money</span>
    <span class="sc-total">${formatMoney(Math.round(total / 100) * 100, '')}<small>${esc(state.settings.currency)}</small></span>
    ${sparkline(series)}
    <span class="sc-row"><span>This month</span><b class="${s.net >= 0 ? 'income' : 'expense'}">${money(Math.round(s.net / 100) * 100, { sign: true })}</b></span>
  </button>`;
  // The balance moved (a record, an undo, a sync): show by how much.
  if (before != null && before !== shown) {
    const body = top.querySelector('.sc-body');
    Motion.floatDelta(body, money(shown - before, { sign: true, compact: true }), shown > before ? 'up' : 'down');
    body?.classList.add('bump');
  }
  const badge = (tab, text, kind = '') => {
    const el = document.querySelector(`.tabbar [data-badge="${tab}"]`);
    if (!el) return;
    el.textContent = text || '';
    el.className = `nb${text ? ` on ${kind}` : ''}`;
  };
  const due = dueItems(state, today).length;
  const overdue = (state.invoices || []).filter((i) => invoiceStatus(i, today) === 'overdue').length;
  const open = (state.invoices || []).filter((i) => invoiceStatus(i, today) === 'sent').length;
  const todayCount = state.tx.filter((t) => t.date === today).length;
  const g = M.mainGoal(state);
  const gs = M.goalStatus(state, today, g);
  badge('plan', due ? String(due) : '', 'alert');
  badge('clients', overdue ? String(overdue) : open ? String(open) : '', overdue ? 'alert' : '');
  badge('log', todayCount ? `${todayCount} today` : '', 'soft');
  badge('goals', gs.target && gs.ratio > 0 ? `${Math.round(gs.ratio * 100)}%` : '', 'gold');
  const r = 15;
  const c = 2 * Math.PI * r;
  bottom.innerHTML = `${gs.target ? `<button type="button" class="sf-goal" data-go="goals" title="${esc(g.name)}">
      <svg viewBox="0 0 38 38" width="38" height="38" aria-hidden="true"><circle cx="19" cy="19" r="${r}" class="sf-track"/><circle cx="19" cy="19" r="${r}" class="sf-prog" style="stroke-dasharray:${c.toFixed(1)};stroke-dashoffset:${(c * (1 - gs.ratio)).toFixed(1)}" transform="rotate(-90 19 19)"/></svg>
      <span><b>${esc(g.emoji || '🎯')} ${esc(g.name)}</b><small>${Math.round(gs.ratio * 100)}% · ${money(Math.round(gs.remaining / 100) * 100, { compact: true })} to go</small></span>
    </button>` : ''}
    <div class="sf-row"><span class="sf-today dow-${dowIndex(today)}"><i aria-hidden="true"></i>${DOW_LONG[dowIndex(today)].slice(0, 3)}, ${Number(today.slice(8, 10))} ${MONTHS[Number(today.slice(5, 7)) - 1].slice(0, 3)}</span>
    <button type="button" class="sf-buddy" data-act="bd-toggle" aria-pressed="${Buddy.isOn()}" title="${Buddy.isOn() ? 'Hide' : 'Show'} ${esc(Buddy.buddyName())}">🤖 <span>${esc(Buddy.buddyName())}</span><b>${Buddy.isOn() ? 'On' : 'Off'}</b></button></div>`;
}

// "Today · Saturday, 10 October" in today's weekday color.
function todayChip() {
  const t = todayISO();
  return `<span class="today-chip dow-${dowIndex(t)}"><i aria-hidden="true"></i>Today · ${DOW_LONG[dowIndex(t)]}, ${Number(t.slice(8, 10))} ${MONTHS[Number(t.slice(5, 7)) - 1]}</span>`;
}

function goToMonth(k) {
  const now = monthKey(todayISO());
  // Future months only when added as a sheet tab (+).
  const next = k > now && !(state.meta.sheetMonths || []).includes(k) ? now : k;
  if (next === ui.month) return;
  ui.monthDir = next > ui.month ? 1 : -1;
  ui.month = next;
  render();
}


function txRow(t, { showDate = false } = {}) {
  let av;
  let title;
  let sub;
  let amount;
  const cur = t.currency || state.settings.currency;
  const fm = (c, o) => formatMoney(c, cur, o);
  if (t.type === 'transfer') {
    av = '<span class="av av-move" aria-hidden="true">⇄</span>';
    title = t.note || `To ${accOf(t.to).name}`;
    sub = `${accOf(t.from).name} → ${accOf(t.to).name}`;
    amount = `<span class="amount">${fm(t.amount)}${Number.isInteger(t.toAmount) ? ` <span class="muted">→ ${formatMoney(t.toAmount, accOf(t.to).currency || cur)}</span>` : ''}</span>`;
  } else {
    const c = catOf(t.category);
    const who = t.person ? M.person(state, t.person)?.name : null;
    av = `<span class="av" style="--c:${catColor(t.category)}" aria-hidden="true">${initial(c.name)}</span>`;
    title = t.note || c.name;
    sub = [c.name, who ? `${t.type === 'income' ? 'from' : 'to'} ${who}` : null, accOf(t.account).name].filter(Boolean).join(' · ');
    const ty = M.typedAs(t);
    amount = `<span class="amount ${t.type === 'income' ? 'income' : ''}">${t.loan ? '<span class="pill">loan</span> ' : ''}${t.type === 'income' ? fm(t.amount, { sign: true }) : fm(-t.amount)}${ty ? `<small class="typed-as">${formatMoney(ty.amount, ty.currency)}</small>` : ''}</span>`;
  }
  if (showDate) sub = `${dayLabel(t.date)} · ${sub}`;
  return `<button class="tx" data-act="edit" data-id="${esc(t.id)}">
    ${av}
    <span class="t"><b>${esc(title)}</b><span>${esc(sub)}</span></span>
    ${amount}
  </button>`;
}

const TIP_LABEL = { bad: 'Over', warn: 'Watch', good: 'Good', info: 'Note' };

function tipCard(t) {
  return `<div class="tip ${t.level}"><span class="tag">${TIP_LABEL[t.level]}</span>
    <div><b>${esc(t.title)}</b><p>${esc(t.text)}</p></div></div>`;
}

function rateBar(summary) {
  const target = M.savingsJar(state)?.pct ?? 0;
  if (summary.income <= 0) return '';
  const r = Math.max(0, Math.min(1, summary.savingsRate));
  const good = summary.savingsRate * 100 >= target;
  return `<div class="rate">
    <div class="row">${summary.net < 0
    ? `<span>Spent <b class="expense">${money(-summary.net)}</b> more than you earned</span>`
    : `<span>Kept <b class="${good ? 'income' : 'expense'}">${pct(summary.savingsRate)}</b> of income</span>`}<span class="muted">target ${target}%</span></div>
    <div class="bar ${good ? '' : 'over'}"><i style="width:${(r * 100).toFixed(1)}%"></i><span class="mark" style="left:${target}%"></span></div>
  </div>`;
}

function stats(s, key = 'm') {
  return `<div class="stats">
    <div class="stat"><span class="k">Earned</span><b class="income">${countUp(s.income, `${key}-in`)}</b></div>
    <div class="stat"><span class="k">Spent</span><b class="expense">${countUp(s.expense, `${key}-out`)}</b>${s.expense ? (() => { const w = workText(state, s.expense, todayISO()); return w ? `<span class="work-time" title="What it cost in your work time (Settings → Your hour)">≈ ${w} of work</span>` : ''; })() : ''}</div>
    <div class="stat"><span class="k">Kept</span><b>${countUp(s.net, `${key}-net`)}</b></div>
  </div>`;
}

function jarsCard(key) {
  const rows = M.jarStatus(state, key);
  const income = M.monthSummary(state, key).income;
  const body = rows.map((j) => {
    if (j.savings) {
      const r = j.budget ? Math.min(1, j.used / j.budget) : 0;
      return `<div class="jar">
        <div class="row"><span>${dot(jarColor(j.jar))}${esc(j.jar.name)} <span class="muted">${j.jar.pct}%</span></span><span class="money">${money(j.used)}</span></div>
        <div class="bar"><i style="width:${(r * 100).toFixed(1)}%"></i></div>
        <div class="foot">${!j.budget ? 'Waiting for this month\'s income' : j.left >= 0 ? `Plan ${money(j.budget)} reached ✓` : `Plan ${money(j.budget)}, ${money(-j.left)} to go`}</div>
      </div>`;
    }
    const over = j.used > j.budget;
    const r = j.budget ? Math.min(1, j.used / j.budget) : j.used ? 1 : 0;
    return `<div class="jar">
      <div class="row"><span>${dot(jarColor(j.jar))}${esc(j.jar.name)} <span class="muted">${j.jar.pct}%</span></span><span class="money">${money(j.used)} <span class="muted">/ ${money(j.budget, { compact: true })}</span></span></div>
      <div class="bar ${over ? 'over' : 'gold'}"><i style="width:${(r * 100).toFixed(1)}%"></i></div>
      <div class="foot ${over ? 'bad' : ''}">${over ? `Over by ${money(j.used - j.budget)}` : `${money(j.left)} left`}</div>
    </div>`;
  }).join('');
  return `<section class="card"><h2>Smart split</h2>
    ${income ? '' : '<p class="muted small" style="margin-top:0">Log your income this month and each jar gets its share.</p>'}
    ${body}</section>`;
}


// Home's month strip (look B): earned, spent, kept, and the savings rate.
function homeStrip(s, key) {
  const target = M.savingsJar(state)?.pct ?? 0;
  const w = s.expense ? workText(state, s.expense, todayISO()) : '';
  const r = Math.max(0, Math.min(1, s.savingsRate || 0));
  const diff = Math.round((s.savingsRate || 0) * 100) - target;
  const rate = s.income > 0 ? `<div class="ms-cell ms-rate"><span class="k"><span>Savings rate</span><span>goal ${target}%</span></span>
      <div class="bar ${diff < 0 ? 'over' : ''}"><i style="width:${(r * 100).toFixed(1)}%"></i><span class="mark" style="left:${target}%"></span></div>
      <p class="${diff < 0 ? 'bad' : ''}">${s.net < 0 ? `${money(-s.net)} more spent than earned` : diff >= 0 ? `${diff} points above your goal` : `${-diff} points below your goal`}</p></div>` : '';
  return `<section class="m-strip" aria-label="${esc(monthLabel(key))}">
    <div class="ms-cell"><span class="k">Earned</span><b class="${s.income ? 'income' : ''}">${countUp(s.income, 'm-in')}</b></div>
    <div class="ms-cell"><span class="k">Spent</span><b class="${s.expense ? 'expense' : ''}">${countUp(s.expense, 'm-out')}</b>${w ? `<span class="work-time" title="What it cost in your work time (Settings → Your hour)">≈ ${w} of your work</span>` : ''}</div>
    <div class="ms-cell"><span class="k">Monthly balance</span><b>${countUp(s.net, 'm-net')}</b></div>
    ${rate}
  </section>`;
}

// Compare identical elapsed days in the current and previous months.
function monthComparison(today) {
  const current = monthKey(today), previous = addMonths(current, -1);
  const day = Number(today.slice(8));
  const totals = (key) => M.monthSummary({ ...state, tx: state.tx.filter((t) => Number(t.date.slice(8)) <= day) }, key);
  const now = totals(current), before = totals(previous);
  const comparison = (label, amount, was) => '<span>' + label + ': <b>' + (was ? (amount >= was ? '+' : '−') + Math.round(Math.abs(amount - was) / Math.abs(was) * 100) + '%' : 'No prior activity') + '</b></span>';
  return '<div class="month-comparison"><span>Days 1–' + day + ' vs ' + esc(monthLabel(previous)) + ', through day ' + Math.min(day, daysInMonth(previous)) + '</span>' + comparison('Income', now.income, before.income) + comparison('Spending', now.expense, before.expense) + '</div>';
}

// The page title on Home says how the month is going.
function homeHeadline(s, hello) {
  if (s.income > 0 && s.net >= 0) return `You kept ${pct(s.savingsRate)} this month`;
  if (s.income > 0) return 'You spent more than you earned';
  if (s.expense > 0) return `${money(s.expense)} spent this month`;
  return hello;
}

// ---------- Screens ----------

// Dedicated Safe-to-Spend card on Home with 7-day velocity sparkline.
function safeCard(today) {
  if (!state.tx.length) return '';
  const sf = safeToSpend(state, today);
  const left = sf.leftToday;
  const isOver = left < 0;
  const onTrack = left >= sf.perDay / 4;
  const statusCls = sf.pool <= 0 ? 'expense' : isOver ? 'expense' : onTrack ? 'income' : 'gold';
  const statusLabel = sf.pool <= 0 ? 'Pool depleted' : isOver ? 'Over today\'s share' : onTrack ? 'On track' : 'Watch pace';

  // 7-day sparkline
  const sparkDays = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    const spent = state.tx.filter((t) => t.date === d && t.type === 'expense' && !t.loan && !t.recurring)
      .reduce((a, t) => a + M.B(t), 0);
    sparkDays.push({ d, dayLabel: Number(d.slice(8)), spent });
  }
  const maxSpent = Math.max(sf.perDay, ...sparkDays.map((x) => x.spent), 1);
  const w = 180, h = 38, pad = 6;
  const barW = 16, gap = 8;
  const bars = sparkDays.map((x, i) => {
    const bh = Math.max(3, Math.round((x.spent / maxSpent) * (h - pad * 2)));
    const bx = i * (barW + gap) + 4;
    const by = h - pad - bh;
    const isToday = x.d === today;
    const col = x.spent > sf.perDay ? 'var(--expense)' : isToday ? 'var(--gold)' : 'var(--muted)';
    return `<rect x="${bx}" y="${by}" width="${barW}" height="${bh}" rx="3" fill="${col}" opacity="${isToday ? 1 : 0.75}"><title>${x.d}: ${money(x.spent)}</title></rect><text x="${bx + barW / 2}" y="${h - 1}" font-size="8" fill="var(--muted)" text-anchor="middle">${x.dayLabel}</text>`;
  }).join('');
  const targetY = Math.round(h - pad - (sf.perDay / maxSpent) * (h - pad * 2));
  const targetLine = sf.perDay > 0 && targetY >= pad && targetY <= h - pad
    ? `<line x1="2" y1="${targetY}" x2="${w - 2}" y2="${targetY}" stroke="var(--line)" stroke-dasharray="2 2" stroke-width="1"/>` : '';

  const sparkSvg = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="overflow:visible; display:block;" aria-label="7-day spending sparkline">${targetLine}${bars}</svg>`;

  return `<section class="card safe-home-card" style="margin-bottom:14px; padding:18px 22px; display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:16px;">
    <div style="min-width:220px;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
        <span class="label" style="margin:0;">Safe to spend today</span>
        <span class="badge ${statusCls}" style="font-size:11px; padding:2px 8px; border-radius:12px; background:var(--surface-2); font-weight:600;">${statusLabel}</span>
      </div>
      <div style="display:flex; align-items:baseline; gap:10px;">
        <b class="${statusCls}" style="font-family:var(--display); font-size:32px; line-height:1.1;">${money(Math.max(0, left))}</b>
        <span class="muted small">of ${money(sf.perDay)}/day</span>
      </div>
      <p class="muted small" style="margin:6px 0 0;">
        ${isOver ? `Over by ${money(-left)}. Tomorrow: ${money(sf.tomorrow)}/day` : `Pool: ${money(Math.max(0, sf.pool))} until ${shortDay(sf.payday)} (${sf.days}d)`}
      </p>
    </div>
    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
      <span class="muted small">Last 7 days vs target</span>
      ${sparkSvg}
    </div>
  </section>`;
}

// Home: one tap opens a record already filled in; Enter adds it.
function quickRow() {
  const picks = M.quickPicks(state, todayISO(), 8);
  if (!picks.length) return '';
  return `<div class="picks home-picks" role="group" aria-label="Quick add"><span class="label">Quick add</span>${picks.map((p, i) => `<button type="button" class="pick" data-act="quick-pick" data-i="${i}">${p.fav ? '<span class="gold">★</span> ' : ''}${esc(p.note || catOf(p.category).name)} <b class="${p.type === 'income' ? 'income' : ''}">${formatMoney(p.amount, p.currency, { compact: true })}</b></button>`).join('')}</div>`;
}

function viewHome() {
  const today = todayISO();
  const key = monthKey(today);
  const s = M.monthSummary(state, key);
  const recent = M.sortTx(state.tx).slice(0, 5);
  const fc = forecast(state, today, { days: 45 });
  const fcTip = fc.low.value < 0 && (state.recurring.length || state.tx.length > 20)
    ? [{ level: 'bad', title: `Money may run short around ${dayLabel(fc.low.date)}`, text: `With your bills and usual spending, cards and cash would be at ${money(Math.round(fc.low.value / 100) * 100)}. See the forecast on Plan.` }] : [];
  const usd = rateAdvice(state, 'USD', today);
  const usdHeld = usd?.verdict === 'high' ? heldIn(state, 'USD', M.accountBalances(state)) : 0;
  const fxTip = usdHeld > 0 ? [{ level: 'good', title: 'Good day to convert USD', text: `1 USD = ${usd.rate.toFixed(2)} ${state.settings.currency}, ${usd.pct === 1 ? 'the highest in 90 days' : `higher than on ${Math.round(usd.pct * 100)}% of the last 90 days`}. You hold ${formatMoney(usdHeld, 'USD')}. See Rates.` }] : [];
  const tips = [...fcTip, ...fxTip, ...M.insights(state, key, today).filter((t) => t.level !== 'info')].slice(0, 2);
  const hour = new Date().getHours();
  const hello = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const headline = homeHeadline(s, hello);

  // Automatic backups and sync count too: no nagging when they already run.
  const lastSafe = Math.max(state.meta.lastBackup || 0, state.meta.lastAutoBackup || 0, state.meta.lastSync || 0);
  const needsBackup = state.tx.length >= 20 && Date.now() - lastSafe > 14 * 864e5;

  const welcome = state.tx.length ? '' : `<section class="card">
    <h2>Start here</h2>
    <p style="margin-top:0">Every lei you log is a lei you control. Tap <b>+</b> for each thing you buy or earn. It takes 5 seconds.</p>
    <div class="btns">
      <button class="btn primary" data-act="add">Log the first one</button>
      <button class="btn" data-act="import-csv">Import my Google Sheet</button>
    </div>
    <p class="muted small" style="margin-bottom:0">Already have money in the wallet or safe? Set it under Settings → Accounts.</p>
  </section>`;

  return `<header class="top"><div><div class="eyebrow">${esc(monthLabel(key))}</div><h1>Your goals, your progress</h1></div><div class="sub">${headline === hello ? '' : `${hello} · `}${dayLabel(today)}</div></header>
  ${Updates.updateBanner()}
  ${DEMO ? '<div class="banner"><p>Live preview with <b>example data</b> (a made-up month). What you add here stays in this browser only.</p></div>' : ''}
  ${Telegram.alertBanner()}
  ${!DEMO && needsBackup ? `<div class="banner"><p>Your data lives only on this device. Make a backup.</p><button class="btn primary" data-act="export-json">Back up</button></div>` : ''}
  ${welcome}
  ${Goals.homeCard({ featured: true })}
  ${safeCard(today)}
  ${homeStrip(s, key)}
  ${monthComparison(today)}
  ${quickRow()}
  <div class="dash">
    <div class="dash-main">
      ${Spending.spendingCard({ period: ui.spendPeriod })}
      ${recent.length ? `<section class="card"><h2>Recent <button class="card-link right" data-go="log">Open log</button></h2><div class="list">${recent.map((t) => txRow(t, { showDate: true })).join('')}</div></section>` : ''}
    </div>
    <div class="dash-side">
      ${Goals.otherGoalsCard()}
      ${Plan.homeCard()}
      ${tips.length ? `<section class="card"><h2>Heads up <button class="card-link right" data-go="reports">Reports</button></h2>${tips.map(tipCard).join('')}</section>` : ''}
      ${jarsCard(key)}
    </div>
  </div>`;
}

function logView() {
  // Once: wide screens switch to the new Sheet view (like the Google Sheet).
  if (!state._sealed && !state.meta.sheetIntro) {
    state.meta.sheetIntro = 1;
    if (window.innerWidth >= 720) state.settings.logView = 'sheet';
    persist({ quiet: true });
  }
  return state.settings.logView || (window.innerWidth >= 720 ? 'sheet' : 'list');
}

function logRecords() {
  const q = ui.search.trim();
  let list = q ? searchTx(state, q, todayISO()) : M.txInMonth(state, ui.month);
  if (ui.filter !== 'all') list = list.filter((t) => t.type === ui.filter);
  return list;
}

// Search results: how many, the totals, and when it first and last happened.
function searchCard(list) {
  const r = searchSummary(list, M.B);
  if (!r.count) return '';
  const d = (iso) => `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1].slice(0, 3)} ${iso.slice(0, 4)}`;
  const kpi = (label, value, cls = '') => `<div class="kpi"><span class="muted small">${label}</span><b class="${cls}">${value}</b></div>`;
  return `<section class="card search-card"><div class="rep-kpis">
    ${kpi('Found', `${r.count} record${r.count === 1 ? '' : 's'}<span class="muted small"> · ${r.months} month${r.months === 1 ? '' : 's'}</span>`)}
    ${r.spent ? kpi('Spent', money(r.spent), 'expense') : ''}
    ${r.earned ? kpi('Earned', money(r.earned), 'income') : ''}
    ${r.spent && r.months > 1 ? kpi('Per month', money(Math.round(r.spent / r.months))) : ''}
    ${kpi('Last time', d(r.last))}
    ${r.count > 1 ? kpi('First time', d(r.first)) : ''}
  </div></section>`;
}

function undoButtons() {
  const u = history.nextUndo();
  const r = history.nextRedo();
  return `<span class="undo-pair" role="group" aria-label="Undo and redo">
    <button type="button" class="icon-btn" data-act="undo" ${u ? '' : 'disabled'} title="${u ? `Undo: ${esc(u)} (Ctrl+Z)` : 'Nothing to undo'}" aria-label="Undo">↶</button>
    <button type="button" class="icon-btn" data-act="redo" ${r ? '' : 'disabled'} title="${r ? `Redo: ${esc(r)} (Ctrl+Y)` : 'Nothing to redo'}" aria-label="Redo">↷</button></span>`;
}

// ---------- Bulk changes (Table) ----------

function selectedTx() {
  return state.tx.filter((t) => ui.selected.has(t.id));
}

function bulkBar() {
  const list = selectedTx();
  if (!list.length) return '';
  const out = list.filter((t) => t.type === 'expense').reduce((a, t) => a + M.B(t), 0);
  const inc = list.filter((t) => t.type === 'income').reduce((a, t) => a + M.B(t), 0);
  const cats = (type, label) => `<optgroup label="${label}">${state.settings.categories.filter((c) => c.type === type).map((c) => `<option value="${esc(c.id)}">${esc(`${c.emoji || ''} ${c.name}`.trim())}</option>`).join('')}</optgroup>`;
  return `<div class="bulk-bar" role="toolbar" aria-label="Change selected records">
    <b>${list.length} selected</b>
    <span class="muted small">${[out ? `−${money(out)}` : '', inc ? `+${money(inc)}` : ''].filter(Boolean).join(' · ')}</span>
    <select data-bulk="category" aria-label="Set category"><option value="">Category…</option>${cats('expense', 'Spent')}${cats('income', 'Earned')}</select>
    <select data-bulk="account" aria-label="Set account"><option value="">Account…</option>${state.settings.accounts.filter((a) => !a.archived).map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select>
    <label class="bulk-date"><span>Date</span><input type="date" data-bulk="date" aria-label="Set date"></label>
    <button type="button" class="btn danger" data-act="bulk-del">Delete</button>
    <button type="button" class="btn" data-act="bulk-clear">Clear</button>
  </div>`;
}

// Ticking rows updates only the ticks and the bar, not the whole table.
function refreshSelection() {
  const slot = document.getElementById('bulk-slot');
  if (slot) slot.innerHTML = bulkBar();
  for (const tr of document.querySelectorAll('#tx-table tr[data-id]')) {
    const on = ui.selected.has(tr.dataset.id);
    tr.classList.toggle('selected', on);
    const box = tr.querySelector('.sel');
    if (box) box.checked = on;
  }
  const all = document.querySelector('#tx-table [data-act="sel-all"]');
  const rows = [...document.querySelectorAll('#tx-table tr[data-id]')];
  if (all) all.checked = rows.length > 0 && rows.every((r) => ui.selected.has(r.dataset.id));
}

function onSelect(el, shift) {
  const id = el.dataset.id;
  const rows = [...document.querySelectorAll('#tx-table tr[data-id]')].map((r) => r.dataset.id);
  if (shift && ui.lastSel && rows.includes(ui.lastSel)) {
    const [a, b] = [rows.indexOf(ui.lastSel), rows.indexOf(id)].sort((x, y) => x - y);
    for (const x of rows.slice(a, b + 1)) ui.selected.add(x);
  } else if (el.checked) ui.selected.add(id);
  else ui.selected.delete(id);
  ui.lastSel = id;
  refreshSelection();
}

function onSelectAll(el) {
  const rows = [...document.querySelectorAll('#tx-table tr[data-id]')].map((r) => r.dataset.id);
  for (const id of rows) if (el.checked) ui.selected.add(id); else ui.selected.delete(id);
  refreshSelection();
}

// Moving a record to another account: in that account's currency, at
// today's rate (or the last one used).
function setTxAccount(t, id) {
  t.account = id;
  const cur = M.account(state, id)?.currency || state.settings.currency;
  if (cur !== t.currency) {
    t.currency = cur;
    t.rate = suggestedRate(cur) || t.rate || 1;
    t.base = Math.round(t.amount * t.rate);
  }
}

function onBulkChange(el) {
  const v = el.value;
  if (!v) return;
  const list = selectedTx();
  let changed = 0;
  let skipped = 0;
  for (const t of list) {
    if (el.dataset.bulk === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      t.date = v;
    } else if (t.type === 'transfer') { skipped++; continue; }
    else if (el.dataset.bulk === 'category') {
      if (M.category(state, v)?.type !== t.type) { skipped++; continue; }
      t.category = v;
    } else if (el.dataset.bulk === 'account') setTxAccount(t, v);
    M.touch(t);
    changed++;
  }
  if (!changed) { toast(skipped ? 'None of the selected records can take that (moves, or a different type)' : 'Nothing changed'); el.value = ''; return; }
  commit();
  const what = { category: 'category', account: 'account', date: 'date' }[el.dataset.bulk];
  toast(`Changed the ${what} of ${changed} record${changed === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped)` : ''}`, 'Undo', () => undoRedo(-1));
}

function bulkDelete() {
  const list = selectedTx();
  if (!list.length) return;
  for (const t of list) M.removeTx(state, t.id);
  ui.selected.clear();
  commit();
  toast(`Deleted ${list.length} record${list.length === 1 ? '' : 's'}`, 'Undo', () => undoRedo(-1));
}

// ---------- Sheet view (Log) ----------

// The account a new record goes to: the one you used last for that kind.
function defaultAccount(type) {
  const last = M.sortTx(state.tx).find((t) => t.type === type && M.account(state, t.account) && !M.account(state, t.account).archived);
  return last?.account || state.settings.accounts.find((a) => !a.archived && !a.savings)?.id || state.settings.accounts[0]?.id;
}

function renderSheetKeepFocus() {
  setTimeout(() => {
    const key = document.activeElement?.dataset?.sh;
    render();
    const el = key && document.querySelector(`#sheet-grid [data-sh="${CSS.escape(key)}"]`);
    if (el) { el.focus(); if (el.select && el.type === 'text') el.select(); }
  }, 0);
}

function onSheetChange(el) {
  const [date, side, k, field] = el.dataset.sh.split('|');
  const type = side === 'in' ? 'income' : 'expense';
  const v = el.value.trim();
  const t = el.dataset.id ? state.tx.find((x) => x.id === el.dataset.id) : null;
  if (t) {
    if (field === 'amount') {
      if (!v) {
        M.removeTx(state, t.id);
        persist();
        Sync.changed();
        toast(`Deleted ${formatMoney(t.amount, t.currency)}`, 'Undo', () => undoRedo(-1));
        renderSheetKeepFocus();
        return;
      }
      const c = evalAmount(v);
      if (!c || c <= 0) { toast('Type a number, e.g. 120 or 120+45'); el.value = formatMoney(t.amount, ''); return; }
      t.amount = c;
      t.base = Math.round(c * (t.rate || 1));
    } else if (field === 'note') {
      t.note = v;
      if (t.category === 'other' || t.category === 'other-in') t.category = M.suggestCategory(state, v, t.type) || t.category;
    } else if (field === 'category') t.category = v;
    M.touch(t);
    persist();
    Sync.changed();
    renderSheetKeepFocus();
    return;
  }
  // An empty cell: an amount makes a new record for that day.
  if (field !== 'amount' || !v) return;
  const amount = evalAmount(v);
  if (!amount || amount <= 0) { toast('Type a number, e.g. 120 or 120+45'); return; }
  const note = (document.querySelector(`#sheet-grid [data-sh="${CSS.escape(`${date}|${side}|${k}|note`)}"]`)?.value || '').trim();
  const account = defaultAccount(type);
  const cur = M.account(state, account)?.currency || state.settings.currency;
  const rate = suggestedRate(cur);
  if (!rate) { toast(`No ${cur} rate yet. Update rates first.`); return; }
  const now = Date.now();
  const tx = { id: M.uid(), createdAt: now, updatedAt: now, type, amount, currency: cur, rate, base: Math.round(amount * rate), date, account, note,
    category: M.suggestCategory(state, note, type) || (type === 'income' ? 'other-in' : 'other') };
  state.tx.push(tx);
  ui.sheetExtra.delete(date);
  ui.flashId = tx.id;
  persist();
  Sync.changed();
  const alert = type === 'expense' ? M.budgetAlert(state, tx) : null;
  toast(alert ? alert.text : `${type === 'income' ? 'Earned' : 'Spent'} ${formatMoney(amount, cur)} · ${catOf(tx.category).name}`);
  renderSheetKeepFocus();
}

// Excel-style: Enter goes to the same column one row down.
function onSheetEnter(el) {
  const [, side, , field] = el.dataset.sh.split('|');
  const cells = [...document.querySelectorAll('#sheet-grid input[data-sh]')].filter((x) => {
    const p = x.dataset.sh.split('|');
    return p[1] === side && p[3] === field;
  });
  const key = cells[cells.indexOf(el) + 1]?.dataset.sh;
  el.blur();
  setTimeout(() => {
    const n = key && document.querySelector(`#sheet-grid [data-sh="${CSS.escape(key)}"]`);
    n?.focus();
    n?.select?.();
  }, 20);
}

function draftRow() {
  const inMonth = monthKey(todayISO()) === ui.month ? todayISO() : `${ui.month}-01`;
  if (!ui.draft || !ui.draft.date.startsWith(ui.month)) {
    ui.draft = { type: 'expense', date: inMonth, category: '', note: '', account: ui.draft?.account || state.settings.accounts[0]?.id, from: state.settings.accounts[0]?.id, to: state.settings.savingsAccount };
  }
  return ui.draft;
}

function viewLog() {
  const s = M.monthSummary(state, ui.month);
  const q = ui.search.trim().toLowerCase();
  const view = logView();
  const list = logRecords();

  let content;
  if (view === 'sheet' && !q) {
    content = sheetHTML(state, ui.month, { today: todayISO(), extra: ui.sheetExtra, fmt: (c) => formatMoney(c, ''), tabs: monthTabs(state, ui.month, todayISO(), state.meta.sheetMonths || []) });
  } else if (view === 'calendar') {
    content = `<section class="card">${calendarHTML(state, ui.month)}</section>`;
  } else if (view === 'table' || view === 'sheet') {
    const shown = new Set(list.map((t) => t.id));
    for (const id of ui.selected) if (!shown.has(id)) ui.selected.delete(id);
    content = `<div id="bulk-slot">${bulkBar()}</div>`
      + tableHTML(state, list, { sort: ui.sort, draft: q ? null : draftRow(), fmt: (c) => money(c), selected: ui.selected, years: !!q })
      + `<datalist id="people-list">${state.people.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>`;
  } else {
    const groups = new Map();
    for (const t of M.sortTx(list)) {
      if (!groups.has(t.date)) groups.set(t.date, []);
      groups.get(t.date).push(t);
    }
    content = [...groups.entries()].map(([date, items]) => {
      const net = items.reduce((a, t) => a + (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0), 0);
      return `<div class="day dow-${dowIndex(date)}${date === todayISO() ? ' is-today' : ''}"><div class="day-head"><span class="dh">${dayLabelHTML(date, todayISO())}${q ? ` ${date.slice(0, 4)}` : ''}</span><span class="money ${net > 0 ? 'income' : ''}">${net ? money(net, { sign: true }) : ''}</span></div>
        <div class="list">${items.map((t) => txRow(t)).join('')}</div></div>`;
    }).join('') || `<div class="empty"><b>${q ? 'Nothing found' : 'No records this month'}</b>${q ? `Try: ${esc(SEARCH_HINT)}` : 'Tap + to add one.'}</div>`;
  }

  const chip = (id, label) => `<button class="chip" data-act="filter" data-filter="${id}" aria-pressed="${ui.filter === id}">${label}</button>`;
  const viewBtn = (id, label) => `<button type="button" data-act="log-view" data-view="${id}" aria-pressed="${view === id}">${label}</button>`;
  const dir = ui.monthDir;
  ui.monthDir = 0;
  return `<header class="top"><div><h1>Log</h1><div class="sub">${q ? 'Searching all months' : monthLabel(ui.month)}</div></div>${todayChip()}</header>
  ${q || view === 'sheet' ? '' : monthNav()}
  <div class="log-body${dir ? ` slide-${dir > 0 ? 'l' : 'r'}` : ''}">
  ${q || view === 'sheet' ? '' : `<section class="card">${stats(s)}${rateBar(s)}</section>`}
  <div class="log-tools">
    <div class="seg seg-views" role="group" aria-label="View">${viewBtn('sheet', 'Sheet')}${viewBtn('table', 'Table')}${viewBtn('calendar', 'Calendar')}${viewBtn('list', 'List')}</div>
    ${view === 'calendar' ? '' : `<input type="search" id="search" placeholder="Search all months: coffee, maib, >1000, march…" value="${esc(ui.search)}" aria-label="Search all records">`}
    <div class="log-actions">
      ${undoButtons()}
      ${Telegram.isLinked() ? '<button type="button" class="btn" data-act="tg-load" title="Get what you sent to your Telegram bot">📥 From Telegram</button>' : ''}
      <button type="button" class="btn" data-act="copy-table" title="Copy this month as a table to paste into Excel or Google Sheets">Copy table</button>
      <button type="button" class="btn" data-act="export-month" title="Download this month as a file Excel opens">Export month</button>
    </div>
  </div>
  ${view === 'calendar' || (view === 'sheet' && !q) ? '' : `<div class="chips">${chip('all', 'All')}${chip('expense', 'Spent')}${chip('income', 'Earned')}${chip('transfer', 'Moves')}</div>`}
  ${q && view !== 'calendar' ? searchCard(list) : view === 'calendar' ? '' : `<p class="search-hint muted small">Search all months: <span>${esc(SEARCH_HINT)}</span></p>`}
  ${content}
  ${view === 'sheet' && !q ? '<p class="muted small">Type an amount and it saves. Clear it to delete. <b>+</b> at the bottom adds the next month.</p>' : ''}
  ${view === 'table' ? '<p class="muted small">Edit any cell; it saves by itself. <b>Enter</b> moves down a row. <b>←</b> / <b>→</b> switch months. Tick rows (Shift+click for a range) to change many at once. <b>Ctrl+Z</b> undoes anything. Paste rows copied from Excel or Google Sheets anywhere on this page to import them.</p>' : ''}
  </div>`;
}

function viewSettings() {
  const st = state.settings;
  const accOptions = (sel, withAll) => (withAll ? `<option value="all" ${sel === 'all' ? 'selected' : ''}>All my money</option>` : '')
    + st.accounts.map((a) => `<option value="${esc(a.id)}" ${sel === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const jarOptions = (sel) => st.jars.filter((j) => !j.savings).map((j) => `<option value="${esc(j.id)}" ${sel === j.id ? 'selected' : ''}>${esc(j.name)}</option>`).join('')
    + `<option value="${M.NO_JAR}" ${sel === M.NO_JAR ? 'selected' : ''}>Business, outside the jars</option>`;
  const used = new Set(state.tx.map((t) => t.category));
  const catRow = (c) => `<div class="cat-row">
    ${dot(catColor(c.id))}
    <input type="text" value="${esc(c.name)}" data-cat="${esc(c.id)}" data-field="name" aria-label="Name">
    ${c.type === 'expense'
    ? `<select data-cat="${esc(c.id)}" data-field="jar" aria-label="Jar">${jarOptions(c.jar)}</select>`
    : used.has(c.id) ? '<span></span>' : `<button class="btn danger" data-act="del-cat" data-id="${esc(c.id)}">Remove</button>`}
  </div>`;
  const lastBackup = state.meta.lastBackup ? new Date(state.meta.lastBackup).toLocaleDateString() : 'never';
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;

  const cards = {
    goals: `<section class="card"><h2>Goals</h2>
    <p class="muted small" style="margin-top:0">Your goals (emergency fund, car, trip…) have their own screen, with progress that fills by itself.</p>
    <button class="btn block" data-go="goals">Open Goals</button>
  </section>`,
    split: `<section class="card"><h2>Smart split <span class="right" id="jar-sum"></span></h2>
    <p class="muted small" style="margin-top:0">Every income is split like this. Spending is checked against each jar.</p>
    ${st.jars.map((j) => `<div class="set-row">
      <input type="text" value="${esc(j.name)}" data-jar="${esc(j.id)}" data-field="label" aria-label="Jar name">
      <label style="display:flex;align-items:center;gap:6px"><input type="number" class="pct" min="0" max="100" step="1" value="${j.pct}" data-jar="${esc(j.id)}" data-field="pct" aria-label="Percent for ${esc(j.name)}">%</label>
    </div>`).join('')}
  </section>`,
    accounts: `<section class="card"><h2>Accounts</h2>
    <p class="muted small" style="margin-top:0">Cards, cash, banks, currencies and crypto are managed on the Accounts screen.</p>
    <button class="btn block" data-go="accounts">Open Accounts</button>
    <label class="field" style="margin:12px 0 0"><span>The "move to savings" button sends money to</span><select data-set="savingsAccount">${accOptions(st.savingsAccount, false)}</select></label>
  </section>`,
    categories: `<section class="card"><h2>Categories</h2>
    <p class="muted small" style="margin-top:0">Spending: pick which jar it comes from. Work costs (fees, taxes) can stay outside the jars.</p>
    ${st.categories.filter((c) => c.type === 'expense').map(catRow).join('')}
    <p class="muted small">Income sources</p>
    ${st.categories.filter((c) => c.type === 'income').map(catRow).join('')}
    <div class="btns" style="margin-top:10px">
      <button class="btn" data-act="add-cat" data-type="expense">+ Spending category</button>
      <button class="btn" data-act="add-cat" data-type="income">+ Income source</button>
    </div>
  </section>`,
    data: `<section class="card"><h2>Your data</h2>
    <p class="muted small" style="margin-top:0">${state.tx.length} records, saved only on this device. Last backup: ${esc(lastBackup)}.</p>
    <div class="btns">
      <button class="btn primary" data-act="export-json">Back up</button>
      <button class="btn" data-act="import-json">Restore backup</button>
    </div>
    <div class="btns" style="margin-top:8px">
      <button class="btn" data-act="import-csv">Import Excel / Google Sheet</button>
      <button class="btn" data-act="export-xlsx">Export to Excel</button>
      ${state.meta.lastImportCheck ? '<button class="btn" data-act="import-check">Last import check</button>' : ''}
    </div>
    <div class="btns" style="margin-top:8px">
      <button class="btn" data-act="import-bank">Import bank statement</button>
      <button class="btn" data-act="export-csv">Export CSV</button>
    </div>
    <p class="muted small" style="margin-bottom:0">From Google Sheets: File → Download → <b>Microsoft Excel (.xlsx)</b> and import the whole file: every month tab at once, you pick which. Bank statements: export CSV or Excel from maib / Victoriabank online banking. Importing the same thing twice is safe.</p>
  </section>`,
    look: `<section class="card look-card"><h2>Look</h2>
    ${themePicker(st)}
    <label class="motion-setting"><span><b>Living atmosphere</b><small>Leaves, bubbles and starlight. Follows your device’s reduced-motion preference.</small></span><input type="checkbox" data-set="themeMotion" ${st.themeMotion !== false ? 'checked' : ''} aria-label="Living atmosphere"></label>
    <label class="field"><span>Currency</span><input type="text" data-set="currency" value="${esc(st.currency)}" maxlength="5"></label>
  </section>`,
    danger: `<section class="card"><h2>Danger zone</h2>
    <button class="btn danger block" data-act="wipe">Erase everything on this device</button>
  </section>`,
  };
  // One section at a time, picked on the left (like any settings screen).
  const sections = [
    { id: 'general', icon: '⚙️', label: 'General', sub: 'Look, smart split, your hour', html: () => cards.look + cards.split + WorkHour.settingsCard() + cards.accounts + cards.goals },
    { id: 'categories', icon: '🏷️', label: 'Categories & rules', sub: 'Categories, jars, auto-rules', html: () => cards.categories + Rules.settingsCard() },
    { id: 'data', icon: '💾', label: 'Data & backups', sub: 'Import, export, backups, sync', html: () => cards.data + Backups.settingsCard() + Sync.settingsCard() },
    { id: 'connect', icon: '🔗', label: 'Telegram & Binance', sub: 'Your bot, crypto balances', html: () => Telegram.settingsCard() + TgBlocks.settingsCard() + Binance.settingsCard() },
    { id: 'buddy', icon: '🤖', label: 'Bit, your buddy', sub: 'Show, name, color', html: () => Buddy.settingsCard() },
    { id: 'security', icon: '🔒', label: 'Security', sub: 'PIN and encryption', html: () => Security.settingsCard() },
    { id: 'about', icon: 'ℹ️', label: 'About & updates', sub: 'Version, check, erase', html: () => Updates.settingsCard() + SelfCheck.settingsCard() + cards.danger },
  ];
  const cur = sections.find((x) => x.id === ui.settingsTab) || sections[0];

  return `<header class="top"><h1>Settings</h1></header>
  ${installPrompt ? '<div class="banner"><p>Install the app for one-tap access, even offline.</p><button class="btn primary" data-act="install">Install</button></div>' : ''}
  ${isIOS ? '<div class="banner"><p>To install on iPhone: tap Share, then “Add to Home Screen”.</p></div>' : ''}
  <div class="set-layout">
    <nav class="set-nav" aria-label="Settings sections">${sections.map((x) => `<button type="button" class="set-tab" data-act="set-tab" data-sec="${x.id}" aria-current="${x.id === cur.id ? 'page' : 'false'}"><span class="set-ic" aria-hidden="true">${x.icon}</span><span class="set-t"><b>${x.label}</b><span>${x.sub}</span></span></button>`).join('')}
      <p class="muted small set-foot">Finance Helper · private, offline, no account, no tracking.</p></nav>
    <div class="set-body"><h2 class="set-title">${cur.icon} ${cur.label}</h2><div class="set-grid">${cur.html()}</div></div>
  </div>`;
}

function updateJarSum() {
  const el = document.getElementById('jar-sum');
  if (!el) return;
  const sum = state.settings.jars.reduce((a, j) => a + (Number(j.pct) || 0), 0);
  el.className = `right ${sum === 100 ? 'sum-ok' : 'sum-bad'}`;
  el.textContent = sum === 100 ? '100% ✓' : `${sum}% (must be 100)`;
}

// ---------- Motion ----------

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let enterTimer = null;
const shownCounts = new Map();

// Staggered entrance for the screen that just opened.
function playEnter() {
  clearTimeout(enterTimer);
  if (reducedMotion()) return;
  const kids = [...app.children, ...app.querySelectorAll('.dash-main > *, .dash-side > *')];
  kids.forEach((el, i) => el.style.setProperty('--i', Math.min(i, 12)));
  app.querySelectorAll('.chart rect, .cal-day').forEach((el, i) => el.style.setProperty('--b', i));
  app.classList.add('enter');
  enterTimer = setTimeout(() => app.classList.remove('enter'), 1600);
}

// Numbers roll from where they were (or from 0 on a fresh screen) to the new value.
function runCounters(entering) {
  for (const el of app.querySelectorAll('[data-count]')) {
    const to = Number(el.dataset.count);
    const key = el.dataset.ck;
    const from = shownCounts.has(key) ? shownCounts.get(key) : entering ? 0 : to;
    shownCounts.set(key, to);
    if (from === to || reducedMotion()) continue;
    const fmt = (v) => (el.dataset.cur ? money(v, { sign: !!el.dataset.sign }) : formatMoney(v, ''));
    const start = performance.now();
    const dur = 800;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - (1 - t) ** 3;
      const v = from + (to - from) * e;
      // Whole lei while counting unless the real value has bani.
      el.textContent = fmt(to % 100 ? Math.round(v) : Math.round(v / 100) * 100);
      if (t < 1 && el.isConnected) requestAnimationFrame(step);
    };
    el.textContent = fmt(from);
    requestAnimationFrame(step);
  }
}

function render({ enter = false } = {}) {
  // Once: the owner chose look B (Midnight, dark). "Light" stays in Settings.
  if (!state._sealed && !state.meta.lookB) {
    state.meta.lookB = 1;
    if (!state.settings.theme || state.settings.theme === 'system') state.settings.theme = 'dark';
    persist({ quiet: true });
  }
  applyTheme();
  // Today's weekday color, used to mark today everywhere.
  document.documentElement.style.setProperty('--today-c', `var(--dow${dowIndex(todayISO())})`);
  app.className = `app view-${ui.tab}`;
  app.innerHTML = (SCREENS[ui.tab] || SCREENS.home).view();
  // Sections that share a sidebar item get tabs under their title.
  const group = SUB_TABS.find((g) => g.some((x) => x.tab === ui.tab));
  if (group) app.querySelector('header.top')?.insertAdjacentHTML('afterend', `<nav class="subtabs" aria-label="Sections">${group.map((x) => `<a href="#${x.tab}"${x.tab === ui.tab ? ' aria-current="page"' : ''}>${x.label}</a>`).join('')}</nav>`);
  if (enter) {
    shownCounts.clear();
    playEnter();
  }
  runCounters(enter);
  Motion.slideSegs(app);
  // Phone: keep the chosen month visible in the scrolling month strip.
  const strip = app.querySelector('.mnav-months');
  const on = strip?.querySelector('.mpill.on');
  if (on && strip.scrollWidth > strip.clientWidth) strip.scrollLeft = on.offsetLeft - strip.clientWidth / 2 + on.offsetWidth / 2;
  if (ui.flashId) {
    // A record created just now: the buddy reacts to it.
    Buddy.onTx(state.tx.find((t) => t.id === ui.flashId));
    app.querySelector(`[data-id="${CSS.escape(ui.flashId)}"]`)?.classList.add('flash');
    ui.flashId = null;
  }
  for (const a of document.querySelectorAll('.tabbar a, .more-list a')) {
    if (a.dataset.tab === (NAV_PARENT[ui.tab] || ui.tab)) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (ui.tab === 'settings') updateJarSum();
  renderSidebar();
  clearTimeout(render.ms);
  render.ms = setTimeout(() => Goals.checkMilestones(), 700);
}

// ---------- Bottom sheet ----------

function openSheet(html, onMount) {
  sheetRoot.innerHTML = '';
  sheetRoot.innerHTML = `<div class="sheet-backdrop" data-close><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  const sheet = sheetRoot.querySelector('.sheet');
  document.body.style.overflow = 'hidden';
  onMount?.(sheet);
  requestAnimationFrame(() => Motion.slideSegs(sheet));
  return sheet;
}

function closeSheet() {
  const el = sheetRoot.firstElementChild;
  document.body.style.overflow = '';
  if (!el) return;
  if (reducedMotion()) { el.remove(); return; }
  // Slide out, then remove only this sheet (a new one may already be open).
  el.classList.add('closing');
  el.removeAttribute('data-close');
  setTimeout(() => el.remove(), 180);
}

function categoryOrder(type) {
  // Most used in the last 90 days first, so your usual ones are one tap away.
  const since = addMonths(monthKey(todayISO()), -3);
  const count = {};
  for (const t of state.tx) if (t.type === type && t.date >= since) count[t.category] = (count[t.category] || 0) + 1;
  return state.settings.categories.filter((c) => c.type === type)
    .map((c, i) => ({ c, i })).sort((a, b) => (count[b.c.id] || 0) - (count[a.c.id] || 0) || a.i - b.i).map((x) => x.c);
}

function accLabel(a) {
  const multi = state.settings.accounts.some((x) => x.currency !== state.settings.currency);
  return `${a.name}${a.bank && !a.name.toLowerCase().includes(a.bank.toLowerCase()) ? ` · ${a.bank}` : ''}${multi ? ` · ${a.currency}` : ''}`;
}

// Rate to the base currency we'd suggest for a new record: today's rate if
// known, else the last one you used for that currency.
function suggestedRate(cur) {
  if (cur === state.settings.currency) return 1;
  const live = pairRate(cur, state.settings.currency, state.rates);
  if (live) return Math.round(live * 10000) / 10000;
  const last = M.sortTx(state.tx).find((t) => t.currency === cur && t.rate);
  return last?.rate || null;
}

function openTxSheet(existing = null, preset = {}) {
  const accounts = M.activeAccounts(state).length ? M.activeAccounts(state) : state.settings.accounts;
  const baseCur = state.settings.currency;
  const last = M.sortTx(state.tx).find((t) => t.type !== 'transfer');
  const draft = existing ? { ...existing, personName: M.person(state, existing.person)?.name || '' } : {
    type: 'expense',
    date: todayISO(),
    account: (last && M.account(state, last.account) && !M.account(state, last.account).archived) ? last.account : accounts[0]?.id,
    from: accounts[0]?.id,
    to: state.settings.savingsAccount || accounts[1]?.id,
    category: null,
    note: '',
    personName: '',
    loan: false,
    ...preset,
  };
  let amountText = existing ? centsToPlain(existing.amount) : preset.amountText || '';
  let toText = existing?.toAmount ? centsToPlain(existing.toAmount) : '';
  let toTouched = !!existing?.toAmount;
  let rateText = existing?.rate && existing.currency !== baseCur ? String(existing.rate) : '';
  let catTouched = !!existing;
  let addingCat = false;
  // One-tap fills for things you log often (and your favorites).
  const picks = existing || preset.fromRule ? [] : M.quickPicks(state, todayISO(), 8);

  const curOf = () => M.account(state, draft.type === 'transfer' ? draft.from : draft.account)?.currency || baseCur;
  const toCur = () => M.account(state, draft.to)?.currency || baseCur;

  // Typed in another currency than the account's (10 USD from an MDL wallet):
  // the record is converted into the account's currency and keeps what you typed.
  const typed0 = existing ? M.typedAs(existing) : null;
  const rateOf = (c) => (c === baseCur ? 1 : suggestedRate(c));
  const defaultEntryRate = (c) => {
    const a = rateOf(c);
    const b = rateOf(curOf());
    return a && b ? String(Math.round((a / b) * 10000) / 10000).replace('.', ',') : '';
  };
  let entryCur = typed0?.currency || null;
  let entryRateText = typed0 ? String(Math.round((existing.amount / typed0.amount) * 10000) / 10000).replace('.', ',') : '';
  if (typed0) amountText = centsToPlain(typed0.amount);
  // A person who usually deals in USD (People → their currency): start in USD.
  if (!existing && !entryCur && draft.personName) {
    const p = state.people.find((x) => x.name.toLowerCase() === String(draft.personName).toLowerCase());
    if (p?.currency && p.currency !== curOf()) { entryCur = p.currency; entryRateText = defaultEntryRate(entryCur); }
  }
  const entryOn = () => draft.type !== 'transfer' && !!entryCur && entryCur !== curOf();
  const entryRate = () => Number(String(entryRateText).replace(',', '.'));
  const curChoices = () => [...new Set([curOf(), baseCur, 'USD', 'EUR', ...state.settings.accounts.map((a) => a.currency), ...state.people.map((x) => x.currency)].filter(Boolean))];

  const accSelect = (field, label) => `<label class="field"><span>${label}</span><select id="tx-${field}">
    ${accounts.concat(existing && !accounts.some((a) => a.id === existing[field]) && M.account(state, existing[field]) ? [M.account(state, existing[field])] : [])
    .map((a) => `<option value="${esc(a.id)}" ${draft[field] === a.id ? 'selected' : ''}>${esc(accLabel(a))}</option>`).join('')}</select></label>`;

  const html = () => {
    const isT = draft.type === 'transfer';
    const cur = curOf();
    if (!isT && cur !== baseCur && !rateText) rateText = String(suggestedRate(cur) || '');
    const cross = isT && cur !== toCur();
    const segBtn = (t, label) => `<button type="button" data-type="${t}" aria-pressed="${draft.type === t}">${label}</button>`;
    const people = state.people.map((p) => `<option value="${esc(p.name)}">`).join('');
    return `<form id="tx-form" novalidate>
      <h3>${existing ? 'Edit record' : 'New record'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
      ${picks.some((p) => p.type === draft.type) ? `<div class="picks" role="group" aria-label="Quick picks">${picks.map((p, i) => p.type !== draft.type ? '' : `<button type="button" class="pick" data-pick="${i}" title="${p.fav ? 'Favorite' : `Logged ${p.count} times lately`}">${p.fav ? '<span class="gold">★</span> ' : ''}${esc(p.note || catOf(p.category).name)} <b class="${p.type === 'income' ? 'income' : ''}">${formatMoney(p.type === 'income' ? p.amount : p.amount, p.currency, { compact: true })}</b></button>`).join('')}</div>` : ''}
      <div class="seg" role="group" aria-label="Type">${segBtn('expense', 'Spent')}${segBtn('income', 'Earned')}${segBtn('transfer', 'Move')}</div>
      <div class="amount-input"><input id="tx-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(amountText)}" aria-label="Amount in ${entryOn() ? entryCur : cur}">${isT ? `<span class="cur">${esc(cur)}</span>`
    : `<select id="tx-cur" class="cur cur-pick" aria-label="Currency of the amount" title="Type it in another currency">${curChoices().map((c) => `<option ${c === (entryOn() ? entryCur : cur) ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`}</div>
      <div class="calc-hint" id="calc-hint">${isT ? 'Move money between your accounts' : 'Tip: type 120+45 and it adds up'}</div>
      ${entryOn() ? `<label class="field fx-row"><span>Rate</span><span class="fx-line">1 ${esc(entryCur)} = <input id="tx-erate" type="text" inputmode="decimal" value="${esc(entryRateText)}" placeholder="?" aria-label="Rate from ${esc(entryCur)} to ${esc(cur)}"> ${esc(cur)}</span></label>` : ''}
      ${!isT && cur !== baseCur ? `<label class="field fx-row"><span>Rate</span><span class="fx-line">1 ${esc(cur)} = <input id="tx-rate" type="text" inputmode="decimal" value="${esc(rateText)}" placeholder="?" aria-label="Rate to ${esc(baseCur)}"> ${esc(baseCur)}</span></label>` : ''}
      ${cross ? `<label class="field"><span>Arrives as (${esc(toCur())})</span><input id="tx-to-amount" type="text" inputmode="decimal" value="${esc(toText)}" placeholder="0"></label>` : ''}
      <label class="field"><span>${isT ? 'Note (optional)' : 'What for?'}</span>
        <input id="tx-note" type="text" list="note-list" autocomplete="off" value="${esc(draft.note)}" placeholder="${draft.type === 'income' ? 'e.g. salary, project for a client' : isT ? 'e.g. to the safe' : 'e.g. groceries, taxi, rent'}"></label>
      <datalist id="note-list">${M.noteSuggestions(state, draft.type).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      ${isT ? '' : `<div class="cats" role="group" aria-label="Category">${categoryOrder(draft.type).map((c) => `<button type="button" class="cat" data-cat="${esc(c.id)}" aria-pressed="${draft.category === c.id}">${dot(catColor(c.id))}<span>${esc(c.name)}</span></button>`).join('')}
        ${addingCat ? `<span class="cat-new"><input id="new-cat" type="text" placeholder="New category" aria-label="New category name"><button type="button" class="btn primary" data-act="cat-create">Add</button></span>` : '<button type="button" class="cat cat-add" data-act="cat-new">+ New</button>'}</div>`}
      ${isT ? '' : `<div class="row2">
        <label class="field"><span>${draft.type === 'income' ? 'From who? (optional)' : 'To who? (optional)'}</span><input id="tx-person" type="text" list="people-list" autocomplete="off" value="${esc(draft.personName)}" placeholder="Name"></label>
        <label class="field check"><input id="tx-loan" type="checkbox" ${draft.loan ? 'checked' : ''}><span>${draft.type === 'income' ? 'Borrowed: I pay it back' : 'Lent: they pay it back'}</span></label>
      </div><datalist id="people-list">${people}</datalist>`}
      <div class="row2">
        ${isT ? accSelect('from', 'From') + accSelect('to', 'To') : accSelect('account', draft.type === 'income' ? 'Into' : 'Paid from')}
      </div>
      ${!existing && !isT && !draft.fromRule ? `<div class="row2"><label class="field"><span>Date</span><input id="tx-date" type="date" value="${esc(draft.date)}"></label>
        <label class="field"><span>Repeat</span><select id="tx-repeat"><option value="">No</option>${FREQS.filter((f) => f.id !== 'once').map((f) => `<option value="${f.id}" ${draft.repeat === f.id ? 'selected' : ''}>${f.label}</option>`).join('')}</select></label></div>`
    : `<label class="field"><span>Date</span><input id="tx-date" type="date" value="${esc(draft.date)}"></label>`}
      <div class="btns">
        ${existing ? '<button type="button" class="btn danger" data-act="tx-delete">Delete</button>' : ''}
        ${existing && draft.type === 'income' && !existing.loan ? '<button type="button" class="btn" data-act="tx-split">Split</button>' : ''}
        ${existing?.type === 'income' && draft.type === 'income' && !existing.loan ? '<button type="button" class="btn" data-act="tx-allocate">Allocate to goals</button>' : ''}
        ${existing && !isT ? `<button type="button" class="btn" data-act="tx-fav" aria-pressed="${M.isFavorite(state, existing)}">${M.isFavorite(state, existing) ? '★ Favorite' : '☆ Make favorite'}</button>` : ''}
        <button type="submit" class="btn primary">${existing ? 'Save' : 'Add'}</button>
      </div>
    </form>`;
  };

  const readInputs = (sheet) => {
    const v = (id) => sheet.querySelector(id);
    amountText = v('#tx-amount').value;
    draft.note = v('#tx-note').value;
    draft.date = v('#tx-date').value || draft.date;
    if (v('#tx-rate')) rateText = v('#tx-rate').value;
    if (v('#tx-erate')) entryRateText = v('#tx-erate').value;
    if (v('#tx-to-amount')) toText = v('#tx-to-amount').value;
    if (v('#tx-person')) draft.personName = v('#tx-person').value;
    if (v('#tx-loan')) draft.loan = v('#tx-loan').checked;
    if (v('#tx-repeat')) draft.repeat = v('#tx-repeat').value;
    for (const f of ['account', 'from', 'to']) {
      const el = v(`#tx-${f}`);
      if (el) draft[f] = el.value;
    }
  };

  // Live line under the amount: the calculator result and the value in MDL.
  const updateHint = (sheet) => {
    const hint = sheet.querySelector('#calc-hint');
    const raw = sheet.querySelector('#tx-amount').value;
    const typed = evalAmount(raw);
    const cur = curOf();
    const parts = [];
    if (/[+\-*/x×÷()]/i.test(raw.slice(1))) parts.push(typed != null && typed > 0 ? `= ${formatMoney(typed, entryOn() ? entryCur : cur)}` : '…');
    // Typed in USD from an MDL account: what leaves (or enters) the account.
    const er = Number(String(sheet.querySelector('#tx-erate')?.value || '').replace(',', '.'));
    const v = typed > 0 && entryOn() ? (er > 0 ? Math.round(typed * er) : null) : typed;
    if (typed > 0 && entryOn()) parts.push(v ? `= ${formatMoney(v, cur)} ${draft.type === 'income' ? 'into' : 'from'} ${accOf(draft.account).name}` : 'Enter the rate');
    const rate = Number(String(sheet.querySelector('#tx-rate')?.value || '').replace(',', '.'));
    if (v > 0 && cur !== baseCur && draft.type !== 'transfer' && rate > 0) parts.push(`≈ ${money(Math.round(v * rate))}`);
    if (v > 0 && draft.type === 'expense') {
      const w = workText(state, Math.round(v * (cur === baseCur ? 1 : rate || suggestedRate(cur) || 0)), todayISO());
      if (w) parts.push(`⏱ ${w} of your work`);
    }
    const toEl = sheet.querySelector('#tx-to-amount');
    if (toEl && !toTouched && v > 0) {
      const conv = convert(v, cur, toCur(), state.rates);
      if (conv != null) { toEl.value = centsToPlain(conv); toText = toEl.value; }
    }
    hint.style.color = '';
    hint.textContent = parts.join('  ') || (draft.type === 'transfer' ? 'Move money between your accounts' : 'Tip: type 120+45 and it adds up');
  };

  const paint = (sheet, focus = true) => {
    sheet.innerHTML = `<div class="grab"></div>${html()}`;
    const amount = sheet.querySelector('#tx-amount');
    amount.addEventListener('input', () => updateHint(sheet));
    sheet.querySelector('#tx-rate')?.addEventListener('input', () => updateHint(sheet));
    sheet.querySelector('#tx-erate')?.addEventListener('input', () => updateHint(sheet));
    sheet.querySelector('#tx-cur')?.addEventListener('change', (e) => {
      readInputs(sheet);
      entryCur = e.target.value === curOf() ? null : e.target.value;
      entryRateText = entryCur ? defaultEntryRate(entryCur) : '';
      paint(sheet, false);
      updateHint(sheet);
      sheet.querySelector(entryRateText ? '#tx-amount' : '#tx-erate')?.focus();
    });
    sheet.querySelector('#tx-to-amount')?.addEventListener('input', () => { toTouched = true; });
    for (const f of ['account', 'from', 'to']) {
      sheet.querySelector(`#tx-${f}`)?.addEventListener('change', () => {
        const before = curOf();
        const beforeTo = draft.type === 'transfer' ? toCur() : null;
        readInputs(sheet);
        // Currency changed: repaint so the currency label and rate line follow.
        if (curOf() !== before || (beforeTo && toCur() !== beforeTo)) { rateText = ''; toTouched = false; if (entryCur) entryRateText = defaultEntryRate(entryCur); paint(sheet, false); updateHint(sheet); }
      });
    }
    sheet.querySelector('#tx-note').addEventListener('input', (e) => {
      if (catTouched || draft.type === 'transfer') return;
      const s = M.suggestCategory(state, e.target.value, draft.type);
      draft.category = s;
      for (const b of sheet.querySelectorAll('.cat[data-cat]')) b.setAttribute('aria-pressed', String(b.dataset.cat === s));
    });
    sheet.querySelector('#new-cat')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sheet.querySelector('[data-act="cat-create"]').click(); }
    });
    sheet.querySelector('#tx-form').addEventListener('submit', (e) => {
      e.preventDefault();
      readInputs(sheet);
      saveDraft(sheet);
    });
    if (addingCat) sheet.querySelector('#new-cat')?.focus();
    else if (focus && !existing) amount.focus();
    if (amountText) updateHint(sheet);
  };

  const fail = (sheet, msg, focusSel) => {
    const hint = sheet.querySelector('#calc-hint');
    hint.textContent = msg;
    hint.style.color = 'var(--expense)';
    if (focusSel) sheet.querySelector(focusSel)?.focus();
  };

  const saveDraft = (sheet) => {
    const amount = evalAmount(amountText);
    if (!amount || amount <= 0) return fail(sheet, 'Enter an amount bigger than 0', '#tx-amount');
    const cur = curOf();
    const now = Date.now();
    const common = { id: existing?.id || M.uid(), createdAt: existing?.createdAt || now, updatedAt: now, type: draft.type, amount, currency: cur, date: draft.date, note: draft.note.trim() };
    let tx;
    if (draft.type === 'transfer') {
      if (draft.from === draft.to) return fail(sheet, 'Pick two different accounts');
      let toAmount;
      if (cur !== toCur()) {
        toAmount = evalAmount(toText);
        if (!toAmount || toAmount <= 0) return fail(sheet, `How much arrives in ${toCur()}?`, '#tx-to-amount');
      }
      const rate = suggestedRate(cur);
      tx = { ...common, from: draft.from, to: draft.to, ...(toAmount ? { toAmount } : {}), rate, base: rate ? Math.round(amount * rate) : amount };
    } else {
      const rate = cur === baseCur ? 1 : Number(String(rateText).replace(',', '.'));
      if (!(rate > 0)) return fail(sheet, `Enter the rate: 1 ${cur} = ? ${baseCur}`, '#tx-rate');
      // Typed in another currency: converted into the account's.
      let entry = { amount, orig: null, debt: null };
      if (entryOn()) {
        const er = entryRate();
        if (!(er > 0)) return fail(sheet, `Enter the rate: 1 ${entryCur} = ? ${cur}`, '#tx-erate');
        entry = M.entryAmounts(amount, entryCur, cur, er, { loan: !!(draft.personName.trim() && draft.loan) });
      }
      const personId = M.ensurePerson(state, draft.personName, now);
      tx = {
        ...common,
        amount: entry.amount,
        account: draft.account,
        category: draft.category || (draft.type === 'income' ? 'other-in' : 'other'),
        rate,
        base: Math.round(entry.amount * rate),
        ...(entry.orig ? { orig: entry.orig } : {}),
        ...(entry.debt ? { debt: entry.debt } : {}),
        ...(personId ? { person: personId } : {}),
        ...(personId && draft.loan ? { loan: true } : {}),
      };
    }
    // Logged from a recurring item on the Plan screen.
    const rule = draft.fromRule && state.recurring.find((r) => r.id === draft.fromRule.id);
    if (rule) {
      tx.id = draft.fromRule.txId;
      tx.recurring = rule.id;
      markDone(rule, draft.fromRule.date, now);
      state.tx = state.tx.filter((t) => t.id !== tx.id);
      delete state.deleted[tx.id];
    }
    // "Repeat": this record becomes the first of a recurring item.
    if (!existing && draft.repeat && tx.type !== 'transfer') {
      const id = M.uid();
      state.recurring.push({ id, createdAt: now, updatedAt: now, type: tx.type, amount: tx.amount, currency: tx.currency, account: tx.account, category: tx.category, note: tx.note, ...(tx.person ? { person: tx.person } : {}), every: draft.repeat, start: tx.date, lastDone: tx.date, auto: false, paused: false });
      tx.recurring = id;
    }
    if (existing) state.tx = state.tx.map((t) => (t.id === existing.id ? tx : t));
    else state.tx.push(tx);
    ui.flashId = tx.id;
    commit();
    closeSheet();
    // Changed the category: offer to always file records like this there.
    if (existing && Rules.afterCorrection(existing, tx)) return;
    if (!existing && draft.repeat && tx.type !== 'transfer') { toast(`Added, and it repeats ${FREQS.find((f) => f.id === draft.repeat).short}. See Plan.`); return; }
    const alert = !existing && M.budgetAlert(state, tx);
    if (alert) { toast(alert.text); return; }
    if (!existing && tx.type === 'income' && !tx.loan) openSplitSheet(tx);
    else toast(existing ? 'Saved' : `${tx.type === 'expense' ? 'Spent' : tx.type === 'income' ? 'Earned' : 'Moved'} ${tx.orig ? `${formatMoney(tx.orig.amount, tx.orig.currency)} (${formatMoney(tx.amount, tx.currency)})` : formatMoney(tx.amount, tx.currency)}`);
  };

  // paint() replaces the sheet's contents (fresh inputs each time); this click
  // listener sits on the sheet itself, so it is bound once.
  openSheet('', (sheet) => {
    sheet.addEventListener('click', (e) => {
      const seg = e.target.closest('.seg button');
      if (seg) {
        readInputs(sheet);
        if (seg.dataset.type !== draft.type) {
          draft.type = seg.dataset.type;
          draft.category = catTouched ? null : M.suggestCategory(state, draft.note, draft.type);
          catTouched = false;
          addingCat = false;
          paint(sheet);
        }
        return;
      }
      if (e.target.closest('[data-act="cat-new"]')) {
        readInputs(sheet);
        addingCat = true;
        paint(sheet, false);
        return;
      }
      if (e.target.closest('[data-act="cat-create"]')) {
        const name = sheet.querySelector('#new-cat')?.value;
        readInputs(sheet);
        const id = M.ensureCategory(state, name, draft.type);
        if (id) {
          draft.category = id;
          catTouched = true;
          persist();
        }
        addingCat = false;
        paint(sheet, false);
        return;
      }
      const cat = e.target.closest('.cat[data-cat]');
      if (cat) {
        draft.category = cat.dataset.cat;
        catTouched = true;
        for (const b of sheet.querySelectorAll('.cat[data-cat]')) b.setAttribute('aria-pressed', String(b === cat));
        return;
      }
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        const p = picks[pick.dataset.pick];
        readInputs(sheet);
        Object.assign(draft, { type: p.type, note: p.note, category: p.category });
        if (M.account(state, p.account) && !M.account(state, p.account).archived) draft.account = p.account;
        amountText = centsToPlain(p.amount);
        rateText = '';
        entryCur = null; // quick picks are in the account's currency
        catTouched = true;
        paint(sheet, false);
        const a = sheet.querySelector('#tx-amount');
        a.focus();
        a.select();
        return;
      }
      if (e.target.closest('[data-act="tx-fav"]')) {
        const on = M.toggleFavorite(state, existing);
        persist();
        Sync.changed();
        readInputs(sheet);
        paint(sheet, false);
        toast(on ? 'Added to your quick picks' : 'Removed from quick picks');
        return;
      }
      if (e.target.closest('[data-act="tx-delete"]')) deleteTx(existing.id);
      if (e.target.closest('[data-act="tx-split"]')) { closeSheet(); setTimeout(() => openSplitSheet(existing), 200); }
      if (e.target.closest('[data-act="tx-allocate"]')) { closeSheet(); setTimeout(() => Goals.openAllocationSheet(existing.id), 200); }
    });
    paint(sheet);
  });
}

// Money came in: one tap divides it. Taxes first (your %), then the rest by
// your jars, each part moved to the account it belongs in (js/split.js).
function openSplitSheet(tx) {
  const from = M.account(state, tx.account);
  if (!from) return;
  const prefs = splitPrefs(state);
  let taxPct = prefs.taxPct;
  const accounts = {};
  const fm = (c) => formatMoney(c, tx.currency);
  const accs = state.settings.accounts.filter((a) => !a.archived);
  const already = isSplit(state, tx.id);
  const paint = (sheet) => {
    const rows = planSplit(state, tx, { taxPct, accounts });
    const plan = splitTransfers(state, tx, rows, { uid: () => '' });
    const moving = plan.transfers.reduce((a, t) => a + t.amount, 0);
    const opt = (r) => accs.map((a) => `<option value="${esc(a.id)}" ${a.id === r.to ? 'selected' : ''}>${a.id === tx.account ? `Stays in ${esc(a.name)}` : `→ ${esc(a.name)}`}</option>`).join('');
    sheet.querySelector('#split-body').innerHTML = `
      <div class="split-tax"><label>🧾 Taxes <input type="number" id="split-tax" min="0" max="100" step="0.5" value="${taxPct || ''}" placeholder="0" aria-label="Tax percent">%</label>
        <span class="muted small">${taxPct ? 'set aside first' : 'set a % if you pay tax on this income'}</span></div>
      ${rows.map((r) => `<div class="split-line${r.to !== tx.account ? ' moves' : ''}${plan.skipped.includes(r.id) ? ' warn' : ''}">
        <span class="sl-name">${esc(r.emoji)} ${esc(r.name)} <span class="muted">${r.pct}%</span></span>
        <select data-split="${esc(r.id)}" aria-label="Where ${esc(r.name)} goes">${opt(r)}</select>
        <b class="money ${r.savings ? 'income' : ''}">${fm(r.amount)}</b>
      </div>`).join('')}
      <p class="muted small split-sum">${plan.transfers.length ? `Moves <b>${fm(moving)}</b> in ${plan.transfers.length} transfer${plan.transfers.length === 1 ? '' : 's'}; ${fm(tx.amount - moving)} stays in ${esc(from.name)}.` : 'Everything stays where it is. Pick where a part goes to move it.'}${plan.skipped.length ? ' Some parts need an exchange rate first (Rates screen).' : ''}${already ? ' <b>This income was split before.</b>' : ''}</p>`;
    sheet.querySelector('#split-go').disabled = !plan.transfers.length;
  };
  openSheet(`<h3>Split ${fm(tx.amount)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p class="muted small" style="margin-top:0">${esc(tx.note || catOf(tx.category).name)} · ${esc(from.name)} · ${dayLabel(tx.date)}</p>
    <div id="split-body"></div>
    <div class="btns" style="margin-top:14px"><button class="btn" data-close>Not now</button><button class="btn" id="split-goals">Allocate to goals</button><button class="btn primary" id="split-go">Split it</button></div>`, (sheet) => {
    paint(sheet);
    sheet.querySelector('#split-goals').addEventListener('click', () => { closeSheet(); setTimeout(() => Goals.openAllocationSheet(tx.id), 200); });
    sheet.addEventListener('change', (e) => {
      if (e.target.id === 'split-tax') taxPct = Math.max(0, Math.min(100, Number(e.target.value) || 0));
      else if (e.target.dataset.split) accounts[e.target.dataset.split] = e.target.value;
      paint(sheet);
    });
    sheet.querySelector('#split-go').addEventListener('click', () => {
      const rows = planSplit(state, tx, { taxPct, accounts });
      const { transfers } = splitTransfers(state, tx, rows, { uid: M.uid });
      if (!transfers.length) return;
      state.tx.push(...transfers);
      // Remember the choices for next time.
      const tax = rows.find((r) => r.id === 'tax');
      state.settings.split = { taxPct, taxAccount: tax && tax.to !== tx.account ? tax.to : prefs.taxAccount };
      for (const j of state.settings.jars) if (accounts[j.id]) j.account = accounts[j.id] === tx.account ? null : accounts[j.id];
      state.settings.updatedAt = Date.now();
      commit();
      closeSheet();
      toast(`Split: ${transfers.length} move${transfers.length === 1 ? '' : 's'}, ${fm(transfers.reduce((a, t) => a + t.amount, 0))}`, 'Undo', () => undoRedo(-1));
    });
  });
}

function openTransferSheet(fromId) {
  const other = state.settings.accounts.find((a) => a.id !== fromId && !a.archived);
  openTxSheet(null, { type: 'transfer', from: fromId, to: fromId === state.settings.savingsAccount ? other?.id : state.settings.savingsAccount || other?.id });
}

function deleteTx(id) {
  const removed = M.removeTx(state, id);
  if (!removed) return;
  commit();
  closeSheet();
  toast('Deleted', 'Undo', () => undoRedo(-1));
}

function toast(text, actionLabel, action) {
  const el = document.getElementById('toast');
  const ms = actionLabel ? 6000 : 2600;
  el.innerHTML = `<svg class="toast-ic" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5"/><path d="M6 10.4l2.6 2.5L14 7.6"/></svg><span>${esc(text)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}<i class="toast-bar" style="--t:${ms}ms" aria-hidden="true"></i>`;
  // Restart the entrance even when a toast is already showing.
  el.hidden = true;
  void el.offsetWidth;
  el.hidden = false;
  if (actionLabel) {
    el.querySelector('button').onclick = () => {
      el.hidden = true;
      action();
    };
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// ---------- Import / export ----------

function download(name, text, type) {
  if (DEMO) {
    toast('Downloads work in the installed app, not in this preview.');
    return false;
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

async function exportJSON() {
  if (download(`finance-helper-backup-${todayISO()}.json`, await backupText(state), 'application/json') === false) return;
  state.meta.lastBackup = Date.now();
  commit();
  toast(hasSession() ? 'Encrypted backup saved. It opens only with your PIN.' : 'Backup saved. Keep it somewhere safe (Drive, Telegram Saved Messages).');
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function exportCSV() {
  // The BOM makes Excel read Romanian letters and emoji correctly.
  download(`finance-helper-${todayISO()}.csv`, `\ufeff${toCSV(exportRows(state))}`, 'text/csv');
}

// Whole history as an Excel workbook: an overview tab per year, then one tab
// per month, like the old Google Sheet.
function exportExcel() {
  const months = [...new Set(state.tx.map((t) => monthKey(t.date)))].sort();
  if (!months.length) { toast('Nothing to export yet.'); return; }
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  const sheets = [
    ...years.map((y) => ({ name: `${y} Overview`, ...overviewSheet(state, Number(y)) })),
    ...months.map((m) => ({ name: monthLabel(m), ...monthSheet(state, m) })),
  ];
  if (download(`finance-helper-${todayISO()}.xlsx`, workbook(sheets), XLSX_TYPE)) toast(`Exported ${months.length} month${months.length === 1 ? '' : 's'} to Excel`);
}

function exportMonthExcel() {
  const list = logRecords();
  const name = ui.search.trim() ? `Search ${ui.search.trim()}` : monthLabel(ui.month);
  if (download(`finance-helper-${ui.month}.xlsx`, workbook([{ name, ...monthSheet(state, ui.month, list) }]), XLSX_TYPE)) toast(`${name} saved as an Excel file`);
}

async function copyTable() {
  const text = toTSV(exportRows(state, logRecords()));
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied. Paste it into Excel or Google Sheets.');
  } catch {
    // Clipboard blocked: show the text so it can be copied by hand.
    openSheet(`<h3>Copy table <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
      <p style="margin-top:0" class="muted small">Press Ctrl+C (⌘C on Mac), then paste into Excel or Google Sheets.</p>
      <textarea id="copy-text" rows="10" style="width:100%;font:13px/1.4 ui-monospace,monospace">${esc(text)}</textarea>`, (sheet) => {
      const ta = sheet.querySelector('#copy-text');
      ta.focus();
      ta.select();
    });
  }
}

// ---------- Table editing ----------

// Re-render after an edit but keep the cursor in the cell the user moved to.
function renderKeepFocus() {
  setTimeout(() => {
    const a = document.activeElement;
    const row = a?.closest?.('#tx-table tr');
    const col = a?.dataset?.col;
    const id = row?.dataset.id;
    const draft = row?.hasAttribute('data-draft');
    render();
    if (!col) return;
    const sel = draft ? `#tx-table tr[data-draft] [data-col="${col}"]` : id ? `#tx-table tr[data-id="${CSS.escape(id)}"] [data-col="${col}"]` : null;
    const el = sel && document.querySelector(sel);
    if (el) {
      el.focus();
      if (el.select && el.type === 'text') el.select();
    }
  }, 0);
}

function onCellChange(el) {
  const row = el.closest('tr');
  const col = el.dataset.col;
  const v = el.value;
  if (row.hasAttribute('data-draft')) {
    const d = ui.draft;
    if (col === 'type') {
      d.type = v;
      d.category = M.suggestCategory(state, d.note, v) || '';
      renderKeepFocus();
    } else if (col === 'note') {
      d.note = v;
      if (!d.category) {
        d.category = M.suggestCategory(state, v, d.type) || '';
        const sel = row.querySelector('[data-col="category"]');
        if (sel && d.category) sel.value = d.category;
      }
    } else if (col === 'amount') d.amountText = v;
    else if (col === 'person') d.personName = v;
    else d[col] = v;
    return;
  }
  const t = state.tx.find((x) => x.id === row.dataset.id);
  if (!t) return;
  if (col === 'amount') {
    const c = evalAmount(v);
    if (!c || c <= 0) { toast('Amount must be a number bigger than 0'); el.value = formatMoney(t.amount, ''); return; }
    t.amount = c;
    t.base = Math.round(c * (t.rate || 1));
  } else if (col === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { el.value = t.date; return; }
    t.date = v;
  } else if (col === 'type') {
    if (v === 'transfer') {
      t.from = t.account || state.settings.accounts[0].id;
      t.to = state.settings.accounts.find((a) => a.id !== t.from && a.id === state.settings.savingsAccount)?.id
        || state.settings.accounts.find((a) => a.id !== t.from)?.id;
      delete t.account;
      delete t.category;
    } else {
      t.account = t.account || t.from || state.settings.accounts[0].id;
      t.category = M.suggestCategory(state, t.note, v) || (v === 'income' ? 'other-in' : 'other');
      delete t.from;
      delete t.to;
    }
    t.type = v;
  } else if (col === 'from' || col === 'to') {
    const other = col === 'from' ? t.to : t.from;
    if (v === other) { toast('Pick two different accounts'); el.value = t[col]; return; }
    t[col] = v;
  } else if (col === 'account') {
    setTxAccount(t, v);
  } else if (col === 'person') {
    const id = M.ensurePerson(state, v);
    if (id) t.person = id; else { delete t.person; delete t.loan; }
  } else if (['category', 'note'].includes(col)) {
    t[col] = col === 'note' ? v.trim() : v;
  } else return;
  M.touch(t);
  persist();
  renderKeepFocus();
}

function addDraftRow() {
  const d = ui.draft;
  const row = document.querySelector('#tx-table tr[data-draft]');
  if (row) for (const el of row.querySelectorAll('[data-col]')) {
    if (el.dataset.col === 'amount') d.amountText = el.value;
    else if (el.dataset.col === 'person') d.personName = el.value;
    else d[el.dataset.col] = el.value;
  }
  const amount = evalAmount(d.amountText);
  if (!amount || amount <= 0) {
    toast('Type an amount in the new row first');
    row?.querySelector('[data-col="amount"]')?.focus();
    return;
  }
  if (d.type === 'transfer' && d.from === d.to) { toast('Pick two different accounts'); return; }
  const now = Date.now();
  const cur = M.account(state, d.type === 'transfer' ? d.from : d.account)?.currency || state.settings.currency;
  const rate = suggestedRate(cur);
  if (!rate) { toast(`No rate for ${cur} yet. Use + New record to enter it.`); return; }
  const base = { id: M.uid(), createdAt: now, updatedAt: now, type: d.type, amount, currency: cur, rate, base: Math.round(amount * rate), date: d.date, note: (d.note || '').trim() };
  if (d.type === 'transfer' && cur !== (M.account(state, d.to)?.currency || cur)) {
    const toAmount = convert(amount, cur, M.account(state, d.to).currency, state.rates);
    if (toAmount == null) { toast('Different currencies: use + New record to enter what arrives.'); return; }
    base.toAmount = toAmount;
  }
  ui.flashId = base.id;
  state.tx.push(d.type === 'transfer'
    ? { ...base, from: d.from, to: d.to }
    : { ...base, account: d.account, category: d.category || M.suggestCategory(state, d.note, d.type) || (d.type === 'income' ? 'other-in' : 'other'), ...(M.ensurePerson(state, d.personName) ? { person: M.ensurePerson(state, d.personName) } : {}) });
  ui.draft = { ...d, note: '', category: '', amountText: '', personName: '' };
  commit();
  toast(`Added ${money(amount)}`);
  document.querySelector('#tx-table tr[data-draft] [data-col="note"]')?.focus();
}

// Excel-style: Enter moves to the same column one row down; Enter in the new
// row adds it.
function onTableEnter(el) {
  const row = el.closest('tr');
  if (row.hasAttribute('data-draft')) {
    if (el.dataset.col === 'amount' || el.dataset.col === 'note') ui.draft.amountText = row.querySelector('[data-col="amount"]').value;
    addDraftRow();
    return;
  }
  el.blur();
  setTimeout(() => {
    const rows = [...document.querySelectorAll('#tx-table tbody tr[data-id], #tx-table tbody tr[data-draft]')];
    const i = rows.findIndex((r) => r.dataset.id === row.dataset.id);
    rows[i + 1]?.querySelector(`[data-col="${el.dataset.col}"]`)?.focus();
  }, 10);
}

function openDaySheet(date) {
  const items = M.sortTx(state.tx.filter((t) => t.date === date));
  const inc = items.filter((t) => t.type === 'income' && !t.loan).reduce((a, t) => a + M.B(t), 0);
  const exp = items.filter((t) => t.type === 'expense' && !t.loan).reduce((a, t) => a + M.B(t), 0);
  openSheet(`<h3>${dayLabel(date)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <div class="stats" style="margin-bottom:12px">
      <div class="stat"><span class="k">Earned</span><b class="income">${money(inc)}</b></div>
      <div class="stat"><span class="k">Spent</span><b class="expense">${money(exp)}</b></div>
      <div class="stat"><span class="k">Records</span><b>${items.length}</b></div>
    </div>
    ${items.length ? `<div class="list">${items.map((t) => txRow(t)).join('')}</div>` : '<p class="muted">Nothing logged on this day.</p>'}
    <div class="btns" style="margin-top:14px"><button class="btn primary" id="day-add">Add a record on this day</button></div>`, (sheet) => {
    sheet.querySelector('#day-add').addEventListener('click', () => { closeSheet(); openTxSheet(null, { date }); });
    sheet.addEventListener('click', (e) => {
      const row = e.target.closest('[data-act="edit"]');
      if (row) { closeSheet(); openTxSheet(state.tx.find((t) => t.id === row.dataset.id)); }
    });
  });
}

async function readFile(input) {
  const file = input.files?.[0];
  input.value = '';
  return file ? file.text() : null;
}

// A bank statement rather than the old sheet or this app's CSV.
const isStatement = (rows) => detectColumns(rows).headerRow === -1 && !!guessMapping(rows);

async function onCSVFile(text) {
  if (text == null) return;
  const rows = parseCSV(text);
  if (isStatement(rows)) { openBankImport(rows); return; }
  const res = importRows(rows, state);
  if (!res.tx.length) {
    toast(res.duplicates ? `Already imported (${res.duplicates} records).` : 'No records found. Rows need a date and an amount.');
    // Importing again is also how you check a sheet against the app.
    if (res.duplicates && res.format === 'sheet') ImportCheck.show(importCheck([{ name: res.allMonths.map((m) => monthLabel(m)).join(', ') || 'Your sheet', ...res }]));
    return;
  }
  const incomes = res.tx.filter((t) => t.type === 'income').length;
  const expenses = res.tx.filter((t) => t.type === 'expense').length;
  openSheet(`<h3>Import ${res.format === 'app' ? 'CSV' : 'from your sheet'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p style="margin-top:0">${res.months.map((m) => monthLabel(m)).join(', ')}</p>
    <div class="split-row"><span>${incomes} incomes</span><b class="money income">${money(res.income)}</b></div>
    <div class="split-row"><span>${expenses} expenses</span><b class="money expense">${money(res.expense)}</b></div>
    ${res.duplicates ? `<div class="split-row"><span class="muted">Already here, skipped</span><b>${res.duplicates}</b></div>` : ''}
    <p class="muted small">Check these totals match your sheet. Categories are guessed from your notes; tap any record later to fix it.</p>
    ${res.format === 'sheet' ? `<label class="field"><span>Put them in</span><select id="imp-acc">${state.settings.accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></label>` : ''}
    <div class="btns"><button class="btn" data-close>Cancel</button><button class="btn primary" id="imp-go">Import ${res.tx.length}</button></div>`, (sheet) => {
    sheet.querySelector('#imp-go').addEventListener('click', () => {
      const acc = sheet.querySelector('#imp-acc')?.value;
      if (acc) for (const t of res.tx) if (t.account) t.account = acc;
      state.tx.push(...res.tx);
      commit();
      closeSheet();
      ui.month = res.months[res.months.length - 1];
      location.hash = '#log';
      toast(`Imported ${res.tx.length} records`);
      if (res.format === 'sheet') setTimeout(() => ImportCheck.show(importCheck([{ name: res.allMonths.map((m) => monthLabel(m)).join(', '), ...res }])), 250);
    });
  });
}

// A whole .xlsx: one line per tab with what it holds; untick tabs to skip.
async function onWorkbookFile(buf) {
  const sheets = await readWorkbook(buf);
  if (sheets.length === 1 && isStatement(sheets[0].rows)) { openBankImport(sheets[0].rows); return; }
  const res = importWorkbook(sheets, state);
  const tabs = res.sheets;
  const useful = tabs.filter((t) => t.tx.length);
  if (!useful.length) {
    const dup = tabs.reduce((a, t) => a + (t.duplicates || 0), 0);
    toast(dup ? `Already imported (${dup} records).` : 'No records found in this file. Rows need a date and an amount.');
    const checks = importCheck(tabs.filter((t) => t.format === 'sheet'));
    if (checks.length) ImportCheck.show(checks);
    return;
  }
  const row = (t, i) => `<label class="tab-row ${t.tx.length ? '' : 'empty'}">
      <input type="checkbox" data-tab-i="${i}" ${t.tx.length ? 'checked' : 'disabled'}>
      <span class="t"><b>${esc(t.name)}</b><span class="muted small">${t.tx.length ? `${t.months.map((m) => monthLabel(m, true)).join(', ')} · ${t.tx.length} records${t.duplicates ? ` · ${t.duplicates} already here` : ''}` : t.duplicates ? `all ${t.duplicates} already here` : 'nothing to import'}</span></span>
      <span class="amount">${t.tx.length ? `<span class="income">+${money(t.income)}</span><span class="sub-amt">−${money(t.expense)}</span>` : ''}</span>
    </label>`;
  openSheet(`<h3>Import ${tabs.length} tab${tabs.length === 1 ? '' : 's'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p class="muted small" style="margin-top:0">Check the totals against your sheet. Categories are guessed from your notes; fix any later in the Log.</p>
    <div class="list tab-list">${tabs.map(row).join('')}</div>
    <label class="field" style="margin-top:12px"><span>Put them in</span><select id="imp-acc">${state.settings.accounts.filter((a) => !a.archived).map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></label>
    <div class="btns"><button class="btn" data-close>Cancel</button><button class="btn primary" id="imp-go">Import</button></div>`, (sheet) => {
    const count = () => [...sheet.querySelectorAll('[data-tab-i]:checked')].reduce((a, el) => a + tabs[el.dataset.tabI].tx.length, 0);
    const btn = sheet.querySelector('#imp-go');
    const label = () => { const n = count(); btn.textContent = `Import ${n} record${n === 1 ? '' : 's'}`; btn.disabled = !n; };
    sheet.addEventListener('change', label);
    label();
    btn.addEventListener('click', () => {
      const acc = sheet.querySelector('#imp-acc').value;
      const cur = M.account(state, acc)?.currency || state.settings.currency;
      const pickedTabs = [...sheet.querySelectorAll('[data-tab-i]:checked')].map((el) => tabs[el.dataset.tabI]);
      const picked = pickedTabs.flatMap((t) => t.tx);
      for (const t of picked) {
        if (!t.account) continue;
        t.account = acc;
        if (cur !== t.currency) { t.currency = cur; t.rate = suggestedRate(cur) || 1; t.base = Math.round(t.amount * t.rate); }
      }
      state.tx.push(...picked);
      commit();
      closeSheet();
      const months = [...new Set(picked.map((t) => t.date.slice(0, 7)))].sort();
      if (months.length) ui.month = months.at(-1);
      location.hash = '#log';
      toast(`Imported ${picked.length} records from ${months.length} month${months.length === 1 ? '' : 's'}`);
      const checks = importCheck(pickedTabs.filter((t) => t.format === 'sheet'));
      if (checks.length) setTimeout(() => ImportCheck.show(checks), 250);
    });
  });
}

// An encrypted backup: open it with the PIN in use, or ask for the PIN it
// was made with.
function askBackupPin(box) {
  openSheet(`<h3>Encrypted backup <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="bk-pin-form" autocomplete="off">
      <p style="margin-top:0">This backup is encrypted. Enter the PIN that was in use when it was made.</p>
      <label class="field"><span>PIN</span><input id="bk-pin" type="password" autocomplete="current-password"></label>
      <p class="lock-msg" id="bk-pin-msg" role="alert"></p>
      <div class="btns"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Open</button></div>
    </form>`, (sheet) => {
    sheet.querySelector('#bk-pin').focus();
    sheet.querySelector('#bk-pin-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const plain = await openImported(box, sheet.querySelector('#bk-pin').value);
        closeSheet();
        onJSONFile(plain);
      } catch (err) {
        sheet.querySelector('#bk-pin-msg').textContent = err.message;
      }
    });
  });
}

async function onJSONFile(text) {
  if (text == null) return;
  let box = null;
  try { box = JSON.parse(text); } catch { /* restoreJSON explains */ }
  if (isSealed(box)) {
    try {
      text = await openImported(box);
    } catch {
      askBackupPin(box);
      return;
    }
  }
  let next;
  try {
    next = restoreJSON(text);
  } catch (err) {
    toast(err.message);
    return;
  }
  openSheet(`<h3>Restore backup <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p style="margin-top:0">This replaces what is on this device (${state.tx.length} records) with the backup (${next.tx.length} records).</p>
    <div class="btns"><button class="btn" data-close>Cancel</button><button class="btn primary" id="restore-go">Restore</button></div>`, (sheet) => {
    sheet.querySelector('#restore-go').addEventListener('click', () => {
      state = next;
      commit();
      closeSheet();
      toast(`Restored ${state.tx.length} records`);
    });
  });
}

function openWipeSheet() {
  openSheet(`<h3>Erase everything? <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p style="margin-top:0">This deletes all ${state.tx.length} records and your settings from this device. It can't be undone. Make a backup first if you might need them.</p>
    <div class="btns"><button class="btn" data-close>Keep my data</button><button class="btn danger" id="wipe-go">Erase ${state.tx.length} records</button></div>`, (sheet) => {
    sheet.querySelector('#wipe-go').addEventListener('click', () => {
      state = M.defaultState();
      state.meta.createdAt = Date.now();
      if (DEMO) state.meta.demoSeeded = true;
      commit();
      closeSheet();
      toast('Everything erased');
    });
  });
}

// ---------- Settings edits ----------

function splitLabel(text, fallbackEmoji) {
  const t = text.trim();
  const m = t.match(/^(\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*)\s*(.*)$/u);
  return m ? { emoji: m[1], name: m[2] || 'Untitled' } : { emoji: fallbackEmoji, name: t || 'Untitled' };
}

function onSettingsChange(el) {
  const st = state.settings;
  const v = el.value;
  if (el.dataset.set) {
    const key = el.dataset.set;
    if (key === 'goal.name') st.goal.name = v.trim() || 'Goal';
    else if (key === 'goal.target') st.goal.target = Math.max(0, evalAmount(v) || 0);
    else if (key === 'goal.account') st.goal.account = v;
    else if (key === 'savingsAccount') st.savingsAccount = v;
    else if (key === 'theme') { st.theme = v; applyTheme(); }
    else if (key === 'themeMotion') { st.themeMotion = el.checked; applyAtmosphere(); }
    else if (key === 'currency') st.currency = v.trim().toUpperCase() || 'MDL';
    if (!['theme', 'themeMotion'].includes(key)) st.updatedAt = Date.now();
  } else if (el.dataset.jar) {
    const j = M.touch(M.jar(state, el.dataset.jar));
    if (el.dataset.field === 'pct') j.pct = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    else Object.assign(j, splitLabel(v, j.emoji));
    updateJarSum();
  } else if (el.dataset.acc) {
    const a = M.touch(M.account(state, el.dataset.acc));
    if (el.dataset.field === 'start') a.start = evalAmount(v) || 0;
    else Object.assign(a, splitLabel(v, a.emoji));
  } else if (el.dataset.cat) {
    const c = M.touch(M.category(state, el.dataset.cat));
    if (el.dataset.field === 'name') c.name = v.trim() || 'Untitled';
    else if (el.dataset.field === 'emoji') c.emoji = v.trim() || '•';
    else if (el.dataset.field === 'jar') c.jar = v;
  } else return;
  persist();
  Sync.changed();
}

// ---------- Events ----------

document.addEventListener('click', (e) => {
  // Table dates: the weekday text is on top; a click opens the date picker.
  if (e.target.matches?.('.dpick')) { try { e.target.showPicker?.(); } catch { /* not supported */ } }
  if (e.target.matches('[data-close]') || e.target.closest('button[data-close]')) {
    if (e.target.classList.contains('sheet-backdrop') || e.target.closest('button[data-close]')) closeSheet();
    return;
  }
  const go = e.target.closest('[data-go]');
  if (go) { location.hash = `#${go.dataset.go}`; return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.closest('.sheet')) return;
  const act = el.dataset.act;
  if (SCREENS[ui.tab]?.onClick?.(act, el)) return;
  if (act === 'acc-open') AccountsScreen.openAccount(el.dataset.id);
  else if (act === 'person-open') PeopleScreen.openPerson(el.dataset.id);
  else if (act === 'more') openMoreSheet();
  else if (act === 'bd-toggle') Buddy.toggle();
  else if (act === 'calc') Calc.toggle();
  else if (act === 'quick-pick') {
    const p = M.quickPicks(state, todayISO(), 8)[Number(el.dataset.i)];
    if (p) openTxSheet(null, { type: p.type, note: p.note, category: p.category, account: p.account, amountText: centsToPlain(p.amount) });
  }
  else if (act.startsWith('update-')) Updates.onClick(act);
  else if (act === 'cat-open') Spending.openCategory(el.dataset.cat, el.dataset.period, el.dataset.type);
  else if (act === 'spend-period') {
    ui[el.dataset.type === 'income' ? 'incomePeriod' : 'spendPeriod'] = el.dataset.period;
    render();
    app.querySelector(`.spend[data-spend="${el.dataset.type}"]`)?.classList.add('flash-in');
  }
  else if (act === 'add') openTxSheet();
  else if (act === 'edit') openTxSheet(state.tx.find((t) => t.id === el.dataset.id));
  else if (act === 'transfer') openTransferSheet(el.dataset.from);
  else if (act === 'month') goToMonth(addMonths(ui.month, Number(el.dataset.step)));
  else if (act === 'goto-month') goToMonth(el.dataset.month);
  else if (act === 'year') goToMonth(`${Number(ui.month.slice(0, 4)) + Number(el.dataset.step)}${ui.month.slice(4)}`);
  else if (act === 'year') { ui.year += Number(el.dataset.step); render({ enter: true }); }
  else if (act === 'open-month') { ui.month = el.dataset.key; ui.search = ''; location.hash = '#log'; }
  else if (act === 'filter') { ui.filter = el.dataset.filter; render(); }
  else if (act === 'log-view') { state.settings.logView = el.dataset.view; commit(); }
  else if (act === 'sort') {
    const col = el.dataset.col;
    ui.sort = { col, dir: ui.sort.col === col ? -ui.sort.dir : 1 };
    render();
  } else if (act === 'row-del') deleteTx(el.dataset.id);
  else if (act === 'sel') onSelect(el, e.shiftKey);
  else if (act === 'set-tab') { ui.settingsTab = el.dataset.sec; render(); window.scrollTo(0, 0); }
  else if (act === 'sh-year') {
    // Another year: its last month you have (or January).
    const y = el.dataset.year;
    const have = [...new Set(state.tx.map((x) => x.date.slice(0, 7)))].filter((k) => k.startsWith(y) && k <= monthKey(todayISO())).sort();
    goToMonth(have.at(-1) || `${y}-01`);
  } else if (act === 'sh-new-month') {
    // Like adding a sheet tab: the month after your last one.
    const next = addMonths(monthTabs(state, ui.month, todayISO(), state.meta.sheetMonths || []).last, 1);
    state.meta.sheetMonths = [...new Set([...(state.meta.sheetMonths || []), next])].sort();
    persist({ quiet: true });
    goToMonth(next);
    toast('New month added');
  } else if (act === 'sh-add') {
    ui.sheetExtra.add(el.dataset.date);
    render();
    const rows = [...document.querySelectorAll(`#sheet-grid tr[data-date="${el.dataset.date}"]`)];
    rows.at(-1)?.querySelectorAll('input')[2]?.focus();
  }
  else if (act === 'sel-all') onSelectAll(el);
  else if (act === 'bulk-clear') { ui.selected.clear(); refreshSelection(); }
  else if (act === 'bulk-del') bulkDelete();
  else if (act === 'undo') undoRedo(-1);
  else if (act === 'redo') undoRedo(1);
  else if (act === 'row-add') addDraftRow();
  else if (act === 'day') openDaySheet(el.dataset.date);
  else if (act === 'copy-table') copyTable();
  else if (act === 'tg-load') Telegram.loadNow();
  else if (act === 'tg-fix') Telegram.openFix();
  else if (act === 'export-month') exportMonthExcel();
  else if (act === 'export-xlsx') exportExcel();
  else if (act === 'export-json') exportJSON();
  else if (act === 'export-csv') exportCSV();
  else if (act === 'import-csv') document.getElementById('file-csv').click();
  else if (act === 'import-check') ImportCheck.open();
  else if (act === 'import-bank') document.getElementById('file-bank').click();
  else if (act === 'import-json') document.getElementById('file-json').click();
  else if (act === 'install') installPrompt?.prompt().finally(() => { installPrompt = null; render(); });
  else if (act === 'add-cat') {
    const type = el.dataset.type;
    state.settings.categories.push({ id: `c-${M.uid()}`, type, name: type === 'income' ? 'New source' : 'New category', emoji: '', updatedAt: Date.now(), ...(type === 'expense' ? { jar: state.settings.jars.find((j) => !j.savings)?.id } : {}) });
    commit();
  } else if (act === 'del-cat') {
    state.settings.categories = state.settings.categories.filter((c) => c.id !== el.dataset.id);
    state.deleted[el.dataset.id] = Date.now();
    commit();
  } else if (act === 'wipe') openWipeSheet();
});

document.addEventListener('change', (e) => {
  if (e.target.closest('.sheet')) return;
  if (SCREENS[ui.tab]?.onChange?.(e.target)) return;
  if (e.target.dataset.bulk) onBulkChange(e.target);
  else if (e.target.dataset.sh) onSheetChange(e.target);
  else if (e.target.classList.contains('sel')) return;
  else if (e.target.closest('#tx-table')) onCellChange(e.target);
  else if (e.target.id === 'file-csv') {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (/\.xlsx$/i.test(file.name)) file.arrayBuffer().then(onWorkbookFile).catch((err) => toast(err.message));
    else file.arrayBuffer().then(decodeText).then(onCSVFile);
  }
  else if (e.target.id === 'file-bank') {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) rowsFromFile(file).then((rows) => openBankImport(rows, { fileName: file.name })).catch((err) => toast(err.message));
  }
  else if (e.target.id === 'file-json') readFile(e.target).then(onJSONFile);
  else onSettingsChange(e.target);
});

document.addEventListener('input', (e) => {
  if (!e.target.closest('.sheet') && SCREENS[ui.tab]?.onInput?.(e.target)) return;
  if (e.target.id === 'search') {
    ui.search = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const s = document.getElementById('search');
    s.focus();
    s.setSelectionRange(pos, pos);
  }
});

// Desktop shortcuts: N = new record, / = search, 1-9 and 0 = sections, Esc = close.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetRoot.firstChild) { closeSheet(); return; }
  if (e.key === 'Escape' && ui.selected.size && !e.target.closest('input:not(.sel), select, textarea')) { ui.selected.clear(); refreshSelection(); return; }
  if (e.key === 'Enter' && e.target.closest('#sheet-grid') && e.target.matches('input')) {
    e.preventDefault();
    onSheetEnter(e.target);
    return;
  }
  if (e.key === 'Enter' && e.target.closest('#tx-table') && e.target.matches('input')) {
    e.preventDefault();
    onTableEnter(e.target);
    return;
  }
  if (Security.isLocked()) return;
  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y: undo and redo, unless you're in the
  // middle of typing in a box (then the box's own undo works).
  const z = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (z === 'z' || z === 'y') && !sheetRoot.firstChild) {
    const f = e.target.closest?.('input, textarea');
    if (f && f.type !== 'checkbox' && f.value !== f.defaultValue) return;
    e.preventDefault();
    undoRedo(z === 'y' || e.shiftKey ? 1 : -1);
    return;
  }
  // "=" opens the calculator, also over an open sheet.
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest('input, select, textarea') && Calc.onKey(e)) return;
  if (e.ctrlKey || e.metaKey || e.altKey || sheetRoot.firstChild) return;
  if (e.target.closest('input, select, textarea')) return;
  if ((e.key === 'l' || e.key === 'L') && Security.hasLock()) { Security.lock(); return; }
  if (ui.tab === 'log' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); goToMonth(addMonths(ui.month, e.key === 'ArrowLeft' ? -1 : 1)); return; }
  const tabs = { 1: 'home', 2: 'log', 3: 'accounts', 4: 'goals', 5: 'plan', 6: 'clients', 7: 'reports', 0: 'settings' };
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openTxSheet(); }
  else if (e.key === '/') {
    e.preventDefault();
    if (ui.tab !== 'log') location.hash = '#log';
    setTimeout(() => document.getElementById('search')?.focus(), 0);
  } else if (tabs[e.key]) location.hash = `#${tabs[e.key]}`;
});

// ---------- Screens ----------

// Rates live under Accounts, People under Clients, Year in review under
// Reports: one sidebar item each, with tabs on the screen.
const SUB_TABS = [
  [{ tab: 'accounts', label: 'Cards & accounts' }, { tab: 'rates', label: 'Rates & converter' }],
  [{ tab: 'clients', label: 'Clients & invoices' }, { tab: 'people', label: 'People & loans' }],
  [{ tab: 'reports', label: 'Reports' }, { tab: 'review', label: 'Year in review' }],
];
const NAV_PARENT = { rates: 'accounts', people: 'clients', review: 'reports' };

const SCREENS = {
  home: { view: viewHome, onClick: (a, el) => Plan.onClick(a, el) },
  log: { view: viewLog },
  accounts: AccountsScreen,
  goals: Goals,
  plan: Plan,
  clients: Clients,
  people: PeopleScreen,
  reports: ReportsScreen,
  review: YearReview,
  rates: RatesScreen,
  settings: { view: viewSettings, onClick: (a, el) => Security.onClick(a, el) || Rules.onClick(a, el) || Telegram.onClick(a) || TgBlocks.onClick(a, el) || Buddy.onClick(a, el) || Binance.onClick(a) || Sync.onClick(a) || SelfCheck.onClick(a) || Backups.onClick(a, el) || (a.startsWith('update-') && (Updates.onClick(a), true)), onChange: (el) => Security.onChange(el) || Telegram.onChange(el) || Buddy.onChange(el) || WorkHour.onChange(el) },
};

function openMoreSheet() {
  const item = (tab, label, sub) => `<a href="#${tab}" class="tx more-item"><span class="t"><b>${label}</b><span>${sub}</span></span><span class="muted">›</span></a>`;
  openSheet(`<h3>More <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <div class="list more-list">
      ${item('goals', 'Goals', 'What you are saving for, filling up by itself')}
      ${item('plan', 'Plan', 'Budgets, bills, subscriptions, regular income')}
      ${item('clients', 'Clients & people', 'Invoices, payments, who gave you money, loans')}
      ${item('reports', 'Reports', 'Any period, year in review, income for taxes')}
      ${item('rates', 'Rates & converter', 'Exchange rates, good day to convert USD?')}
      ${item('settings', 'Settings', 'Goal, smart split, categories, backups')}
    </div>`);
}

// ---------- Exchange rates ----------

async function updateRates({ force = false, announce = false } = {}) {
  const fresh = state.rates?.fetchedAt && Date.now() - state.rates.fetchedAt < 30 * 60000;
  if ((fresh && !force) || ui.ratesBusy || state._sealed) return;
  if (DEMO) {
    if (announce) toast('This preview uses example rates; the installed app downloads live ones.');
    return;
  }
  ui.ratesBusy = true;
  if (ui.tab === 'rates') render();
  const res = await refreshRates(state, { fetchText: window.desktop?.fetchText, bnm: !!window.desktop });
  // The first time: the last 90 days from the National Bank, for the
  // "good day to convert?" advice.
  if (window.desktop?.fetchText && !ui.backfilled) {
    ui.backfilled = true;
    await backfillRates(state, { fetchText: window.desktop.fetchText }).catch(() => 0);
  }
  ui.ratesBusy = false;
  persist();
  if (['home', 'accounts', 'rates'].includes(ui.tab) && !sheetRoot.firstElementChild) render();
  if (announce) toast(res.ok ? 'Rates updated' : res.partial ? `Partly updated. ${res.errors[0]}` : `Couldn't update rates. ${res.errors[0] || ''}`);
}

// A real getter (Object.assign would copy today's object once), so screens
// always see the current state after a restore, erase or demo reset.
Object.defineProperty(ctx, 'state', { get: () => state });
Object.assign(ctx, {
  ui,
  tipCard,
  dot,
  catColor,
  download,
  DEMO,
  commit,
  persist,
  render: (o) => render(o),
  toast,
  openSheet,
  closeSheet,
  money,
  bigMoney,
  countUp,
  txRow,
  openTxSheet,
  openTransferSheet,
  updateRates,
  suggestedRate: (cur) => suggestedRate(cur),
  restoreFromText: (text) => onJSONFile(text),
  buddy: (msg) => Buddy.say(msg),
  openSplit: (tx) => openSplitSheet(tx),
  backupNow: () => Backups.autoBackup({ force: true }),
  undo: () => undoRedo(-1),
  // Sync brings in a merged copy of the data.
  replaceState: (next) => { state = next; persist({ quiet: true }); },
  // Swap the data in memory without saving (lock / unlock with encryption).
  // Undo steps hold readable data, so they go too.
  setState: (next) => { state = next; history.clear(); history.reset(next); },
  // After unlocking encrypted data: catch up on what waited for it.
  afterUnlock: () => {
    applyTheme();
    updateRates();
    Sync.refreshConnected().then((on) => on && Sync.syncNow());
    Binance.syncBinance();
    Plan.runAuto();
    Telegram.resume();
    setTimeout(snapshotToday, 3000);
  },
  // Lock screen "Reset this device": wipe local data and start fresh.
  resetDevice: () => {
    wipeStore();
    location.reload();
  },
});

function route() {
  let tab = location.hash.slice(1) || 'home';
  if (tab === 'insights') tab = 'reports'; // old links
  const from = ui.tab;
  ui.tab = tab in SCREENS ? tab : 'home';
  closeSheet();
  const show = () => { render({ enter: true }); window.scrollTo(0, 0); };
  // Another screen: the old one fades into the new one.
  if (from && from !== ui.tab && app.firstChild) Motion.crossFade(show); else show();
  // "Add a record" shortcut from the home-screen icon.
  if (tab === 'add' || tab === 'add-income' || tab === 'add-expense') {
    history.replaceState(null, '', '#home');
    openTxSheet(null, tab === 'add-income' ? { type: 'income' } : {});
  }
}

window.addEventListener('hashchange', route);

// Paste rows copied from Excel / Google Sheets (or this app's "Copy table")
// anywhere on the Log screen to import them, with a preview first.
document.addEventListener('paste', (e) => {
  if (ui.tab !== 'log' || sheetRoot.firstChild || e.target.closest('input, textarea, select')) return;
  const text = e.clipboardData?.getData('text/plain') || '';
  if (!/[\t,;]/.test(text)) return;
  e.preventDefault();
  onCSVFile(text);
});

// Another tab or window changed the data: pick it up.
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEYS.KEY) {
    state = load();
    render();
  }
  if (e.key === STORAGE_KEYS.ENC && hasSession()) {
    reopen().then((next) => { if (next) { state = next; render(); } }).catch(() => {});
  }
});

window.addEventListener('fh-save-failed', () => toast('Could not save the encrypted data. Make a backup and run "Check everything".'));

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (ui.tab === 'settings') render();
});

if (!DEMO && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Preview only: fill the app with invented example data (a made-up month in
// the old sheet format plus this month across several accounts and
// currencies) so every screen has something to show. Bumping DEMO_VERSION
// re-seeds previews opened before.
const DEMO_VERSION = 10;

async function seedDemo() {
  if (!DEMO || state.meta.demoSeeded === DEMO_VERSION) return;
  state = M.defaultState();
  const now = Date.now();
  const acc = (id, name, bank, kind, currency, color, extra = {}) => ({ id, name, bank, kind, currency, color, start: 0, last4: '', savings: false, archived: false, holdings: [], updatedAt: now, ...extra });
  state.settings.accounts = [
    acc('wallet', 'Cash', 'Cash', 'cash', 'MDL', 2),
    acc('maib-visa', 'maib Visa', 'maib', 'card', 'MDL', 1, { last4: '4821' }),
    acc('maib-virt', 'maib virtual', 'maib', 'virtual', 'MDL', 5, { last4: '0937' }),
    acc('maib-biz', 'maib Business', 'maib', 'business', 'MDL', 4, { last4: '5512' }),
    acc('vb-usd', 'Victoriabank USD', 'Victoriabank', 'card', 'USD', 3, { last4: '7740' }),
    acc('safe', 'Safe', 'Cash', 'savings', 'MDL', 6, { savings: true, start: 1500000 }),
    acc('binance', 'Binance', 'Binance', 'crypto', 'USD', 7, { holdings: [{ asset: 'BTC', qty: 0.012 }, { asset: 'ETH', qty: 0.4 }, { asset: 'USDT', qty: 150 }] }),
  ];
  state.rates = { usd: { USD: 1, MDL: 17.6, EUR: 0.86, RON: 4.3, GBP: 0.75, UAH: 41.5, CHF: 0.8, PLN: 3.7, TRY: 41, CAD: 1.38 }, crypto: { BTC: 62000, ETH: 2400, BNB: 580, SOL: 150, XRP: 0.55, ADA: 0.4, DOGE: 0.12, TON: 5.2 }, sources: { fiat: { name: 'example rates' }, crypto: { name: 'example prices' } }, fetchedAt: now };
  // 90 days of example USD rates for the "convert now?" card.
  for (let i = 91; i >= 1; i -= 1) {
    const d = new Date(Date.now() - i * 86400000);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    recordRates(state.rates, iso, { ...state.rates.usd, MDL: Math.round((17.36 + 0.16 * Math.sin(i / 9) + 0.06 * Math.sin(i / 2.7)) * 1e4) / 1e4 });
  }
  try {
    const res = importRows(parseCSV(await (await fetch('sample.csv')).text()), state);
    state.tx.push(...res.tx);
  } catch {
    // No sample file: the preview just starts with this month.
  }
  const today = todayISO();
  const day = (n) => `${monthKey(today)}-${String(Math.max(1, Math.min(Number(today.slice(8, 10)), n))).padStart(2, '0')}`;
  const ana = M.ensurePerson(state, 'Ana', now);
  const mom = M.ensurePerson(state, 'Mom', now);
  const client = M.ensurePerson(state, 'US client', now);
  let t0 = now;
  const rec = (type, amount, d, category, note, account, extra = {}) => {
    const cur = M.account(state, account).currency;
    const rate = cur === 'MDL' ? 1 : 17.6;
    state.tx.push({ id: M.uid(), createdAt: t0, updatedAt: t0++, type, amount, currency: cur, rate, base: Math.round(amount * rate), date: day(d), category, note, account, ...extra });
  };
  rec('income', 120000, 1, 'side', 'website project', 'vb-usd', { person: client });
  rec('income', 380000, 1, 'work', 'salary', 'maib-visa');
  rec('expense', 12000, 2, 'food', 'groceries', 'maib-visa');
  rec('expense', 4500, 3, 'transport', 'taxi', 'maib-virt');
  rec('expense', 5000, 4, 'subscriptions', 'google one', 'maib-virt');
  rec('income', 50000, 5, 'family', 'birthday money', 'wallet', { person: mom });
  rec('expense', 30000, 6, 'other', 'lent for a phone repair', 'wallet', { person: ana, loan: true });
  rec('expense', 21000, 6, 'food', 'dinner out', 'maib-visa');
  rec('expense', 16000, 8, 'hygiene', 'shampoo and soap', 'wallet');
  rec('expense', 9900, 8, 'clothes', 'socks', 'maib-visa');
  for (const d of [2, 3, 6, 8]) rec('expense', 600, d, 'transport', 'bus', 'wallet');
  for (const d of [2, 5, 8]) rec('expense', 3500, d, 'food', 'coffee', 'maib-virt');
  state.tx.push({ id: M.uid(), createdAt: t0, updatedAt: t0++, type: 'transfer', amount: 266000, currency: 'MDL', rate: 1, base: 266000, date: day(1), from: 'maib-visa', to: 'safe', note: 'Deposit 70% · salary' });
  // Recurring: start last month; the ones already logged this month are done.
  const prev = addMonths(monthKey(today), -1);
  const thisDay = Number(today.slice(8, 10));
  const plan = (note, type, amount, account, category, d, extra = {}) => {
    const start = `${prev}-${String(d).padStart(2, '0')}`;
    const cur = M.account(state, account).currency;
    state.recurring.push({ id: M.uid(), createdAt: now, updatedAt: now, type, amount, currency: cur, account, category, note, every: 'month', start, lastDone: start, auto: false, paused: false, ...extra });
  };
  plan('salary', 'income', 380000, 'maib-visa', 'work', 1, { auto: true, lastDone: day(1) });
  plan('website retainer', 'income', 120000, 'vb-usd', 'side', 20, { person: client });
  plan('rent', 'expense', 450000, 'maib-visa', 'home', 25);
  plan('internet', 'expense', 15000, 'maib-virt', 'home', Math.max(1, Math.min(thisDay - 2, 28)));
  plan('google one', 'expense', 5000, 'maib-virt', 'subscriptions', 4, { auto: true, lastDone: day(4) });
  plan('gym', 'expense', 60000, 'wallet', 'sport', 15);
  plan('phone', 'expense', 12000, 'maib-visa', 'home', 12);
  // A US client with invoices: one paid (the website project above), one sent, one draft.
  Object.assign(M.person(state, client), { client: true, rate: 2500, currency: 'USD', address: 'Example Corp\n100 Main St, Austin TX' });
  const paidTx = state.tx.find((t) => t.person === client && t.type === 'income');
  const inv = (number, date, due, items, extra = {}) => state.invoices.push({ id: M.uid(), createdAt: now, updatedAt: now, number, client, date, due, currency: 'USD', items, note: '', sent: true, paidDate: null, paidTx: null, ...extra });
  inv('INV-2026-001', day(1), day(1), [{ desc: 'Website redesign', hours: 48, rate: 2500 }], { paidDate: paidTx.date, paidTx: paidTx.id });
  inv('INV-2026-002', day(5), `${addMonths(monthKey(today), 1)}-05`, [{ desc: 'Landing page', hours: 12, rate: 2500 }, { desc: 'Hosting (year)', amount: 9000 }]);
  inv('INV-2026-003', today, null, [{ desc: 'Maintenance', hours: 6, rate: 2500 }], { sent: false });
  state.settings.invoiceFrom = 'Your Name\nChișinău, Moldova\nyou@example.com';
  M.addRule(state, { match: 'linella', type: 'expense', category: 'food' }, now);
  M.addRule(state, { match: 'orange', type: 'expense', category: 'home' }, now);
  // Budgets for a few categories.
  for (const [id, lei] of [['food', 400], ['clothes', 300], ['hygiene', 250], ['transport', 300], ['fun', 800]]) M.category(state, id).budget = lei * 100;
  for (const [id, theme] of [['maib-visa', 'ocean'], ['maib-virt', 'plum'], ['maib-biz', 'graphite'], ['vb-usd', 'crimson'], ['wallet', 'emerald'], ['safe', 'gold'], ['binance', 'midnight']]) M.account(state, id).cardTheme = theme;
  state.goals = [
    { id: 'g-ef', name: 'Emergency fund', emoji: '🛟', target: 3000000, account: 'savings', saved: 0, history: [], deadline: null, doneAt: null, theme: 'teal', updatedAt: now },
    { id: 'g-car', name: 'Car', emoji: '🚗', target: 25000000, account: 'all', saved: 0, history: [], deadline: `${Number(today.slice(0, 4)) + 2}-06-01`, doneAt: null, theme: 'ocean', updatedAt: now },
    { id: 'g-trip', name: 'Trip to Italy', emoji: '✈️', target: 2500000, account: 'manual', saved: 1650000, history: [{ date: day(2), amount: 400000 }], deadline: `${Number(today.slice(0, 4)) + 1}-05-15`, doneAt: null, theme: 'sunset', updatedAt: now },
  ];
  state.settings.savingsAccount = 'safe';
  state.meta.demoSeeded = DEMO_VERSION;
  history.clear();
  commit({ quiet: true });
}

Spending.bindHover(app);
bindTilt(document);
requestPersistence();
if (!DEMO) Security.initLock();
route();
Updates.initUpdates();
Binance.initBinance();
Sync.initSync();
Backups.initBackups();
Plan.initPlan();
Telegram.initTelegram();
Motion.initMotion();
Calc.initCalc();
Buddy.initBuddy();

// One net-worth snapshot a day (crypto and rates of that day included).
function snapshotToday() {
  if (DEMO || state._sealed) return;
  if (M.takeSnapshot(state, todayISO())) { persist({ quiet: true }); Sync.changed(); }
}
setTimeout(snapshotToday, 5000);
setInterval(snapshotToday, 60 * 60000);

// Desktop: Ctrl+Alt+N from any app brings this window up with a new record.
if (window.desktop?.onQuickAdd) {
  window.desktop.onQuickAdd(() => {
    if (Security.isLocked()) return;
    closeSheet();
    openTxSheet();
  });
  window.desktop.hotkey?.().then((h) => {
    const keys = document.querySelector('.tabbar .keys p');
    if (h?.ok && keys) keys.insertAdjacentHTML('beforeend', `<br>${h.key.split('+').map((k) => `<kbd>${k}</kbd>`).join('')} from anywhere`);
  }).catch(() => {});
}

document.addEventListener('submit', (e) => {
  if (e.target.closest('.sheet') || !e.target.id) return;
  if (e.target.id === 'bn-form') { e.preventDefault(); Binance.onSubmit(e.target); }
  if (e.target.id === 'sync-form') { e.preventDefault(); Sync.onSubmit(e.target); }
  if (['tg-form', 'tg-relay-form', 'tg-server-form'].includes(e.target.id)) { e.preventDefault(); Telegram.onSubmit(e.target); }
});
seedDemo();
updateRates();
setInterval(() => updateRates(), 30 * 60000);
window.addEventListener('online', () => updateRates({ force: true }));
