// The app: screens, the add/edit sheet, import and backup. All numbers come
// from model.js; this file only turns them into HTML and handles taps.

import { load, saveSoon, flushSave, hasPendingSave, onSaved, backupText, restoreJSON, requestPersistence, isSealed, openImported, wipeStore, hasSession, reopen, storeReady, STORAGE_KEYS } from './store.js';
import * as M from './model.js';
import * as T from './cattree.js';
import * as Cats from './screens/categories.js';
import { formatMoney, evalAmount, centsToPlain } from './money.js';
import * as Privacy from './privacy.js';
import { todayISO, monthKey, monthLabel, addMonths, daysInMonth, dayLabel, dowIndex, DOW_LONG, DOW_SHORT, MONTHS, addDays } from './dates.js';
import { convert, pairRate, formatRate, rateToBase } from './fx.js';
import { parseCSV, toCSV } from './csv.js';
import { importRows, importWorkbook, importCheck, exportRows, toTSV, monthSheet, overviewSheet, detectColumns, fillRate, fillKnownRates, skipNoRate, previewTotal } from './importer.js';
import { readWorkbook } from './xlsx-read.js';
import { workbook } from './xlsx.js';
import { refreshRates, backfillRates, recordRates } from './rates.js';
import { ctx } from './ctx.js';
import * as RatesScreen from './screens/rates.js';
import * as AccountsScreen from './screens/accounts.js';
import * as Spending from './screens/spending.js';
import * as PeopleScreen from './screens/people.js';
import * as ReportsScreen from './screens/reports.js';
import * as Security from './screens/security.js';
import * as Updates from './screens/updates.js';
import * as DataHealth from './screens/datahealth.js'; // Settings → Data & health
import { parseQuick } from './quickadd.js';
import * as CloseMonth from './screens/closemonth.js';
import * as Wrapped from './screens/wrapped.js';
import { isClosed as monthClosed } from './closemonth.js';
import * as Standalone from './standalone.js'; // standalone app: cloud sync, Life import, update badge, notifications
import * as Binance from './screens/binance.js';
import * as Sync from './screens/sync.js';
import * as SelfCheck from './screens/selfcheck.js';
import * as Backups from './screens/backups.js';
import * as Tidy from './screens/moneytidy.js';
import * as CashCount from './screens/cashcount.js';
import * as Repeating from './screens/repeating.js';
import * as Checkup from './screens/checkup.js';
import * as RealityScreen from './screens/reality.js';
import * as Shortcuts from './shortcuts.js';
import * as Bulk from './bulk.js';
import { backupBefore } from './dupes.js';
import * as Plan from './screens/plan.js';
import * as Clients from './screens/clients.js';
import * as Rules from './screens/rules.js';
import * as Goals from './screens/goals.js';
import * as Telegram from './screens/telegram.js';
import * as TgBlocks from './screens/tgblocks.js';
import * as TelegramHub from './screens/telegram_hub.js';
import * as Motion from './motion.js';
import * as Flow from './flow.js';
import { isArchived, withArchive } from './archive.js';
import * as Tips from './tips.js';
import * as ArchiveCard from './screens/archivecard.js';
import * as Calc from './screens/calc.js';
import * as Buddy from './screens/buddy.js';
import * as ImportCheck from './screens/importcheck.js';
import * as Reprice from './screens/reprice.js';
import * as Reconcile from './screens/reconcile.js';
import * as MoneyIO from './screens/moneyio.js';
import { isMoneyExport } from './moneyexport.js';
import * as RateGaps from './screens/rategaps.js';
import * as WorkHour from './screens/workhour.js';
import * as YearReview from './screens/yearreview.js';
import * as LongView from './screens/longview.js';
import * as MoneyB2 from './screens/moneyb2.js';
import * as Taxes from './screens/taxes.js';
import * as MoneyCalendar from './screens/calendar.js';
import * as Wishlist from './screens/wishlist.js';
import * as Afford from './screens/afford.js';
import * as MoneyB from './screens/moneyb.js';
import * as Changes from './changestore.js';
import * as Recent from './screens/recent.js';
import * as SavedBar from './screens/savedbar.js';
import * as GridEdit from './gridedit.js';
import * as ChangesScreen from './screens/changes.js';
import * as RecordX from './screens/recordx.js'; // your own fields, split records, colour tags
import * as TagsReport from './screens/tagsreport.js';
import * as BudgetWarn from './screens/budgetwarn.js';
import * as IncomeSources from './screens/incomesources.js';
import * as IS from './incomesources.js';
import { workText } from './workhours.js';
import { planSplit, splitTransfers, splitPrefs, isSplit } from './split.js';
import { openBankImport, rowsFromFile, decodeText } from './screens/bankimport.js';
import { guessMapping } from './bank.js';
import { forecast, spendingIds, spentFrom } from './forecast.js';
import { bindTilt, cardHTML } from './cards.js';
import { FREQS, markDone, dueItems } from './recurring.js';
import { invoiceStatus } from './invoices.js';
import { tableHTML, calendarHTML, dayLabelHTML, accountOptionsHTML, accountDisplayName } from './logviews.js';
import { sheetHTML, monthTabs } from './sheetview.js';
import { createHistory } from './history.js';
import { mergeLocal } from './sync.js';
import { settingsBase, stampSettings } from './settingstamp.js';
import { searchTx, searchSummary, SEARCH_HINT, savedFilters, saveFilter, removeFilter } from './search.js';
import { chipsHTML, withoutTerm } from './searchchips.js';
import * as Money3 from './screens/money3.js';
import { safeToSpend, shortDay, limitStatus, suggestLimit, everydaySpent } from './safespend.js';
import { verdict, nextSteps } from './nextsteps.js';
import { openRecap } from './screens/recap.js';
import * as Pay from './payyourself.js';
import { sound } from './audio.js';
import { AmbientMusic } from './ambient.js';
import { openPalette, closePalette, isPaletteOpen } from './palette.js';
import { bindSankeyHover } from './charts.js';
import { APP_VERSION } from './version.js';
import { countsAsSpending, countsAsIncome, signed, isRefund, isNotCounted } from './catshare.js';
import * as E from './everyday.js';

// The data lives in IndexedDB: open it (and move an old copy out of localStorage) before the first read.
await storeReady();
let state = load();
// Undo / redo for this session (js/history.js).
const history = createHistory();
// When each plain setting last changed here (js/settingstamp.js): stamped at
// every save made on this device, so sync merges settings key by key. Whatever
// starts the undo history over (start, sync, unlock, restore) starts this over too.
let settingsWas = null;
const resetHistory = history.reset;
history.reset = (s) => { resetHistory(s); settingsWas = settingsBase(s); };
const stampChanged = () => { settingsWas = stampSettings(state, settingsWas); };
history.reset(state);
Changes.reset(state); // change history (js/changestore.js)
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
// Inside Life System (its Money page): Life's light/dark, a slim tab strip
// instead of the sidebar, no robot, and the data syncs to your Life database.
const inLifeNow = () => document.documentElement.dataset.inLife === '1';
// The look: inside Life "Match Life System" unless you picked another one
// there (themeInLife, this device only); on its own, your usual pick.
const themeChoice = () => (inLifeNow() ? state.settings.themeInLife || 'life' : state.settings.theme);
function lifeMode() {
  const r = document.documentElement;
  if (r.dataset.lifeMode === 'light' || r.dataset.lifeMode === 'dark') return r.dataset.lifeMode;
  try {
    const t = window.parent.document.documentElement.dataset.theme;
    if (t === 'light' || t === 'dark') return t;
  } catch {}
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

const app = document.getElementById('app');
const sheetRoot = document.getElementById('sheet-root');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c, opts) => formatMoney(c, state.settings.currency, opts);
const whole = (c) => Math.round(c / 100) * 100; // whole lei for totals
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

// Money that counts up to its value when a screen opens. Totals are whole lei:
// the bani belong on single records, not on sums.
const countUp = (c, key, opts) => (c = Math.round(c / 100) * 100, `<span data-count="${c}" data-ck="${key}" data-cur="1"${opts?.sign ? ' data-sign="1"' : ''}>${money(c, opts)}</span>`);

// Save. Each save is an undo step, except quiet ones: changes that didn't
// come from you (sync, the daily net-worth snapshot, Binance balances).
// The write itself waits a moment (store.js saveSoon): a burst of changes is
// one write, and leaving the page writes at once.
const SAVE_FAILED = 'Could not save. Is your browser storage full or blocked?';
let holdDepth = 0; // a paste or fill of many cells: every cell saves, but it is one undo step
function persist({ quiet = false } = {}) {
  stampChanged();
  if (holdDepth) { if (!saveSoon(state)) toast(SAVE_FAILED); return; }
  const added = Changes.track(state, quiet ? 'quiet' : 'local');
  if (!saveSoon(state)) toast(SAVE_FAILED);
  if (quiet) history.reset(state);
  else history.tag(history.record(state), added[0]?.grp); // the undo step knows its change-history action
}

// Life System hears about a change once it is really stored (it reads the
// stored copy to pay "Spending logged").
let tellLife = null;
onSaved((ok) => {
  if (!ok) toast(SAVE_FAILED);
  if (!tellLife) return;
  const payload = tellLife.opts;
  tellLife = null;
  try { window.parent.postMessage({ type: 'FINANCE_TRANSACTION_LOGGED', payload }, '*'); } catch {}
});
for (const ev of ['pagehide', 'beforeunload']) window.addEventListener(ev, () => flushSave());
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });

function commit(opts) {
  persist(opts);
  render();
  Sync.changed();
  if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
    tellLife = { opts };
    if (!hasPendingSave()) { tellLife = null; try { window.parent.postMessage({ type: 'FINANCE_TRANSACTION_LOGGED', payload: opts }, '*'); } catch {} }
  }
}

// Ctrl+Z / Ctrl+Y and the Undo / Redo buttons. The session steps first (they
// also cover plain settings); after a reload the change history takes over
// (js/screens/recent.js). `force`: the person said yes to "this was made on
// another device" or "changed since".
function finishRevert(dir, label, of) {
  if (of) Changes.expectRevert(of);
  stampChanged();
  Changes.track(state, dir < 0 ? 'undo' : 'redo');
  history.reset(state);
  if (!saveSoon(state)) toast(SAVE_FAILED);
  ui.selected?.clear();
  render();
  Sync.changed();
  toast(`${dir < 0 ? 'Undone' : 'Redone'}: ${label}`, dir < 0 ? 'Redo' : 'Undo', () => undoRedo(-dir));
}
function undoRedo(dir, force) {
  if (state._sealed) return;
  if (Recent.guard(dir, force)) return;
  const grp = history.topGrp(dir);
  const e = dir < 0 ? history.undo(state) : history.redo(state);
  if (!e) { if (!Recent.step(dir)) toast(dir < 0 ? 'Nothing to undo' : 'Nothing to redo'); return; }
  const first = grp && Changes.entries().find((x) => x.grp === grp)?.id;
  finishRevert(dir, e.label, first);
}

const THEME_STYLES = [
  ['dark', 'Midnight', 'Golden stars in a midnight sky', '#0b0d12', '#e3b95f'],
  ['ocean', 'Ocean', 'Blue tides and drifting bubbles', '#08131f', '#82caff'],
  ['forest', 'Forest', 'Soft greens and falling leaves', '#0b1712', '#b8d88d'],
  ['paper', 'Paper', 'Warm pages and floating flecks', '#f5f0e6', '#875523'],
  ['samurai', 'Samurai', 'Sakura petals, blood moon & bushido spirit', '#0c080e', '#ff4d6d'],
  ['light', 'Classic light', 'Clean whites and a soft shimmer', '#f3f4f7', '#8a6a22'],
  ['system', 'Follow system', 'Matches your device appearance', '#303b4b', '#c6d3e2'],
];
function themePicker(st) {
  const styles = inLifeNow() ? [['life', 'Match Life System', 'Life’s light or dark, and it follows when you switch', '#11151d', '#c8f135'], ...THEME_STYLES] : THEME_STYLES;
  const picked = themeChoice();
  return '<fieldset class="style-picker"><legend>Choose your atmosphere</legend><div class="style-grid">' + styles.map(([id, name, detail, bg, accent]) =>
    `<label class="style-choice"><input type="radio" name="app-theme" data-set="theme" value="${id}" ${picked === id ? 'checked' : ''}><span class="style-preview style-${id}" style="--preview-bg:${bg};--preview-accent:${accent}"><span class="preview-sidebar"></span><span class="preview-heading"></span><span class="preview-panel"></span><span class="preview-panel second"></span><span class="preview-motif"></span><span class="style-check" aria-hidden="true">✓</span></span><span class="style-name">${name}</span><span class="style-detail">${detail}</span></label>`
  ).join('') + '</div></fieldset>';
}
let ambientKey = '';
function applyAtmosphere() {
  // Calm inside Life (its Match theme has no floating flecks), and never
  // with reduced motion.
  const active = state.settings.themeMotion === true && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && themeChoice() !== 'life';
  const key = active ? themeChoice() || 'system' : '';
  if (key === ambientKey) return;
  ambientKey = key;
  document.getElementById('theme-atmosphere')?.remove();
  if (!key) return;
  const layer = document.createElement('div');
  layer.id = 'theme-atmosphere';
  layer.className = 'theme-atmosphere atmosphere-' + key;
  layer.setAttribute('aria-hidden', 'true');
  const count = key === 'samurai' ? 18 : 12;
  for (let i = 0; i < count; i++) {
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

function applyWallpaper() {
  document.getElementById('theme-wallpaper')?.remove();
  let wp = state.settings.wallpaper;
  if (!wp || wp === 'auto') {
    if (state.settings.theme === 'samurai') wp = 'samurai-moon';
    else if (state.settings.theme === 'paper') wp = 'paper-warm';
    else if (state.settings.theme === 'forest') wp = 'forest-canopy';
    else if (state.settings.theme === 'ocean') wp = 'ocean-tides';
  }
  if (!wp || wp === 'none') return;
  const layer = document.createElement('div');
  layer.id = 'theme-wallpaper';
  layer.className = 'theme-wallpaper';
  layer.setAttribute('aria-hidden', 'true');
  const opacity = state.settings.wallpaperOpacity != null ? Number(state.settings.wallpaperOpacity) : 0.45;
  layer.style.opacity = Math.max(0.05, Math.min(1, opacity));
  if (wp === 'samurai-moon') {
    layer.classList.add('wp-samurai-moon');
  } else if (wp === 'samurai-katana') {
    layer.classList.add('wp-samurai-katana');
  } else if (wp === 'paper-warm') {
    layer.classList.add('wp-paper-warm');
  } else if (wp === 'forest-canopy') {
    layer.classList.add('wp-forest-canopy');
  } else if (wp === 'ocean-tides') {
    layer.classList.add('wp-ocean-tides');
  } else if (wp === 'custom' && state.settings.customWallpaper) {
    layer.style.backgroundImage = `url("${state.settings.customWallpaper.replace(/"/g, '\\"')}")`;
  } else {
    return;
  }
  document.body.prepend(layer);
}

function applyTheme() {
  applyAtmosphere();
  applyWallpaper();
  const choice = themeChoice();
  const design = ['ocean', 'forest', 'paper', 'samurai'].includes(choice) ? choice : '';
  document.documentElement.dataset.design = design;
  if (choice === 'life') document.documentElement.dataset.look = 'life';
  else delete document.documentElement.dataset.look;
  // Calm: inside Life, or with "Living atmosphere" off, nothing loops forever.
  document.documentElement.toggleAttribute('data-calm', inLifeNow() || state.settings.themeMotion !== true);
  const t = choice === 'life' ? lifeMode() : design ? (design === 'paper' ? 'light' : 'dark') : choice;
  if (t === 'dark' || t === 'light') {
    document.documentElement.dataset.theme = t;
    ownTheme = true;
  } else if (ownTheme) {
    delete document.documentElement.dataset.theme;
    ownTheme = false;
  }
}

// Life switched light/dark (EmbedHost sets data-life-mode and tells us).
window.addEventListener('life-theme', () => { if (!state._sealed && !document.getElementById('life-tabs')?.dataset.ready) render(); else if (themeChoice() === 'life') applyTheme(); });

AmbientMusic.subscribe(() => {
  renderSidebar();
  if (ui.tab === 'settings' && ['general', 'extras'].includes(ui.settingsTab)) render();
});

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
    if (countsAsSpending(t)) spent[k] = (spent[k] || 0) + signed(t, M.B(t));
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

function sparkline(values, w = 216, h = 28) {
  if (values.length < 2) return '';
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pad = 4;
  const step = (w - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => [pad + i * step, h - pad - ((v - min) / span) * (h - pad * 2)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = pts.at(-1);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="spark-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--gold)" stop-opacity="0.38"/>
        <stop offset="100%" stop-color="var(--gold)" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${line} L${(w - pad).toFixed(1)} ${h} L${pad} ${h} Z" fill="url(#spark-g)"/>
    <path d="${line}" class="spark-line" pathLength="1"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.2" class="spark-dot"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="6" class="spark-pulse"/>
  </svg>`;
}

// Lei, euro and dollars: a total in the other two, today's rates, and how
// old they are when they could not be updated ("rates from 3 Nov").
function ratesLine(totalCents = null) {
  const base0 = state.settings.currency;
  const r = M.knownRates(state);
  const others = ['EUR', 'USD'].filter((c) => c !== base0);
  const pair = (c) => pairRate(c, base0, r);
  const parts = others.filter((c) => pair(c)).map((c) => `1 ${c === 'USD' ? '$' : '€'} = ${formatRate(pair(c))} ${base0 === 'MDL' ? 'lei' : base0}`);
  if (!parts.length) return '';
  const alt = totalCents == null ? '' : others.map((c) => convert(totalCents, base0, c, r)).map((v, i) => (v == null ? '' : formatMoney(Math.round(v / 100) * 100, others[i], { compact: true }))).filter(Boolean).join(' · ');
  // The date of the rate used (js/ratedate.js), and a quiet chip when it is more than 3 days old.
  const dated = Tidy.rateDateHTML({ today: todayISO() });
  return `<p class="rates-note">${alt ? `≈ ${alt} · ` : ''}${parts.join(' · ')}${dated ? ` · ${dated}` : ' · rates from your last records'}</p>`;
}

const EYE_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

// Inside Life on a phone-width screen: one slim strip of sections at the top. From 720px the sidebar does this.
const LIFE_TABS = [['home', 'Home'], ['log', 'Log'], ['accounts', 'Accounts'], ['goals', 'Goals'], ['plan', 'Plan'], ['reports', 'Reports']];
const LIFE_NARROW = window.matchMedia('(max-width: 719px)');
LIFE_NARROW.addEventListener?.('change', () => { if (!state._sealed) renderSidebar(); });
function renderLifeTabs() {
  const nav = document.getElementById('life-tabs');
  if (!nav || !inLifeNow()) return;
  // Only a phone-width screen has the strip; wider ones have the sidebar (and one "New record" button, not two).
  if (!LIFE_NARROW.matches) {
    if (nav.dataset.ready) { nav.innerHTML = ''; nav.hidden = true; delete nav.dataset.ready; }
    return;
  }
  if (!nav.dataset.ready) {
    nav.dataset.ready = '1';
    nav.hidden = false;
    // Each section keeps its sidebar icon and colour, so it's quick to spot.
    const icon = (tab) => {
      const a = document.querySelector(`a[data-tab="${tab}"] .ni svg`)?.closest('a');
      const svg = a?.querySelector('.ni svg')?.outerHTML ?? '';
      return { svg, color: a?.style.getPropertyValue('--nc') || 'var(--text-2)' };
    };
    const dots = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>';
    nav.innerHTML = `<div class="lt-scroll">${LIFE_TABS.map(([tab, label]) => { const i = icon(tab); return `<a href="#${tab}" data-tab="${tab}" style="--nc:${i.color}">${i.svg ? `<span class="lt-i">${i.svg}</span>` : ''}<span>${label}</span></a>`; }).join('')}<button type="button" class="lt-more" data-act="more" aria-label="More sections"><span class="lt-i">${dots}</span><span>More</span></button></div>
      <button type="button" class="lt-eye" data-act="toggle-mask" data-testid="privacy-eye-strip"></button>
      <button type="button" class="lt-add" data-act="add" aria-label="Add a record"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>New</span></button>`;
  }
  const cur = NAV_PARENT[ui.tab] || ui.tab;
  const inStrip = LIFE_TABS.some(([t]) => t === cur);
  for (const a of nav.querySelectorAll('a')) a.toggleAttribute('aria-current', a.dataset.tab === cur);
  nav.querySelector('.lt-more')?.setAttribute('aria-pressed', String(!inStrip));
  const eye = nav.querySelector('.lt-eye');
  if (eye) {
    const hid = Privacy.isHidden();
    eye.innerHTML = hid ? EYE_OFF : EYE_ON;
    eye.title = hid ? 'Show amounts (Space)' : 'Hide amounts (Space)';
    eye.setAttribute('aria-label', hid ? 'Show amounts' : 'Hide amounts');
    eye.setAttribute('aria-pressed', String(hid));
  }
}

function renderSidebar() {
  renderLifeTabs();
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

  const isMasked = Privacy.isHidden();
  const totalDisplay = formatMoney(shown, '');
  const netSign = s.net >= 0 ? '+' : '−';
  const netAbs = Math.abs(s.net);
  const trendDisplay = isMasked ? '••••' : `${netSign}${money(Math.round(netAbs / 100) * 100, { compact: true })}`;
  const trendCls = s.net >= 0 ? 'pos' : 'neg';
  const savingsRate = s.income > 0 ? (s.net > 0 ? Math.round((s.net / s.income) * 100) : 0) : null;

  top.innerHTML = `<div class="sc-body" role="button" tabindex="0" data-go="accounts" title="Open Accounts &amp; Net Worth">
    <div class="sc-head">
      <span class="sc-label">All my money</span>
      <button type="button" class="sc-mask-btn" data-act="toggle-mask" data-testid="privacy-eye" title="${isMasked ? 'Show amounts (Space)' : 'Hide amounts (Space)'}" aria-label="${isMasked ? 'Show amounts' : 'Hide amounts'}" aria-pressed="${isMasked}">
        ${isMasked ? EYE_OFF : EYE_ON}
      </button>
    </div>
    <div class="sc-total-wrap">
      <span class="sc-total">${totalDisplay}<small>${esc(state.settings.currency)}</small></span>
      <span class="sc-badge ${trendCls}" title="Net flow this month: ${money(s.net, { sign: true })}">
        ${s.net >= 0 ? '▲' : '▼'} ${trendDisplay}
      </span>
    </div>
    ${sparkline(series)}
    <div class="sc-row">
      <div class="sc-stat">
        <span class="sc-stat-label">This month</span>
        <b class="sc-stat-val ${s.net >= 0 ? 'income' : 'expense'}">${money(Math.round(s.net / 100) * 100, { sign: true })}</b>
      </div>
      <div class="sc-stat sc-stat-right">
        <span class="sc-stat-label">Savings rate</span>
        <b class="sc-stat-val gold">${savingsRate != null ? `${savingsRate}%` : '—'}</b>
      </div>
    </div>
  </div>`;

  // The balance rolls to its new value (never while amounts are hidden).
  const totalEl = top.querySelector('.sc-total');
  if (before != null && before !== shown && totalEl?.firstChild?.nodeType === 3) {
    Flow.countTo(totalEl.firstChild, { from: before, to: shown, fmt: (v) => formatMoney(v, ''), hidden: Privacy.isHidden, off: () => reducedMotion() || Flow.flowOff() });
  }
  // The balance moved (a record, an undo, a sync): show by how much.
  if (before != null && before !== shown && !isMasked) {
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
  badge('people', overdue ? String(overdue) : open ? String(open) : '', overdue ? 'alert' : '');
  badge('log', todayCount ? `${todayCount} today` : '', 'soft');
  badge('goals', gs.target && gs.ratio > 0 ? `${Math.round(gs.ratio * 100)}%` : '', 'gold');
  badge('telegram', Telegram.isLinked?.() ? '● On' : '', 'soft');
  const rc = Checkup.badge(today);
  badge('reality', rc.text, rc.kind);

  const ambState = AmbientMusic.getState();
  const currentTrack = AmbientMusic.TRACKS.find((t) => t.id === ambState.track) || AmbientMusic.TRACKS[0];
  const ambPill = `<div class="sf-ambient">
    <button type="button" class="ambient-pill ${ambState.playing ? 'playing' : ''}" data-act="amb-toggle" title="${ambState.playing ? 'Pause' : 'Play'} Lo-Fi & Zen music (${esc(currentTrack.name)})">
      <span class="amb-note">${currentTrack.icon}</span>
      <span class="amb-label">
        <b>${esc(currentTrack.name)}</b>
        <small>${ambState.playing ? 'Playing Lo-Fi' : 'Offline Lo-Fi Player'}</small>
      </span>
      <span class="amb-waves" aria-hidden="true">
        <i class="w1"></i><i class="w2"></i><i class="w3"></i>
      </span>
    </button>
    <button type="button" class="amb-next-mini" data-act="amb-next" title="Next track">⏭</button>
  </div>`;

  // The sidebar is the menu: the goal lives on Home and in the Goals badge,
  // Bit in Settings → Bit; only the music shows here, and only while playing.
  bottom.innerHTML = (ambState.playing ? ambPill : '') + Recent.sideButton();
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


// A new spending record without a subcategory gets the one its note fits.
function autoSub(t) {
  if (t.type !== 'expense' || T.subOf(state, t)) return;
  const g = T.suggestSub(state, t.note, { category: t.category })?.sub;
  if (g) { t.sub = g.id; t.category = g.parent; }
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
    const sc = T.subOf(state, t);
    const who = t.person ? M.person(state, t.person)?.name : null;
    const icon = sc?.emoji || c.emoji;
    av = `<span class="av${icon ? ' av-emoji' : ''}" style="--c:${catColor(t.category)}" aria-hidden="true">${icon ? esc(icon) : initial(c.name)}</span>`;
    title = t.note || (sc ? sc.name : c.name);
    sub = [sc ? `${c.name} › ${sc.name}` : c.name, who ? `${t.type === 'income' ? 'from' : 'to'} ${who}` : null, accOf(t.account).name].filter(Boolean).join(' · ');
    const ty = M.typedAs(t);
    // In another currency: what it was in lei too (at that day's rate).
    const inLei = cur !== state.settings.currency && Number.isInteger(t.base) ? `<small class="typed-as">≈ ${formatMoney(t.base, state.settings.currency)}</small>` : '';
    // A reward bought in Life System (life-reward-…): tagged, so you can tell it from real spending.
    const fromRewards = String(t.id || '').startsWith('life-reward-') ? '<span class="pill" title="Bought with points in Life System Rewards">From Rewards (points)</span> ' : '';
    // A reconciliation adjustment (js/reconcile.js): labelled, it is not income or spending.
    const recon = t.reconcile ? '<span class="pill" title="Settles a difference with your bank; not income or spending">Reconciliation</span> ' : '';
    const refundPill = isRefund(t) ? '<span class="pill" title="Money back for something you bought: it lowers spending, it is not income">Refund</span> ' : '';
    const notPill = isNotCounted(t) ? `<span class="pill not-counted" data-testid="not-counted-tag" title="The balance changed, but this is left out of ${t.type === 'income' ? 'income' : 'spending'} totals">${t.type === 'income' ? 'not income' : 'not spending'}</span> ` : '';
    amount = `<span class="amount ${isNotCounted(t) ? 'not-counted' : t.type === 'income' ? 'income' : ''}">${IS.tagHTML(state, t)}${fromRewards}${recon}${refundPill}${notPill}${t.loan ? '<span class="pill">loan</span> ' : ''}${t.type === 'income' ? fm(t.amount, { sign: true }) : fm(-t.amount)}${ty ? `<small class="typed-as">${formatMoney(ty.amount, ty.currency)}</small>` : inLei}</span>`;
  }
  if (showDate) sub = `${dayLabel(t.date)} · ${sub}`;
  return `<button class="tx" data-act="edit" data-id="${esc(t.id)}">
    ${av}
    <span class="t"><b>${esc(title)}</b><span>${esc(sub)}</span>${RecordX.rowChips(t)}</span>
    ${amount}
  </button>${RecordX.splitDetails(t)}`;
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
  return `<div class="rate log-rate-bar">
    <div class="row">${summary.net < 0
    ? `<span>Deficit: spent <b class="expense">${money(-summary.net)}</b> more than you earned</span>`
    : `<span>Saved <b class="${good ? 'income' : 'expense'}">${pct(summary.savingsRate)}</b> of income</span>`}<span class="muted">Safe Target: <b>${target}%</b></span></div>
    <div class="bar ${good ? '' : 'over'}"><i style="width:${(r * 100).toFixed(1)}%"></i><span class="mark" style="left:${target}%"></span></div>
  </div>`;
}

function stats(s, key = 'm') {
  const target = M.savingsJar(state)?.pct ?? 70;
  const netGood = s.net >= 0;
  const ratePct = s.income > 0 ? Math.round(s.savingsRate * 100) : 0;
  const isTargetMet = ratePct >= target;
  const w = s.expense ? workText(state, s.expense, todayISO()) : '';
  return `<div class="stats log-kpi-grid">
    <div class="stat log-kpi-card in">
      <div class="log-kpi-top"><span class="k">Earned</span><span class="log-kpi-badge in">↗ Inflow</span></div>
      <b class="income log-kpi-val">${countUp(s.income, `${key}-in`)}</b>
      <span class="log-kpi-sub muted">${monthLabel(ui.month)} earnings</span>
    </div>
    <div class="stat log-kpi-card out">
      <div class="log-kpi-top"><span class="k">Spent</span><span class="log-kpi-badge out">↘ Outflow</span></div>
      <b class="expense log-kpi-val">${countUp(s.expense, `${key}-out`)}</b>
      <span class="log-kpi-sub muted">${w ? `<span title="What it cost in your work time (Settings → Your hour)">≈ ${esc(w)} of work</span>` : 'Monthly outflow'}</span>
    </div>
    <div class="stat log-kpi-card net ${netGood ? 'good' : 'bad'}">
      <div class="log-kpi-top"><span class="k">Net Cash Flow</span><span class="log-kpi-badge ${netGood ? (isTargetMet ? 'gold' : 'in') : 'bad'}">${netGood ? `${ratePct}% kept` : 'Deficit'}</span></div>
      <b class="log-kpi-val ${netGood ? 'income' : 'expense'}">${countUp(s.net, `${key}-net`, { sign: true })}</b>
      <span class="log-kpi-sub muted">${s.net < 0 ? `Spent <b class="expense">${money(-s.net)}</b> over income` : `Target: ${target}% safe savings`}</span>
    </div>
  </div>`;
}

function jarsCard(key) {
  const rows = M.jarStatus(state, key, todayISO());
  const income = M.monthSummary(state, key).income;
  const body = rows.map((j) => {
    if (j.savings) {
      const r = j.budget ? Math.min(1, j.used / j.budget) : 0;
      const pctVal = Math.round(r * 100);
      return `<div class="liquid-jar-card" data-go="accounts" title="Deposit / Safe Jar">
        <div class="liquid-jar-fluid gold" style="height:${Math.max(12, pctVal)}%;">
          <svg class="liquid-jar-wave" viewBox="0 0 100 20" preserveAspectRatio="none"><path d="M0 10 Q 25 18, 50 10 T 100 10 V 20 H 0 Z" fill="rgba(200, 160, 80, 0.7)"/></svg>
        </div>
        <div class="liquid-jar-header">
          <span class="liquid-jar-title">${j.jar.emoji || '🏦'} ${esc(j.jar.name)}</span>
          <span class="liquid-jar-pct">${j.jar.pct}%</span>
        </div>
        <div class="liquid-jar-content">
          <span class="liquid-jar-fig">${money(j.used)}</span>
          <span class="liquid-jar-sub">${!j.budget ? 'Waiting for income' : j.left >= 0 ? 'Target reached ✓' : `${money(-j.left)} to goal`}</span>
        </div>
      </div>`;
    }
    const over = j.used > j.budget;
    const r = j.budget ? Math.min(1, j.used / j.budget) : j.used ? 1 : 0;
    const pctVal = Math.round(r * 100);
    const fluidColor = over ? 'crimson' : 'emerald';
    const waveFill = over ? 'rgba(230, 75, 75, 0.75)' : 'rgba(46, 196, 120, 0.65)';
    return `<div class="liquid-jar-card" data-go="log" data-jar="${esc(j.jar.id)}" title="${esc(j.jar.name)}">
      <div class="liquid-jar-fluid ${fluidColor}" style="height:${Math.min(100, Math.max(12, pctVal))}%;">
        <svg class="liquid-jar-wave" viewBox="0 0 100 20" preserveAspectRatio="none"><path d="M0 10 Q 25 18, 50 10 T 100 10 V 20 H 0 Z" fill="${waveFill}"/></svg>
      </div>
      <div class="liquid-jar-header">
        <span class="liquid-jar-title">${j.jar.emoji || '🫙'} ${esc(j.jar.name)}</span>
        <span class="liquid-jar-pct">${j.jar.pct}%</span>
      </div>
      <div class="liquid-jar-content">
        <span class="liquid-jar-fig">${over ? money(j.used - j.budget) : money(j.left)}</span>
        <span class="liquid-jar-sub ${over ? 'bad' : ''}">${over ? 'Over budget leak' : `${money(j.budget, { compact: true })} plan`}</span>
      </div>
    </div>`;
  }).join('');
  return `<section class="card">
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <h2 style="margin:0;">Smart split jars</h2>
      <button class="card-link" data-go="settings" data-sub="categories">Rules</button>
    </div>
    ${rows[0]?.estimated ? `<p class="muted small" style="margin-top:6px; margin-bottom:0;">Budgets use your usual income (${money(rows[0].basis)} a month) until this month's comes in${income ? `: ${money(income)} so far` : ''}.</p>`
    : income ? '' : '<p class="muted small" style="margin-top:6px; margin-bottom:0;">Log your income this month and each jar gets its share.</p>'}
    <div class="liquid-jars-grid">${body}</div>
  </section>`;
}


// Home's month strip (look B): earned, spent, kept, and the savings rate.
// Home's month strip: YOUR money (what came in for you, what you lived on,
// what you kept). The work's own numbers are in the line under it.
function homeStrip(s, key) {
  const p = M.personalMonth(state, key);
  const target = M.savingsJar(state)?.pct ?? 0;
  const w = p.personalSpent ? workText(state, p.personalSpent, todayISO()) : '';
  const r = Math.max(0, Math.min(1, p.rate || 0));
  const diff = Math.round((p.rate || 0) * 100) - target;
  const rate = p.personalIncome > 0 ? `<div class="ms-cell ms-rate"><span class="k"><span>Savings rate</span><span>goal ${target}%</span></span>
      <div class="bar ${diff < 0 ? 'over' : ''}"><i style="width:${(r * 100).toFixed(1)}%"></i><span class="mark" style="left:${target}%"></span></div>
      <p class="${diff < 0 ? 'bad' : ''}">${p.kept < 0 ? `${money(-p.kept)} more than came in for you` : diff >= 0 ? `${diff} points above your goal` : `${-diff} points below your goal`}</p></div>` : '';
  const inSub = p.pay ? (p.salary ? 'your salary' : 'salary not paid yet') + (p.otherIncome ? ` + ${money(p.otherIncome, { compact: true })} other` : '')
    : p.workIncome ? 'work profit + other income' : '';
  return `<section class="m-strip" aria-label="${esc(monthLabel(key))}: your money">
    <div class="ms-cell"><span class="k">Came in for you</span><b class="${p.personalIncome > 0 ? 'income' : ''}">${countUp(p.personalIncome, 'm-in')}</b>${inSub ? `<span class="work-time">${esc(inSub)}</span>` : ''}</div>
    <div class="ms-cell"><span class="k">You lived on</span><b class="${p.personalSpent ? 'expense' : ''}">${countUp(p.personalSpent, 'm-out')}</b>${w ? `<span class="work-time" title="What it cost in your work time (Settings → Your hour)">≈ ${w} of your work</span>` : p.workCosts ? '<span class="work-time">work costs not included</span>' : ''}</div>
    <div class="ms-cell"><span class="k">Kept</span><b>${countUp(p.kept, 'm-net')}</b></div>
    ${rate}
  </section>
  ${workLine(p)}`;
}

// The work, on its own line: what clients paid, what the work cost, profit.
function workLine(p) {
  if (!p.workIncome && !p.workCosts) return '';
  return `<div class="work-line" role="note"><span class="wl-k">💼 Work this month</span>
    <span>Earned <b class="income">${money(whole(p.workIncome))}</b></span><span>Costs <b>${money(whole(p.workCosts))}</b></span>
    <span>Profit <b class="${p.profit < 0 ? 'expense' : ''}">${money(whole(p.profit))}</b></span>
    ${p.workIncome ? '' : '<span class="muted">No client payment yet this month</span>'}</div>`;
}

// Pay yourself: the salary from your buffer, and how long the buffer lasts.
function payCard(today) {
  const st = Pay.payStatus(state, today);
  // Not set up: the invitation is a "Do this next" step (js/nextsteps.js).
  if (!st.on) return '';
  const buf = M.account(state, state.settings.pay.buffer);
  const months = Pay.runwayText(st.runway);
  return `<section class="card pay-card ${st.due ? (st.short ? 'short' : 'due') : ''}">
    <div class="pc-main"><span class="k">💸 Pay yourself <button class="card-link" data-act="pay-setup">Edit</button></span>
      <b class="pc-fig">${money(st.amount)} <span class="muted small">a month</span></b>
      <span class="pc-sub">${st.paid ? `Paid ${esc(dayLabel(st.paid.date))} · next ${esc(dayLabel(st.next))}` : st.due ? `Due since ${esc(dayLabel(st.date))}` : `Next salary ${esc(dayLabel(st.next))}`}</span></div>
    <div class="pc-runway"><span class="k">Buffer · ${esc(buf?.name || '')}</span><b>${money(Math.round(st.bufferBalance / 100) * 100)}</b>
      <span class="${st.runway < 3 ? 'expense' : st.runway >= 6 ? 'income' : ''}">covers ${esc(months)}</span></div>
    ${st.due ? `<div class="pc-act">${st.short ? `<p class="lock-msg" style="margin:0 0 8px">The buffer has less than one salary. Pay what's there, or lower the salary.</p>` : ''}<button class="btn primary" data-act="pay-now">Pay yourself ${money(st.amount)}</button></div>` : ''}
  </section>`;
}

function paySettingsCard() {
  const st = Pay.payStatus(state, todayISO());
  return `<section class="card"><h2>Pay yourself</h2>
    <p class="muted small" style="margin-top:0">${st.on ? `Salary <b>${money(st.amount)}</b> a month on day ${state.settings.pay.day}, from <b>${esc(M.account(state, state.settings.pay.buffer)?.name || '')}</b>. Buffer covers ${esc(Pay.runwayText(st.runway))}.`
    : 'Keep client money in a buffer account and pay yourself a fixed monthly salary from it, so slow months don\'t hurt.'}</p>
    <button class="btn block" data-act="pay-setup">${st.on ? 'Change' : 'Set it up'}</button></section>`;
}

function payNow() {
  const tx = Pay.salaryTx(state, todayISO(), { id: M.uid() });
  if (!tx) { toast('Needs an exchange rate between the buffer and your account first (Accounts → Rates).'); return; }
  state.tx.push(tx);
  commit();
  toast(`Salary paid: ${formatMoney(tx.base, state.settings.currency)} to ${M.account(state, tx.to)?.name || 'your account'}.`);
}

function openPaySheet() {
  const today = todayISO();
  const p = state.settings.pay || {};
  const sug = Pay.suggestSalary(state, today);
  const accs = state.settings.accounts.filter((a) => !a.archived);
  const opts = (sel) => accountOptionsHTML(accs, sel, { baseCur: state.settings.currency });
  const guessBuffer = p.buffer || (accs.find((a) => a.currency && a.currency !== state.settings.currency && !a.savings && a.kind !== 'crypto') || accs.find((a) => a.kind === 'card'))?.id;
  const guessTo = p.to || (accs.find((a) => a.kind === 'cash') || accs.find((a) => a.id !== guessBuffer))?.id;
  openSheet(`<h3>Pay yourself <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p class="muted small" style="margin-top:0">All client money goes into a <b>buffer</b>. Once a month the app moves your salary from it to your spending account, so every month looks the same.</p>
    <form id="pay-form" autocomplete="off">
      <label class="field"><span>Buffer (where client money lands)</span><select id="pay-buffer">${opts(guessBuffer)}</select></label>
      <label class="field"><span>Salary goes to</span><select id="pay-to">${opts(guessTo)}</select></label>
      <label class="field"><span>Salary per month (${esc(state.settings.currency)})</span><input id="pay-amount" type="text" inputmode="decimal" value="${p.amount ? centsToPlain(p.amount) : sug.amount ? centsToPlain(sug.amount) : ''}" placeholder="e.g. 15000"></label>
      <p class="muted small" style="margin:-4px 0 10px">${sug.amount ? `Suggested ${money(sug.amount)}: 80% of your average work profit (${money(sug.average)}) over the last ${sug.months} month${sug.months === 1 ? '' : 's'}. The other 20% grows the buffer.` : 'Tip: pick about 80% of what your work usually brings in a month.'} Saving happens in the buffer, so Safe to spend treats the salary as money to live on.</p>
      <label class="field"><span>Pay day</span><select id="pay-day">${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${(p.day || 1) === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
      <label class="field check"><input type="checkbox" id="pay-auto" ${p.auto ? 'checked' : ''}><span>Pay it automatically on pay day (when the app is open)</span></label>
      <p class="lock-msg" id="pay-err" hidden></p>
      <div class="btns">${p.on ? '<button type="button" class="btn danger" id="pay-off">Turn off</button>' : '<button type="button" class="btn" data-close>Not now</button>'}<button class="btn primary" type="submit">${p.on ? 'Save' : 'Start paying myself'}</button></div>
    </form>`, (sheet) => {
    sheet.querySelector('#pay-off')?.addEventListener('click', () => {
      state.settings.pay = { ...state.settings.pay, on: false };
      state.settings.updatedAt = Date.now();
      commit(); closeSheet(); toast('Pay yourself is off. Your salaries so far stay in the log.');
    });
    sheet.querySelector('#pay-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const err = sheet.querySelector('#pay-err');
      const buffer = sheet.querySelector('#pay-buffer').value;
      const to = sheet.querySelector('#pay-to').value;
      const amount = evalAmount(sheet.querySelector('#pay-amount').value);
      const fail = (m) => { err.textContent = m; err.hidden = false; };
      if (!buffer || !to) return fail('Pick both accounts.');
      if (buffer === to) return fail('The buffer and the salary account must be different.');
      if (!(amount > 0)) return fail('Type the salary, e.g. 15000.');
      state.settings.pay = { on: true, buffer, to, amount, day: Number(sheet.querySelector('#pay-day').value) || 1, auto: sheet.querySelector('#pay-auto').checked };
      state.settings.updatedAt = Date.now();
      commit();
      closeSheet();
      const st = Pay.payStatus(state, todayISO());
      toast(`Done. Your buffer covers ${Pay.runwayText(st.runway)}.${st.due ? ' This month\'s salary is ready to pay on Home.' : ''}`);
    });
  });
}

// ---------- Spending money ----------
// Which accounts Safe to spend counts. The app guesses (cards and cash, not
// savings or business, plus the account you really spend from); you can pick.
function spendFromLine() {
  const ids = spendingIds(state, todayISO());
  const names = state.settings.accounts.filter((a) => ids.has(a.id)).map((a) => a.name);
  return `<button type="button" class="sh-from" data-act="spend-setup" title="Choose which accounts count">Counting ${names.length ? esc(names.slice(0, 3).join(', ')) + (names.length > 3 ? ` +${names.length - 3}` : '') : 'no accounts'} · <u>change</u></button>`;
}

function spendSettingsCard() {
  const ids = spendingIds(state, todayISO());
  const names = state.settings.accounts.filter((a) => ids.has(a.id)).map((a) => a.name);
  const own = Array.isArray(state.settings.spendFrom) && state.settings.spendFrom.length;
  return `<section class="card"><h2>Spending money</h2>
    <p class="muted small" style="margin-top:0">Safe to spend counts <b>${esc(names.join(', ') || 'nothing yet')}</b>${own ? ' (your choice)' : ', guessed from where you spend'}. Savings and business accounts stay out unless you add them.</p>
    <button class="btn block" data-act="spend-setup">Choose accounts</button></section>`;
}

function openSpendSheet() {
  const today = todayISO();
  const ids = spendingIds(state, today);
  const from = new Map(spentFrom(state, today).map((x) => [x.id, x.share]));
  const vals = M.accountValues(state).filter((v) => !v.account.archived);
  const why = (a) => {
    const share = from.get(a.id);
    if (share >= 0.05) return `${Math.round(share * 100)}% of your everyday spending lately`;
    if (a.kind === 'business') return 'Work money: better paid out as a salary';
    if (a.savings || a.kind === 'savings') return 'Savings';
    if (a.kind === 'crypto') return 'Crypto';
    return 'Not used for spending lately';
  };
  openSheet(`<h3>Spending money <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p class="muted small" style="margin-top:0">Tick the accounts you live from. Safe to spend shares out what's in them, minus bills, until payday.</p>
    <form id="spend-form" class="spend-list">
      ${vals.map((v) => `<label class="spend-row"><input type="checkbox" name="acc" value="${esc(v.account.id)}" ${ids.has(v.account.id) ? 'checked' : ''}>
        <span class="spend-t"><b>${esc(v.account.name)}</b><small>${esc(why(v.account))}</small></span>
        <span class="spend-bal">${formatMoney(v.own, v.account.currency || state.settings.currency)}</span></label>`).join('')}
      <p class="lock-msg" id="spend-err" hidden></p>
      <div class="btns"><button type="button" class="btn" id="spend-auto">Let the app guess</button><button class="btn primary" type="submit">Save</button></div>
    </form>`, (sheet) => {
    sheet.querySelector('#spend-auto').addEventListener('click', () => {
      delete state.settings.spendFrom;
      state.settings.updatedAt = Date.now();
      commit(); closeSheet(); toast('Spending money is guessed from where you spend.');
    });
    sheet.querySelector('#spend-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const picked = [...sheet.querySelectorAll('input[name=acc]:checked')].map((i) => i.value);
      if (!picked.length) { const err = sheet.querySelector('#spend-err'); err.textContent = 'Tick at least one account.'; err.hidden = false; return; }
      state.settings.spendFrom = picked;
      state.settings.updatedAt = Date.now();
      commit();
      closeSheet();
      toast(`Saved. Safe to spend today: ${money(Math.max(0, safeToSpend(state, todayISO()).leftToday))}.`);
    });
  });
}

// ---------- Spending limit ----------
// One number for the month's everyday spending (not bills, rent or work
// costs). Safe to spend then never gives a day more than its fair share of
// what is left of it.
function limitSettingsCard() {
  const lim = limitStatus(state, todayISO());
  return `<section class="card"><h2>Spending limit</h2>
    <p class="muted small" style="margin-top:0">${lim ? `<b>${money(lim.amount)}</b> a month for everyday spending. This month: ${money(lim.spent)} spent, ${lim.left >= 0 ? `${money(lim.left)} left` : `<span class="expense">${money(-lim.left)} over</span>`}.`
    : 'Pick how much you want to spend in a month on everyday things (food, going out, shopping). Safe to spend then shares it out day by day. Bills and rent don\'t count.'}</p>
    <button class="btn block" data-act="limit-setup">${lim ? 'Change' : 'Set a limit'}</button></section>`;
}

function openLimitSheet() {
  const today = todayISO();
  const key = monthKey(today);
  const cur = state.settings.limit || {};
  const usual = suggestLimit(state, today);
  const spent = everydaySpent(state, `${key}-01`, today);
  const daysLeft = daysInMonth(key) - Number(today.slice(8)) + 1;
  const chips = usual ? [[usual, 'My usual'], [Math.round(usual * 0.9 / 10000) * 10000, '−10%'], [Math.round(usual * 0.8 / 10000) * 10000, '−20%']] : [];
  openSheet(`<h3>Spending limit <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p class="muted small" style="margin-top:0">How much for everyday spending this month: food, going out, shopping, taxis. Bills, rent, repeating payments and work costs don't count.</p>
    <form id="limit-form" autocomplete="off">
      <label class="field"><span>Limit per month (${esc(state.settings.currency)})</span><input id="limit-amount" type="text" inputmode="decimal" value="${cur.amount ? centsToPlain(cur.amount) : usual ? centsToPlain(usual) : ''}" placeholder="e.g. 8000"></label>
      ${chips.length ? `<div class="picks lim-chips">${chips.map(([v, l]) => `<button type="button" class="pick" data-lim="${v}">${l} <b>${formatMoney(v, state.settings.currency, { compact: true })}</b></button>`).join('')}</div>` : ''}
      <div class="lim-preview" id="limit-preview" aria-live="polite"></div>
      <p class="lock-msg" id="limit-err" hidden></p>
      <div class="btns">${cur.on ? '<button type="button" class="btn danger" id="limit-off">Turn off</button>' : '<button type="button" class="btn" data-close>Not now</button>'}<button class="btn primary" type="submit">${cur.on ? 'Save' : 'Set the limit'}</button></div>
    </form>`, (sheet) => {
    const input = sheet.querySelector('#limit-amount');
    const preview = sheet.querySelector('#limit-preview');
    const show = () => {
      const v = evalAmount(input.value);
      if (!(v > 0)) { preview.innerHTML = ''; return; }
      const left = v - spent;
      const perDay = left > 0 ? Math.floor(left / daysLeft / 100) * 100 : 0;
      const pct = Math.min(100, (spent / v) * 100);
      preview.innerHTML = `<div class="lim-bar ${left < 0 ? 'over' : ''}"><i style="width:${pct.toFixed(1)}%"></i></div>
        <div class="lim-figs"><span><b>${money(spent)}</b> spent this month</span><span>${left >= 0 ? `<b>${money(left)}</b> left` : `<b class="expense">${money(-left)}</b> over`}</span></div>
        <p class="lim-day">${left > 0 ? `About <b>${money(perDay)}</b> a day for the ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : 'Nothing left for this month at this limit'}${usual ? ` · you usually spend ${money(usual)}` : ''}</p>`;
    };
    input.addEventListener('input', show);
    sheet.querySelectorAll('[data-lim]').forEach((b) => b.addEventListener('click', () => { input.value = centsToPlain(Number(b.dataset.lim)); show(); }));
    show();
    sheet.querySelector('#limit-off')?.addEventListener('click', () => {
      state.settings.limit = { ...state.settings.limit, on: false };
      state.settings.updatedAt = Date.now();
      commit(); closeSheet(); toast('Spending limit is off. Safe to spend goes by your money only.');
    });
    sheet.querySelector('#limit-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const amount = evalAmount(input.value);
      const err = sheet.querySelector('#limit-err');
      if (!(amount > 0)) { err.textContent = 'Type the limit, e.g. 8000.'; err.hidden = false; return; }
      state.settings.limit = { on: true, amount };
      state.settings.updatedAt = Date.now();
      commit();
      closeSheet();
      const sf = safeToSpend(state, todayISO());
      toast(`Limit set. Today you can spend ${money(Math.max(0, sf.leftToday))}.`);
    });
  });
}

// On pay day, if you chose "automatically": the salary moves by itself.
function autoPay() {
  if (state._sealed || DEMO) return;
  const st = Pay.payStatus(state, todayISO());
  if (!st.on || !st.due || st.short || !state.settings.pay.auto) return;
  const tx = Pay.salaryTx(state, todayISO(), { id: M.uid() });
  if (!tx) return;
  state.tx.push(tx);
  persist({ quiet: true });
  setTimeout(() => toast(`Salary paid: ${formatMoney(tx.base, state.settings.currency)} from your buffer.`), 1200);
}

// Compare identical elapsed days in the current and previous months.
function monthComparison(today) {
  const current = monthKey(today), previous = addMonths(current, -1);
  const day = Number(today.slice(8));
  const upTo = (key) => `${key}-${String(Math.min(day, daysInMonth(key))).padStart(2, '0')}`;
  const income = (key) => M.monthSummary({ ...state, tx: state.tx.filter((t) => Number(t.date.slice(8)) <= day) }, key).income;
  // Everyday spending only: rent and other bills land on one day and would
  // make any month look like +100%.
  const spent = (key) => everydaySpent(state, `${key}-01`, upTo(key));
  const comparison = (label, amount, was) => `<span>${label}: <b>${was ? `${amount >= was ? '+' : '−'}${Math.round((Math.abs(amount - was) / Math.abs(was)) * 100)}%` : 'No prior activity'}</b></span>`;
  return `<div class="month-comparison"><span>Days 1–${day} vs ${esc(monthLabel(previous))}</span>${comparison('Income', income(current), income(previous))}${comparison('Everyday spending', spent(current), spent(previous))}</div>`;
}

// The page title on Home says how the month is going.

// ---------- Screens ----------

// Dedicated Safe-to-Spend card on Home with 7-day velocity sparkline.
// Home: your spending cards as a small fanned wallet (the same designs as
// Accounts); a tap opens the card.
function wallet(sf) {
  const ids = spendingIds(state, todayISO());
  const vals = M.accountValues(state).filter((v) => ids.has(v.account.id))
    .sort((a, b) => (b.inBase || 0) - (a.inBase || 0)).slice(0, 3);
  if (!vals.length) return '';
  const cards = vals.map((v, i) => `<div class="shw-card" style="--i:${i}">${cardHTML(v, { money, base: state.settings.currency })}</div>`).reverse().join('');
  return `<div class="sh-wallet" style="--n:${vals.length}"><div class="shw-stack">${cards}</div>
    <button type="button" class="card-link shw-cap" data-act="spend-setup">${money(Math.round(Math.max(0, sf.liquid) / 100) * 100)} spending money →</button>
    ${state.settings.accounts.some((a) => !a.archived && a.currency !== state.settings.currency) ? ratesLine() : ''}</div>`;
}

function safeCard(today) {
  if (!state.tx.length) return '';
  const sf = safeToSpend(state, today);
  const cur = state.settings.currency;
  const left = sf.leftToday;
  const isOver = left < 0;
  const empty = sf.pool <= 0;
  const onTrack = left >= sf.perDay / 4;
  // Nothing spare is a calm "wait" (amber), not an alarm: the bills and savings simply come first.
  const tone = isOver && !empty ? 'over' : empty || !onTrack ? 'watch' : 'ok';
  const statusLabel = empty ? `Until ${shortDay(sf.payday)}` : isOver ? 'Over today' : onTrack ? 'On track' : 'Go easy';

  // The last 7 days against the daily share (bills and recurring don't count).
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    const spent = state.tx.filter((t) => t.date === d && countsAsSpending(t) && !t.recurring && !M.isBillCategory(state, t.category))
      .reduce((a, t) => a + signed(t, M.B(t)), 0);
    week.push({ d, spent });
  }
  // Scale to what you really spent; the daily share joins the scale only when
  // it is near it, otherwise it is named above the chart (no flat bars).
  const maxSpent = Math.max(...week.map((x) => x.spent), 0);
  const shareFits = sf.perDay > 0 && (maxSpent === 0 ? false : sf.perDay <= maxSpent * 2.5);
  const top = Math.max(maxSpent, shareFits ? sf.perDay : 0, 1) * 1.2;
  const avg = Math.round(week.reduce((a, x) => a + x.spent, 0) / 7);
  const bars = week.map((x) => {
    const pct = x.spent ? Math.max(6, (x.spent / top) * 100) : 2;
    const cls = [x.spent > sf.perDay && sf.perDay > 0 ? 'over' : '', x.d === today ? 'today' : ''].join(' ').trim();
    const label = x.d === today ? 'Today' : DOW_SHORT[dowIndex(x.d)];
    const val = x.spent ? `<b class="sh-val">${esc(formatMoney(whole(x.spent), '', { compact: true }))}</b>` : '';
    return `<div class="sh-bar ${cls}" title="${esc(label)} ${Number(x.d.slice(8))}: ${esc(money(x.spent))}"><i style="height:${pct.toFixed(1)}%">${val}</i><span>${label === 'Today' ? 'Today' : label.slice(0, 2)}</span></div>`;
  }).join('');
  const target = shareFits
    ? `<em class="sh-target" style="bottom:${((sf.perDay / top) * 100).toFixed(1)}%"><span>${esc(money(sf.perDay, { compact: true }))} a day</span></em>`
    : '';
  const used = sf.perDay > 0 ? Math.min(100, (sf.spentToday / sf.perDay) * 100) : 100;
  const fig = empty ? 0 : Math.max(0, left);

  let sub = empty
    ? `Bills and savings need <b>${money(sf.short)}</b> more before ${esc(shortDay(sf.payday))}.`
    : isOver
      ? `Over by <b>${money(-left)}</b>. From tomorrow: <b>${money(sf.tomorrow)}</b> a day until ${esc(shortDay(sf.payday))}.`
      : sf.byLimit
        ? `Spent <b>${money(sf.spentToday)}</b> of today's <b>${money(sf.perDay)}</b> · your limit decides today`
        : `Spent <b>${money(sf.spentToday)}</b> of today's <b>${money(sf.perDay)}</b> · <b>${money(whole(Math.max(0, sf.pool)))}</b> for ${sf.days} day${sf.days === 1 ? '' : 's'}, until ${esc(shortDay(sf.payday))}`;
  if (sf.planned > 0) sub += ` · <b>${money(sf.planned)}</b> kept aside for planned expenses`;
  const lim = sf.limit;
  const limitRow = lim
    ? `<button type="button" class="sh-limit ${lim.left < 0 ? 'over' : lim.projected > lim.amount ? 'pace' : ''}" data-act="limit-setup" title="Change your spending limit">
        <span class="shl-top"><span>Month limit</span><span><b>${money(lim.spent)}</b> of ${money(lim.amount)} · ${lim.left >= 0 ? `${money(lim.left)} left` : `${money(-lim.left)} over`}</span></span>
        <span class="sh-meter"><i style="width:${Math.min(100, lim.ratio * 100).toFixed(1)}%"></i></span>
        ${lim.left >= 0 && lim.projected > lim.amount ? `<span class="shl-pace">At this pace: ${money(lim.projected)} by the end of the month</span>` : ''}
      </button>`
    : '<button type="button" class="card-link sh-setlimit" data-act="limit-setup">Set a monthly spending limit →</button>';

  return `<section class="card safe-hero sh-${tone}" aria-label="Safe to spend today">
    <div class="sh-main">
      <div class="sh-k">Safe to spend today <span class="sh-chip">${statusLabel}</span></div>
      <b class="sh-fig">${formatMoney(fig, '')}<small>${esc(cur)}</small></b>
      <div class="sh-meter" role="img" aria-label="${Math.round(used)}% of today's share spent"><i style="width:${used.toFixed(1)}%"></i></div>
      <p class="sh-sub">${sub}</p>
      ${spendFromLine()}
      ${limitRow}
    </div>
    <div class="sh-week">
      <div class="sh-week-k"><span>Last 7 days</span><span>${money(whole(avg), { compact: true })} a day on average${!shareFits && sf.perDay > 0 ? ` · your share ${money(sf.perDay, { compact: true })}` : ''}</span></div>
      <div class="sh-bars">${target}${bars}</div>
    </div>
    ${wallet(sf)}
  </section>`;
}

// Home: one tap opens a record already filled in; Enter adds it.
function quickRow() {
  const picks = M.quickPicks(state, todayISO(), 8);
  if (!picks.length) return '';
  return `<div class="picks home-picks" role="group" aria-label="Quick add"><span class="label">Quick add</span>${picks.map((p, i) => `<button type="button" class="pick" data-act="quick-pick" data-i="${i}">${p.fav ? '<span class="gold">★</span> ' : ''}${esc(p.note || catOf(p.category).name)} <b class="${p.type === 'income' ? 'income' : ''}">${formatMoney(p.amount, p.currency, { compact: true })}</b></button>`).join('')}</div>`;
}

// "Do this next": up to three things worth doing today (js/nextsteps.js).
function stepsCard(today) {
  if (!state.tx.length) return '';
  const steps = nextSteps(state, today, { hidden: state.meta.stepsHidden || {}, demo: DEMO });
  if (!steps.length) return '';
  const attrs = (x) => (x.go ? `data-go="${esc(x.go)}"` : `data-act="${esc(x.act)}"${Object.entries(x.data || {}).map(([k, val]) => ` data-${k}="${esc(String(val))}"`).join('')}`);
  return `<section class="steps" aria-label="Do this next">
    <h2 class="steps-h">Do this next</h2>
    <div class="steps-grid">${steps.map((x, i) => `<article class="step lvl-${x.level}" style="--i:${i}">
      <span class="step-ic" aria-hidden="true">${esc(x.icon)}</span>
      <div class="step-t"><b>${esc(x.title)}</b><p>${esc(x.text)}</p></div>
      <div class="step-btns"><button type="button" class="btn sm ${x.level === 'nice' ? '' : 'primary'}" ${attrs(x)}>${esc(x.btn)}</button><button type="button" class="step-later" data-act="step-later" data-id="${esc(x.id)}">Later</button></div>
    </article>`).join('')}</div>
  </section>`;
}

function viewHome() {
  const today = todayISO();
  const key = monthKey(today);
  const s = M.monthSummary(state, key);
  const recent = M.sortTx(state.tx).slice(0, 5);
  const fc = forecast(state, today, { days: 45 });
  const fcTip = fc.low.value < 0 && (state.recurring.length || state.tx.length > 20)
    ? [{ level: 'bad', title: `Money may run short around ${dayLabel(fc.low.date)}`, text: `With your bills and usual spending, cards and cash would be at ${money(Math.round(fc.low.value / 100) * 100)}. See the forecast on Plan.` }] : [];
  const tips = [...fcTip, ...M.insights(state, key, today).filter((t) => t.level !== 'info')].slice(0, 2);
  const hour = new Date().getHours();
  const hello = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const v = verdict(state, today);

  const welcome = state.tx.length ? '' : `<section class="card">
    <h2>Start here</h2>
    <p style="margin-top:0">Every lei you log is a lei you control. Tap <b>+</b> for each thing you buy or earn. It takes 5 seconds.</p>
    <div class="btns">
      <button class="btn primary" data-act="add">Log the first one</button>
      <button class="btn" data-act="import-csv">Import my Google Sheet</button>
    </div>
    <p class="muted small" style="margin-bottom:0">Already have money in the wallet or safe? Set it under Settings → Accounts.</p>
  </section>`;

  return `<header class="top home-top v-${v.tone}"><div><div class="eyebrow">${esc(monthLabel(key))} · ${hello}</div><h1>${esc(v.title)}</h1><div class="sub home-verdict">${esc(v.sub)}</div></div><div class="sub">${dayLabel(today)}</div></header>
  ${MoneyB.topHTML()}
  ${Updates.updateBanner()}
  ${DEMO ? '<div class="banner"><p>Live preview with <b>example data</b> (a made-up month). What you add here stays in this browser only.</p></div>' : ''}
  ${Telegram.alertBanner()}
  ${Reprice.banner()}
  ${MoneyB2.reviewCard(today)}
  ${welcome}
  ${safeCard(today)}
  ${Afford.homeRow()}
  ${MoneyB.askBox()}
  ${stepsCard(today)}
  ${payCard(today)}
  ${CashCount.card(today)}
  ${homeStrip(s, key)}
  ${Spending.spendingCard({ key: 'home', period: ui.spendPeriod })}
  ${Goals.homeCard({ featured: true })}
  ${Money3.emergencyCard()}
  ${monthComparison(today)}
  ${Money3.favsCard() || quickRow()}
  <div class="dash">
    <div class="dash-main">
      ${recent.length ? `<section class="card"><h2>Recent <button class="card-link right" data-go="log">Open log</button></h2><div class="list">${recent.map((t) => txRow(t, { showDate: true })).join('')}</div></section>` : ''}
    </div>
    <div class="dash-side">
      ${Goals.otherGoalsCard()}
      ${Plan.homeCard()}
      ${MoneyB2.netWorthCard(today)}
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
  // "Include archived years" (js/archive.js) lets the search read them too.
  let list = q ? searchTx(ui.archived ? withArchive(state) : state, q, todayISO()) : M.txInMonth(state, ui.month);
  if (ui.filter === 'loan') list = list.filter((t) => t.loan);
  else if (ui.filter !== 'all') list = list.filter((t) => t.type === ui.filter);
  return list;
}

// Search results: how many, the totals, and when it first and last happened.
function searchCard(list) {
  // Totals from the matching split lines (js/splits.js): "cat:food" counts only the Food part.
  // Count and dates are the records found (archived years included when switched on).
  const whole = searchSummary(list, M.B);
  const lines = searchSummary(searchTx({ ...state, tx: list }, ui.search.trim(), todayISO(), { lines: true }), M.B);
  const r = { ...whole, spent: lines.spent, earned: lines.earned };
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
  const u = history.nextUndo() || Recent.nextLabel(-1);
  const r = history.nextRedo() || Recent.nextLabel(1);
  return `<span class="undo-pair" role="group" aria-label="Undo and redo">
    <button type="button" class="icon-btn" data-act="undo" ${u ? '' : 'disabled'} title="${u ? `Undo: ${esc(u)} (Ctrl+Z)` : 'Nothing to undo'}" aria-label="Undo">↶</button>
    <button type="button" class="icon-btn" data-act="redo" ${r ? '' : 'disabled'} title="${r ? `Redo: ${esc(r)} (Ctrl+Y)` : 'Nothing to redo'}" aria-label="Redo">↷</button>
    <button type="button" class="icon-btn" data-act="recent-actions" title="Recent actions (U)" aria-label="Recent actions" data-testid="recent-open-log">🕘</button></span>`;
}

// ---------- Bulk changes (Table) ----------

function selectedTx() {
  return state.tx.filter((t) => ui.selected.has(t.id));
}

function bulkBar() {
  const list = selectedTx();
  if (!list.length) return '';
  const out = list.filter((t) => t.type === 'expense' && !t.notSpending).reduce((a, t) => a + M.B(t), 0);
  const inc = list.filter((t) => t.type === 'income' && !t.notIncome).reduce((a, t) => a + M.B(t), 0);
  const cats = (type, label) => `<optgroup label="${label}">${state.settings.categories.filter((c) => c.type === type).map((c) => `<option value="${esc(c.id)}">${esc(`${c.emoji || ''} ${c.name}`.trim())}</option>`).join('')}</optgroup>`;
  return `<div class="bulk-bar" role="toolbar" aria-label="Change selected records">
    <b data-testid="bulk-count">${list.length} selected</b>
    <span class="muted small">${[out ? `−${money(out)}` : '', inc ? `+${money(inc)}` : ''].filter(Boolean).join(' · ')}</span>
    <select data-bulk="category" aria-label="Set category"><option value="">Set category…</option>${cats('expense', 'Spent')}${cats('income', 'Earned')}</select>
    <select data-bulk="account" aria-label="Set account"><option value="">Set account…</option>${accountOptionsHTML(state.settings.accounts.filter((a) => !a.archived), '', { baseCur: state.settings.currency })}</select>
    ${list.some((t) => t.type === 'income' && !t.loan) ? '<select data-bulk="income" data-testid="bulk-income" aria-label="Count as income"><option value="">Count as income…</option><option value="yes">Count as income: yes</option><option value="no">Count as income: no</option></select>' : ''}
    ${list.some((t) => t.type === 'expense' && !t.loan) ? '<select data-bulk="spending" data-testid="bulk-spending" aria-label="Count as spending"><option value="">Count as spending…</option><option value="yes">Count as spending: yes</option><option value="no">Count as spending: no</option></select>' : ''}
    ${list.some((t) => IS.canHaveSource(t)) && IS.hasSources(state) ? `<select data-bulk="source" data-testid="bulk-source" aria-label="Set source"><option value="">Set source…</option>${IS.activeSources(state).map((s) => `<option value="${esc(s.id)}">${esc(`${s.emoji || ''} ${s.name}`.trim())}</option>`).join('')}<option value="${IS.NONE}">No source</option></select>` : ''}
    ${Taxes.bulkSelectHTML()}
    ${RecordX.bulkHTML()}
    <label class="bulk-date"><span>Set date</span><input type="date" data-bulk="date" aria-label="Set date"></label>
    <button type="button" class="btn" data-act="bulk-all" data-testid="bulk-all">Select all shown</button>
    <button type="button" class="btn danger" data-act="bulk-del" data-testid="bulk-del">Delete</button>
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

// Each bulk change asks first ("Set the category of 3 records to Food?"),
// applies to all of them, and is one Undo step.
function confirmBulk({ title, text, ok, danger = false, onOk }) {
  openSheet(`<h3>${esc(title)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p data-testid="bulk-confirm-text">${esc(text)}</p>
    <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-bulk-ok data-testid="bulk-confirm-ok">${esc(ok)}</button></div>`, (sheet) => {
    sheet.querySelector('[data-bulk-ok]').addEventListener('click', (e) => { e.target.disabled = true; onOk(); });
  });
}

const plural = (n) => `${n} record${n === 1 ? '' : 's'}`;

function runBulk(kind, v, ids) {
  let changed = 0;
  let skipped = 0;
  if (kind === 'tax') {
    for (const t of state.tx.filter((x) => ids.includes(x.id))) {
      if (!Taxes.bulkTag(t, v)) { skipped++; continue; }
      M.touch(t);
      changed++;
    }
  } else ({ changed, skipped } = Bulk.applyBulk(state, ids, kind, v, { rateFor: (cur) => suggestedRate(cur) }));
  closeSheet();
  if (!changed) { toast(skipped ? 'None of the selected records can take that (moves, or a different type)' : 'Nothing changed'); return; }
  commit();
  const what = { category: 'category', account: 'account', date: 'date', tax: 'tax tag', income: 'income setting', spending: 'spending setting', source: 'income source' }[kind];
  toast(`Changed the ${what} of ${plural(changed)}${skipped ? ` (${skipped} skipped)` : ''}`, 'Undo', () => undoRedo(-1));
}

function onBulkChange(el) {
  const v = el.value;
  const kind = el.dataset.bulk;
  if (!v) return;
  const label = el.tagName === 'SELECT' ? el.selectedOptions[0]?.textContent.trim() : v;
  el.value = '';
  const ids = [...ui.selected];
  if (kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
  const n = kind === 'tax' ? ids.length : Bulk.countApplicable(state, ids, kind, v);
  if (!n) { toast('None of the selected records can take that (moves, or a different type)'); return; }
  const what = { category: 'category', account: 'account', date: 'date', tax: 'tax tag', income: 'income setting', spending: 'spending setting', source: 'income source' }[kind];
  if (kind === 'source') {
    const none = v === IS.NONE;
    confirmBulk({ title: 'Set source', text: none ? `Take the income source off ${plural(n)}? One Undo puts it back.` : `Set the source of ${plural(n)} to ${label}? Only Earned records change. One Undo puts every record back exactly as it was.`, ok: none ? `Clear ${plural(n)}` : `Set ${plural(n)}`, onOk: () => runBulk(kind, v, ids) });
    return;
  }
  if (kind === 'income' || kind === 'spending') {
    const w = kind === 'income' ? 'income' : 'spending';
    const text = v === 'no' ? `Leave ${plural(n)} out of ${w}? The money still counts in the account balances. One Undo puts it back.` : `Count ${plural(n)} as ${w} again? One Undo puts it back.`;
    confirmBulk({ title: `Count as ${w}`, text, ok: v === 'no' ? `Leave out ${plural(n)}` : `Count ${plural(n)}`, onOk: () => runBulk(kind, v, ids) });
    return;
  }
  confirmBulk({ title: `Set ${what}`, text: `Set the ${what} of ${plural(n)} to ${label}? One Undo puts every record back exactly as it was.`, ok: `Change ${plural(n)}`, onOk: () => runBulk(kind, v, ids) });
}

function bulkDelete() {
  const ids = selectedTx().map((t) => t.id);
  if (!ids.length) return;
  confirmBulk({
    title: 'Delete records',
    text: `Delete ${plural(ids.length)}? A backup is saved first, and one Undo brings them all back.`,
    ok: `Delete ${plural(ids.length)}`,
    danger: true,
    onOk: async () => {
      const bk = await backupBefore(`deleting ${plural(ids.length)} from the Log`);
      closeSheet();
      if (!bk.ok) { toast(`Nothing was deleted: ${bk.error}`); return; }
      const n = Bulk.deleteMany(state, ids);
      ui.selected.clear();
      commit();
      toast(`Deleted ${plural(n)}`, 'Undo', () => undoRedo(-1));
    },
  });
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
      if (!c || c <= 0) { toast('Type a number, e.g. 120 or 120+45'); el.value = formatMoney(t.amount, '', { reveal: true }); return; }
      t.amount = c;
      t.base = Math.round(c * (t.rate || 1));
    } else if (field === 'note') {
      t.note = v;
      if (t.category === 'other' || t.category === 'other-in') t.category = M.suggestCategory(state, v, t.type) || t.category;
      autoSub(t);
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
  autoSub(tx);
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
    // The new row starts on the account you used last (your wallet, usually).
    const acc = ui.draft?.account || M.defaultAccount(state, 'expense');
    ui.draft = { type: 'expense', date: inMonth, category: '', note: '', account: acc, from: acc, to: state.settings.savingsAccount };
  }
  return ui.draft;
}

// Filters without typing: category, account, tag and dates become a search.
function filterPanel() {
  const opts = (list, label) => `<option value="">${label}</option>` + list.map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('');
  const cats = state.settings.categories.map((c) => [c.id, c.name]);
  const accs = M.activeAccounts(state).map((a) => [a.id, a.name]);
  const tags = M.allTags(state).map((g) => [g.tag, `#${g.tag}`]);
  return `<details class="filter-panel"${ui.filterOpen ? ' open' : ''}><summary data-act="filter-toggle">Filters</summary>
    <div class="fp-row">
      <select id="fp-cat" aria-label="Category">${opts(cats, 'Any category')}</select>
      <select id="fp-acc" aria-label="Account">${opts(accs, 'Any account')}</select>
      ${tags.length ? `<select id="fp-tag" aria-label="Tag">${opts(tags, 'Any tag')}</select>` : ''}
      ${IS.hasSources(state) ? `<select id="fp-src" aria-label="Income source">${opts(IS.sourcesOf(state).map((x) => [x.name, x.name]), 'Any source')}</select>` : ''}
      <label class="fp-date"><span>From</span><input id="fp-from" type="date"></label>
      <label class="fp-date"><span>To</span><input id="fp-to" type="date"></label>
      <input id="fp-min" type="text" inputmode="decimal" placeholder="More than" aria-label="More than (amount)">
      <button type="button" class="btn primary" data-act="filter-apply">Show</button>
    </div></details>`;
}

// "Nothing spent today": kept by Life System (the one no-spend button, as on
// Today and the Money page). It pays nothing now; once the day is over it
// counts as a no-spend day if nothing was logged for it. This page only shows and asks.
const inLife = (() => { try { return window.parent && window.parent !== window; } catch { return false; } })();
let freeDays = new Set();
if (inLife) {
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'LIFE_FINANCE_FREE_DAYS') return;
    freeDays = new Set(Array.isArray(e.data.days) ? e.data.days : []);
    if (e.data.error) toast(e.data.error);
    else if (e.data.op === 'mark') toast('Noted. If it stays that way, tonight counts as a no-spend day.');
    render();
  });
  try { window.parent.postMessage({ type: 'LIFE_SYSTEM_BRIDGE', action: 'FINANCE_FREE_DAY', payload: { op: 'ask' } }, location.origin); } catch {}
}
function freeDayStrip() {
  if (!inLife || ui.month !== monthKey(todayISO())) return '';
  const on = freeDays.has(todayISO());
  return `<section class="card free-day" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:space-between;padding:10px 14px">
    <span>${on ? '<b>Nothing spent today ✓</b> <small class="muted">It counts tonight if nothing is logged for today.</small>' : '<span>Spent nothing today? Tonight it counts as a no-spend day.</span>'}</span>
    ${on ? '' : '<button type="button" class="btn primary" data-act="free-day" data-op="mark">Nothing spent today</button>'}
  </section>`;
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
      + tableHTML(state, list, { sort: ui.sort, draft: q ? null : draftRow(), fmt: (c) => money(c), selected: ui.selected, years: !!q, extra: RecordX.tableCols(), month: q ? null : ui.month })
      + `<datalist id="people-list">${state.people.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>`;
  } else {
    const groups = new Map();
    for (const t of M.sortTx(list)) {
      if (!groups.has(t.date)) groups.set(t.date, []);
      groups.get(t.date).push(t);
    }
    // A free day with no records shows as its own line: "No spending ✓".
    if (!q) for (const d of freeDays) if (d.startsWith(ui.month) && !groups.has(d)) groups.set(d, []);
    const ordered = [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
    content = ordered.map(([date, items]) => {
      const net = items.filter((t) => !isNotCounted(t)).reduce((a, t) => a + (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0), 0);
      return `<div class="day dow-${dowIndex(date)}${date === todayISO() ? ' is-today' : ''}"><div class="day-head"><span class="dh">${dayLabelHTML(date, todayISO())}${q ? ` ${date.slice(0, 4)}` : ''}</span><span class="money ${net > 0 ? 'income' : ''}">${net ? money(net, { sign: true }) : ''}</span></div>
        <div class="list">${items.length ? items.map((t) => txRow(t)).join('') : '<div class="row"><b>No spending ✓</b></div>'}</div></div>`;
    }).join('') || (q ? `<div class="empty"><b>Nothing found</b>Try: ${esc(SEARCH_HINT)}</div>` : Tips.EMPTY.log());
  }

  const chip = (id, label) => `<button class="chip" data-act="filter" data-filter="${id}" aria-pressed="${ui.filter === id}">${label}</button>`;
  const viewBtn = (id, label) => `<button type="button" data-act="log-view" data-view="${id}" aria-pressed="${view === id}">${label}</button>`;
  const dir = ui.monthDir;
  ui.monthDir = 0;
  return `<header class="top"><div><h1>Log</h1><div class="sub">${q ? 'Searching all months' : monthLabel(ui.month)}</div></div>${todayChip()}</header>
  ${q || view === 'sheet' ? '' : monthNav()}
  ${q ? '' : freeDayStrip()}
  <div class="log-body${dir ? ` slide-${dir > 0 ? 'l' : 'r'}` : ''}">
  ${q || view === 'sheet' ? '' : `<section class="card">${stats(s)}${rateBar(s)}</section>`}
  <div class="log-tools">
    <div class="seg seg-views" role="group" aria-label="View">${viewBtn('sheet', 'Sheet')}${viewBtn('table', 'Table')}${viewBtn('calendar', 'Calendar')}${viewBtn('list', 'List')}</div>
    ${view === 'calendar' ? '' : `<input type="search" id="search" placeholder="Search: coffee, >100, #trip, cat:food, from:2026-01-01…" value="${esc(ui.search)}" aria-label="Search all records">`}
    <div class="log-actions">
      ${undoButtons()}
      ${Tidy.logButtons()}
      <button type="button" class="btn" data-act="copy-table" title="Copy this month as a table to paste into Excel or Google Sheets">Copy table</button>
      ${ui.month < monthKey(todayISO()) ? `<button type="button" class="btn" data-act="cm-open" data-key="${ui.month}" data-testid="log-close-month">${monthClosed(state, ui.month) ? '✓ Checked' : 'Close the month'}</button>` : ''}
      <button type="button" class="btn" data-act="export-month" title="Download this month as a file Excel opens">Export month</button>
    </div>
  </div>
  ${view === 'calendar' || (view === 'sheet' && !q) ? '' : `
    <div class="log-filter-row">
      <div class="chips" style="margin:0;">
        ${chip('all', 'All')}
        ${chip('expense', '🔴 Spent')}
        ${chip('income', '🟢 Earned')}
        ${chip('transfer', '🔄 Moves')}
        ${chip('loan', '⚡ Loans')}
      </div>
      ${SavedBar.barHTML(state, ui)}
      <div class="log-quick-chips">
        <span class="muted small" style="font-size:11px;">Quick:</span>
        <button type="button" class="lq-chip" data-act="log-quick-search" data-q="today">📅 Today</button>
        <button type="button" class="lq-chip" data-act="log-quick-search" data-q=">1000">&gt; 1 000</button>
        <button type="button" class="lq-chip" data-act="log-quick-search" data-q="50-200">50–200</button>
        ${M.allTags(state).slice(0, 4).map((g) => `<button type="button" class="lq-chip" data-act="log-quick-search" data-q="#${esc(g.tag)}">#${esc(g.tag)}</button>`).join('')}
        ${IS.activeSources(state).slice(0, 6).map((x) => `<button type="button" class="lq-chip src-lq" data-act="log-quick-search" data-testid="src-filter" data-q="${esc(`source:"${x.name}"`)}" style="--c:${IS.colorVar(x)}"><i aria-hidden="true"></i>${esc(x.name)}</button>`).join('')}
        ${isArchived(state) ? `<button type="button" class="lq-chip" data-act="log-archived" aria-pressed="${!!ui.archived}" data-testid="include-archived">${ui.archived ? '✓ ' : ''}Include archived years</button>` : ''}
        ${q ? `<button type="button" class="lq-chip lq-clear" data-act="log-clear-search">✕ Clear search</button>` : ''}
      </div>
    </div>
    ${filterPanel()}
  `}
  ${q && view !== 'calendar' ? chipsHTML(ui.search, esc, state) + searchCard(list) : ''}
  ${content}
  ${view === 'sheet' && !q ? '<p class="muted small">Type an amount and it saves. Clear it to delete. <b>+</b> at the bottom adds the next month.</p>' : ''}
  ${view === 'table' ? '<p class="muted small">Edit any cell; it saves by itself. <b>Enter</b> moves down a row. <b>←</b> / <b>→</b> switch months. Tick rows (Shift+click for a range) to change many at once. <b>Ctrl+Z</b> undoes anything. Paste rows copied from Excel or Google Sheets anywhere on this page to import them.</p>' : ''}
  </div>`;
}

function viewSettings() {
  const st = state.settings;
  const accOptions = (sel, withAll) => (withAll ? `<option value="all" ${sel === 'all' ? 'selected' : ''}>All my money</option>` : '')
    + accountOptionsHTML(st.accounts, sel, { baseCur: st.currency });
  const jarOptions = (sel) => st.jars.filter((j) => !j.savings).map((j) => `<option value="${esc(j.id)}" ${sel === j.id ? 'selected' : ''}>${esc(j.name)}</option>`).join('')
    + `<option value="${M.NO_JAR}" ${sel === M.NO_JAR ? 'selected' : ''}>Business, outside the jars</option>`;
  const used = new Set(state.tx.map((t) => t.category));
  const catRow = (c) => `<div class="cat-row">
    <input class="cat-emoji" type="text" maxlength="4" value="${esc(c.emoji || '')}" data-cat="${esc(c.id)}" data-field="emoji" aria-label="Icon for ${esc(c.name)}" placeholder="•" style="--c:${catColor(c.id)}">
    <input type="text" value="${esc(c.name)}" data-cat="${esc(c.id)}" data-field="name" aria-label="Name">
    ${c.type === 'expense'
    ? `<select data-cat="${esc(c.id)}" data-field="jar" aria-label="Jar">${jarOptions(c.jar)}</select>
      <span class="cat-flags"><label class="cat-bill" title="A bill (rent, internet, utilities): paying it doesn't use up today's safe-to-spend"><input type="checkbox" data-cat="${esc(c.id)}" data-field="bill" ${M.isBillCategory(state, c.id) ? 'checked' : ''}><span>Bill</span></label>
      <label class="cat-bill" title="Work cost (leave out of Everyday): fees and taxes of your work are not counted in Everyday only on Where your money goes"><input type="checkbox" data-cat="${esc(c.id)}" data-field="workCost" ${c.workCost ? 'checked' : ''}><span>Work cost (leave out of Everyday)</span></label></span>`
    : used.has(c.id) ? '<span></span><span></span>' : `<button class="btn danger" data-act="del-cat" data-id="${esc(c.id)}">Remove</button><span></span>`}
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
    <p class="muted small" style="margin-top:0">Spending: pick which jar it comes from. Work costs (fees, taxes) can stay outside the jars. Tick <b>Bill</b> for rent, internet and other bills: paying them doesn't use up today's safe-to-spend.</p>
    ${st.categories.filter((c) => c.type === 'expense').map(catRow).join('')}
    <label class="field" style="margin:12px 0 0"><span>Everyday limit (${esc(st.currency)}): a single buy of this much or more is a one-off, left out of "Everyday only" on Where your money goes</span><input type="text" inputmode="decimal" data-set="everydayLimit" value="${esc(centsToPlain(E.everydayLimit(st, state.rates)))}" aria-label="Everyday limit"></label>
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
    <div class="btns" style="margin-top:8px">
      <button class="btn primary" data-act="money-export" data-testid="money-export">Export all money (CSV + Excel)</button>
    </div>
    <p class="muted small">Every record with every field (rate, ${esc(state.settings.currency)} value, tags, client, invoice), plus accounts, invoices, clients, recurring items, goals and reconciliations. Import the CSV back the same way as above: what is already here is skipped.</p>
    <p class="muted small" style="margin-bottom:0">From Google Sheets: File → Download → <b>Microsoft Excel (.xlsx)</b> and import the whole file: every month tab at once, you pick which. Bank statements: export CSV or Excel from maib / Victoriabank online banking. Importing the same thing twice is safe.</p>
  </section>`,
    look: `<section class="card look-card"><h2>Look</h2>
    ${themePicker(st)}
    <label class="field"><span>Currency</span><input type="text" data-set="currency" value="${esc(st.currency)}" maxlength="5"></label>
    ${Tips.settingsRow()}
    ${Flow.settingsRow()}
  </section>
`,
    extras: `<section class="card look-card"><h2>Extras</h2>
    <p class="muted small" style="margin-top:0">Nice-to-haves, kept out of the way: moving backgrounds, wallpapers, button sounds and focus music. Your numbers work the same with all of them off.</p>
    <label class="motion-setting"><span><b>Living atmosphere</b><small>Sakura petals, leaves, bubbles and starlight. Follows your device’s reduced-motion preference.</small></span><input type="checkbox" data-set="themeMotion" ${st.themeMotion === true ? 'checked' : ''} aria-label="Living atmosphere"></label>
    <div class="field" style="margin-top:14px">
      <span style="font-weight:600;display:block;margin-bottom:6px">Atmospheric Wallpaper</span>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">
        <label class="btn outline sm" style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="radio" name="app-wp" data-set="wallpaper" value="none" ${(!st.wallpaper || st.wallpaper === 'none') ? 'checked' : ''}> None
        </label>
        <label class="btn outline sm" style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="radio" name="app-wp" data-set="wallpaper" value="paper-warm" ${st.wallpaper === 'paper-warm' || (!st.wallpaper && st.theme === 'paper') ? 'checked' : ''}> 📜 Warm Pages
        </label>
        <label class="btn outline sm" style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="radio" name="app-wp" data-set="wallpaper" value="samurai-moon" ${st.wallpaper === 'samurai-moon' || (!st.wallpaper && st.theme === 'samurai') ? 'checked' : ''}> ⛩️ Blood Moon
        </label>
        <label class="btn outline sm" style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="radio" name="app-wp" data-set="wallpaper" value="samurai-katana" ${st.wallpaper === 'samurai-katana' ? 'checked' : ''}> ⚔️ Katana Slash
        </label>
        <label class="btn outline sm" style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="radio" name="app-wp" data-set="wallpaper" value="forest-canopy" ${st.wallpaper === 'forest-canopy' || (!st.wallpaper && st.theme === 'forest') ? 'checked' : ''}> 🍃 Forest Canopy
        </label>
        <label class="btn outline sm" style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="radio" name="app-wp" data-set="wallpaper" value="ocean-tides" ${st.wallpaper === 'ocean-tides' || (!st.wallpaper && st.theme === 'ocean') ? 'checked' : ''}> 🌊 Ocean Tides
        </label>
        <label class="btn outline sm" style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="radio" name="app-wp" data-set="wallpaper" value="custom" ${st.wallpaper === 'custom' ? 'checked' : ''}> 🖼️ Custom URL
        </label>
      </div>
      ${st.wallpaper === 'custom' ? `<input type="url" data-set="customWallpaper" placeholder="https://example.com/wallpaper.jpg" value="${esc(st.customWallpaper || '')}" style="margin-top:8px" aria-label="Custom wallpaper URL">` : ''}
      ${(st.wallpaper && st.wallpaper !== 'none') || (!st.wallpaper && st.theme === 'samurai') ? `<label class="field" style="margin-top:8px"><span>Wallpaper Opacity (${Math.round((st.wallpaperOpacity ?? 0.35) * 100)}%)</span><input type="range" data-set="wallpaperOpacity" min="0.05" max="0.9" step="0.05" value="${st.wallpaperOpacity ?? 0.35}"></label>` : ''}
    </div>
    <label class="motion-setting" style="margin-top:14px"><span><b>Tactile sounds</b><small>Mechanical micro-click on buttons, keys and coin chime on logging.</small></span><input type="checkbox" data-set="sound" ${st.sound !== false ? 'checked' : ''} aria-label="Tactile sounds"></label>
    <div style="margin:4px 0 10px"><button type="button" class="btn sm" data-act="test-sound">🔊 Test sounds</button></div>
  </section>
  <section class="card ambient-card">
    <h2>Lo-Fi & Zen Ambient Music</h2>
    <p class="muted small" style="margin-top:0">100% offline procedural soundscapes generated in real-time via Web Audio API. Gentle background focus while managing finances.</p>
    <div class="amb-controls" style="margin-top:12px">
      <button type="button" class="btn ${AmbientMusic.getState().playing ? 'primary' : 'outline'}" data-act="amb-toggle">
        ${AmbientMusic.getState().playing ? '⏸️ Pause soundscape' : '▶️ Play soundscape'}
      </button>
      <button type="button" class="btn outline sm" data-act="amb-next">⏭️ Next track</button>
      <label style="display:inline-flex;align-items:center;gap:8px;font-size:13px;margin-left:auto">
        <span>Volume</span>
        <input type="range" data-act="amb-vol" min="0" max="1" step="0.05" value="${AmbientMusic.getState().volume}" style="width:110px">
      </label>
    </div>
    <div class="amb-tracks">
      ${AmbientMusic.TRACKS.map((t) => `
        <button type="button" class="amb-track-btn ${AmbientMusic.getState().track === t.id ? 'active' : ''}" data-act="amb-track" data-track="${t.id}">
          <span class="amb-t-icon">${t.icon}</span>
          <span class="amb-t-text">
            <b>${esc(t.name)}</b>
            <small>${esc(t.desc)}</small>
          </span>
        </button>
      `).join('')}
    </div>
  </section>`,
    danger: `<section class="card set-danger-card" id="danger-zone-card">
      <div class="card-head-pill">
        <h2>⚠️ Danger zone</h2>
        <span class="set-badge danger">Irreversible</span>
      </div>
      <p class="muted small" style="margin:0 0 12px">Permanently wipe all transactions, accounts, people, and preferences stored in this browser or device. Make sure to export a JSON backup first if you want to keep your data.</p>
      
      <div class="danger-lock-wrap">
        <label class="danger-lock-label" for="danger-unlock-cb">
          <input type="checkbox" id="danger-unlock-cb" data-act="danger-unlock">
          <span>I understand this will permanently delete all data on this device</span>
        </label>
      </div>

      <div class="danger-actions-row">
        <button type="button" class="btn" data-act="export-json">💾 Backup data first</button>
        <button type="button" class="btn danger disabled" id="btn-danger-wipe" data-act="wipe" disabled title="Check the confirmation box above to unlock">🔒 Erase everything on this device</button>
      </div>
    </section>`,
  };
  // One section at a time, picked on the left (like any settings screen).
  const sections = [
    { id: 'health', icon: '🩺', label: 'Data & health', sub: 'Space left, sync, devices', desc: 'Is everything working, how much room your data takes on the server and this device, and how long it lasts at your pace.', html: () => { DataHealth.init(); return DataHealth.card(); } },
    { id: 'general', icon: '⚙️', label: 'General', sub: 'Look, keys', desc: 'How the app looks and the keyboard shortcuts.', html: () => cards.look + Shortcuts.settingsCard() },
    { id: 'spending', icon: '💸', label: 'Spending', sub: 'Spending money, limit, salary', desc: 'Which accounts Safe to spend counts, your monthly spending limit, when your salary comes, and the checks that keep the numbers real.', html: () => spendSettingsCard() + limitSettingsCard() + MoneyB.settingsCard() + cards.accounts + Checkup.settingsCard() + CashCount.settingsCard() },
    { id: 'saving', icon: '🐷', label: 'Saving', sub: 'Smart split, pay yourself, goals', desc: 'How each income is split into jars, paying yourself a fixed salary, your goals and your emergency fund.', html: () => cards.split + paySettingsCard() + cards.goals + Money3.settingsCard() },
    { id: 'extras', icon: '✨', label: 'Extras', sub: 'Your hour, music, wallpapers', desc: 'What an hour of your work is worth, moving backgrounds, wallpapers, button sounds and focus music. All optional.', html: () => WorkHour.settingsCard() + cards.extras },
    { id: 'categories', icon: '🏷️', label: 'Categories & rules', sub: 'Categories, jars, auto-rules', desc: 'Your categories, which jar each one fills, and rules that sort records for you.', html: () => cards.categories + Cats.editorCard() + RecordX.fieldsCard() + RecordX.tagsCard() + Rules.settingsCard() + BudgetWarn.settingsCard() },
    { id: 'sources', icon: '💼', label: 'Income sources', sub: 'Job 1, Job 2, clients', desc: 'Your own tags for where money comes from. Pick one when you log income, and see each one in Reports.', html: () => IncomeSources.settingsCard() },
    { id: 'data', icon: '💾', label: 'Data & backups', sub: 'Import, export, backups, sync', desc: 'Where your data lives, automatic backups, sync between devices and Excel import.', html: () => cards.data + Standalone.dataCards() + ArchiveCard.settingsCard() + ChangesScreen.settingsCard() + Backups.settingsCard() + Sync.settingsCard() },
    { id: 'connect', icon: '🔗', label: 'Telegram & Binance', sub: 'Your bot, crypto balances', desc: 'Your own Telegram bot for logging from your phone, and Binance balances (read-only).', html: () => Standalone.botCard() + Telegram.settingsCard() + TgBlocks.settingsCard() + Binance.settingsCard() },
    { id: 'buddy', icon: '🤖', label: 'Bit, your buddy', sub: 'Show, name, color', desc: 'Bit, the little robot that cheers you on: show or hide it, its name and color.', html: () => Buddy.settingsCard() },
    { id: 'security', icon: '🔒', label: 'Security', sub: 'PIN, encryption, hide amounts', desc: 'A PIN when the app opens, your data locked with a password, and hiding every amount until you press Space.', html: () => Security.settingsCard() + Security.privacyCard() },
    { id: 'about', icon: 'ℹ️', label: 'About & updates', sub: 'Version, check, erase', desc: 'Your version and updates, a quick health check, and erasing everything.', badgeText: `v${APP_VERSION}`, badgeClass: 'gold', html: () => Updates.settingsCard() + SelfCheck.settingsCard() + cards.danger },
  ];
  const cur = sections.find((x) => x.id === ui.settingsTab) || sections[0];

  return `<header class="top">
    <div>
      <h1>Settings</h1>
      <div class="sub">How it looks, your data, the bot and security</div>
    </div>
  </header>
  ${installPrompt ? '<div class="banner"><p>Install the app for one-tap access, even offline.</p><button class="btn primary" data-act="install">Install</button></div>' : ''}
  ${isIOS ? '<div class="banner"><p>To install on iPhone: tap Share, then “Add to Home Screen”.</p></div>' : ''}
  <div class="set-layout">
    <nav class="set-nav" aria-label="Settings sections">
      <div class="set-nav-list">
        ${sections.map((x) => `<button type="button" class="set-tab" data-act="set-tab" data-sec="${x.id}" aria-current="${x.id === cur.id ? 'page' : 'false'}"><span class="set-ic" aria-hidden="true">${x.icon}</span><span class="set-t"><b>${x.label}</b><span>${x.sub}</span></span><span class="set-tab-chevron" aria-hidden="true">›</span></button>`).join('')}
      </div>
      <div class="set-nav-foot">
        ${inLifeNow() ? `<span class="set-privacy-badge">🔒 Yours only</span>
        <span>Syncs to your own Life System database · no tracking</span>` : `<span class="set-privacy-badge">🔒 Yours only</span>
        <span>No tracking · your devices and your own server</span>`}
      </div>
    </nav>
    <div class="set-body">
      <div class="set-hero-banner">
        <div class="set-hero-left">
          <div class="set-hero-icon" aria-hidden="true">${cur.icon}</div>
          <div class="set-hero-text">
            <h2 class="set-hero-title">${cur.label}</h2>
            <p class="set-hero-desc">${cur.desc || cur.sub}</p>
          </div>
        </div>
        ${cur.badgeText ? `<div class="set-hero-badges"><span class="set-badge ${cur.badgeClass || 'gold'}">${cur.badgeText}</span></div>` : ''}
      </div>
      <div class="set-grid">${cur.html()}</div>
    </div>
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
    if (from === to) continue;
    const fmt = (v) => (el.dataset.cur ? money(v, { sign: !!el.dataset.sign }) : formatMoney(v, ''));
    // js/flow.js: never animates while amounts are hidden or motion is off.
    Flow.countTo(el, { from, to, fmt, hidden: Privacy.isHidden, off: () => reducedMotion() || Flow.flowOff() });
  }
}

// A bill paid by hand (rent, internet…): offer to make it a monthly bill,
// so it's set aside before each payday instead of surprising one day.
function offerMonthlyBill(tx) {
  if (tx.type !== 'expense' || tx.recurring || tx.loan || !M.isBillCategory(state, tx.category)) return false;
  const norm = (x) => String(x || '').trim().toLowerCase();
  if (state.recurring.some((r) => r.type === 'expense' && r.category === tx.category && norm(r.note) === norm(tx.note))) return false;
  toast(`Spent ${formatMoney(tx.amount, tx.currency)}. Is this a monthly bill?`, 'Make it monthly', () => {
    const t = state.tx.find((x) => x.id === tx.id);
    if (!t || t.recurring) return;
    const now = Date.now();
    const id = M.uid();
    state.recurring.push({ id, createdAt: now, updatedAt: now, type: 'expense', amount: t.amount, currency: t.currency, account: t.account, category: t.category, note: t.note, every: 'month', start: t.date, lastDone: t.date, auto: false, paused: false });
    M.touch(t).recurring = id;
    commit();
    toast('Monthly bill added. Safe to spend now keeps it aside before each payday (see Plan).');
  });
  return true;
}

function render({ enter = false } = {}) {
  autoPay();
  // Once: work costs ("Work fees", "Taxes") leave the personal jars.
  if (!state._sealed && !state.meta.workJarsMoved) {
    state.meta.workJarsMoved = 1;
    const moved = M.moveWorkCostsOutOfJars(state);
    persist({ quiet: true });
    if (moved.length && !DEMO) setTimeout(() => toast(`${moved.join(', ')}: now a work cost, outside your personal jars. Change it in Settings → Categories.`), 1500);
  }
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
  // One dismissible tip under the title (js/tips.js; off with Settings -> Tips).
  const tip = Tips.tipHTML(ui.tab);
  if (tip) (app.querySelector('.subtabs') || app.querySelector('header.top'))?.insertAdjacentHTML('afterend', tip);
  if (enter) {
    shownCounts.clear();
    playEnter();
  }
  runCounters(enter);
  Motion.slideSegs(app);
  // js/flow.js: a short fade for a sub-screen, rows that ease in, out and light up when saved.
  Flow.afterScreen(app, `${ui.tab}|${ui.settingsTab || ''}|${state.settings.logView || ''}`, { enter });
  Flow.afterRender(app, `${ui.tab}|${ui.month || ''}|${ui.filter || ''}|${ui.search || ''}|${ui.settingsTab || ''}`, { enter });
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
  for (const a of document.querySelectorAll('.tabbar a, .more-list a, .life-tabs a')) {
    if (a.dataset.tab === (NAV_PARENT[ui.tab] || ui.tab)) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (ui.tab === 'settings') updateJarSum();
  renderSidebar();
  clearTimeout(render.ms);
  render.ms = setTimeout(() => Goals.checkMilestones(), 700);
}

// ---------- Bottom sheet ----------

// "Today · Yesterday · 2 days ago" under a record's Date: one tap for something you remembered later.
function dayChips(date) {
  const today = todayISO();
  const days = [[0, 'Today'], [1, 'Yesterday'], [2, '2 days ago'], [3, '3 days ago']];
  return `<div class="day-chips" role="group" aria-label="Pick the day" data-testid="day-chips">${days.map(([n, label]) => {
    const d = addDays(today, -n);
    return `<button type="button" class="chip${d === date ? ' on' : ''}" data-day-back="${n}" aria-pressed="${d === date}">${label}</button>`;
  }).join('')}</div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-day-back]');
  if (!b) return;
  const input = b.closest('form')?.querySelector('#tx-date');
  if (!input) return;
  input.value = addDays(todayISO(), -Number(b.dataset.dayBack));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  for (const c of b.parentElement.querySelectorAll('[data-day-back]')) { c.classList.toggle('on', c === b); c.setAttribute('aria-pressed', String(c === b)); }
});
// Log table: ＋ on a day adds a record on that day; drag a record onto another day to move it.
// ＋ (or a click on the day's name) opens a line to type in: "120 lunch maib", Enter saves.
function openDayQuick(date, text = '') {
  const input = document.querySelector(`[data-day-quick="${date}"]`);
  if (!input) return false;
  document.querySelectorAll('.day-quick-wrap:not([hidden])').forEach((w) => { if (!w.contains(input)) w.hidden = true; });
  input.closest('.day-quick-wrap').hidden = false;
  input.value = text;
  input.focus();
  dayQuickHint(input);
  return true;
}
function dayQuickHint(input) {
  const hint = input.parentElement.querySelector('.day-quick-hint');
  if (!hint) return;
  const r = input.value.trim() ? parseQuick(state, input.value, { today: input.dataset.dayQuick }) : null;
  hint.textContent = !r ? '' : r.ok ? `${r.kind === 'income' ? 'Earned' : r.kind === 'refund' ? 'Refund' : 'Spent'} ${formatMoney(r.amount, r.currency)} · ${M.category(state, r.category)?.name || 'Other'} · ${M.account(state, r.account)?.name || ''}${r.tx.date !== input.dataset.dayQuick ? ` · ${dayLabel(r.tx.date)}` : ''}` : (r.missing || '');
  hint.classList.toggle('bad', !!r && !r.ok);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-day-add]');
  const name = !b && e.target.closest?.('#tx-table tr.day-row .dr');
  const form = e.target.closest?.('[data-day-form]');
  if (form) { e.stopPropagation(); openTxSheet(null, { date: form.dataset.dayForm }); return; }
  const day = b?.dataset.dayAdd || (name && name.closest('tr.day-row')?.dataset.day);
  if (!day || day > todayISO()) return;
  e.stopPropagation();
  if (!openDayQuick(day)) openTxSheet(null, { date: day });
}, true);
document.addEventListener('input', (e) => { if (e.target?.dataset?.dayQuick) dayQuickHint(e.target); });
document.addEventListener('keydown', (e) => {
  const el = e.target;
  if (!el?.dataset?.dayQuick) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); el.closest('.day-quick-wrap').hidden = true; return; }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  e.stopPropagation();
  if (state._sealed) { toast('The data is locked. Unlock it first.'); return; }
  const date = el.dataset.dayQuick;
  const r = parseQuick(state, el.value, { today: date });
  if (!r.ok) { toast(r.missing || 'Type an amount first, like "120 lunch".'); return; }
  const now = Date.now();
  const tx = { id: M.uid(), createdAt: now, updatedAt: now, ...r.tx };
  state.tx.push(tx);
  ui.flashId = tx.id;
  commit();
  toast(`Added ${formatMoney(tx.amount, tx.currency)}${tx.note ? ` · ${tx.note}` : ''} · ${dayLabel(tx.date)}`, 'Undo', () => undoRedo(-1));
  setTimeout(() => openDayQuick(date), 0); // ready for the next one that day
}, true);
let dragId = null;
let dragIds = [];
const dropDay = (el) => el?.closest?.('tr[data-day], tr[data-date]');
document.addEventListener('dragstart', (e) => {
  if (!e.target.closest?.('.drag-h')) return;
  const tr = e.target.closest('#tx-table tr[data-id]');
  if (!tr) return;
  dragId = tr.dataset.id;
  // Ticked rows move together when you drag one of them.
  dragIds = ui.selected?.has(dragId) && ui.selected.size > 1 ? [...ui.selected] : [dragId];
  for (const id of dragIds) document.querySelector(`#tx-table tr[data-id="${CSS.escape(id)}"]`)?.classList.add('dragging');
  try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); } catch { /* ignore */ }
});
document.addEventListener('dragend', () => {
  dragId = null;
  document.querySelectorAll('#tx-table .dragging, #tx-table .drop-here').forEach((x) => x.classList.remove('dragging', 'drop-here'));
});
document.addEventListener('dragover', (e) => {
  if (!dragId) return;
  const tr = dropDay(e.target);
  if (!tr || !tr.closest('#tx-table')) return;
  e.preventDefault();
  const day = tr.dataset.day || tr.dataset.date;
  document.querySelectorAll('#tx-table .drop-here').forEach((x) => { if ((x.dataset.day || x.dataset.date) !== day) x.classList.remove('drop-here'); });
  document.querySelectorAll(`#tx-table tr[data-day="${day}"], #tx-table tr[data-date="${day}"]`).forEach((x) => x.classList.add('drop-here'));
});
document.addEventListener('drop', (e) => {
  if (!dragId) return;
  const tr = dropDay(e.target);
  const id = dragId;
  dragId = null;
  if (!tr || !tr.closest('#tx-table')) return;
  e.preventDefault();
  const day = tr.dataset.day || tr.dataset.date;
  const ids = dragIds.length ? dragIds : [id];
  dragIds = [];
  const moved = state.tx.filter((x) => ids.includes(x.id) && x.date !== day);
  if (!day || !moved.length) return;
  const now = Date.now();
  for (const t of moved) { t.date = day; M.touch(t, now); }
  ui.flashId = moved[0].id;
  commit();
  toast(`Moved ${moved.length > 1 ? `${moved.length} records` : ''} to ${dayLabel(day)}`.replace('Moved  to', 'Moved to'), 'Undo', () => undoRedo(-1));
});

document.addEventListener('change', (e) => {
  if (e.target?.id !== 'tx-date') return;
  const box = e.target.closest('form')?.querySelector('.day-chips');
  if (!box) return;
  for (const c of box.querySelectorAll('[data-day-back]')) { const on = addDays(todayISO(), -Number(c.dataset.dayBack)) === e.target.value; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); }
});

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
  return accountDisplayName(a, { baseCur: state.settings.currency });
}

// Rate to the base currency we'd suggest for a new record: today's rate if
// known, else the last one you used for that currency (fx.js rateToBase, the
// same rule Telegram and Life System's quick add use).
function suggestedRate(cur) {
  return rateToBase(state, cur);
}

function openTxSheet(existing = null, preset = {}) {
  const accounts = M.activeAccounts(state).length ? M.activeAccounts(state) : state.settings.accounts;
  const baseCur = state.settings.currency;
  const draft = existing ? { ...existing, personName: M.person(state, existing.person)?.name || '' } : {
    type: 'expense',
    date: todayISO(),
    // Lei by default: the lei account last used for the category, else the main wallet.
    account: M.defaultAccount(state, preset.type || 'expense', preset.category || null),
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
  // You picked the account yourself: a category no longer moves it.
  let accTouched = !!existing || !!preset.account;
  let addingCat = false;
  // Subcategory: picked by you (or confirmed), else a guess from the note.
  let subTouched = !!existing?.sub;
  let subGuess = null;
  let subOpen = false;
  let addingSub = false;
  if (!existing) draft.sub = preset.sub || null;
  // Income source (js/incomesources.js): the one you used last for this note or category is pre-filled until you pick.
  let srcTouched = !!existing || !!preset.incomeSource;
  let addingSrc = false;
  if (!existing && !draft.incomeSource) draft.incomeSource = null;
  const srcShown = () => draft.type === 'income' && !draft.refund && !draft.loan;
  const reSrc = () => {
    if (srcTouched || !srcShown()) return;
    draft.incomeSource = IS.rememberedSource(state, { category: draft.category, note: draft.note });
  };
  if (!existing && draft.type === 'income') reSrc();
  RecordX.initDraft(draft, existing); // your own fields and split lines (js/screens/recordx.js)
  const guessSub = () => (draft.type === 'expense' ? T.suggestSub(state, draft.note, { category: draft.category })?.sub || null : null);
  // After the note or category changed (unless you picked one yourself). A
  // new record takes the guess (shown as "Is this …?"); an old one only
  // shows it until you tap ✓.
  const reguess = () => {
    if (subTouched) return;
    if (draft.type !== 'expense') { subGuess = null; draft.sub = existing?.sub || null; return; }
    subGuess = guessSub();
    if (!existing) {
      if (subGuess && !catTouched && T.isOther(draft.category)) draft.category = subGuess.parent;
      draft.sub = subGuess && subGuess.parent === draft.category ? subGuess.id : null;
    }
  };
  if ((existing && !existing.sub) || (!existing && draft.note && !draft.sub)) reguess();
  // One-tap fills for things you log often (and your favorites).
  const picks = existing || preset.fromRule ? [] : M.quickPicks(state, todayISO(), 8);

  // A refund is income with an expense category: its category chips are the expense ones.
  const catType = () => (draft.type === 'income' && draft.refund ? 'expense' : draft.type);
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

  const accSelect = (field, label) => {
    const all = accounts.concat(existing && !accounts.some((a) => a.id === existing[field]) && M.account(state, existing[field]) ? [M.account(state, existing[field])] : []);
    return `<label class="field"><span>${label}</span><select id="tx-${field}">
      ${accountOptionsHTML(all, draft[field], { baseCur })}</select></label>`;
  };

  const catChipIcon = (c) => (c.emoji ? `<span class="ci" aria-hidden="true">${esc(c.emoji)}</span>` : dot(catColor(c.id)));
  const subRow = () => {
    if (draft.type !== 'expense' || !draft.category) return '';
    const subs = T.subsOf(state, draft.category);
    const other = T.isOther(draft.category);
    // In Other, a guess may point at another category ("kebab" -> Food › Restaurants).
    const g = subGuess && !subTouched && (subGuess.parent === draft.category || other) ? subGuess : null;
    if (!subs.length && !g && other) return '';
    const chosen = draft.sub && T.subById(state, draft.sub)?.parent === draft.category ? draft.sub : null;
    const gp = g && g.parent !== draft.category ? catOf(g.parent) : null;
    const guessLine = g ? `<div class="guess-line"><span class="guess-q">Is this <b>${gp ? `${esc(gp.emoji || '')} ${esc(gp.name)} › ` : ''}${esc(g.emoji || '')} ${esc(g.name)}</b>?</span>
      <button type="button" class="guess-yes" data-act="sub-yes">✓ Yes</button>
      ${other ? '' : `<button type="button" class="guess-change" data-act="sub-change" aria-expanded="${subOpen}">Change</button>`}</div>` : '';
    const list = !other && (!g || subOpen) ? `<div class="subs" role="group" aria-label="Subcategory">${subs.map((x) => `<button type="button" class="sub-chip" data-sub="${esc(x.id)}" aria-pressed="${chosen === x.id}" style="--c:${Cats.subColor(state, x)}">${x.emoji ? `<span class="ci" aria-hidden="true">${esc(x.emoji)}</span>` : ''}<span>${esc(x.name)}</span></button>`).join('')}
      ${addingSub ? `<span class="cat-new"><input id="new-sub" type="text" placeholder="New subcategory" aria-label="New subcategory name"><button type="button" class="btn primary" data-act="sub-create">Add</button></span>` : `<button type="button" class="sub-chip sub-add" data-act="sub-new">+ New</button>`}</div>` : '';
    return `<div class="sub-row">${guessLine}${list}</div>`;
  };
  const paintSrc = (sheet) => {
    const wrap = sheet.querySelector('#src-row-wrap');
    if (wrap) wrap.innerHTML = srcShown() ? IncomeSources.pickerHTML(state, { selected: draft.incomeSource, adding: addingSrc }) : '';
    const box = sheet.querySelector('#new-src');
    if (box) {
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sheet.querySelector('[data-act="src-form-create"]').click(); } });
      box.focus();
    }
  };
  const paintSub = (sheet) => {
    const wrap = sheet.querySelector('#sub-row-wrap');
    if (wrap) wrap.innerHTML = subRow();
    for (const b of sheet.querySelectorAll('.cat[data-cat]')) b.setAttribute('aria-pressed', String(b.dataset.cat === draft.category));
    const box = sheet.querySelector('#new-sub');
    if (box) {
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sheet.querySelector('[data-act="sub-create"]').click(); } });
      box.focus();
    }
  };

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
      ${RecordX.tagRow(draft)}
      ${isT ? '' : RecordX.splitHTML(draft, { cats: categoryOrder(catType()), cur, total: evalAmount(amountText) || 0, entryOn: entryOn() })}
      ${isT || RecordX.hidesCategory(draft) ? '' : `<div class="cats" role="group" aria-label="Category">${categoryOrder(catType()).map((c) => `<button type="button" class="cat" data-cat="${esc(c.id)}" aria-pressed="${draft.category === c.id}">${catChipIcon(c)}<span>${esc(c.name)}</span></button>`).join('')}
        ${addingCat ? `<span class="cat-new"><input id="new-cat" type="text" placeholder="New category" aria-label="New category name"><button type="button" class="btn primary" data-act="cat-create">Add</button></span>` : '<button type="button" class="cat cat-add" data-act="cat-new">+ New</button>'}</div>
        <div id="sub-row-wrap">${subRow()}</div>
        <div id="src-row-wrap">${srcShown() ? IncomeSources.pickerHTML(state, { selected: draft.incomeSource, adding: addingSrc }) : ''}</div>`}
      ${isT ? '' : `<div class="row2">
        <label class="field"><span>${draft.type === 'income' ? 'From who? (optional)' : 'To who? (optional)'}</span><input id="tx-person" type="text" list="people-list" autocomplete="off" value="${esc(draft.personName)}" placeholder="Name"></label>
        <label class="field check"><input id="tx-loan" type="checkbox" ${draft.loan ? 'checked' : ''}><span>${draft.type === 'income' ? 'Borrowed: I pay it back' : 'Lent: they pay it back'}</span></label>
      </div><datalist id="people-list">${people}</datalist>
      ${draft.type === 'income' ? `<label class="field check"><input id="tx-refund" data-testid="tx-refund" type="checkbox" ${draft.refund ? 'checked' : ''}><span>This is a refund: money back for something I bought. It lowers that category's spending and is not income.</span></label>` : ''}
      ${draft.type === 'income' && !draft.refund && !draft.loan ? `<label class="field check"><input id="tx-notincome" data-testid="tx-notincome" type="checkbox" ${draft.notIncome ? 'checked' : ''}><span>Doesn't count as income: money I already had. The balance still changes, but it is left out of Earned and savings.</span></label>` : ''}
      ${draft.type === 'expense' && !draft.loan ? `<label class="field check"><input id="tx-notspending" data-testid="tx-notspending" type="checkbox" ${draft.notSpending ? 'checked' : ''}><span>Doesn't count as spending: money that left but was not really spent. The balance still changes, but it is left out of Spent.</span></label>` : ''}`}
      <div class="row2">
        ${isT ? accSelect('from', 'From') + accSelect('to', 'To') : accSelect('account', draft.type === 'income' ? 'Into' : 'Paid from')}
      </div>
      ${!existing && !isT && !draft.fromRule ? `<div class="row2"><label class="field"><span>Date</span><input id="tx-date" type="date" value="${esc(draft.date)}"></label>
        <label class="field"><span>Repeat</span><select id="tx-repeat"><option value="">No</option>${FREQS.filter((f) => f.id !== 'once' && f.id !== 'custom').map((f) => `<option value="${f.id}" ${draft.repeat === f.id ? 'selected' : ''}>${f.label}</option>`).join('')}</select></label></div>`
    : `<label class="field"><span>Date</span><input id="tx-date" type="date" value="${esc(draft.date)}"></label>`}
      ${dayChips(draft.date)}
      ${RecordX.fieldsHTML(draft)}
      ${existing ? Taxes.sheetRow(existing.id) : ''}
      <div class="btns">
        ${existing ? '<button type="button" class="btn danger" data-act="tx-delete">Delete</button>' : ''}
        ${existing && draft.type === 'income' && !existing.loan && !draft.refund ? '<button type="button" class="btn" data-act="tx-split">Divide into jars</button>' : ''}
        ${existing && existing.type === 'expense' && draft.type === 'expense' && !draft.splitOn ? '<button type="button" class="btn" data-act="tx-split-receipt" title="Make separate records for each person or category">Split with people</button>' : ''}
        ${existing?.type === 'income' && draft.type === 'income' && !existing.loan && !draft.refund ? '<button type="button" class="btn" data-act="tx-allocate">Allocate to goals</button>' : ''}
        ${existing && !isT && !existing.loan ? '<button type="button" class="btn" data-act="tx-repeat" data-testid="tx-repeat">Repeat this…</button>' : ''}
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
    if (v('#tx-refund')) { draft.refund = v('#tx-refund').checked; if (draft.refund) { draft.loan = false; draft.notIncome = false; } }
    if (v('#tx-notincome')) draft.notIncome = v('#tx-notincome').checked;
    if (v('#tx-notspending')) draft.notSpending = v('#tx-notspending').checked;
    if (v('#tx-repeat')) draft.repeat = v('#tx-repeat').value;
    for (const f of ['account', 'from', 'to']) {
      const el = v(`#tx-${f}`);
      if (el) draft[f] = el.value;
    }
    RecordX.read(sheet, draft);
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
    paintPriceMemory(sheet);
  };

  // What the same payee usually costs, under the amount (js/prices.js): read only, nothing stored.
  const paintPriceMemory = (sheet) => {
    const typed = evalAmount(sheet.querySelector('#tx-amount')?.value) || 0;
    const cur = curOf();
    const rate = cur === baseCur ? 1 : Number(String(sheet.querySelector('#tx-rate')?.value || '').replace(',', '.')) || suggestedRate(cur) || 0;
    const er = entryOn() ? Number(String(sheet.querySelector('#tx-erate')?.value || '').replace(',', '.')) : 1;
    MoneyB.paintPrice(sheet, { note: sheet.querySelector('#tx-note')?.value ?? draft.note, type: draft.type, amountBase: Math.round(typed * (er > 0 ? er : 0) * rate), existingId: existing?.id || null });
  };

  // A category picked (or guessed): the account follows it, unless you chose one.
  const followCategory = (sheet) => {
    if (accTouched || draft.type === 'transfer') return;
    const next = M.defaultAccount(state, draft.type, draft.category);
    if (!next || next === draft.account) return;
    const before = curOf();
    draft.account = next;
    if (curOf() !== before) { readInputs(sheet); draft.account = next; rateText = ''; paint(sheet, false); updateHint(sheet); return; }
    const el = sheet.querySelector('#tx-account');
    if (el) el.value = next;
  };

  // "$12", "12 €", "12 eur": that amount in that currency (lei otherwise).
  const readSymbol = (sheet) => {
    if (draft.type === 'transfer') return false;
    const el = sheet.querySelector('#tx-amount');
    const hit = M.currencyInText(el.value);
    if (!hit.currency) return false;
    readInputs(sheet);
    amountText = hit.text;
    entryCur = hit.currency === curOf() ? null : hit.currency;
    entryRateText = entryCur ? defaultEntryRate(entryCur) : '';
    paint(sheet, false);
    const a = sheet.querySelector('#tx-amount');
    a.focus();
    a.setSelectionRange?.(a.value.length, a.value.length);
    updateHint(sheet);
    return true;
  };

  const paint = (sheet, focus = true) => {
    sheet.innerHTML = `<div class="grab"></div>${html()}`;
    const amount = sheet.querySelector('#tx-amount');
    amount.addEventListener('input', () => { if (!readSymbol(sheet)) updateHint(sheet); });
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
        if (f === 'account') accTouched = true;
        const before = curOf();
        const beforeTo = draft.type === 'transfer' ? toCur() : null;
        readInputs(sheet);
        // Currency changed: repaint so the currency label and rate line follow.
        if (curOf() !== before || (beforeTo && toCur() !== beforeTo)) { rateText = ''; toTouched = false; if (entryCur) entryRateText = defaultEntryRate(entryCur); paint(sheet, false); updateHint(sheet); }
      });
    }
    sheet.querySelector('#tx-note').addEventListener('input', (e) => {
      if (draft.type === 'transfer') return;
      draft.note = e.target.value;
      paintPriceMemory(sheet);
      const before = draft.category;
      if (!catTouched) draft.category = M.suggestCategory(state, e.target.value, catType());
      reguess();
      paintSub(sheet);
      if (draft.category && draft.category !== before) followCategory(sheet);
      const srcBefore = draft.incomeSource;
      reSrc();
      if (draft.incomeSource !== srcBefore) paintSrc(sheet);
    });
    sheet.querySelector('#tx-refund')?.addEventListener('change', () => {
      // The category list switches between income and expense categories.
      readInputs(sheet);
      if (draft.refund) { draft.notIncome = false; draft.incomeSource = null; }
      draft.category = M.suggestCategory(state, draft.note, catType());
      catTouched = false;
      subTouched = false;
      draft.sub = null;
      addingCat = false;
      if (!accTouched) draft.account = M.defaultAccount(state, 'income', draft.category);
      paint(sheet, false);
      updateHint(sheet);
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
    if (focusSel) { const f = sheet.querySelector(focusSel); f?.focus(); Flow.shake(f); }
  };

  const saveDraft = (sheet) => {
    const amount = evalAmount(amountText);
    if (!amount || amount <= 0) return fail(sheet, 'Enter an amount bigger than 0', '#tx-amount');
    const rxProblem = RecordX.check(draft, amount, { entryOn: entryOn(), cur: curOf() }); // fields and split lines
    if (rxProblem) return fail(sheet, rxProblem);
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
        category: draft.category || (draft.type === 'income' && !draft.refund ? 'other-in' : 'other'),
        ...(draft.type === 'expense' && draft.sub && T.subById(state, draft.sub)?.parent === draft.category ? { sub: draft.sub } : {}),
        rate,
        base: Math.round(entry.amount * rate),
        ...(entry.orig ? { orig: entry.orig } : {}),
        ...(entry.debt ? { debt: entry.debt } : {}),
        ...(personId ? { person: personId } : {}),
        ...(personId && draft.loan && !draft.refund ? { loan: true } : {}),
        ...(draft.type === 'income' && draft.refund && !draft.loan ? { refund: true } : {}),
        ...(draft.type === 'income' && draft.notIncome && !draft.refund && !draft.loan ? { notIncome: true } : {}),
        ...(draft.type === 'income' && !draft.refund && !(personId && draft.loan) && draft.incomeSource && IS.sourceById(state, draft.incomeSource) ? { incomeSource: draft.incomeSource } : {}),
        ...(draft.type === 'expense' && draft.notSpending && !draft.loan ? { notSpending: true } : {}),
      };
    }
    // Logged from a recurring item on the Plan screen.
    const rule = draft.fromRule && state.recurring.find((r) => r.id === draft.fromRule.id);
    if (rule) {
      tx.id = draft.fromRule.txId;
      tx.recurring = rule.id;
      markDone(rule, draft.fromRule.date, now);
      state.tx = state.tx.filter((t) => t.id !== tx.id);
      // Logged on purpose after it was taken back: newer than that deletion on every device (js/archive.js buried).
      if (state.deleted[tx.id]) tx.updatedAt = Math.max(tx.updatedAt || now, state.deleted[tx.id]) + 1;
      delete state.deleted[tx.id];
    }
    // "Repeat": this record becomes the first of a recurring item.
    if (!existing && draft.repeat && tx.type !== 'transfer') {
      const id = M.uid();
      state.recurring.push({ id, createdAt: now, updatedAt: now, type: tx.type, amount: tx.amount, currency: tx.currency, account: tx.account, category: tx.category, note: tx.note, ...(tx.person ? { person: tx.person } : {}), every: draft.repeat, start: tx.date, lastDone: tx.date, auto: false, paused: false });
      tx.recurring = id;
    }
    // The form does not show the tax tag or receipts: keep them (js/screens/taxes.js).
    if (existing) Object.assign(tx, Taxes.keepOnEdit(state, existing.id));
    // Nor where it came from, its book or whether you confirmed it (phase 5): kept too (model.js keptOnEdit).
    if (existing) tx = M.keptOnEdit(existing, tx);
    tx = RecordX.apply(tx, draft, existing); // your own fields, split lines (or none: unsplit)
    if (existing) state.tx = state.tx.map((t) => (t.id === existing.id ? tx : t));
    else state.tx.push(tx);
    // You picked or confirmed the subcategory: remember the shop for next time.
    if (tx.sub && subTouched && tx.note) T.rememberSub(state, tx.note, tx.sub, now);
    ui.flashId = tx.id;
    if (tx.type === 'income' || (tx.type === 'transfer' && tx.to === state.settings.savingsAccount)) sound.income(state);
    else if (tx.type === 'expense') sound.expense(state);
    commit();
    closeSheet();
    // Changed the category: offer to always file records like this there.
    if (existing && Rules.afterCorrection(existing, tx)) return;
    if (!existing && draft.repeat && tx.type !== 'transfer') { toast(`Added, and it repeats ${FREQS.find((f) => f.id === draft.repeat).short}. See Plan.`); return; }
    if (!existing && offerMonthlyBill(tx)) return;
    const alert = !existing && M.budgetAlert(state, tx);
    if (alert) { toast(alert.text); return; }
    if (!existing && tx.type === 'income' && !tx.loan && !tx.refund) openSplitSheet(tx);
    else if (!existing && tx.refund) toast(`Refund ${formatMoney(tx.amount, tx.currency)}: lowers ${catOf(tx.category).name} spending`, 'Undo', () => undoRedo(-1));
    else toast(existing ? 'Saved' : `${tx.type === 'expense' ? 'Spent' : tx.type === 'income' ? 'Earned' : 'Moved'} ${tx.orig ? `${formatMoney(tx.orig.amount, tx.orig.currency)} (${formatMoney(tx.amount, tx.currency)})` : formatMoney(tx.amount, tx.currency)}`);
  };

  // paint() replaces the sheet's contents (fresh inputs each time); this click
  // listener sits on the sheet itself, so it is bound once.
  openSheet('', (sheet) => {
    Taxes.bindSheet(sheet);
    RecordX.bind(sheet, { draft, repaint: () => { paint(sheet, false); updateHint(sheet); }, readAll: () => readInputs(sheet), total: () => evalAmount(sheet.querySelector('#tx-amount')?.value) || 0, cur: () => curOf() });
    sheet.addEventListener('click', (e) => {
      const seg = e.target.closest('.seg button');
      if (seg) {
        readInputs(sheet);
        if (seg.dataset.type !== draft.type) {
          draft.type = seg.dataset.type;
          if (draft.type !== 'income') draft.refund = false;
          draft.notIncome = false;
          draft.notSpending = false;
          if (draft.type !== 'income') draft.incomeSource = null;
          addingSrc = false;
          draft.category = catTouched ? null : M.suggestCategory(state, draft.note, catType());
          catTouched = false;
          addingCat = false;
          subTouched = false;
          draft.sub = null;
          reguess();
          if (draft.type === 'income') reSrc();
          if (!accTouched && draft.type !== 'transfer') draft.account = M.defaultAccount(state, draft.type, draft.category);
          paint(sheet);
        }
        return;
      }
      const srcBtn = e.target.closest('.src-chip[data-src]');
      if (srcBtn) {
        draft.incomeSource = draft.incomeSource === srcBtn.dataset.src ? null : srcBtn.dataset.src;
        srcTouched = true;
        // A source's usual account is used until you pick an account yourself.
        const usual = draft.incomeSource && IS.sourceById(state, draft.incomeSource)?.account;
        if (usual && !accTouched && usual !== draft.account && M.account(state, usual) && !M.account(state, usual).archived) {
          readInputs(sheet);
          draft.account = usual;
          rateText = '';
          paint(sheet, false);
          updateHint(sheet);
        } else paintSrc(sheet);
        return;
      }
      if (e.target.closest('[data-act="src-form-new"]')) {
        addingSrc = true;
        paintSrc(sheet);
        return;
      }
      if (e.target.closest('[data-act="src-form-create"]')) {
        const r = IS.addSource(state, { name: sheet.querySelector('#new-src')?.value });
        if (r.ok || (r.error === 'exists' && !r.source.archived)) {
          draft.incomeSource = r.source.id;
          srcTouched = true;
          addingSrc = false;
          if (r.ok) persist();
        } else if (r.error === 'exists') toast(`"${r.source.name}" is archived. Bring it back in Settings → Income sources.`);
        else toast('Give the source a name');
        paintSrc(sheet);
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
      const subBtn = e.target.closest('.sub-chip[data-sub]');
      if (subBtn) {
        draft.sub = draft.sub === subBtn.dataset.sub && subTouched ? null : subBtn.dataset.sub;
        subTouched = true;
        paintSub(sheet);
        return;
      }
      if (e.target.closest('[data-act="sub-yes"]') && subGuess) {
        subTouched = true;
        subOpen = false;
        draft.sub = subGuess.id;
        const moved = draft.category !== subGuess.parent;
        draft.category = subGuess.parent;
        catTouched = true;
        if (moved) followCategory(sheet);
        // An old record: filed right away, one tap.
        const live = existing && state.tx.find((t) => t.id === existing.id);
        if (live && live.type === 'expense') {
          T.setSub(state, live, subGuess.id);
          existing.sub = subGuess.id;
          existing.category = subGuess.parent;
          persist();
          Sync.changed();
          toast(`Filed under ${subGuess.name}`);
        }
        paintSub(sheet);
        return;
      }
      if (e.target.closest('[data-act="sub-change"]')) {
        subOpen = !subOpen;
        paintSub(sheet);
        return;
      }
      if (e.target.closest('[data-act="sub-new"]')) {
        addingSub = true;
        subOpen = true;
        paintSub(sheet);
        return;
      }
      if (e.target.closest('[data-act="sub-create"]')) {
        const made = T.addSub(state, draft.category, sheet.querySelector('#new-sub')?.value || '');
        addingSub = false;
        if (made) {
          draft.sub = made.id;
          subTouched = true;
          persist();
        }
        paintSub(sheet);
        return;
      }
      const cat = e.target.closest('.cat[data-cat]');
      if (cat) {
        draft.category = cat.dataset.cat;
        catTouched = true;
        if (draft.sub && T.subById(state, draft.sub)?.parent !== draft.category) { draft.sub = null; subTouched = false; }
        subOpen = false;
        reguess();
        paintSub(sheet);
        followCategory(sheet);
        const srcWas = draft.incomeSource;
        reSrc();
        if (draft.incomeSource !== srcWas) paintSrc(sheet);
        return;
      }
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        const p = picks[pick.dataset.pick];
        readInputs(sheet);
        Object.assign(draft, { type: p.type, note: p.note, category: p.category, sub: null });
        subTouched = false;
        if (M.account(state, p.account) && !M.account(state, p.account).archived) draft.account = p.account;
        amountText = centsToPlain(p.amount);
        rateText = '';
        entryCur = null; // quick picks are in the account's currency
        catTouched = true;
        reguess();
        srcTouched = false;
        draft.incomeSource = null;
        reSrc();
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
      if (e.target.closest('[data-act="tx-repeat"]') && existing) { closeSheet(); setTimeout(() => Plan.editRule(null, Repeating.presetFromTx(existing)), 200); }
      if (e.target.closest('[data-act="tx-split"]')) { closeSheet(); setTimeout(() => openSplitSheet(existing), 200); }
      if (e.target.closest('[data-act="tx-split-receipt"]')) { closeSheet(); setTimeout(() => openReceiptSplit(existing), 200); }
      const tagBtn = e.target.closest('.tag-pick[data-tag]');
      if (tagBtn) {
        readInputs(sheet);
        const tag = tagBtn.dataset.tag;
        const has = M.tagsOf(draft.note).includes(tag);
        draft.note = has ? draft.note.replace(new RegExp(`(^|\\s)#${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i'), '').replace(/\s+/g, ' ').trim() : `${draft.note.trim()} #${tag}`.trim();
        const noteEl = sheet.querySelector('#tx-note');
        if (noteEl) noteEl.value = draft.note;
        tagBtn.setAttribute('aria-pressed', String(!has));
        return;
      }
      if (e.target.closest('[data-act="tx-allocate"]')) { closeSheet(); setTimeout(() => Goals.openAllocationSheet(existing.id), 200); }
    });
    paint(sheet);
  });
}

// One receipt across categories or people: the parts become separate
// records with the same date and account (model.js splitRecord).
function openReceiptSplit(tx) {
  if (!tx || tx.type !== 'expense') return;
  const cur = tx.currency;
  let parts = [
    { amount: '', category: tx.category, person: M.person(state, tx.person)?.name || '' },
    { amount: '', category: tx.category, person: '' },
  ];
  const cats = categoryOrder('expense');
  const read = (sheet) => {
    parts = [...sheet.querySelectorAll('.rs-row')].map((row) => ({
      amount: row.querySelector('.rs-amt').value,
      category: row.querySelector('.rs-cat').value,
      person: row.querySelector('.rs-person').value,
    }));
  };
  const cents = (p) => evalAmount(String(p.amount)) || 0;
  const paint = (sheet) => {
    const used = parts.reduce((a, p) => a + cents(p), 0);
    const left = tx.amount - used;
    sheet.innerHTML = `<div class="grab"></div><h3>Split receipt <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
      <p class="muted small">${esc(tx.note || catOf(tx.category).name)} · ${formatMoney(tx.amount, cur)} on ${esc(tx.date)}. Each part becomes its own record.</p>
      <div class="rs-list">${parts.map((p, i) => `<div class="rs-row">
        <input class="rs-amt" type="text" inputmode="decimal" placeholder="${i === parts.length - 1 && left > 0 ? centsToPlain(left) : '0'}" value="${esc(p.amount)}" aria-label="Part ${i + 1} amount">
        <select class="rs-cat" aria-label="Part ${i + 1} category">${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === p.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <input class="rs-person" type="text" list="people-list" placeholder="Person (optional)" value="${esc(p.person)}" aria-label="Part ${i + 1} person">
      </div>`).join('')}</div>
      <datalist id="people-list">${state.people.map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist>
      <p class="small ${left === 0 ? 'income' : 'muted'}" id="rs-left">${left === 0 ? 'Adds up.' : left > 0 ? `${formatMoney(left, cur)} left to share (the last empty part takes it)` : `${formatMoney(-left, cur)} too much`}</p>
      <div class="btns"><button type="button" class="btn" data-act="rs-add">+ Part</button><button type="button" class="btn primary" data-act="rs-save">Split</button></div>`;
  };
  openSheet('', (sheet) => {
    sheet.addEventListener('input', () => {
      read(sheet);
      const used = parts.reduce((a, p) => a + cents(p), 0);
      const left = tx.amount - used;
      const el = sheet.querySelector('#rs-left');
      if (el) { el.textContent = left === 0 ? 'Adds up.' : left > 0 ? `${formatMoney(left, cur)} left to share (the last empty part takes it)` : `${formatMoney(-left, cur)} too much`; el.className = `small ${left === 0 ? 'income' : 'muted'}`; }
    });
    sheet.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="rs-add"]')) { read(sheet); parts.push({ amount: '', category: tx.category, person: '' }); paint(sheet); return; }
      if (!e.target.closest('[data-act="rs-save"]')) return;
      read(sheet);
      const used = parts.reduce((a, p) => a + cents(p), 0);
      const empty = parts.filter((p) => !cents(p));
      if (empty.length === 1 && tx.amount - used > 0) empty[0].amount = centsToPlain(tx.amount - used);
      const now = Date.now();
      const list = parts.filter((p) => cents(p) > 0).map((p) => ({ amount: cents(p), category: p.category, person: p.person.trim() ? M.ensurePerson(state, p.person, now) : null }));
      const out = M.splitRecord(tx, list, now);
      if (!out) { toast(`The parts must add up to ${formatMoney(tx.amount, cur)} (at least two).`); return; }
      state.tx = state.tx.filter((t) => t.id !== tx.id).concat(out);
      commit();
      closeSheet();
      toast(`Split into ${out.length} records`);
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
      if (v === 'loan-lent') {
        d.type = 'expense';
        d.loan = true;
        d.category = 'other';
      } else if (v === 'loan-borrowed') {
        d.type = 'income';
        d.loan = true;
        d.category = 'other-in';
      } else {
        d.type = v;
        d.loan = false;
        d.category = M.suggestCategory(state, d.note, v) || '';
      }
      renderKeepFocus();
    } else if (col === 'note') {
      d.note = v;
      if (!d.loan && /^(loan|lent|borrowed|debt)\b/i.test(v.trim())) {
        d.loan = true;
      }
      if (!d.category) {
        d.category = M.suggestCategory(state, v, d.type) || (d.loan ? (d.type === 'income' ? 'other-in' : 'other') : '');
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
    if (!c || c <= 0) { toast('Amount must be a number bigger than 0'); el.value = formatMoney(t.amount, '', { reveal: true }); return; }
    t.amount = c;
    t.base = Math.round(c * (t.rate || 1));
    if (t.debt && t.currency === t.debt.currency) {
      t.debt.amount = c;
    }
  } else if (col === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { el.value = t.date; return; }
    t.date = v;
  } else if (col === 'type') {
    if (v === 'loan-lent') {
      t.type = 'expense';
      t.loan = true;
      t.account = t.account || t.from || state.settings.accounts[0].id;
      t.category = t.category || 'other';
      delete t.from;
      delete t.to;
    } else if (v === 'loan-borrowed') {
      t.type = 'income';
      t.loan = true;
      t.account = t.account || t.from || state.settings.accounts[0].id;
      t.category = t.category || 'other-in';
      delete t.from;
      delete t.to;
    } else if (v === 'transfer') {
      delete t.loan;
      delete t.debt;
      t.from = t.account || state.settings.accounts[0].id;
      t.to = state.settings.accounts.find((a) => a.id !== t.from && a.id === state.settings.savingsAccount)?.id
        || state.settings.accounts.find((a) => a.id !== t.from)?.id;
      delete t.account;
      delete t.category;
    } else {
      delete t.loan;
      delete t.debt;
      t.account = t.account || t.from || state.settings.accounts[0].id;
      t.category = M.suggestCategory(state, t.note, v) || (v === 'income' ? 'other-in' : 'other');
      delete t.from;
      delete t.to;
      t.type = v;
    }
  } else if (col === 'from' || col === 'to') {
    const other = col === 'from' ? t.to : t.from;
    if (v === other) { toast('Pick two different accounts'); el.value = t[col]; return; }
    t[col] = v;
  } else if (col === 'account') {
    setTxAccount(t, v);
  } else if (col === 'person') {
    const id = M.ensurePerson(state, v);
    if (id) {
      t.person = id;
    } else {
      delete t.person;
      delete t.loan;
      delete t.debt;
    }
  } else if (['category', 'note'].includes(col)) {
    t[col] = col === 'note' ? v.trim() : v;
    if (col === 'note' && !t.loan && /^(loan|lent|borrowed|debt)\b/i.test(t.note)) {
      t.loan = true;
    }
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
  
  const isLoan = Boolean(d.loan || d.type === 'loan-lent' || d.type === 'loan-borrowed' || /^(loan|lent|borrowed|debt)\b/i.test(d.note || ''));
  const actualType = d.type === 'loan-borrowed' ? 'income' : (d.type === 'loan-lent' ? 'expense' : d.type);
  
  const base = { id: M.uid(), createdAt: now, updatedAt: now, type: actualType, amount, currency: cur, rate, base: Math.round(amount * rate), date: d.date, note: (d.note || '').trim() };
  if (isLoan) base.loan = true;
  if (d.type === 'transfer' && cur !== (M.account(state, d.to)?.currency || cur)) {
    const toAmount = convert(amount, cur, M.account(state, d.to).currency, state.rates);
    if (toAmount == null) { toast('Different currencies: use + New record to enter what arrives.'); return; }
    base.toAmount = toAmount;
  }
  const personId = M.ensurePerson(state, d.personName);
  ui.flashId = base.id;
  state.tx.push(actualType === 'transfer'
    ? { ...base, from: d.from, to: d.to }
    : { ...base, account: d.account, category: d.category || M.suggestCategory(state, d.note, actualType) || (actualType === 'income' ? 'other-in' : 'other'), ...(personId ? { person: personId } : {}) });
  ui.draft = { ...d, type: 'expense', loan: false, note: '', category: '', amountText: '', personName: '' };
  commit();
  toast(isLoan ? `Added loan ${money(amount)}` : `Added ${money(amount)}`);
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
  const inc = items.filter((t) => countsAsIncome(t)).reduce((a, t) => a + M.B(t), 0);
  const exp = items.filter((t) => countsAsSpending(t)).reduce((a, t) => a + signed(t, M.B(t)), 0);
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
  // This app's full money export: its own import (ids, rates and values kept).
  if (isMoneyExport(rows)) { MoneyIO.openImport(rows); return; }
  if (isStatement(rows)) { openBankImport(rows); return; }
  const res = importRows(rows, state);
  if (!res.tx.length) {
    toast(res.duplicates ? `Already imported (${res.duplicates} records).` : 'No records found. Rows need a date and an amount.');
    // Importing again is also how you check a sheet against the app.
    if (res.duplicates && res.format === 'sheet') ImportCheck.show(importCheck([{ name: res.allMonths.map((m) => monthLabel(m)).join(', ') || 'Your sheet', ...res }]));
    return;
  }
  // Rows in another currency without a rate: warned about, never imported 1:1.
  let accPick = null;
  const body = () => {
    const incomes = res.tx.filter((t) => t.type === 'income').length;
    const expenses = res.tx.filter((t) => t.type === 'expense').length;
    const gaps = RateGaps.gapsOf(res.tx);
    return `<h3>Import ${res.format === 'app' ? 'CSV' : 'from your sheet'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p style="margin-top:0">${res.months.map((m) => monthLabel(m)).join(', ')}</p>
    <div class="split-row"><span>${incomes} incomes</span><b class="money income">${money(res.income)}</b></div>
    <div class="split-row"><span>${expenses} expenses</span><b class="money expense">${money(res.expense)}</b></div>
    ${res.duplicates ? `<div class="split-row"><span class="muted">Already here, skipped</span><b>${res.duplicates}</b></div>` : ''}
    ${RateGaps.gapHTML(gaps)}
    <p class="muted small">Check these totals match your sheet. Categories are guessed from your notes; tap any record later to fix it.</p>
    ${res.format === 'sheet' ? `<label class="field"><span>Put them in</span><select id="imp-acc">${state.settings.accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === accPick ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : ''}
    <div class="btns"><button class="btn" data-close>Cancel</button><button class="btn primary" id="imp-go" ${gaps.length || !res.tx.length ? 'disabled' : ''}>Import ${res.tx.length}</button></div>`;
  };
  // The sheet format goes into one account: its currency decides the rate.
  const applyAcc = () => {
    if (res.format !== 'sheet' || !accPick) return;
    const cur = M.account(state, accPick)?.currency || state.settings.currency;
    for (const t of res.tx) {
      if (!t.account) continue;
      t.account = accPick;
      if (t.currency !== cur) { t.currency = cur; t.rate = suggestedRate(cur); t.base = t.rate ? Math.round(t.amount * t.rate) : t.amount; }
    }
  };
  openSheet(body(), (sheet) => {
    const paint = () => { sheet.innerHTML = `<div class="grab"></div>${body()}`; };
    accPick = sheet.querySelector('#imp-acc')?.value || null;
    applyAcc();
    paint();
    sheet.addEventListener('change', (e) => {
      if (e.target.id !== 'imp-acc') return;
      accPick = e.target.value;
      applyAcc();
      paint();
    });
    sheet.addEventListener('click', (e) => {
      if (RateGaps.onGapClick(e, sheet, async (g) => {
        const base = state.settings.currency;
        if (g.kind === 'set') fillRate(res.tx, g.currency, g.rate, base);
        else if (g.kind === 'skip') res.tx = skipNoRate(res.tx, g.currency, base);
        else if (g.kind === 'fetch') { await RateGaps.fetchRates(); fillKnownRates(res.tx, state); }
        res.income = previewTotal(res.tx, 'income');
        res.expense = previewTotal(res.tx, 'expense');
        paint();
      })) return;
      if (!e.target.closest('#imp-go') || RateGaps.gapsOf(res.tx).length || !res.tx.length) return;
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
  const mx = sheets.find((sh) => isMoneyExport(sh.rows));
  if (mx) { MoneyIO.openImport(mx.rows.map((r) => r.map((c) => (c == null ? '' : c)))); return; }
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
    <div id="imp-gaps"></div>
    <div class="btns"><button class="btn" data-close>Cancel</button><button class="btn primary" id="imp-go">Import</button></div>`, (sheet) => {
    const pickedTabs = () => [...sheet.querySelectorAll('[data-tab-i]:checked')].map((el) => tabs[el.dataset.tabI]);
    const count = () => pickedTabs().reduce((a, t) => a + t.tx.length, 0);
    const btn = sheet.querySelector('#imp-go');
    // The account's currency decides each row's rate; rates you set stay.
    const fx = {};
    const applyAcc = () => {
      const acc = sheet.querySelector('#imp-acc').value;
      const cur = M.account(state, acc)?.currency || state.settings.currency;
      for (const t of tabs.flatMap((x) => x.tx)) {
        if (!t.account) continue;
        t.account = acc;
        if (cur !== t.currency) { t.currency = cur; t.rate = fx[cur] || suggestedRate(cur); t.base = t.rate ? Math.round(t.amount * t.rate) : t.amount; }
      }
    };
    // Rows in another currency without a rate: warned about, never imported 1:1.
    const label = () => {
      const gaps = RateGaps.gapsOf(pickedTabs().flatMap((t) => t.tx));
      sheet.querySelector('#imp-gaps').innerHTML = RateGaps.gapHTML(gaps);
      const n = count();
      btn.textContent = `Import ${n} record${n === 1 ? '' : 's'}`;
      btn.disabled = !n || gaps.length > 0;
    };
    sheet.addEventListener('change', (e) => {
      if (e.target.id === 'imp-acc') applyAcc();
      label();
    });
    applyAcc();
    label();
    sheet.addEventListener('click', (e) => {
      RateGaps.onGapClick(e, sheet, async (g) => {
        const base = state.settings.currency;
        for (const t of tabs) {
          if (g.kind === 'set') { fx[g.currency] = g.rate; fillRate(t.tx, g.currency, g.rate, base); }
          else if (g.kind === 'skip') t.tx = skipNoRate(t.tx, g.currency, base);
        }
        if (g.kind === 'fetch') { await RateGaps.fetchRates(); for (const t of tabs) fillKnownRates(t.tx, state); }
        label();
      });
    });
    btn.addEventListener('click', () => {
      const chosen = pickedTabs();
      const picked = chosen.flatMap((t) => t.tx);
      if (!picked.length || RateGaps.gapsOf(picked).length) return;
      state.tx.push(...picked);
      commit();
      closeSheet();
      const months = [...new Set(picked.map((t) => t.date.slice(0, 7)))].sort();
      if (months.length) ui.month = months.at(-1);
      location.hash = '#log';
      toast(`Imported ${picked.length} records from ${months.length} month${months.length === 1 ? '' : 's'}`);
      const checks = importCheck(chosen.filter((t) => t.format === 'sheet'));
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
  const txCount = state.tx.length;
  const accCount = state.accounts.length;
  const pplCount = (state.people || []).length;

  openSheet(`
    <div class="wipe-modal">
      <div class="wipe-modal-header">
        <div class="wipe-danger-badge">⚠️</div>
        <div>
          <h3 style="margin:0; font-size:18px; color:var(--expense, #ef4444)">Permanently erase all data?</h3>
          <p class="muted small" style="margin:4px 0 0">This will wipe all records from this device. It cannot be undone.</p>
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Close" style="margin-left:auto">✕</button>
      </div>

      <div class="wipe-summary-grid">
        <div class="wipe-summary-item">
          <span class="wipe-sum-val">${txCount}</span>
          <span class="wipe-sum-lbl">Transactions</span>
        </div>
        <div class="wipe-summary-item">
          <span class="wipe-sum-val">${accCount}</span>
          <span class="wipe-sum-lbl">Accounts</span>
        </div>
        <div class="wipe-summary-item">
          <span class="wipe-sum-val">${pplCount}</span>
          <span class="wipe-sum-lbl">People &amp; Loans</span>
        </div>
        <div class="wipe-summary-item">
          <span class="wipe-sum-val">All</span>
          <span class="wipe-sum-lbl">Settings &amp; Jars</span>
        </div>
      </div>

      <div class="wipe-backup-banner">
        <span>💡 Save a backup file to keep your history safe before erasing.</span>
        <button type="button" class="btn small" data-act="export-json">💾 Download backup</button>
      </div>

      <div class="wipe-confirm-box">
        <label for="wipe-confirm-input" class="wipe-confirm-prompt">
          To confirm permanent deletion, type <strong>ERASE</strong> in the box below:
        </label>
        <input type="text" id="wipe-confirm-input" class="input block" placeholder="Type ERASE to confirm" autocomplete="off" spellcheck="false" autofocus>
      </div>

      <div class="btns wipe-btns">
        <button type="button" class="btn" data-close>Keep my data</button>
        <button type="button" class="btn danger disabled" id="wipe-go" disabled title="Type ERASE above to enable">
          ⚠️ Erase everything (${txCount} records)
        </button>
      </div>
    </div>
  `, (sheet) => {
    const input = sheet.querySelector('#wipe-confirm-input');
    const goBtn = sheet.querySelector('#wipe-go');

    const updateState = () => {
      const match = (input?.value || '').trim().toUpperCase() === 'ERASE';
      if (goBtn) {
        goBtn.disabled = !match;
        goBtn.classList.toggle('disabled', !match);
        goBtn.classList.toggle('ready', match);
        goBtn.title = match ? 'Click to permanently erase all data' : 'Type ERASE above to enable';
      }
    };

    input?.addEventListener('input', updateState);
    input?.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' && (input?.value || '').trim().toUpperCase() === 'ERASE') {
        goBtn?.click();
      }
    });

    goBtn?.addEventListener('click', () => {
      if ((input?.value || '').trim().toUpperCase() !== 'ERASE') return;
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
    else if (key === 'theme' && inLifeNow()) {
      st.themeInLife = v;
      applyTheme();
      render();
    }
    else if (key === 'theme') {
      st.theme = v;
      if (v === 'samurai') {
        st.wallpaper = 'samurai-moon';
      } else if (v === 'paper') {
        st.wallpaper = 'paper-warm';
      } else if (v === 'forest') {
        st.wallpaper = 'forest-canopy';
      } else if (v === 'ocean') {
        st.wallpaper = 'ocean-tides';
      } else if (v === 'dark' || v === 'light' || v === 'system') {
        st.wallpaper = 'none';
      }
      applyTheme();
      render();
    }
    else if (key === 'themeMotion') { st.themeMotion = el.checked; applyTheme(); }
    else if (key === 'sound') { st.sound = el.checked; if (st.sound) sound.test(state); }
    else if (key === 'checkupOn') st.checkupOn = el.checked;
    else if (key === 'checkupDay') st.checkupDay = Math.max(1, Math.min(28, Math.round(Number(v)) || 1));
    else if (key === 'checkupEvery') { if (['week', '2weeks', 'month'].includes(v)) st.checkupEvery = v; render(); }
    else if (key === 'checkupWeekday') st.checkupWeekday = Math.max(0, Math.min(6, Math.round(Number(v)) || 0));
    else if (key === 'checkupTime') { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) st.checkupTime = v; }
    else if (key === 'cashCountOn') st.cashCountOn = el.checked;
    else if (key === 'cashCountDay') st.cashCountDay = Math.max(0, Math.min(6, Math.round(Number(v)) || 0));
    else if (key === 'everydayLimit') st.everydayLimit = Math.max(0, evalAmount(v) || 0);
    else if (key === 'currency') st.currency = v.trim().toUpperCase() || 'MDL';
    else if (key === 'wallpaper') {
      st.wallpaper = v;
      applyWallpaper();
      render();
    }
    else if (key === 'customWallpaper') {
      st.customWallpaper = v.trim();
      applyWallpaper();
    }
    else if (key === 'wallpaperOpacity') {
      st.wallpaperOpacity = Number(v);
      applyWallpaper();
    }
    if (!['theme', 'themeMotion', 'sound', 'wallpaper', 'customWallpaper', 'wallpaperOpacity'].includes(key)) st.updatedAt = Date.now();
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
    else if (el.dataset.field === 'jar') { c.jar = v; c.jarChosen = true; }
    else if (el.dataset.field === 'bill') c.bill = el.checked;
    else if (el.dataset.field === 'workCost') c.workCost = el.checked;
  } else return;
  persist();
  Sync.changed();
}

// ---------- Events ----------

document.addEventListener('click', (e) => {
  // Table dates: the weekday text is on top; a click opens the date picker.
  if (e.target.matches?.('.dpick')) { try { e.target.showPicker?.(); } catch { /* not supported */ } }
  const btn = e.target.closest('button, .btn, .chip, .fab, .tabbar a, .subtabs a, [data-act], [data-go], .seg button, .tgb-main, .calc-keys button');
  if (btn && !btn.disabled) {
    sound.click(state);
  }
  if (e.target.matches('[data-close]') || e.target.closest('button[data-close]')) {
    if (e.target.classList.contains('sheet-backdrop') || e.target.closest('button[data-close]')) closeSheet();
    return;
  }
  const el = e.target.closest('[data-act]');
  if (el && !el.closest('.sheet')) {
    const act = el.dataset.act;
    if (act === 'toggle-mask') { Privacy.toggle(); return; }
    if (act === 'cmd-palette') {
      openPalette({
        state,
        go: (tab) => { location.hash = `#${tab}`; },
        openNew: (draft = {}) => openTxSheet(draft),
        openCalc: () => Calc.toggle(),
        lock: () => { if (Security.hasLock()) Security.lock(); },
        exportExcel: () => exportExcel(),
        backupJSON: () => exportJSON(),
      });
      return;
    }
    if (act === 'lock-app') {
      if (Security.hasLock()) {
        Security.lock();
      } else {
        toast('Set a PIN in Settings to lock with one click (or press L)');
        location.hash = '#settings';
      }
      return;
    }
  }
  const go = e.target.closest('[data-go]');
  if (go && !el) { location.hash = `#${go.dataset.go}`; return; }
  if (!el || el.closest('.sheet')) return;
  const act = el.dataset.act;
  if (act === 'test-sound') {
    sound.test(state);
    toast('Playing sound test 🔊');
    return;
  }
  if (act === 'amb-toggle') {
    AmbientMusic.toggle();
    renderSidebar();
    if (ui.tab === 'settings' && ['general', 'extras'].includes(ui.settingsTab)) render();
    return;
  }
  if (act === 'amb-next') {
    AmbientMusic.nextTrack();
    renderSidebar();
    if (ui.tab === 'settings' && ['general', 'extras'].includes(ui.settingsTab)) render();
    return;
  }
  if (act === 'amb-track') {
    AmbientMusic.setTrack(el.dataset.track);
    if (!AmbientMusic.getState().playing) AmbientMusic.play();
    renderSidebar();
    if (ui.tab === 'settings' && ['general', 'extras'].includes(ui.settingsTab)) render();
    return;
  }
  if (RecordX.onClick(act, el)) return; // fields, tags, bulk "Set field" / "Add tag"
  if (Standalone.onClick(act, el)) return;
  if (SCREENS[ui.tab]?.onClick?.(act, el)) return;
  if (act === 'acc-open') AccountsScreen.openAccount(el.dataset.id);
  else if (act === 'person-open') PeopleScreen.openPerson(el.dataset.id);
  else if (act === 'more') openMoreSheet();
  else if (act === 'bd-toggle') Buddy.toggle();
  else if (act === 'calc') Calc.toggle();
  else if (act === 'pay-setup') openPaySheet();
  else if (act === 'limit-setup') openLimitSheet();
  else if (act === 'spend-setup') openSpendSheet();
  else if (act === 'recap-open') openRecap(el.dataset.key || addMonths(monthKey(todayISO()), -1));
  else if (act === 'step-later') {
    const today = todayISO();
    const hidden = Object.fromEntries(Object.entries(state.meta.stepsHidden || {}).filter(([, d]) => d === today));
    hidden[el.dataset.id] = today;
    state.meta.stepsHidden = hidden;
    persist({ quiet: true });
    render();
  } else if (act === 'step-save') {
    // From your fullest card or cash in the main currency, to your savings.
    const base = state.settings.currency;
    const ids = spendingIds(state, todayISO());
    const liquid = M.accountValues(state).filter((v) => ids.has(v.account.id) && (v.account.currency || base) === base)
      .sort((a, b) => (b.inBase || 0) - (a.inBase || 0))[0]?.account;
    const to = state.settings.savingsAccount || state.settings.accounts.find((a) => !a.archived && (a.savings || a.kind === 'savings'))?.id;
    openTxSheet(null, { type: 'transfer', amountText: centsToPlain(Number(el.dataset.amount) || 0), from: liquid?.id, to, note: 'Savings' });
  }
  else if (act === 'pay-now') payNow();
  else if (act === 'pay-hide') { state.meta.payHide = 1; persist(); toast('Hidden. Set it up any time from Settings → Saving → Pay yourself.'); }
  else if (act === 'quick-pick') {
    const p = M.quickPicks(state, todayISO(), 8)[Number(el.dataset.i)];
    if (p) openTxSheet(null, { type: p.type, note: p.note, category: p.category, account: p.account, amountText: centsToPlain(p.amount) });
  }
  else if (act.startsWith('update-')) Updates.onClick(act);
  else if (act === 'cat-open') Spending.openCategory(el.dataset.cat, el.dataset.period, el.dataset.type);
  else if (Spending.onClick(act, el)) { /* the "Where your money goes" card */ }
  else if (Reprice.onClick(act)) { /* "Re-price past entries" */ }
  else if (MoneyB2.onClick(act, el)) { /* budgets from 3 months, month review, subscriptions */ }
  else if (Reconcile.onClick(act, el)) { /* monthly reconciliation */ }
  else if (Tidy.onClick(act)) { /* duplicates, refund suggestions, rate update */ }
  else if (CashCount.onClick(act, el)) { /* weekly cash count card */ }
  else if (Checkup.onClick(act, el)) { /* reality check card and settings */ }
  else if (Money3.onClick(act, el)) { /* favourites and the emergency fund */ }
  else if (act === 'sq-chip-x') { ui.search = withoutTerm(ui.search, Number(el.dataset.i), state); render(); }
  else if (act === 'shortcuts-help') Shortcuts.openHelp();
  else if (act === 'bulk-all') { for (const r of document.querySelectorAll('#tx-table tr[data-id]')) ui.selected.add(r.dataset.id); refreshSelection(); }
  else if (act === 'add') openTxSheet();
  else if (act === 'edit') { const t = state.tx.find((x) => x.id === el.dataset.id); if (t) openTxSheet(t); else toast('This record is in an archived year. Unarchive it in Settings → Data & backups to change it.'); }
  else if (act === 'transfer') openTransferSheet(el.dataset.from);
  else if (act === 'month') goToMonth(addMonths(ui.month, Number(el.dataset.step)));
  else if (act === 'goto-month') goToMonth(el.dataset.month);
  else if (act === 'free-day') { try { window.parent.postMessage({ type: 'LIFE_SYSTEM_BRIDGE', action: 'FINANCE_FREE_DAY', payload: { op: 'mark' } }, location.origin); } catch {} }
  else if (act === 'year') goToMonth(`${Number(ui.month.slice(0, 4)) + Number(el.dataset.step)}${ui.month.slice(4)}`);
  else if (act === 'year') { ui.year += Number(el.dataset.step); render({ enter: true }); }
  else if (act === 'open-month') { ui.month = el.dataset.key; ui.search = ''; location.hash = '#log'; }
  else if (act === 'filter') { ui.filter = el.dataset.filter; render(); }
  else if (act === 'log-quick-search') { ui.search = el.dataset.q; render(); document.getElementById('search')?.focus(); }
  else if (act === 'log-clear-search') { ui.search = ''; render(); }
  else if (act === 'log-archived') { ui.archived = !ui.archived; render(); }
  else if (act === 'filter-save') {
    const q = ui.search.trim();
    if (q) { saveFilter(state, q, q.length > 24 ? `${q.slice(0, 22)}…` : q); commit({ quiet: true }); toast('Saved. Tap the chip to run it again.'); }
  }
  else if (act === 'filter-forget') { removeFilter(state, el.dataset.q); commit({ quiet: true }); }
  else if (act === 'filter-toggle') { ui.filterOpen = !el.closest('details')?.open; }
  else if (act === 'filter-apply') {
    const v = (id) => document.getElementById(id)?.value?.trim() || '';
    const parts = [];
    if (v('fp-cat')) parts.push(`cat:${v('fp-cat')}`);
    if (v('fp-acc')) parts.push(`acc:${v('fp-acc')}`);
    if (v('fp-tag')) parts.push(`#${v('fp-tag')}`);
    if (v('fp-src')) parts.push(`source:"${v('fp-src')}"`);
    if (v('fp-from')) parts.push(`from:${v('fp-from')}`);
    if (v('fp-to')) parts.push(`to:${v('fp-to')}`);
    if (v('fp-min')) parts.push(`>${v('fp-min').replace(/\s/g, '')}`);
    ui.search = parts.join(' ');
    ui.filterOpen = false;
    render();
  }
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
  } else if (act === 'sh-jump-today') {
    const todayRow = document.getElementById('gs-today-row');
    if (todayRow) {
      todayRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      todayRow.classList.add('flash-row');
      setTimeout(() => todayRow.classList.remove('flash-row'), 1500);
    } else {
      goToMonth(monthKey(todayISO()));
      setTimeout(() => {
        const row = document.getElementById('gs-today-row');
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row?.classList.add('flash-row');
        setTimeout(() => row?.classList.remove('flash-row'), 1500);
      }, 60);
    }
  }
  else if (act === 'sel-all') onSelectAll(el);
  else if (act === 'bulk-clear') { ui.selected.clear(); refreshSelection(); }
  else if (act === 'bulk-del') bulkDelete();
  else if (act === 'undo') undoRedo(-1);
  else if (act === 'redo') undoRedo(1);
  else if (act === 'row-add') addDraftRow();
  else if (act === 'day') openDaySheet(el.dataset.date);
  else if (act === 'day-add') openTxSheet(null, { date: el.dataset.date });
  else if (act === 'copy-table') copyTable();
  else if (act === 'tg-load') Telegram.loadNow();
  else if (act === 'tg-fix') Telegram.openFix();
  else if (act === 'export-month') exportMonthExcel();
  else if (act === 'export-xlsx') exportExcel();
  else if (act === 'export-json') exportJSON();
  else if (act === 'export-csv') exportCSV();
  else if (act === 'money-export') MoneyIO.exportAll();
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
  } else if (act === 'danger-unlock' || el.id === 'danger-unlock-cb') {
    const cb = document.getElementById('danger-unlock-cb');
    const btn = document.getElementById('btn-danger-wipe');
    if (cb && btn) {
      const unlocked = !!cb.checked;
      btn.disabled = !unlocked;
      btn.classList.toggle('disabled', !unlocked);
      btn.innerHTML = unlocked ? '⚠️ Erase everything on this device' : '🔒 Erase everything on this device';
      btn.title = unlocked ? 'Open confirmation dialog' : 'Check the confirmation box above to unlock';
    }
  } else if (act === 'wipe') {
    const cb = document.getElementById('danger-unlock-cb');
    if (cb && !cb.checked) {
      toast('Check the confirmation box first to unlock data erase');
      cb.focus();
      return;
    }
    openWipeSheet();
  }
});

document.addEventListener('change', (e) => {
  if (e.target.closest('.sheet')) return;
  if (SCREENS[ui.tab]?.onChange?.(e.target)) return;
  if (e.target.dataset.bulk) onBulkChange(e.target);
  else if (e.target.dataset.sh) onSheetChange(e.target);
  else if (e.target.classList.contains('sel')) return;
  else if (e.target.closest('#tx-table')) onCellChange(e.target);
  else if (e.target.id === 'danger-unlock-cb' || e.target.dataset.act === 'danger-unlock') {
    const btn = document.getElementById('btn-danger-wipe');
    if (btn) {
      const unlocked = !!e.target.checked;
      btn.disabled = !unlocked;
      btn.classList.toggle('disabled', !unlocked);
      btn.innerHTML = unlocked ? '⚠️ Erase everything on this device' : '🔒 Erase everything on this device';
      btn.title = unlocked ? 'Open confirmation dialog' : 'Check the confirmation box above to unlock';
    }
  }
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

function updateSheetFormula(input) {
  if (!input || !input.matches || !input.matches('#sheet-grid input[data-sh]')) return;
  const [date, side, , field] = (input.dataset.sh || '').split('|');
  const tr = input.closest('tr');
  const rowNum = tr?.querySelector('.gs-rn')?.textContent || '';
  const colLetter = side === 'in' ? (field === 'amount' ? 'B' : 'C') : (field === 'amount' ? 'D' : 'E');
  const coordEl = document.getElementById('gs-cell-addr');
  const textEl = document.getElementById('gs-formula-text');
  if (coordEl && rowNum) coordEl.textContent = `${colLetter}${rowNum}`;
  if (textEl) {
    const sideName = side === 'in' ? 'Income' : 'Expense';
    const fieldName = field === 'amount' ? 'Amount' : 'Note';
    const val = input.value.trim() || '(empty)';
    textEl.textContent = `${date} · ${sideName} ${fieldName}: ${val}`;
  }
}

document.addEventListener('focusin', (e) => updateSheetFormula(e.target));

document.addEventListener('input', (e) => {
  if (e.target.matches && e.target.matches('#sheet-grid input[data-sh]')) updateSheetFormula(e.target);
  if (e.target.dataset.act === 'amb-vol') {
    AmbientMusic.setVolume(e.target.value);
    return;
  }
  if (e.target.dataset.set === 'wallpaperOpacity') {
    state.settings.wallpaperOpacity = Number(e.target.value);
    applyWallpaper();
    const lbl = e.target.closest('label')?.querySelector('span');
    if (lbl) lbl.textContent = `Wallpaper Opacity (${Math.round(state.settings.wallpaperOpacity * 100)}%)`;
    persist();
    return;
  }
  if (e.target.dataset.set === 'customWallpaper') {
    state.settings.customWallpaper = e.target.value.trim();
    applyWallpaper();
    persist();
    return;
  }
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

Money3.install();

// Desktop shortcuts: N = new record, / = search, 1-9 and 0 = sections, Esc = close.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isPaletteOpen()) { e.preventDefault(); closePalette(); return; }
  // Space shows or hides every amount (never while typing in a box; see privacy.js).
  if (!Security.isLocked() && Privacy.onKey(e)) return;
  if (Cats.onKey(e) || ReportsScreen.onKey?.(e)) return;
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    if (isPaletteOpen()) closePalette();
    else openPalette({
      state,
      go: (tab) => { location.hash = `#${tab}`; },
      openNew: (draft = {}) => openTxSheet(draft),
      openCalc: () => Calc.toggle(),
      lock: () => { if (Security.hasLock()) Security.lock(); },
      exportExcel: () => exportExcel(),
      backupJSON: () => exportJSON(),
    });
    return;
  }
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
    // Typing in a box (a note, the search, a cell being edited): Ctrl+Z undoes the text, never a record.
    const f = e.target.closest?.('input, textarea, [contenteditable=""], [contenteditable="true"]');
    if (f && !/^(checkbox|radio|button|range)$/.test(f.type || '') && !f.readOnly) return;
    e.preventDefault();
    undoRedo(z === 'y' || e.shiftKey ? 1 : -1);
    return;
  }
  // "=" opens the calculator, also over an open sheet.
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest('input, select, textarea') && Calc.onKey(e)) return;
  if (e.ctrlKey || e.metaKey || e.altKey || sheetRoot.firstChild) return;
  if (e.target.closest('input, select, textarea')) return;
  if (Shortcuts.onKey(e, { go: (tab) => { location.hash = `#${tab}`; } })) return;
  if ((e.key === 'l' || e.key === 'L') && Security.hasLock()) { Security.lock(); return; }
  if (e.key === 'h' || e.key === 'H') { e.preventDefault(); Privacy.toggle(); return; }
  if (ui.tab === 'log' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); goToMonth(addMonths(ui.month, e.key === 'ArrowLeft' ? -1 : 1)); return; }
  const tabs = { 1: 'home', 2: 'log', 3: 'accounts', 4: 'goals', 5: 'plan', 6: 'people', 7: 'reports', 8: 'telegram', 0: 'settings' };
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openTxSheet(); }
  else if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    const id = ui.selected.size === 1 ? [...ui.selected][0] : document.activeElement?.closest?.('[data-id]')?.dataset.id;
    const t = id && state.tx.find((x) => x.id === id);
    if (t) openTxSheet(t); else toast('Tick one record in the Table first, then press E');
  }
  else if (e.key === '/') {
    e.preventDefault();
    if (ui.tab !== 'log') location.hash = '#log';
    setTimeout(() => document.getElementById('search')?.focus(), 0);
  } else if (tabs[e.key]) location.hash = `#${tabs[e.key]}`;
});

// ---------- Screens ----------

// Rates live under Accounts, Clients under People, Year in review under
// Reports: one sidebar item each, with tabs on the screen.
const SUB_TABS = [
  [{ tab: 'accounts', label: 'Cards & accounts' }, { tab: 'rates', label: 'Rates & converter' }],
  [{ tab: 'people', label: 'People & loans' }, { tab: 'clients', label: 'Clients & invoices' }],
  [{ tab: 'reports', label: 'Reports' }, { tab: 'review', label: 'Year in review' }, { tab: 'longview', label: 'Long view' }, { tab: 'taxes', label: 'Taxes' }, { tab: 'tags', label: 'Tags' }],
  [{ tab: 'plan', label: 'Plan' }, { tab: 'calendar', label: 'Calendar' }, { tab: 'wishlist', label: 'Wishlist' }],
];
const NAV_PARENT = { rates: 'accounts', clients: 'people', review: 'reports', longview: 'reports', taxes: 'reports', tags: 'reports', calendar: 'plan', wishlist: 'plan' };

const SCREENS = {
  home: { view: viewHome, onClick: (a, el) => Plan.onClick(a, el) || Afford.onClick(a) },
  log: { view: viewLog },
  accounts: AccountsScreen,
  goals: Goals,
  plan: Plan,
  clients: Clients,
  people: PeopleScreen,
  reports: ReportsScreen,
  review: YearReview,
  longview: LongView,
  taxes: Taxes,
  tags: TagsReport,
  calendar: MoneyCalendar,
  wishlist: Wishlist,
  changes: ChangesScreen,
  reality: RealityScreen,
  rates: RatesScreen,
  telegram: TelegramHub,
  bot: TelegramHub,
  settings: { view: viewSettings, onClick: (a, el) => IncomeSources.onClick(a, el) || Security.onClick(a, el) || Cats.onClick(a, el) || Rules.onClick(a, el) || Telegram.onClick(a) || TgBlocks.onClick(a, el) || Buddy.onClick(a, el) || Binance.onClick(a) || Sync.onClick(a) || SelfCheck.onClick(a) || Backups.onClick(a, el) || (a.startsWith('update-') && (Updates.onClick(a), true)), onChange: (el) => Security.onChange(el) || Cats.onChange(el) || Telegram.onChange(el) || Buddy.onChange(el) || WorkHour.onChange(el) },
};

function openMoreSheet() {
  const item = (tab, label, sub) => `<a href="#${tab}" class="tx more-item"><span class="t"><b>${label}</b><span>${sub}</span></span><span class="muted">›</span></a>`;
  openSheet(`<h3>More <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <div class="list more-list">
      ${item('goals', 'Goals', 'What you are saving for, filling up by itself')}
      ${item('plan', 'Plan', 'Budgets, bills, subscriptions, regular income')}
      ${item('people', 'People & loans', 'Track who owes you, debts, IOUs & client invoices')}
      ${item('telegram', 'Telegram bot', 'Phone sync, custom keyboard buttons & bot commands')}
      ${item('reports', 'Reports', 'Any period, year in review, income for taxes')}
      ${item('rates', 'Rates & converter', 'Exchange rates, good day to convert USD?')}
      ${item('changes', 'Change history', 'Every change on this device, with Put back')}
      ${item('settings', 'Settings', 'Goal, smart split, categories, backups')}
      <button type="button" class="tx more-item" data-act="shortcuts-help" data-testid="more-shortcuts"><span class="t"><b>Keyboard shortcuts</b><span>N, /, E, Ctrl+Z, G then a letter</span></span><span class="muted">›</span></button>
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
  persistSync: () => { persist(); Sync.changed(); },
  openNeedsSub: (list) => Cats.openNeedsSub(list),
  drillReports: (cat, sub) => {
    ReportsScreen.drillTo(cat, sub);
    if (location.hash === '#reports') render();
    else location.hash = '#reports';
  },
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
  ratesLine: (c) => ratesLine(c),
  buddy: (msg) => Buddy.say(msg),
  openSplit: (tx) => openSplitSheet(tx),
  backupNow: () => Backups.autoBackup({ force: true }),
  // Archive / Unarchive (js/archive.js): a bulk move that is not an edit, so no change-history entries and no undo step.
  archiveApply: (fn) => {
    if (state._sealed) return 0;
    const n = fn(state);
    if (n) { Changes.reset(state); history.reset(state); if (!saveSoon(state)) toast(SAVE_FAILED); render(); Sync.changed(); }
    return n;
  },
  undo: () => undoRedo(-1),
  undoRedo,
  holdHistory: () => { holdDepth++; },
  releaseHistory: () => { if (holdDepth && --holdDepth === 0) persist(); },
  finishRevert,
  topGrp: (dir) => history.topGrp(dir),
  canSession: (dir) => (dir < 0 ? history.canUndo() : history.canRedo()),
  clearSession: () => { history.clear(); history.reset(state); },
  openTableForTx: (tx) => {
    state.settings.logView = 'table';
    if (tx?.date) ui.month = tx.date.slice(0, 7);
    if (tx?.id) ui.flashId = tx.id;
    ui.search = '';
    ui.filter = 'all';
    location.hash = '#log';
    render();
  },
  openTableForPerson: (p) => {
    state.settings.logView = 'table';
    ui.search = p?.name || '';
    ui.filter = 'all';
    location.hash = '#log';
    render();
  },
  // Sync brings in a merged copy of the data.
  replaceState: (next) => { state = next; persist({ quiet: true }); },
  // Swap the data in memory without saving (lock / unlock with encryption).
  // Undo steps hold readable data, so they go too.
  setState: (next) => { state = next; history.clear(); history.reset(next); Changes.reset(next); },
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

// Life System's Money page asks to reconcile an account ("Reconcile: due"):
// it leaves { screen: 'reconcile', account } under this key, read once.
const GOTO_KEY = 'finance-helper.goto';
function takeGoto() {
  let g = null;
  try { g = JSON.parse(localStorage.getItem(GOTO_KEY) || 'null'); localStorage.removeItem(GOTO_KEY); } catch { return; }
  if (!g || state._sealed || Date.now() - (Number(g.at) || 0) > 10 * 60e3) return;
  if (g.screen === 'reconcile') {
    // Opening a screen closes any sheet, so the sheet opens once Accounts is shown.
    const openIt = () => { if (g.account && M.account(state, g.account)) Reconcile.open(g.account); };
    if (location.hash !== '#accounts') {
      window.addEventListener('hashchange', () => setTimeout(openIt, 60), { once: true });
      location.hash = '#accounts';
    } else openIt();
  } else if (g.screen === 'longview') location.hash = '#longview';
  // Life's Money menu item: always open on Home (the total balance), not where you left off.
  else if (g.screen === 'home') location.hash = '#home';
}
window.addEventListener('storage', (e) => { if (e.key === GOTO_KEY && e.newValue) takeGoto(); });
setTimeout(takeGoto, 300);

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
    // A change made here is still waiting to be written: merge the stored copy
    // into it (newest copy of each record wins, deletions stick), then write.
    // Neither side's change is lost.
    if (hasPendingSave()) {
      try {
        const stored = load();
        if (!stored._sealed) state = mergeLocal(state, stored);
        Changes.track(state, 'sync'); history.reset(state); // arrived from elsewhere: logged, never part of an undo step
      } catch { /* keep this device's copy; the next sync merges */ }
      saveSoon(state);
      flushSave();
      render();
      return;
    }
    state = load();
    Changes.track(state, 'sync'); history.reset(state); // arrived from elsewhere: logged, never part of an undo step
    render();
  }
  if (e.key === STORAGE_KEYS.ENC && hasSession()) {
    // Locked data changed elsewhere (Life System's sync merged another device's
    // copy): a change waiting here is merged into it, never thrown away.
    const waiting = hasPendingSave();
    reopen().then((next) => {
      if (!next) return;
      state = waiting ? mergeLocal(state, next) : next;
      Changes.track(state, 'sync'); history.reset(state); // arrived from elsewhere: logged, never part of an undo step
      if (waiting) { saveSoon(state); flushSave(); }
      render();
    }).catch(() => {});
  }
});

window.addEventListener('fh-save-failed', () => toast('Could not save on this device. Make a backup now and run "Check everything".'));

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

// Money privacy: amounts start hidden; Space, the eye or H show them; they hide again
// when the window is hidden or after a while with no input (screens/security.js settings).
document.body.classList.toggle('money-hidden', Privacy.isHidden());
Privacy.start();
document.addEventListener('keyup', Privacy.onKeyUp);
Privacy.subscribe((hidden) => {
  document.body.classList.toggle('money-hidden', hidden);
  if (!state._sealed && !Security.isLocked()) { render(); renderSidebar(); }
  toast(hidden ? 'Amounts hidden' : 'Amounts shown');
});

Spending.bindHover(app);
bindSankeyHover(app);
bindTilt(document);
requestPersistence();
if (!DEMO) Security.initLock();
MoneyB.init();
ChangesScreen.init();
RealityScreen.init();
Recent.init();
SavedBar.init();
GridEdit.init();
BudgetWarn.init();
route();
Updates.initUpdates();
Standalone.init();
CloseMonth.init();
Wrapped.init();
Binance.initBinance();
Sync.initSync();
Backups.initBackups();
Plan.initPlan();
Telegram.initTelegram();
Motion.initMotion();
Flow.initFlow();
Tips.init({ rerender: () => render() });
ArchiveCard.init();
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
