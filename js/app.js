// The app: screens, the add/edit sheet, import and backup. All numbers come
// from model.js; this file only turns them into HTML and handles taps.

import { load, save, backupJSON, restoreJSON, requestPersistence } from './store.js';
import * as M from './model.js';
import { formatMoney, evalAmount, centsToPlain } from './money.js';
import { todayISO, monthKey, monthLabel, addMonths, dayLabel } from './dates.js';
import { parseCSV, toCSV } from './csv.js';
import { importRows, exportRows } from './importer.js';
import { trendChart } from './charts.js';

let state = load();
const ui = {
  tab: 'home',
  month: monthKey(todayISO()),
  year: Number(todayISO().slice(0, 4)),
  filter: 'all',
  search: '',
};
let installPrompt = null;
let toastTimer = null;

const app = document.getElementById('app');
const sheetRoot = document.getElementById('sheet-root');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c, opts) => formatMoney(c, state.settings.currency, opts);
const pct = (r) => (r == null ? '–' : `${Math.round(r * 100)}%`);
const catOf = (id) => M.category(state, id) || { name: 'Unknown', emoji: '❔' };
const accOf = (id) => M.account(state, id) || { name: 'Unknown', emoji: '❔' };

function persist() {
  if (!save(state)) toast('Could not save. Is your browser storage full or blocked?');
}

function commit() {
  persist();
  render();
}

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
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
  let emoji;
  let title;
  let sub;
  let amount;
  if (t.type === 'transfer') {
    emoji = '↔️';
    title = t.note || `To ${accOf(t.to).name}`;
    sub = `${accOf(t.from).name} → ${accOf(t.to).name}`;
    amount = `<span class="amount">${money(t.amount)}</span>`;
  } else {
    const c = catOf(t.category);
    emoji = c.emoji;
    title = t.note || c.name;
    sub = `${c.name} · ${accOf(t.account).name}`;
    amount = t.type === 'income'
      ? `<span class="amount income">${money(t.amount, { sign: true })}</span>`
      : `<span class="amount">${money(-t.amount)}</span>`;
  }
  if (showDate) sub = `${dayLabel(t.date)} · ${sub}`;
  return `<button class="tx" data-act="edit" data-id="${esc(t.id)}">
    <span class="e" aria-hidden="true">${esc(emoji)}</span>
    <span class="t"><b>${esc(title)}</b><span>${esc(sub)}</span></span>
    ${amount}
  </button>`;
}

function tipCard(t) {
  return `<div class="tip ${t.level}"><span class="i" aria-hidden="true">${esc(t.icon)}</span>
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

function stats(s) {
  return `<div class="stats">
    <div class="stat"><span class="k">Earned</span><b class="income">${money(s.income)}</b></div>
    <div class="stat"><span class="k">Spent</span><b class="expense">${money(s.expense)}</b></div>
    <div class="stat"><span class="k">Kept</span><b>${money(s.net)}</b></div>
  </div>`;
}

function jarsCard(key) {
  const rows = M.jarStatus(state, key);
  const income = M.monthSummary(state, key).income;
  const body = rows.map((j) => {
    if (j.savings) {
      const r = j.budget ? Math.min(1, j.used / j.budget) : 0;
      return `<div class="jar">
        <div class="row"><span>${esc(j.jar.emoji)} ${esc(j.jar.name)} <span class="muted">${j.jar.pct}%</span></span><span class="money">${money(j.used)}</span></div>
        <div class="bar"><i style="width:${(r * 100).toFixed(1)}%"></i></div>
        <div class="foot">${j.left >= 0 ? `Plan ${money(j.budget)} reached ✓` : `Plan ${money(j.budget)}, ${money(-j.left)} to go`}</div>
      </div>`;
    }
    const over = j.used > j.budget;
    const r = j.budget ? Math.min(1, j.used / j.budget) : j.used ? 1 : 0;
    return `<div class="jar">
      <div class="row"><span>${esc(j.jar.emoji)} ${esc(j.jar.name)} <span class="muted">${j.jar.pct}%</span></span><span class="money">${money(j.used)} <span class="muted">/ ${money(j.budget, { compact: true })}</span></span></div>
      <div class="bar ${over ? 'over' : 'gold'}"><i style="width:${(r * 100).toFixed(1)}%"></i></div>
      <div class="foot ${over ? 'bad' : ''}">${over ? `Over by ${money(j.used - j.budget)}` : `${money(j.left)} left`}</div>
    </div>`;
  }).join('');
  return `<section class="card"><h2>Smart split · ${monthLabel(key, true)}</h2>
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
  else if (g.monthsLeft === 0) line = '🎉 Goal reached. Time to set a bigger one.';
  else if (g.eta) line = `At ${money(g.pace)}/month you reach it in <b>${monthLabel(g.eta)}</b> (${g.monthsLeft} month${g.monthsLeft === 1 ? '' : 's'}). Save ${money(Math.ceil(g.remaining / Math.max(1, g.monthsLeft - 1)))}/month to get there a month sooner.`;
  else if (g.pace != null && g.pace < 0) line = `This went down by ${money(-g.pace)}/month lately. Keep more than you spend and I'll predict when you get there.`;
  else line = 'Log a month of income and spending and I\'ll predict when you get there.';
  return `<section class="card goal"><h2>🎯 ${esc(goal.name)} <span class="right muted">${esc(where)}</span></h2>
    <div class="row"><b class="money">${money(g.current)}</b><span class="muted money">of ${money(g.target)}</span></div>
    <div class="bar gold"><i style="width:${(g.ratio * 100).toFixed(1)}%"></i></div>
    <p>${line}</p></section>`;
}

// ---------- Screens ----------

function viewHome() {
  const today = todayISO();
  const key = monthKey(today);
  const bal = M.accountBalances(state);
  const total = Object.values(bal).reduce((a, b) => a + b, 0);
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

  return `<header class="top"><div><h1>${hello}</h1><div class="sub">${dayLabel(today)}</div></div></header>
  ${needsBackup ? `<div class="banner"><p>💾 Your data lives only on this device. Make a backup.</p><button class="btn primary" data-act="export-json">Back up</button></div>` : ''}
  ${welcome}
  <section class="card hero">
    <div class="label">All my money</div>
    <div class="big money ${total < 0 ? 'expense' : ''}">${money(total)}</div>
    <div class="accounts">
      ${state.settings.accounts.map((a) => `<button class="acc ${bal[a.id] < 0 ? 'neg' : ''}" data-act="transfer" data-from="${esc(a.id)}"><span class="n">${esc(a.emoji)} ${esc(a.name)}</span><b class="money">${money(bal[a.id])}</b></button>`).join('')}
    </div>
  </section>
  <section class="card"><h2>${monthLabel(key)}</h2>${stats(s)}${rateBar(s)}</section>
  ${goalCard()}
  ${tips.length ? `<section class="card"><h2>Heads up <button class="card-link right" data-go="insights">All insights</button></h2>${tips.map(tipCard).join('')}</section>` : ''}
  ${jarsCard(key)}
  ${recent.length ? `<section class="card"><h2>Recent <button class="card-link right" data-go="log">See all</button></h2><div class="list">${recent.map((t) => txRow(t, { showDate: true })).join('')}</div></section>` : ''}`;
}

function viewLog() {
  const s = M.monthSummary(state, ui.month);
  const q = ui.search.trim().toLowerCase();
  let list = q
    ? state.tx.filter((t) => {
      const hay = [t.note, catOf(t.category).name, t.type === 'transfer' ? `${accOf(t.from).name} ${accOf(t.to).name}` : accOf(t.account).name, centsToPlain(t.amount)].join(' ').toLowerCase();
      return hay.includes(q);
    })
    : M.txInMonth(state, ui.month);
  if (ui.filter !== 'all') list = list.filter((t) => t.type === ui.filter);
  list = M.sortTx(list);

  const groups = new Map();
  for (const t of list) {
    if (!groups.has(t.date)) groups.set(t.date, []);
    groups.get(t.date).push(t);
  }
  const days = [...groups.entries()].map(([date, items]) => {
    const net = items.reduce((a, t) => a + (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0), 0);
    return `<div class="day"><div class="day-head"><span>${dayLabel(date)}${q ? ` ${date.slice(0, 4)}` : ''}</span><span class="money ${net > 0 ? 'income' : ''}">${net ? money(net, { sign: true }) : ''}</span></div>
      <div class="list">${items.map((t) => txRow(t)).join('')}</div></div>`;
  }).join('');

  const chip = (id, label) => `<button class="chip" data-act="filter" data-filter="${id}" aria-pressed="${ui.filter === id}">${label}</button>`;
  return `<header class="top"><h1>Log</h1>${monthSwitch()}</header>
  ${q ? '' : `<section class="card">${stats(s)}${rateBar(s)}</section>`}
  <div class="search"><input type="search" id="search" placeholder="Search notes, categories, amounts" value="${esc(ui.search)}" aria-label="Search all records"></div>
  <div class="chips">${chip('all', 'All')}${chip('expense', 'Spent')}${chip('income', 'Earned')}${chip('transfer', 'Moves')}</div>
  ${q ? `<p class="muted small">${list.length} result${list.length === 1 ? '' : 's'} in all months</p>` : ''}
  ${days || `<div class="empty"><div class="big">🧾</div><b>${q ? 'Nothing found' : 'No records this month'}</b>${q ? 'Try another word.' : 'Tap + to add one.'}</div>`}`;
}

function viewInsights() {
  const today = todayISO();
  const key = ui.month;
  const tips = M.insights(state, key, today);
  const cmp = M.categoryComparison(state, key);
  const s = M.monthSummary(state, key);
  const maxCat = cmp[0]?.amount || 1;
  const cats = cmp.slice(0, 12).map((c) => {
    const k = catOf(c.id);
    let vs = '';
    if (c.avg) {
      const d = c.amount - c.avg;
      const p = Math.round((d / c.avg) * 100);
      vs = `<div class="vs">normal month ${money(c.avg)} · <span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(p)}%</span></div>`;
    }
    return `<div class="cbar"><div class="row"><span>${esc(k.emoji)} ${esc(k.name)} <span class="muted">${pct(c.share)}</span></span><span class="money">${money(c.amount)}</span></div>
      <div class="bar"><i style="width:${((c.amount / maxCat) * 100).toFixed(1)}%"></i></div>${vs}</div>`;
  }).join('');
  const maxSrc = s.bySource[0]?.amount || 1;
  const srcs = s.bySource.map((c) => {
    const k = catOf(c.id);
    return `<div class="cbar in"><div class="row"><span>${esc(k.emoji)} ${esc(k.name)} <span class="muted">${pct(c.amount / s.income)}</span></span><span class="money">${money(c.amount)}</span></div>
      <div class="bar"><i style="width:${((c.amount / maxSrc) * 100).toFixed(1)}%"></i></div></div>`;
  }).join('');

  const y = M.yearOverview(state, ui.year);
  const nowKey = monthKey(today);
  const k = (c) => formatMoney(c, '', { compact: true });
  const yearRows = y.rows.map((r) => {
    const has = r.income || r.expense;
    return `<tr class="${has ? '' : 'dim'}">
    <td><button class="card-link" style="color:inherit" data-act="open-month" data-key="${r.key}">${monthLabel(r.key, true).slice(0, 3)}</button></td>
    ${has ? `<td class="income">${k(r.income)}</td><td class="expense">${k(r.expense)}</td><td>${k(r.net)}</td><td>${pct(r.savingsRate)}</td>` : '<td>–</td><td>–</td><td>–</td><td>–</td>'}</tr>`;
  }).join('');

  return `<header class="top"><h1>Insights</h1>${monthSwitch()}</header>
  <section class="card"><h2>What your money says</h2>${tips.map(tipCard).join('')}</section>
  <section class="card"><h2>Where it goes <span class="right muted">${money(s.expense)}</span></h2>
    ${cats || '<p class="muted" style="margin:0">No spending logged this month.</p>'}</section>
  <section class="card"><h2>Where it comes from <span class="right muted">${money(s.income)}</span></h2>
    ${srcs || '<p class="muted" style="margin:0">No income logged this month.</p>'}
    ${s.bySource.length ? '<p class="muted small" style="margin-bottom:0">To make more: do more of what pays best per hour, and add one more source.</p>' : ''}</section>
  <section class="card"><h2>Last 6 months</h2>${trendChart(M.trend(state, key, 6), (c) => money(c))}
    <div class="legend"><span><i style="background:var(--income)"></i>Earned</span><span><i style="background:var(--expense)"></i>Spent</span></div></section>
  <section class="card"><h2>Year ${ui.year} · ${esc(state.settings.currency)}
      <span class="right"><button class="card-link" data-act="year" data-step="-1" aria-label="Previous year">‹ ${ui.year - 1}</button>
      ${ui.year < Number(nowKey.slice(0, 4)) ? `&nbsp;<button class="card-link" data-act="year" data-step="1" aria-label="Next year">${ui.year + 1} ›</button>` : ''}</span></h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Month</th><th>Earned</th><th>Spent</th><th>Kept</th><th>%</th></tr></thead>
      <tbody>${yearRows}<tr class="total"><td>Total</td><td class="income">${k(y.total.income)}</td><td class="expense">${k(y.total.expense)}</td><td>${k(y.total.net)}</td><td>${pct(y.total.savingsRate)}</td></tr></tbody>
    </table></div></section>`;
}

function viewSettings() {
  const st = state.settings;
  const accOptions = (sel, withAll) => (withAll ? `<option value="all" ${sel === 'all' ? 'selected' : ''}>All my money</option>` : '')
    + st.accounts.map((a) => `<option value="${esc(a.id)}" ${sel === a.id ? 'selected' : ''}>${esc(a.emoji)} ${esc(a.name)}</option>`).join('');
  const jarOptions = (sel) => st.jars.filter((j) => !j.savings).map((j) => `<option value="${esc(j.id)}" ${sel === j.id ? 'selected' : ''}>${esc(j.emoji)} ${esc(j.name)}</option>`).join('');
  const used = new Set(state.tx.map((t) => t.category));
  const catRow = (c) => `<div class="cat-row">
    <input type="text" class="emoji" value="${esc(c.emoji)}" data-cat="${esc(c.id)}" data-field="emoji" aria-label="Emoji" maxlength="4">
    <input type="text" value="${esc(c.name)}" data-cat="${esc(c.id)}" data-field="name" aria-label="Name">
    ${c.type === 'expense'
    ? `<select data-cat="${esc(c.id)}" data-field="jar" aria-label="Jar">${jarOptions(c.jar)}</select>`
    : used.has(c.id) ? '<span></span>' : `<button class="btn danger" data-act="del-cat" data-id="${esc(c.id)}">Remove</button>`}
  </div>`;
  const lastBackup = state.meta.lastBackup ? new Date(state.meta.lastBackup).toLocaleDateString() : 'never';
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;

  return `<header class="top"><h1>Settings</h1></header>
  ${installPrompt ? '<div class="banner"><p>📲 Install the app for one-tap access, even offline.</p><button class="btn primary" data-act="install">Install</button></div>' : ''}
  ${isIOS ? '<div class="banner"><p>📲 To install on iPhone: tap Share, then “Add to Home Screen”.</p></div>' : ''}

  <section class="card"><h2>🎯 Goal</h2>
    <label class="field"><span>Name</span><input type="text" data-set="goal.name" value="${esc(st.goal.name)}"></label>
    <div class="row2">
      <label class="field"><span>Target (${esc(st.currency)})</span><input type="text" inputmode="decimal" data-set="goal.target" value="${centsToPlain(st.goal.target)}"></label>
      <label class="field"><span>Counts</span><select data-set="goal.account">${accOptions(st.goal.account, true)}</select></label>
    </div>
  </section>

  <section class="card"><h2>🧮 Smart split <span class="right" id="jar-sum"></span></h2>
    <p class="muted small" style="margin-top:0">Every income is split like this. Spending is checked against each jar.</p>
    ${st.jars.map((j) => `<div class="set-row">
      <input type="text" value="${esc(j.emoji)} ${esc(j.name)}" data-jar="${esc(j.id)}" data-field="label" aria-label="Jar name">
      <label style="display:flex;align-items:center;gap:6px"><input type="number" class="pct" min="0" max="100" step="1" value="${j.pct}" data-jar="${esc(j.id)}" data-field="pct" aria-label="Percent for ${esc(j.name)}">%</label>
    </div>`).join('')}
  </section>

  <section class="card"><h2>👛 Accounts</h2>
    <p class="muted small" style="margin-top:0">Starting balance = what was there before you started logging.</p>
    ${st.accounts.map((a) => `<div class="set-row">
      <input type="text" value="${esc(a.emoji)} ${esc(a.name)}" data-acc="${esc(a.id)}" data-field="label" aria-label="Account name">
      <input type="text" inputmode="decimal" class="pct" style="width:120px" value="${centsToPlain(a.start || 0)}" data-acc="${esc(a.id)}" data-field="start" aria-label="Starting balance of ${esc(a.name)}">
    </div>`).join('')}
    <label class="field" style="margin:12px 0 0"><span>Savings go to</span><select data-set="savingsAccount">${accOptions(st.savingsAccount, false)}</select></label>
  </section>

  <details class="card"><summary>🏷️ Categories</summary>
    <p class="muted small" style="margin-top:0">Spending: pick which jar it comes from.</p>
    ${st.categories.filter((c) => c.type === 'expense').map(catRow).join('')}
    <p class="muted small">Income sources</p>
    ${st.categories.filter((c) => c.type === 'income').map(catRow).join('')}
    <div class="btns" style="margin-top:10px">
      <button class="btn" data-act="add-cat" data-type="expense">+ Spending category</button>
      <button class="btn" data-act="add-cat" data-type="income">+ Income source</button>
    </div>
  </details>

  <section class="card"><h2>💾 Your data</h2>
    <p class="muted small" style="margin-top:0">${state.tx.length} records, saved only on this device. Last backup: ${esc(lastBackup)}.</p>
    <div class="btns">
      <button class="btn primary" data-act="export-json">Back up</button>
      <button class="btn" data-act="import-json">Restore backup</button>
    </div>
    <div class="btns" style="margin-top:8px">
      <button class="btn" data-act="import-csv">Import Google Sheet (CSV)</button>
      <button class="btn" data-act="export-csv">Export CSV</button>
    </div>
    <p class="muted small" style="margin-bottom:0">From Google Sheets: open a month tab → File → Download → Comma-separated values (.csv), then import it here. Repeat for each month. Importing the same month twice is safe.</p>
  </section>

  <section class="card"><h2>🎨 Look</h2>
    <div class="row2">
      <label class="field"><span>Theme</span><select data-set="theme">
        ${['system', 'dark', 'light'].map((t) => `<option value="${t}" ${st.theme === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}
      </select></label>
      <label class="field"><span>Currency</span><input type="text" data-set="currency" value="${esc(st.currency)}" maxlength="5"></label>
    </div>
  </section>

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

function render() {
  applyTheme();
  const views = { home: viewHome, log: viewLog, insights: viewInsights, settings: viewSettings };
  app.innerHTML = (views[ui.tab] || viewHome)();
  for (const a of document.querySelectorAll('.tabbar a')) {
    if (a.dataset.tab === ui.tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (ui.tab === 'settings') updateJarSum();
}

// ---------- Bottom sheet ----------

function openSheet(html, onMount) {
  sheetRoot.innerHTML = `<div class="sheet-backdrop" data-close><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  const sheet = sheetRoot.querySelector('.sheet');
  document.body.style.overflow = 'hidden';
  onMount?.(sheet);
  return sheet;
}

function closeSheet() {
  sheetRoot.innerHTML = '';
  document.body.style.overflow = '';
}

function categoryOrder(type) {
  // Most used in the last 90 days first, so your usual ones are one tap away.
  const since = addMonths(monthKey(todayISO()), -3);
  const count = {};
  for (const t of state.tx) if (t.type === type && t.date >= since) count[t.category] = (count[t.category] || 0) + 1;
  return state.settings.categories.filter((c) => c.type === type)
    .map((c, i) => ({ c, i })).sort((a, b) => (count[b.c.id] || 0) - (count[a.c.id] || 0) || a.i - b.i).map((x) => x.c);
}

function openTxSheet(existing = null, preset = {}) {
  const accounts = state.settings.accounts;
  const last = M.sortTx(state.tx).find((t) => t.type !== 'transfer');
  const draft = existing ? { ...existing } : {
    type: 'expense',
    date: todayISO(),
    account: last?.account || accounts[0]?.id,
    from: accounts[0]?.id,
    to: state.settings.savingsAccount || accounts[1]?.id,
    category: null,
    note: '',
    ...preset,
  };
  let amountText = existing ? centsToPlain(existing.amount) : preset.amountText || '';
  let catTouched = !!existing;

  const accSelect = (field, label) => `<label class="field"><span>${label}</span><select id="tx-${field}">
    ${accounts.map((a) => `<option value="${esc(a.id)}" ${draft[field] === a.id ? 'selected' : ''}>${esc(a.emoji)} ${esc(a.name)}</option>`).join('')}</select></label>`;

  const html = () => {
    const isT = draft.type === 'transfer';
    const segBtn = (t, label) => `<button type="button" data-type="${t}" aria-pressed="${draft.type === t}">${label}</button>`;
    return `<form id="tx-form" novalidate>
      <h3>${existing ? 'Edit record' : 'New record'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
      <div class="seg" role="group" aria-label="Type">${segBtn('expense', 'Spent')}${segBtn('income', 'Earned')}${segBtn('transfer', 'Move')}</div>
      <div class="amount-input"><input id="tx-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(amountText)}" aria-label="Amount"><span class="cur">${esc(state.settings.currency)}</span></div>
      <div class="calc-hint" id="calc-hint">${isT ? 'Move money between your accounts' : 'Tip: type 120+45 and it adds up'}</div>
      <label class="field"><span>${isT ? 'Note (optional)' : 'What for?'}</span>
        <input id="tx-note" type="text" list="note-list" autocomplete="off" value="${esc(draft.note)}" placeholder="${draft.type === 'income' ? 'e.g. from work, mother, competition' : isT ? 'e.g. to the safe' : 'e.g. food, taxi, gift for brother'}"></label>
      <datalist id="note-list">${M.noteSuggestions(state, draft.type).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      ${isT ? '' : `<div class="cats" role="group" aria-label="Category">${categoryOrder(draft.type).map((c) => `<button type="button" class="cat" data-cat="${esc(c.id)}" aria-pressed="${draft.category === c.id}"><span class="e">${esc(c.emoji)}</span>${esc(c.name)}</button>`).join('')}</div>`}
      <div class="row2">
        ${isT ? accSelect('from', 'From') + accSelect('to', 'To') : accSelect('account', draft.type === 'income' ? 'Into' : 'Paid from')}
      </div>
      <label class="field"><span>Date</span><input id="tx-date" type="date" value="${esc(draft.date)}"></label>
      <div class="btns">
        ${existing ? '<button type="button" class="btn danger" data-act="tx-delete">Delete</button>' : ''}
        <button type="submit" class="btn primary">${existing ? 'Save' : 'Add'}</button>
      </div>
    </form>`;
  };

  const readInputs = (sheet) => {
    amountText = sheet.querySelector('#tx-amount').value;
    draft.note = sheet.querySelector('#tx-note').value;
    draft.date = sheet.querySelector('#tx-date').value || draft.date;
    for (const f of ['account', 'from', 'to']) {
      const el = sheet.querySelector(`#tx-${f}`);
      if (el) draft[f] = el.value;
    }
  };

  const paint = (sheet, focus = true) => {
    sheet.innerHTML = `<div class="grab"></div>${html()}`;
    const amount = sheet.querySelector('#tx-amount');
    const hint = sheet.querySelector('#calc-hint');
    amount.addEventListener('input', () => {
      const v = evalAmount(amount.value);
      if (/[+\-*/x×÷()]/i.test(amount.value.slice(1))) hint.textContent = v != null && v > 0 ? `= ${money(v)}` : '…';
    });
    sheet.querySelector('#tx-note').addEventListener('input', (e) => {
      if (catTouched || draft.type === 'transfer') return;
      const s = M.suggestCategory(state, e.target.value, draft.type);
      draft.category = s;
      for (const b of sheet.querySelectorAll('.cat')) b.setAttribute('aria-pressed', String(b.dataset.cat === s));
    });
    sheet.querySelector('#tx-form').addEventListener('submit', (e) => {
      e.preventDefault();
      readInputs(sheet);
      saveDraft(sheet);
    });
    if (focus && !existing) amount.focus();
  };

  const saveDraft = (sheet) => {
    const amount = evalAmount(amountText);
    const hint = sheet.querySelector('#calc-hint');
    if (!amount || amount <= 0) {
      hint.textContent = 'Enter an amount bigger than 0';
      hint.style.color = 'var(--expense)';
      sheet.querySelector('#tx-amount').focus();
      return;
    }
    if (draft.type === 'transfer' && draft.from === draft.to) {
      hint.textContent = 'Pick two different accounts';
      hint.style.color = 'var(--expense)';
      return;
    }
    const base = { id: existing?.id || M.uid(), createdAt: existing?.createdAt || Date.now(), type: draft.type, amount, date: draft.date, note: draft.note.trim() };
    const tx = draft.type === 'transfer'
      ? { ...base, from: draft.from, to: draft.to }
      : { ...base, account: draft.account, category: draft.category || (draft.type === 'income' ? 'other-in' : 'other') };
    if (existing) state.tx = state.tx.map((t) => (t.id === existing.id ? tx : t));
    else state.tx.push(tx);
    commit();
    closeSheet();
    if (!existing && tx.type === 'income') openSplitSheet(tx);
    else toast(existing ? 'Saved' : `${tx.type === 'expense' ? 'Spent' : 'Moved'} ${money(tx.amount)}`);
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
          paint(sheet);
        }
        return;
      }
      const cat = e.target.closest('.cat');
      if (cat) {
        draft.category = cat.dataset.cat;
        catTouched = true;
        for (const b of sheet.querySelectorAll('.cat')) b.setAttribute('aria-pressed', String(b === cat));
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
  const canMove = target && M.account(state, target) && target !== tx.account && save > 0;
  openSheet(`<h3>💰 Split ${money(tx.amount)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <div>${parts.map((p) => `<div class="split-row"><span>${esc(p.jar.emoji)} ${esc(p.jar.name)} <span class="muted">${p.jar.pct}%</span></span><b class="money ${p.jar.savings ? 'income' : ''}">${money(p.amount)}</b></div>`).join('')}</div>
    <div class="btns" style="margin-top:14px">
      ${canMove ? `<button class="btn primary" data-act="move-savings">Move ${money(save)} to ${esc(accOf(target).name)}</button>` : ''}
      <button class="btn" data-close>Done</button>
    </div>`, (sheet) => {
    sheet.querySelector('[data-act="move-savings"]')?.addEventListener('click', () => {
      state.tx.push({ id: M.uid(), createdAt: Date.now(), type: 'transfer', amount: save, date: tx.date, from: tx.account, to: target, note: `Deposit ${sj.pct}%${tx.note ? ` · ${tx.note}` : ''}` });
      commit();
      closeSheet();
      toast(`🔒 ${money(save)} is in the ${accOf(target).name}. Don't touch it.`);
    });
  });
}

function openTransferSheet(fromId) {
  const other = state.settings.accounts.find((a) => a.id !== fromId);
  openTxSheet(null, { type: 'transfer', from: fromId, to: fromId === state.settings.savingsAccount ? other?.id : state.settings.savingsAccount || other?.id });
}

function deleteTx(id) {
  const idx = state.tx.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const [removed] = state.tx.splice(idx, 1);
  commit();
  closeSheet();
  toast('Deleted', 'Undo', () => {
    state.tx.push(removed);
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
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJSON() {
  state.meta.lastBackup = Date.now();
  download(`finance-helper-backup-${todayISO()}.json`, backupJSON(state), 'application/json');
  commit();
  toast('Backup saved. Keep it somewhere safe (Drive, Telegram Saved Messages).');
}

function exportCSV() {
  download(`finance-helper-${todayISO()}.csv`, toCSV(exportRows(state)), 'text/csv');
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
    toast(res.duplicates ? `Already imported (${res.duplicates} records).` : 'No records found in that file.');
    return;
  }
  const incomes = res.tx.filter((t) => t.type === 'income').length;
  const expenses = res.tx.filter((t) => t.type === 'expense').length;
  openSheet(`<h3>Import ${res.format === 'app' ? 'CSV' : 'from your sheet'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p style="margin-top:0">${res.months.map((m) => monthLabel(m)).join(', ')}</p>
    <div class="split-row"><span>💚 ${incomes} incomes</span><b class="money income">${money(res.income)}</b></div>
    <div class="split-row"><span>🧾 ${expenses} expenses</span><b class="money expense">${money(res.expense)}</b></div>
    ${res.duplicates ? `<div class="split-row"><span class="muted">Already here, skipped</span><b>${res.duplicates}</b></div>` : ''}
    <p class="muted small">Check these totals match your sheet. Categories are guessed from your notes; tap any record later to fix it.</p>
    ${res.format === 'sheet' ? `<label class="field"><span>Put them in</span><select id="imp-acc">${state.settings.accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.emoji)} ${esc(a.name)}</option>`).join('')}</select></label>` : ''}
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

async function onJSONFile(text) {
  if (text == null) return;
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
  } else if (el.dataset.jar) {
    const j = M.jar(state, el.dataset.jar);
    if (el.dataset.field === 'pct') j.pct = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    else Object.assign(j, splitLabel(v, j.emoji));
    updateJarSum();
  } else if (el.dataset.acc) {
    const a = M.account(state, el.dataset.acc);
    if (el.dataset.field === 'start') a.start = evalAmount(v) || 0;
    else Object.assign(a, splitLabel(v, a.emoji));
  } else if (el.dataset.cat) {
    const c = M.category(state, el.dataset.cat);
    if (el.dataset.field === 'name') c.name = v.trim() || 'Untitled';
    else if (el.dataset.field === 'emoji') c.emoji = v.trim() || '•';
    else if (el.dataset.field === 'jar') c.jar = v;
  } else return;
  persist();
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
  if (act === 'add') openTxSheet();
  else if (act === 'edit') openTxSheet(state.tx.find((t) => t.id === el.dataset.id));
  else if (act === 'transfer') openTransferSheet(el.dataset.from);
  else if (act === 'month') { ui.month = addMonths(ui.month, Number(el.dataset.step)); render(); }
  else if (act === 'year') { ui.year += Number(el.dataset.step); render(); }
  else if (act === 'open-month') { ui.month = el.dataset.key; ui.search = ''; location.hash = '#log'; }
  else if (act === 'filter') { ui.filter = el.dataset.filter; render(); }
  else if (act === 'export-json') exportJSON();
  else if (act === 'export-csv') exportCSV();
  else if (act === 'import-csv') document.getElementById('file-csv').click();
  else if (act === 'import-json') document.getElementById('file-json').click();
  else if (act === 'install') installPrompt?.prompt().finally(() => { installPrompt = null; render(); });
  else if (act === 'add-cat') {
    const type = el.dataset.type;
    state.settings.categories.push({ id: `c-${M.uid()}`, type, name: type === 'income' ? 'New source' : 'New category', emoji: type === 'income' ? '💵' : '🏷️', ...(type === 'expense' ? { jar: state.settings.jars.find((j) => !j.savings)?.id } : {}) });
    commit();
    document.querySelector('details.card')?.setAttribute('open', '');
  } else if (act === 'del-cat') {
    state.settings.categories = state.settings.categories.filter((c) => c.id !== el.dataset.id);
    commit();
    document.querySelector('details.card')?.setAttribute('open', '');
  } else if (act === 'wipe') {
    if (confirm(`Erase all ${state.tx.length} records and settings from this device? Make a backup first if you might need them.`)) {
      state = M.defaultState();
      state.meta.createdAt = Date.now();
      commit();
      toast('Everything erased');
    }
  }
});

document.addEventListener('change', (e) => {
  if (e.target.closest('.sheet')) return;
  if (e.target.id === 'file-csv') readFile(e.target).then(onCSVFile);
  else if (e.target.id === 'file-json') readFile(e.target).then(onJSONFile);
  else onSettingsChange(e.target);
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'search') {
    ui.search = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const s = document.getElementById('search');
    s.focus();
    s.setSelectionRange(pos, pos);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetRoot.firstChild) closeSheet();
});

function route() {
  const tab = location.hash.slice(1) || 'home';
  ui.tab = ['home', 'log', 'insights', 'settings'].includes(tab) ? tab : 'home';
  closeSheet();
  render();
  window.scrollTo(0, 0);
  // "Add a record" shortcut from the home-screen icon.
  if (tab === 'add') {
    history.replaceState(null, '', '#home');
    openTxSheet();
  }
}

window.addEventListener('hashchange', route);

// Another tab or window changed the data: pick it up.
window.addEventListener('storage', (e) => {
  if (e.key === 'finance-helper.state') {
    state = load();
    render();
  }
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (ui.tab === 'settings') render();
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

requestPersistence();
route();
