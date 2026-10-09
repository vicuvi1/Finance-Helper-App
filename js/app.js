// The app: screens, the add/edit sheet, import and backup. All numbers come
// from model.js; this file only turns them into HTML and handles taps.

import { load, save, backupText, restoreJSON, requestPersistence, isSealed, openImported, wipeStore, hasSession, reopen, STORAGE_KEYS } from './store.js';
import * as M from './model.js';
import { formatMoney, evalAmount, centsToPlain } from './money.js';
import { todayISO, monthKey, monthLabel, addMonths, dayLabel } from './dates.js';
import { convert, pairRate } from './fx.js';
import { parseCSV, toCSV } from './csv.js';
import { importRows, importWorkbook, exportRows, toTSV, monthSheet, overviewSheet } from './importer.js';
import { readWorkbook } from './xlsx-read.js';
import { workbook } from './xlsx.js';
import { refreshRates } from './rates.js';
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
import { FREQS, markDone } from './recurring.js';
import { tableHTML, calendarHTML } from './logviews.js';
import { dailyChart } from './charts.js';

let state = load();
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

function persist() {
  if (!save(state)) toast('Could not save. Is your browser storage full or blocked?');
}

function commit() {
  persist();
  render();
  Sync.changed();
}

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'dark' || t === 'light') {
    document.documentElement.dataset.theme = t;
    ownTheme = true;
  } else if (ownTheme) {
    delete document.documentElement.dataset.theme;
    ownTheme = false;
  }
}

// ---------- Shared pieces ----------

function monthSwitch() {
  const isNow = ui.month >= monthKey(todayISO());
  return `<div class="month-switch">
    <button class="icon-btn" data-act="month" data-step="-1" aria-label="Previous month">‹</button>
    <b>${monthLabel(ui.month)}</b>
    <button class="icon-btn" data-act="month" data-step="1" aria-label="Next month" ${isNow ? 'disabled' : ''}>›</button>
  </div>`;
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
    amount = `<span class="amount ${t.type === 'income' ? 'income' : ''}">${t.loan ? '<span class="pill">loan</span> ' : ''}${t.type === 'income' ? fm(t.amount, { sign: true }) : fm(-t.amount)}</span>`;
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
    <div class="row"><span>Kept <b class="${good ? 'income' : 'expense'}">${pct(summary.savingsRate)}</b> of income</span><span class="muted">target ${target}%</span></div>
    <div class="bar ${good ? '' : 'over'}"><i style="width:${(r * 100).toFixed(1)}%"></i><span class="mark" style="left:${target}%"></span></div>
  </div>`;
}

function stats(s, key = 'm') {
  return `<div class="stats">
    <div class="stat"><span class="k">Earned</span><b class="income">${countUp(s.income, `${key}-in`)}</b></div>
    <div class="stat"><span class="k">Spent</span><b class="expense">${countUp(s.expense, `${key}-out`)}</b></div>
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

function goalCard() {
  const today = todayISO();
  const g = M.goalStatus(state, today);
  const goal = state.settings.goal;
  const where = goal.account === 'all' ? 'all my money' : accOf(goal.account).name;
  let line;
  if (!g.target) line = 'Set a goal in Settings.';
  else if (g.monthsLeft === 0) line = 'Goal reached. Time to set a bigger one.';
  else if (g.eta) line = `At ${money(g.pace)}/month you reach it in <b>${monthLabel(g.eta)}</b> (${g.monthsLeft} month${g.monthsLeft === 1 ? '' : 's'}). Save ${money(Math.ceil(g.remaining / Math.max(1, g.monthsLeft - 1) / 100) * 100)}/month to get there a month sooner.`;
  else if (g.pace != null && g.pace < 0) line = `This went down by ${money(-g.pace)}/month lately. Keep more than you spend and I'll predict when you get there.`;
  else line = 'Log a month of income and spending and I\'ll predict when you get there.';
  return `<section class="card goal"><h2>${esc(goal.name)} <span class="right muted">${esc(where)}</span></h2>
    <div class="row"><b class="money">${countUp(Math.round(g.current / 100) * 100, 'goal')}</b><span class="muted money">of ${money(g.target)} · ${Math.round(g.ratio * 100)}%</span></div>
    <div class="bar gold"><i style="width:${(g.ratio * 100).toFixed(1)}%"></i></div>
    <p>${line}</p></section>`;
}

// ---------- Screens ----------

function viewHome() {
  const today = todayISO();
  const key = monthKey(today);
  const values = M.accountValues(state).filter((v) => !v.account.archived);
  const { total, missing } = M.totalBalance(state);
  const s = M.monthSummary(state, key);
  const recent = M.sortTx(state.tx).slice(0, 5);
  const tips = M.insights(state, key, today).filter((t) => t.level !== 'info').slice(0, 2);
  const hour = new Date().getHours();
  const hello = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const needsBackup = state.tx.length >= 20
    && (!state.meta.lastBackup || Date.now() - state.meta.lastBackup > 14 * 864e5);

  const welcome = state.tx.length ? '' : `<section class="card">
    <h2>Start here</h2>
    <p style="margin-top:0">Every lei you log is a lei you control. Tap <b>+</b> for each thing you buy or earn. It takes 5 seconds.</p>
    <div class="btns">
      <button class="btn primary" data-act="add">Log the first one</button>
      <button class="btn" data-act="import-csv">Import my Google Sheet</button>
    </div>
    <p class="muted small" style="margin-bottom:0">Already have money in the wallet or safe? Set it under Settings → Accounts.</p>
  </section>`;

  const days = [];
  const dim = Number(today.slice(8, 10));
  for (let d = 1; d <= new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).getUTCDate(); d++) {
    const iso = `${key}-${String(d).padStart(2, '0')}`;
    days.push({ day: d, iso, amount: s.expenses.filter((t) => t.date === iso).reduce((a, t) => a + t.amount, 0), future: d > dim });
  }
  const perDay = dim ? Math.round(s.expense / dim) : 0;

  return `<header class="top"><div><h1>${hello}</h1><div class="sub">${dayLabel(today)}</div></div></header>
  ${Updates.updateBanner()}
  ${DEMO ? '<div class="banner"><p>Live preview with <b>example data</b> (a made-up month). What you add here stays in this browser only.</p></div>' : ''}
  ${!DEMO && needsBackup ? `<div class="banner"><p>Your data lives only on this device. Make a backup.</p><button class="btn primary" data-act="export-json">Back up</button></div>` : ''}
  ${welcome}
  <section class="hero">
    <div class="hero-main">
      <div class="label">All my money</div>
      <div class="big ${total < 0 ? 'expense' : ''}">${bigMoney(total)}</div>
      <div class="accounts">
        ${values.map(({ account: a, own, coins }) => `<button class="acc ${own < 0 ? 'neg' : ''}" data-act="acc-open" data-id="${esc(a.id)}" title="Open ${esc(a.name)}"><span class="n">${dot(`var(--c${a.color || 1})`)}${esc(a.name)}</span><b class="money">${a.kind === 'crypto' && (a.holdings || []).length ? money(coins + (convert(own, a.currency, state.settings.currency, state.rates) || 0)) : formatMoney(own, a.currency)}</b></button>`).join('')}
      </div>
      ${missing.length ? `<p class="muted small" style="margin:10px 0 0">Not counted yet (no exchange rate): ${missing.map((v) => esc(v.account.name)).join(', ')}.</p>` : ''}
    </div>
    <div class="hero-month">
      <div class="label">${monthLabel(key)}</div>
      ${stats(s)}${rateBar(s)}
    </div>
  </section>
  <div class="dash">
    <div class="dash-main">
      ${Spending.spendingCard({ period: ui.spendPeriod })}
      <section class="card"><h2>Spending this month <span class="right muted">${money(perDay)} a day on average</span></h2>
        ${dailyChart(days, (c) => money(c))}</section>
      ${recent.length ? `<section class="card"><h2>Recent <button class="card-link right" data-go="log">Open log</button></h2><div class="list">${recent.map((t) => txRow(t, { showDate: true })).join('')}</div></section>` : ''}
    </div>
    <div class="dash-side">
      ${Plan.homeCard()}
      ${goalCard()}
      ${tips.length ? `<section class="card"><h2>Heads up <button class="card-link right" data-go="reports">Reports</button></h2>${tips.map(tipCard).join('')}</section>` : ''}
      ${jarsCard(key)}
    </div>
  </div>`;
}

function logView() {
  return state.settings.logView || (window.innerWidth >= 720 ? 'table' : 'list');
}

function logRecords() {
  const q = ui.search.trim().toLowerCase();
  let list = q
    ? state.tx.filter((t) => {
      const hay = [t.note, catOf(t.category).name, t.type === 'transfer' ? `${accOf(t.from).name} ${accOf(t.to).name}` : accOf(t.account).name, centsToPlain(t.amount)].join(' ').toLowerCase();
      return hay.includes(q);
    })
    : M.txInMonth(state, ui.month);
  if (ui.filter !== 'all') list = list.filter((t) => t.type === ui.filter);
  return list;
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
  if (view === 'calendar') {
    content = `<section class="card">${calendarHTML(state, ui.month)}</section>`;
  } else if (view === 'table') {
    content = tableHTML(state, list, { sort: ui.sort, draft: draftRow(), fmt: (c) => money(c) })
      + `<datalist id="people-list">${state.people.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>`;
  } else {
    const groups = new Map();
    for (const t of M.sortTx(list)) {
      if (!groups.has(t.date)) groups.set(t.date, []);
      groups.get(t.date).push(t);
    }
    content = [...groups.entries()].map(([date, items]) => {
      const net = items.reduce((a, t) => a + (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0), 0);
      return `<div class="day"><div class="day-head"><span>${dayLabel(date)}${q ? ` ${date.slice(0, 4)}` : ''}</span><span class="money ${net > 0 ? 'income' : ''}">${net ? money(net, { sign: true }) : ''}</span></div>
        <div class="list">${items.map((t) => txRow(t)).join('')}</div></div>`;
    }).join('') || `<div class="empty"><b>${q ? 'Nothing found' : 'No records this month'}</b>${q ? 'Try another word.' : 'Tap + to add one.'}</div>`;
  }

  const chip = (id, label) => `<button class="chip" data-act="filter" data-filter="${id}" aria-pressed="${ui.filter === id}">${label}</button>`;
  const viewBtn = (id, label) => `<button type="button" data-act="log-view" data-view="${id}" aria-pressed="${view === id}">${label}</button>`;
  return `<header class="top"><h1>Log</h1>${monthSwitch()}</header>
  ${q ? '' : `<section class="card">${stats(s)}${rateBar(s)}</section>`}
  <div class="log-tools">
    <div class="seg seg-views" role="group" aria-label="View">${viewBtn('table', 'Table')}${viewBtn('calendar', 'Calendar')}${viewBtn('list', 'List')}</div>
    ${view === 'calendar' ? '' : `<input type="search" id="search" placeholder="Search notes, categories, amounts" value="${esc(ui.search)}" aria-label="Search all records">`}
    <div class="log-actions">
      <button type="button" class="btn" data-act="copy-table" title="Copy this month as a table to paste into Excel or Google Sheets">Copy table</button>
      <button type="button" class="btn" data-act="export-month" title="Download this month as a file Excel opens">Export month</button>
    </div>
  </div>
  ${view === 'calendar' ? '' : `<div class="chips">${chip('all', 'All')}${chip('expense', 'Spent')}${chip('income', 'Earned')}${chip('transfer', 'Moves')}</div>`}
  ${q && view !== 'calendar' ? `<p class="muted small">${list.length} result${list.length === 1 ? '' : 's'} in all months</p>` : ''}
  ${content}
  ${view === 'table' ? '<p class="muted small">Edit any cell; it saves by itself. <b>Enter</b> moves down a row. Paste rows copied from Excel or Google Sheets anywhere on this page to import them.</p>' : ''}`;
}

function viewSettings() {
  const st = state.settings;
  const accOptions = (sel, withAll) => (withAll ? `<option value="all" ${sel === 'all' ? 'selected' : ''}>All my money</option>` : '')
    + st.accounts.map((a) => `<option value="${esc(a.id)}" ${sel === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const jarOptions = (sel) => st.jars.filter((j) => !j.savings).map((j) => `<option value="${esc(j.id)}" ${sel === j.id ? 'selected' : ''}>${esc(j.name)}</option>`).join('');
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

  return `<header class="top"><h1>Settings</h1></header>
  ${installPrompt ? '<div class="banner"><p>Install the app for one-tap access, even offline.</p><button class="btn primary" data-act="install">Install</button></div>' : ''}
  ${isIOS ? '<div class="banner"><p>To install on iPhone: tap Share, then “Add to Home Screen”.</p></div>' : ''}

  <section class="card"><h2>Goal</h2>
    <label class="field"><span>Name</span><input type="text" data-set="goal.name" value="${esc(st.goal.name)}"></label>
    <div class="row2">
      <label class="field"><span>Target (${esc(st.currency)})</span><input type="text" inputmode="decimal" data-set="goal.target" value="${centsToPlain(st.goal.target)}"></label>
      <label class="field"><span>Counts</span><select data-set="goal.account">${accOptions(st.goal.account, true)}</select></label>
    </div>
  </section>

  <section class="card"><h2>Smart split <span class="right" id="jar-sum"></span></h2>
    <p class="muted small" style="margin-top:0">Every income is split like this. Spending is checked against each jar.</p>
    ${st.jars.map((j) => `<div class="set-row">
      <input type="text" value="${esc(j.name)}" data-jar="${esc(j.id)}" data-field="label" aria-label="Jar name">
      <label style="display:flex;align-items:center;gap:6px"><input type="number" class="pct" min="0" max="100" step="1" value="${j.pct}" data-jar="${esc(j.id)}" data-field="pct" aria-label="Percent for ${esc(j.name)}">%</label>
    </div>`).join('')}
  </section>

  <section class="card"><h2>Accounts</h2>
    <p class="muted small" style="margin-top:0">Cards, cash, banks, currencies and crypto are managed on the Accounts screen.</p>
    <button class="btn block" data-go="accounts">Open Accounts</button>
    <label class="field" style="margin:12px 0 0"><span>The "move to savings" button sends money to</span><select data-set="savingsAccount">${accOptions(st.savingsAccount, false)}</select></label>
  </section>

  <details class="card"><summary>Categories</summary>
    <p class="muted small" style="margin-top:0">Spending: pick which jar it comes from.</p>
    ${st.categories.filter((c) => c.type === 'expense').map(catRow).join('')}
    <p class="muted small">Income sources</p>
    ${st.categories.filter((c) => c.type === 'income').map(catRow).join('')}
    <div class="btns" style="margin-top:10px">
      <button class="btn" data-act="add-cat" data-type="expense">+ Spending category</button>
      <button class="btn" data-act="add-cat" data-type="income">+ Income source</button>
    </div>
  </details>

  <section class="card"><h2>Your data</h2>
    <p class="muted small" style="margin-top:0">${state.tx.length} records, saved only on this device. Last backup: ${esc(lastBackup)}.</p>
    <div class="btns">
      <button class="btn primary" data-act="export-json">Back up</button>
      <button class="btn" data-act="import-json">Restore backup</button>
    </div>
    <div class="btns" style="margin-top:8px">
      <button class="btn" data-act="import-csv">Import Excel / Google Sheet</button>
      <button class="btn" data-act="export-xlsx">Export to Excel</button>
    </div>
    <div class="btns" style="margin-top:8px">
      <button class="btn" data-act="export-csv">Export CSV</button>
    </div>
    <p class="muted small" style="margin-bottom:0">From Google Sheets: File → Download → <b>Microsoft Excel (.xlsx)</b> and import the whole file: every month tab at once, you pick which. A single tab as .csv works too. Importing the same month twice is safe.</p>
  </section>

  <section class="card"><h2>Look</h2>
    <div class="row2">
      <label class="field"><span>Theme</span><select data-set="theme">
        ${['system', 'dark', 'light'].map((t) => `<option value="${t}" ${st.theme === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}
      </select></label>
      <label class="field"><span>Currency</span><input type="text" data-set="currency" value="${esc(st.currency)}" maxlength="5"></label>
    </div>
  </section>

  ${Sync.settingsCard()}
  ${Backups.settingsCard()}
  ${Binance.settingsCard()}
  ${Security.settingsCard()}
  ${Updates.settingsCard()}
  ${SelfCheck.settingsCard()}

  <section class="card"><h2>Danger zone</h2>
    <button class="btn danger block" data-act="wipe">Erase everything on this device</button>
  </section>
  <p class="muted small" style="text-align:center">Finance Helper · private, offline, no account, no tracking.</p>`;
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
  applyTheme();
  app.className = `app view-${ui.tab}`;
  app.innerHTML = (SCREENS[ui.tab] || SCREENS.home).view();
  if (enter) {
    shownCounts.clear();
    playEnter();
  }
  runCounters(enter);
  if (ui.flashId) {
    app.querySelector(`[data-id="${CSS.escape(ui.flashId)}"]`)?.classList.add('flash');
    ui.flashId = null;
  }
  for (const a of document.querySelectorAll('.tabbar a, .more-list a')) {
    if (a.dataset.tab === ui.tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (ui.tab === 'settings') updateJarSum();
}

// ---------- Bottom sheet ----------

function openSheet(html, onMount) {
  sheetRoot.innerHTML = '';
  sheetRoot.innerHTML = `<div class="sheet-backdrop" data-close><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  const sheet = sheetRoot.querySelector('.sheet');
  document.body.style.overflow = 'hidden';
  onMount?.(sheet);
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

  const curOf = () => M.account(state, draft.type === 'transfer' ? draft.from : draft.account)?.currency || baseCur;
  const toCur = () => M.account(state, draft.to)?.currency || baseCur;

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
      <div class="seg" role="group" aria-label="Type">${segBtn('expense', 'Spent')}${segBtn('income', 'Earned')}${segBtn('transfer', 'Move')}</div>
      <div class="amount-input"><input id="tx-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(amountText)}" aria-label="Amount in ${cur}"><span class="cur">${esc(cur)}</span></div>
      <div class="calc-hint" id="calc-hint">${isT ? 'Move money between your accounts' : 'Tip: type 120+45 and it adds up'}</div>
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
        <label class="field"><span>Repeat</span><select id="tx-repeat"><option value="">No</option>${FREQS.map((f) => `<option value="${f.id}" ${draft.repeat === f.id ? 'selected' : ''}>${f.label}</option>`).join('')}</select></label></div>`
    : `<label class="field"><span>Date</span><input id="tx-date" type="date" value="${esc(draft.date)}"></label>`}
      <div class="btns">
        ${existing ? '<button type="button" class="btn danger" data-act="tx-delete">Delete</button>' : ''}
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
    const v = evalAmount(raw);
    const cur = curOf();
    const parts = [];
    if (/[+\-*/x×÷()]/i.test(raw.slice(1))) parts.push(v != null && v > 0 ? `= ${formatMoney(v, cur)}` : '…');
    const rate = Number(String(sheet.querySelector('#tx-rate')?.value || '').replace(',', '.'));
    if (v > 0 && cur !== baseCur && draft.type !== 'transfer' && rate > 0) parts.push(`≈ ${money(Math.round(v * rate))}`);
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
    sheet.querySelector('#tx-to-amount')?.addEventListener('input', () => { toTouched = true; });
    for (const f of ['account', 'from', 'to']) {
      sheet.querySelector(`#tx-${f}`)?.addEventListener('change', () => {
        const before = curOf();
        const beforeTo = draft.type === 'transfer' ? toCur() : null;
        readInputs(sheet);
        // Currency changed: repaint so the currency label and rate line follow.
        if (curOf() !== before || (beforeTo && toCur() !== beforeTo)) { rateText = ''; toTouched = false; paint(sheet, false); updateHint(sheet); }
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
      const personId = M.ensurePerson(state, draft.personName, now);
      tx = {
        ...common,
        account: draft.account,
        category: draft.category || (draft.type === 'income' ? 'other-in' : 'other'),
        rate,
        base: Math.round(amount * rate),
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
    if (!existing && draft.repeat && tx.type !== 'transfer') { toast(`Added, and it repeats ${FREQS.find((f) => f.id === draft.repeat).short}. See Plan.`); return; }
    const alert = !existing && M.budgetAlert(state, tx);
    if (alert) { toast(alert.text); return; }
    if (!existing && tx.type === 'income' && !tx.loan) openSplitSheet(tx);
    else toast(existing ? 'Saved' : `${tx.type === 'expense' ? 'Spent' : tx.type === 'income' ? 'Earned' : 'Moved'} ${formatMoney(tx.amount, tx.currency)}`);
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
      if (e.target.closest('[data-act="tx-delete"]')) deleteTx(existing.id);
    });
    paint(sheet);
  });
}

function openSplitSheet(tx) {
  const parts = M.splitIncome(state, tx.amount);
  const sj = M.savingsJar(state);
  const target = state.settings.savingsAccount;
  const save = parts.find((p) => p.jar.id === sj?.id)?.amount || 0;
  const from = M.account(state, tx.account);
  const to = M.account(state, target);
  const arrives = to && from ? convert(save, from.currency, to.currency, state.rates) : null;
  const canMove = to && target !== tx.account && save > 0 && arrives != null;
  const fm = (c) => formatMoney(c, tx.currency);
  openSheet(`<h3>Split ${fm(tx.amount)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <div>${parts.map((p) => `<div class="split-row"><span>${dot(jarColor(p.jar))}${esc(p.jar.name)} <span class="muted">${p.jar.pct}%</span></span><b class="money ${p.jar.savings ? 'income' : ''}">${fm(p.amount)}</b></div>`).join('')}</div>
    <div class="btns" style="margin-top:14px">
      ${canMove ? `<button class="btn primary" data-act="move-savings">Move ${fm(save)} to ${esc(to.name)}</button>` : ''}
      <button class="btn" data-close>Done</button>
    </div>`, (sheet) => {
    sheet.querySelector('[data-act="move-savings"]')?.addEventListener('click', () => {
      const now = Date.now();
      state.tx.push({
        id: M.uid(), createdAt: now, updatedAt: now, type: 'transfer', amount: save, currency: from.currency,
        ...(from.currency !== to.currency ? { toAmount: arrives } : {}),
        rate: tx.rate || 1, base: Math.round(save * (tx.rate || 1)),
        date: tx.date, from: tx.account, to: target, note: `Deposit ${sj.pct}%${tx.note ? ` · ${tx.note}` : ''}`,
      });
      commit();
      closeSheet();
      toast(`${fm(save)} is in ${to.name}. Don't touch it.`);
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
  toast('Deleted', 'Undo', () => {
    M.restoreTx(state, removed);
    commit();
  });
}

function toast(text, actionLabel, action) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(text)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}`;
  el.hidden = false;
  if (actionLabel) {
    el.querySelector('button').onclick = () => {
      el.hidden = true;
      action();
    };
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, actionLabel ? 6000 : 2600);
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
    t.account = v;
    // Moved to an account in another currency: the amount is now in that
    // currency, priced at today's rate (or the last one used).
    const cur = M.account(state, v)?.currency || state.settings.currency;
    if (cur !== t.currency) {
      t.currency = cur;
      t.rate = suggestedRate(cur) || t.rate || 1;
      t.base = Math.round(t.amount * t.rate);
    }
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
    const rows = [...document.querySelectorAll('#tx-table tbody tr')];
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

async function onCSVFile(text) {
  if (text == null) return;
  const res = importRows(parseCSV(text), state);
  if (!res.tx.length) {
    toast(res.duplicates ? `Already imported (${res.duplicates} records).` : 'No records found. Rows need a date and an amount.');
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
    });
  });
}

// A whole .xlsx: one line per tab with what it holds; untick tabs to skip.
async function onWorkbookFile(buf) {
  const sheets = await readWorkbook(buf);
  const res = importWorkbook(sheets, state);
  const tabs = res.sheets;
  const useful = tabs.filter((t) => t.tx.length);
  if (!useful.length) {
    const dup = tabs.reduce((a, t) => a + (t.duplicates || 0), 0);
    toast(dup ? `Already imported (${dup} records).` : 'No records found in this file. Rows need a date and an amount.');
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
      const picked = [...sheet.querySelectorAll('[data-tab-i]:checked')].flatMap((el) => tabs[el.dataset.tabI].tx);
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
    else if (key === 'currency') st.currency = v.trim().toUpperCase() || 'MDL';
    if (key !== 'theme') st.updatedAt = Date.now();
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
  else if (act === 'month') { ui.month = addMonths(ui.month, Number(el.dataset.step)); render({ enter: true }); }
  else if (act === 'year') { ui.year += Number(el.dataset.step); render({ enter: true }); }
  else if (act === 'open-month') { ui.month = el.dataset.key; ui.search = ''; location.hash = '#log'; }
  else if (act === 'filter') { ui.filter = el.dataset.filter; render(); }
  else if (act === 'log-view') { state.settings.logView = el.dataset.view; commit(); }
  else if (act === 'sort') {
    const col = el.dataset.col;
    ui.sort = { col, dir: ui.sort.col === col ? -ui.sort.dir : 1 };
    render();
  } else if (act === 'row-del') deleteTx(el.dataset.id);
  else if (act === 'row-add') addDraftRow();
  else if (act === 'day') openDaySheet(el.dataset.date);
  else if (act === 'copy-table') copyTable();
  else if (act === 'export-month') exportMonthExcel();
  else if (act === 'export-xlsx') exportExcel();
  else if (act === 'export-json') exportJSON();
  else if (act === 'export-csv') exportCSV();
  else if (act === 'import-csv') document.getElementById('file-csv').click();
  else if (act === 'import-json') document.getElementById('file-json').click();
  else if (act === 'install') installPrompt?.prompt().finally(() => { installPrompt = null; render(); });
  else if (act === 'add-cat') {
    const type = el.dataset.type;
    state.settings.categories.push({ id: `c-${M.uid()}`, type, name: type === 'income' ? 'New source' : 'New category', emoji: '', updatedAt: Date.now(), ...(type === 'expense' ? { jar: state.settings.jars.find((j) => !j.savings)?.id } : {}) });
    commit();
    document.querySelector('details.card')?.setAttribute('open', '');
  } else if (act === 'del-cat') {
    state.settings.categories = state.settings.categories.filter((c) => c.id !== el.dataset.id);
    state.deleted[el.dataset.id] = Date.now();
    commit();
    document.querySelector('details.card')?.setAttribute('open', '');
  } else if (act === 'wipe') openWipeSheet();
});

document.addEventListener('change', (e) => {
  if (e.target.closest('.sheet')) return;
  if (SCREENS[ui.tab]?.onChange?.(e.target)) return;
  if (e.target.closest('#tx-table')) onCellChange(e.target);
  else if (e.target.id === 'file-csv') {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (/\.xlsx$/i.test(file.name)) file.arrayBuffer().then(onWorkbookFile).catch((err) => toast(err.message));
    else file.text().then(onCSVFile);
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

// Desktop shortcuts: N = new record, / = search, 1-8 = sections, Esc = close.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetRoot.firstChild) { closeSheet(); return; }
  if (e.key === 'Enter' && e.target.closest('#tx-table') && e.target.matches('input')) {
    e.preventDefault();
    onTableEnter(e.target);
    return;
  }
  if (Security.isLocked()) return;
  if (e.ctrlKey || e.metaKey || e.altKey || sheetRoot.firstChild) return;
  if (e.target.closest('input, select, textarea')) return;
  if ((e.key === 'l' || e.key === 'L') && Security.hasLock()) { Security.lock(); return; }
  const tabs = { 1: 'home', 2: 'log', 3: 'accounts', 4: 'plan', 5: 'people', 6: 'reports', 7: 'rates', 8: 'settings' };
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openTxSheet(); }
  else if (e.key === '/') {
    e.preventDefault();
    if (ui.tab !== 'log') location.hash = '#log';
    setTimeout(() => document.getElementById('search')?.focus(), 0);
  } else if (tabs[e.key]) location.hash = `#${tabs[e.key]}`;
});

// ---------- Screens ----------

const SCREENS = {
  home: { view: viewHome, onClick: (a, el) => Plan.onClick(a, el) },
  log: { view: viewLog },
  accounts: AccountsScreen,
  plan: Plan,
  people: PeopleScreen,
  reports: ReportsScreen,
  rates: RatesScreen,
  settings: { view: viewSettings, onClick: (a, el) => Security.onClick(a, el) || Binance.onClick(a) || Sync.onClick(a) || SelfCheck.onClick(a) || Backups.onClick(a, el) || (a.startsWith('update-') && (Updates.onClick(a), true)), onChange: Security.onChange },
};

function openMoreSheet() {
  const item = (tab, label, sub) => `<a href="#${tab}" class="tx more-item"><span class="t"><b>${label}</b><span>${sub}</span></span><span class="muted">›</span></a>`;
  openSheet(`<h3>More <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <div class="list more-list">
      ${item('plan', 'Plan', 'Budgets, bills, subscriptions, regular income')}
      ${item('people', 'People', 'Who gave you money, who you gave to, loans')}
      ${item('reports', 'Reports', 'Any month, quarter, year or your own dates')}
      ${item('rates', 'Rates & converter', 'Live exchange rates and crypto prices')}
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
  // Sync brings in a merged copy of the data.
  replaceState: (next) => { state = next; persist(); },
  // Swap the data in memory without saving (lock / unlock with encryption).
  setState: (next) => { state = next; },
  // After unlocking encrypted data: catch up on what waited for it.
  afterUnlock: () => {
    applyTheme();
    updateRates();
    Sync.refreshConnected().then((on) => on && Sync.syncNow());
    Binance.syncBinance();
    Plan.runAuto();
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
  ui.tab = tab in SCREENS ? tab : 'home';
  closeSheet();
  render({ enter: true });
  window.scrollTo(0, 0);
  // "Add a record" shortcut from the home-screen icon.
  if (tab === 'add') {
    history.replaceState(null, '', '#home');
    openTxSheet();
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
const DEMO_VERSION = 4;

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
  // Budgets for a few categories.
  for (const [id, lei] of [['food', 400], ['clothes', 300], ['hygiene', 250], ['transport', 300], ['fun', 800]]) M.category(state, id).budget = lei * 100;
  state.settings.savingsAccount = 'safe';
  state.meta.demoSeeded = DEMO_VERSION;
  commit();
}

Spending.bindHover(app);
requestPersistence();
if (!DEMO) Security.initLock();
route();
Updates.initUpdates();
Binance.initBinance();
Sync.initSync();
Backups.initBackups();
Plan.initPlan();

document.addEventListener('submit', (e) => {
  if (e.target.closest('.sheet') || !e.target.id) return;
  if (e.target.id === 'bn-form') { e.preventDefault(); Binance.onSubmit(e.target); }
  if (e.target.id === 'sync-form') { e.preventDefault(); Sync.onSubmit(e.target); }
});
seedDemo();
updateRates();
setInterval(() => updateRates(), 30 * 60000);
window.addEventListener('online', () => updateRates({ force: true }));
