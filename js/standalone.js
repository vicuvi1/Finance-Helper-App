// The standalone app's own pieces, kept out of the files copied from Life
// System (scripts/sync-from-mega.mjs) so a new copy never loses them. Wired
// into js/app.js by four small hooks (scripts/standalone-patches.mjs):
//  - Settings → Data & backups: "Cloud sync" (sign in with the server PIN,
//    status, Sync now) and "Import from Life System";
//  - the update badge next to the app's name (desktop: update available /
//    downloading / restart; web: reload to update);
//  - notifications (budget warnings, salary watch, check-up) on this device;
//  - on the web, a sign-in sheet the first time (to load Money from the server).

import { ctx, esc } from './ctx.js';
import { createCloud, DEFAULT_URL, syncSummary } from './cloud.js';
import { readLifeFile, incomingState, previewImport, mergeImport } from './lifeimport.js';
import { runNotices } from './notifier.js';
import { openImported, deviceStorage, flushSave } from './store.js';
import { todayISO } from './dates.js';
import { isMoneyHidden } from './money.js';
import { updateStatus, onUpdateChange, watchServiceWorker, webUpdateWaiting } from './screens/updates.js';
import { APP_VERSION } from './version.js';
import { notesSince, shouldShow, NOTES } from './whatsnew.js';

const isDesktop = () => typeof window !== 'undefined' && !!window.desktop?.isDesktop;
const isWeb = () => !isDesktop() && typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
/** Where the server is: the desktop's chosen address, or (web) this site itself. */
const baseUrl = () => (isDesktop() ? cloud?.config.url || DEFAULT_URL : cloud?.config.url || location.origin);

function transport(path, body, token) {
  if (isDesktop()) return window.desktop.cloud.request(baseUrl(), path, body, token);
  const base = baseUrl();
  const url = base === location.origin ? path : `${base}${path}`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
}

let cloud = null;
let timer = null;
let started = false;
// Web: is there a Money server on this site? (GitHub Pages or a plain file server has none: no card, no sign-in.)
let serverHere = null;
async function probeServer() {
  if (isDesktop()) return true;
  try {
    const r = await transport('/api/money', { op: 'read' }, '');
    serverHere = r.status === 401 || r.status === 200 || r.status === 503;
  } catch { serverHere = false; }
  refreshCard();
  return serverHere;
}

function soon(ms = 3000) {
  clearTimeout(timer);
  timer = setTimeout(() => cloud?.sync().then(after), ms);
}
function after(r) {
  // A good sync means the server holds a copy (and backs it up nightly): Home's "Make a backup" step stays away.
  if (r?.ok && ctx.state?.meta && !ctx.state._sealed) ctx.state.meta.lastSync = Date.now();
  if (r?.again) soon(1500);
  else if (r && !r.ok && cloud.config.signedIn && cloud.config.dirty) soon(60_000);
  refreshCard();
}

const ago = (ms) => {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
};

/** The Cloud sync card (Settings → Data & backups). */
export function cloudCard() {
  if (!cloud || ctx.DEMO) return '';
  if (!isDesktop() && !serverHere && !cloud.config.signedIn) return '<section class="card" id="cloud-card" hidden></section>';
  const st = cloud.status;
  const cfg = cloud.config;
  const line = !cfg.signedIn
    ? 'Not signed in. Sign in with your server PIN to keep the web and desktop apps in step.'
    : st.busy ? 'Syncing…'
      : st.state === 'error' ? esc(st.error)
        : st.state === 'skipped' ? esc(st.note)
          : cfg.dirty ? 'Your latest changes are waiting to be sent.'
            : `Synced ${ago(cfg.okAt)}. The server has everything this device has.`;
  const tone = !cfg.signedIn ? '' : st.state === 'error' ? 'danger' : cfg.dirty || st.busy ? 'accent' : 'success';
  return `<section class="card" id="cloud-card" data-testid="cloud-card"><h2>Cloud sync</h2>
    <div class="set-status-box ${tone}"><div class="set-sb-icon">${cfg.signedIn ? (st.state === 'error' ? '⚠️' : '☁️') : '🔑'}</div>
      <div class="set-sb-content"><b>${cfg.signedIn ? 'Signed in' : 'Signed out'}</b><p class="muted small" style="margin:2px 0 0" data-testid="cloud-status">${line}</p>${st.note && st.state === 'ok' ? `<p class="muted small" style="margin:4px 0 0">${esc(st.note)}</p>` : ''}</div></div>
    ${isDesktop() ? `<label class="field" style="margin-top:12px"><span>Server address</span><input id="cloud-url" type="url" value="${esc(baseUrl())}" placeholder="${DEFAULT_URL}" data-testid="cloud-url"></label>` : ''}
    ${cfg.signedIn
      ? `<div class="btns" style="margin-top:12px"><button class="btn primary" data-act="cloud-sync" data-testid="cloud-sync">Sync now</button><button class="btn" data-act="cloud-signout">Sign out</button></div>`
      : `<div class="btns" style="margin-top:12px"><button class="btn primary" data-act="cloud-signin" data-testid="cloud-signin">Sign in</button></div>`}
    <p class="muted small" style="margin-bottom:0">Each record's newest edit wins and nothing is deleted by syncing. Your data stays on this device too and works offline.</p>
  </section>`;
}

/** The Import from Life System card. */
export function importCard() {
  if (ctx.DEMO) return '';
  return `<section class="card" id="life-import-card"><h2>Import from Life System</h2>
    <p class="muted small" style="margin-top:0">Bring your Money data over from Life System in one step. In Life System open <b>Data center → Money → Download</b> (or use a full backup), then pick that file here. You see what changes first; a backup is made before anything is merged, and nothing here is deleted.</p>
    <button class="btn block" data-act="life-import" data-testid="life-import">Import from Life System…</button>
    <input type="file" id="life-import-file" accept=".json,application/json" hidden data-testid="life-import-file">
  </section>`;
}

// ---------- What's new (js/whatsnew.js) ----------

export function openWhatsNew(from = null) {
  const list = from ? notesSince(from, APP_VERSION) : NOTES.filter((n) => !n.v || n.v <= APP_VERSION).slice(0, 8);
  if (!list.length) return;
  ctx.openSheet(`<h3>What's new ${from ? `in ${esc(APP_VERSION)}` : ''} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <div class="whatsnew" data-testid="whats-new">${list.map((n) => `<section><b>Version ${esc(n.v)}</b><ul>${n.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></section>`).join('')}</div>
    <div class="btns"><button type="button" class="btn primary" data-close>Got it</button></div>`);
}

export const dataCards = () => cloudCard() + serverBackupsCard() + importCard();

// ---------- Server backups (api/_backups.mjs): every night, kept 30 days ----------

let bk = null; // {list} | {error}
let bkBusy = '';
async function loadBackups() {
  if (!cloud?.config.signedIn) return;
  try { bk = { list: (await cloud.api('/api/money', { op: 'backups' })).backups || [] }; }
  catch (e) { bk = { error: e.message }; }
  paintBackups();
}
function paintBackups() { const el = document.getElementById('srv-backups'); if (el) el.outerHTML = serverBackupsCard(); }
/** The newest server backup's time (for Data & health), or 0. */
export const lastServerBackup = () => bk?.list?.[0]?.at || 0;
export function serverBackupsCard() {
  if (!cloud || ctx.DEMO) return '';
  const signed = cloud.config.signedIn;
  if (signed && !bk && !bkBusy) setTimeout(loadBackups, 0);
  const label = (b) => {
    const d = new Date(b.at);
    const when = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return `${when}${b.kind === 'before-restore' ? ' · before a restore' : b.kind === 'manual' ? ' · made by you' : ''}`;
  };
  const rows = (bk?.list || []).map((b) => `<div class="kv"><span>${esc(label(b))} <small class="muted">· ${b.records.toLocaleString()} records</small></span><b><button type="button" class="btn sm" data-act="srv-restore" data-id="${esc(b.id)}" data-testid="srv-restore">Restore</button></b></div>`).join('');
  return `<section class="card" id="srv-backups" data-testid="srv-backups"><h2>Server backups</h2>
    <p class="muted small" style="margin-top:0">${signed ? 'Your server saves a full copy of your Money every night (around 9:00) and keeps the last 30 days. Restoring one puts it back on every device; how things were just before is saved first, so a restore can be undone.' : 'Sign in to Cloud sync (above) to see your server backups.'}</p>
    ${bk?.error ? `<p class="small" style="color:var(--expense)">${esc(bk.error)}</p>` : ''}
    ${signed ? `<div class="set-kv-list">${rows || '<div class="kv"><span class="muted">No backup yet. The first one is made tonight, or press Back up now.</span></div>'}</div>
    <div class="btns" style="margin-top:12px"><button type="button" class="btn" data-act="srv-backup-now" data-testid="srv-backup-now"${bkBusy ? ' disabled' : ''}>${bkBusy === 'now' ? 'Saving…' : 'Back up now'}</button></div>` : ''}
  </section>`;
}
function confirmRestore(id) {
  const b = (bk?.list || []).find((x) => x.id === id);
  if (!b) return;
  ctx.openSheet(`<h3>Restore this backup? <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p style="margin-top:0">Your Money goes back to <b>${esc(new Date(b.at).toLocaleString())}</b> (${b.records.toLocaleString()} records) on every device.</p>
    <p class="muted small">Anything added after that is replaced. How things are right now is saved first as a backup, so you can restore that one to undo this.</p>
    <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn danger" id="srv-restore-go" data-testid="srv-restore-go">Restore</button></div>`, (sheet) => {
    sheet.querySelector('#srv-restore-go').addEventListener('click', async () => {
      sheet.querySelector('#srv-restore-go').disabled = true;
      try {
        const r = await cloud.api('/api/money', { op: 'restore', id });
        ctx.closeSheet();
        ctx.toast(`Restored: ${r.records.toLocaleString()} records. Syncing…`);
        const s = await cloud.sync({ check: true });
        after(s);
        bk = null; loadBackups();
      } catch (e) { ctx.closeSheet(); ctx.toast(e.message); }
    });
  });
}

// ---------- Always-on Telegram bot on your server (api/telegram.mjs) ----------

const BOT_MSGS = [
  ['morning', 'Morning (about 9:00)', 'Safe to spend today and what is due in the next 2 days.'],
  ['evening', 'Evening (about 21:00)', 'Only if you logged nothing that day: a reminder to add it.'],
  ['weekly', 'Sunday morning', 'Your week: spent, kept, the biggest leak.'],
  ['monthly', 'On the 1st', 'Last month\'s recap.'],
];
const botMsgsOn = () => ({ morning: true, evening: true, weekly: true, monthly: true, ...(ctx.state.settings.botMsgs || {}) });
function botMsgsHTML() {
  const on = botMsgsOn();
  return `<div class="bot-msgs" data-testid="bot-msgs"><b class="small">Messages the bot sends you</b>
    ${BOT_MSGS.map(([k, t, d]) => `<label class="motion-setting"><span><b>${t}</b><small>${d}</small></span><input type="checkbox" data-bot-msg="${k}" ${on[k] ? 'checked' : ''} aria-label="${t}"></label>`).join('')}</div>`;
}

let botSt = null; // last status from the server
let botBusy = false;
async function loadBotStatus(op = 'status') {
  if (!cloud?.config.signedIn) return;
  botBusy = true; paintBotCard();
  try { botSt = await cloud.api('/api/telegram', { op }); botSt.error = ''; }
  catch (e) { botSt = { ...(botSt || {}), error: e.message }; }
  botBusy = false; paintBotCard();
  return botSt;
}
function paintBotCard() {
  const el = document.getElementById('srv-bot-card');
  if (el) el.outerHTML = botCard();
}
/** Settings → Telegram & Binance: the always-on bot that runs on your own server. */
export function botCard() {
  if (!cloud || ctx.DEMO) return '';
  const st = botSt;
  const signed = cloud.config.signedIn;
  let line;
  let btn = '';
  if (!signed) line = 'Sign in to Cloud sync first (the line under the app\'s name), then turn it on here.';
  else if (botBusy && !st) line = 'Checking…';
  else if (st?.error) { line = esc(st.error); btn = '<button class="btn" data-act="srv-bot-check">Check again</button>'; }
  else if (st && st.configured === false) line = esc(st.why);
  else if (st?.on) {
    line = `On: <b>@${esc(st.bot)}</b> answers day and night, even with your computer off. What you send goes straight into your Money and shows here within a minute.${st.lastError ? ` <br><span style="color:var(--expense)">Last problem: ${esc(st.lastError)}</span>` : ''}`;
    btn = '<button class="btn" data-act="srv-bot-off">Turn off</button>';
  } else if (st) {
    line = `Off. <b>@${esc(st.bot)}</b> is ready on your server.${st.elsewhere ? ' Telegram now sends its messages somewhere else (an old address): turning it on here takes them back.' : ''}`;
    btn = '<button class="btn primary" data-act="srv-bot-on" data-testid="srv-bot-on">Turn on</button>';
  } else line = 'Checking…';
  if (signed && !st && !botBusy) setTimeout(() => loadBotStatus(), 0);
  return `<section class="card" id="srv-bot-card" data-testid="srv-bot-card"><h2>Always-on bot (your server)</h2>
    <p class="muted small" style="margin-top:0">${line}</p>
    <p class="muted small">Type <code>coffee 35</code>, <code>+500 salary</code>, <code>yesterday 120 lunch</code>. Each reply has an Undo button. /today /month /balance /last /undo</p>
    ${st?.on ? botMsgsHTML() : ''}
    ${btn ? `<div class="btns">${btn}</div>` : ''}
  </section>`;
}


function refreshCard() {
  const el = document.getElementById('cloud-card');
  if (el) el.outerHTML = cloudCard();
  paintStatus();
}

/** Records that came from the other device show at once, but never while you are typing or in a sheet. */
let renderWaiting = false;
function renderWhenFree() {
  const a = document.activeElement;
  const typing = a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes(a.type)) || a.isContentEditable);
  if (!typing && !document.querySelector('.sheet')) { renderWaiting = false; ctx.render(); return; }
  if (renderWaiting) return;
  renderWaiting = true;
  const again = () => setTimeout(() => { renderWaiting = false; renderWhenFree(); }, 300);
  document.addEventListener('focusout', again, { once: true });
}

// ---------- Sync status under the app's name (instead of "Private & Offline") ----------

const STYLE = `
.brand-sub.fh-sync{cursor:default;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;background:none;border:0;padding:0;font:inherit;font-size:10.5px;font-weight:600;color:var(--faint);text-align:left}
.brand-sub.fh-sync[data-act]{cursor:pointer}
.brand-sub.fh-sync[data-act]:hover{color:var(--text)}
.brand-sub.fh-sync.warn{color:var(--gold)}
.brand-sub.fh-sync.bad{color:var(--expense)}
.brand-sub.fh-sync .brand-dot{transition:background .3s}
.brand-sub.fh-sync.busy .brand-dot{background:var(--gold);box-shadow:0 0 6px var(--gold);animation:fhPulse 1s ease-in-out infinite}
.brand-sub.fh-sync.warn .brand-dot{background:var(--gold);box-shadow:none}
.brand-sub.fh-sync.bad .brand-dot{background:var(--expense);box-shadow:none}
.brand-sub.fh-sync.off .brand-dot{background:var(--faint);box-shadow:none}
@keyframes fhPulse{50%{opacity:.35}}
.whatsnew section{margin:0 0 12px}.whatsnew ul{margin:6px 0 0;padding-left:20px;color:var(--muted)}.whatsnew li{margin:3px 0}
.fh-ver{display:block;font-size:10px;font-weight:600;color:var(--faint);cursor:pointer;line-height:1.3;width:max-content}
.fh-ver:hover{color:var(--gold)}
#update-badge.fh-update{display:none}
@media (min-width:720px){#update-badge.fh-update{display:block;width:100%;margin:0 0 12px;padding:7px 10px;font-size:12.5px;white-space:nowrap;text-align:center}}
`;
function injectStyle() {
  if (document.getElementById('fh-standalone-style')) return;
  const st = document.createElement('style');
  st.id = 'fh-standalone-style';
  st.textContent = STYLE;
  document.head.appendChild(st);
}

/** The app's version, its own small line under the name (a click opens About & updates). */
function paintVersion() {
  const meta = document.querySelector('.tabbar .brand-meta');
  if (!meta || meta.querySelector('.fh-ver')) return;
  const v = document.createElement('span');
  v.className = 'fh-ver';
  v.dataset.testid = 'app-version';
  v.textContent = `Version ${APP_VERSION}`;
  v.title = 'Data & health';
  meta.appendChild(v);
}

function paintStatus() {
  if (typeof document === 'undefined') return;
  const el = document.querySelector('.tabbar .brand-sub');
  if (el && (!cloud || ctx.DEMO)) { el.innerHTML = '<i class="brand-dot"></i>Example data'; paintVersion(); return; }
  if (!el) return;
  const st = cloud.status;
  const cfg = cloud.config;
  const s = syncSummary({
    server: isDesktop() || serverHere !== false || cfg.signedIn,
    signedIn: cfg.signedIn,
    busy: st.busy,
    state: st.state,
    dirty: cfg.dirty,
    okAt: cfg.okAt,
    online: typeof navigator === 'undefined' || navigator.onLine !== false,
  });
  el.className = `brand-sub fh-sync ${s.tone}`;
  el.innerHTML = `<i class="brand-dot"></i>${esc(s.text)}`;
  paintVersion();
  el.title = s.act === 'cloud-signin' ? 'Sign in so this device and your other one share the same Money' : s.act === 'cloud-sync' ? 'Sync now' : s.text;
  el.dataset.testid = 'sync-status';
  if (s.act) { el.dataset.act = s.act; el.setAttribute('role', 'button'); el.tabIndex = 0; }
  else { delete el.dataset.act; el.removeAttribute('role'); el.removeAttribute('tabindex'); }
}
export const _probe = probeServer;

// ---------- Sign in ----------

export function openSignIn({ first = false, keep = false } = {}) {
  ctx.openSheet(`<h3>${first ? 'Sign in to load your Money' : keep ? 'Keep this device in step' : 'Sign in to Cloud sync'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p class="muted" style="margin-top:0">${keep ? 'This device is not syncing, so the web and desktop apps can show different numbers. Sign in with your server PIN: the records here and on the server are merged (the newest edit of each wins, nothing is deleted).' : 'Your server PIN (the one Life System used). It is checked by the server and never stored here.'}</p>
    <form id="cloud-form">
      <label class="field"><span id="cloud-pin-label">PIN</span><input id="cloud-pin" type="password" inputmode="numeric" autocomplete="current-password" required minlength="4" maxlength="12" data-testid="cloud-pin"></label>
      <details id="cloud-forgot" style="margin:8px 0" data-testid="cloud-forgot"><summary class="muted small">Forgot your PIN? (or first time on this server)</summary>
        <p class="muted small" style="margin:6px 0">Paste the server's setup key and type a <b>new</b> PIN above (4 to 8 digits). The key is <b>CRON_SECRET</b> in Vercel → your project → Settings → Environment Variables. Every other device is signed out and signs in again with the new PIN.</p>
        <label class="field"><span>Server setup key</span><input id="cloud-setup" type="password" autocomplete="off" data-testid="cloud-setup"></label></details>
      <p class="muted small" id="cloud-err" role="alert" style="color:var(--danger, #e66)"></p>
      <div class="btns">${first || keep ? '<button type="button" class="btn" data-close>Not now</button>' : '<button type="button" class="btn" data-close>Cancel</button>'}<button class="btn primary" data-testid="cloud-pin-go">Sign in</button></div>
    </form>`, (sheet) => {
    const form = sheet.querySelector('#cloud-form');
    sheet.querySelector('#cloud-pin').focus();
    sheet.querySelector('#cloud-forgot').addEventListener('toggle', (e) => {
      sheet.querySelector('#cloud-pin-label').textContent = e.target.open ? 'New PIN' : 'PIN';
      sheet.querySelector('[data-testid="cloud-pin-go"]').textContent = e.target.open ? 'Set the new PIN and sign in' : 'Sign in';
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = sheet.querySelector('#cloud-err');
      err.textContent = 'Signing in…';
      try {
        const setupKey = sheet.querySelector('#cloud-forgot').open ? sheet.querySelector('#cloud-setup').value.trim() : '';
        await cloud.signIn(sheet.querySelector('#cloud-pin').value, { setupKey });
        ctx.closeSheet();
        ctx.toast(setupKey ? 'New PIN set. Use it on your other devices too. Syncing your Money…' : 'Signed in. Syncing your Money…');
        const r = await cloud.sync();
        after(r);
        ctx.toast(r.ok ? (r.got ? `Synced: ${r.got} records came from the server` : 'Synced') : r.error);
        ctx.render();
      } catch (e2) {
        err.textContent = e2.message;
      }
    });
  });
}

// ---------- Import from Life System ----------

async function backupFirst(label) {
  try { await ctx.backupNow?.(); } catch { /* desktop/Drive backup is a bonus */ }
  if (!isDesktop()) {
    try { ctx.download(`finance-helper-before-life-import-${todayISO()}.json`, JSON.stringify({ app: 'finance-helper', exportedAt: new Date().toISOString(), note: label, ...ctx.state }), 'application/json'); } catch { /* ignore */ }
  }
}

async function onImportFile(text) {
  let read;
  try { read = readLifeFile(text); } catch (e) { ctx.toast(e.message); return; }
  if (read.kind === 'sealed') {
    ctx.openSheet(`<h3>Money was locked with its PIN <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
      <p class="muted" style="margin-top:0">Enter the Money PIN you used in Life System. The file is opened here only.</p>
      <form id="li-pin-form"><label class="field"><span>Money PIN</span><input id="li-pin" type="password" inputmode="numeric" required></label>
      <p class="muted small" id="li-err" role="alert"></p>
      <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Open</button></div></form>`, (sheet) => {
      sheet.querySelector('#li-pin').focus();
      sheet.querySelector('#li-pin-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const plain = await openImported(read.box, sheet.querySelector('#li-pin').value);
          ctx.closeSheet();
          onImportFile(plain);
        } catch { sheet.querySelector('#li-err').textContent = 'Wrong PIN for this file.'; }
      });
    });
    return;
  }
  if (ctx.state._sealed) { ctx.toast('Unlock the app first.'); return; }
  const incoming = incomingState(read.state);
  const p = previewImport(ctx.state, incoming);
  const range = p.first ? ` from ${p.first} to ${p.last}` : '';
  ctx.openSheet(`<h3>Import from Life System <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p class="muted" style="margin-top:0">${esc(read.from)}: ${p.records} records${range}.</p>
    <div class="set-kv-list" data-testid="life-import-preview">
      <div class="kv"><span>New records to add</span><b>${p.add}</b></div>
      <div class="kv"><span>Records with a newer edit in the file</span><b>${p.update}</b></div>
      <div class="kv"><span>Already the same here</span><b>${p.same}</b></div>
      <div class="kv"><span>Only on this device (kept)</span><b>${p.keep}</b></div>
      ${p.other ? `<div class="kv"><span>New people, bills, invoices, goals</span><b>${p.other}</b></div>` : ''}
    </div>
    <p class="muted small">A backup of this device's data is made first${isDesktop() ? ' (Documents → Finance Helper → Backups)' : ' (downloaded as a file)'}. Nothing is deleted; Ctrl+Z undoes the import.</p>
    <div class="btns"><button class="btn" data-close>Cancel</button><button class="btn primary" id="li-go" data-testid="life-import-go">Back up and import</button></div>`, (sheet) => {
    sheet.querySelector('#li-go').addEventListener('click', async () => {
      sheet.querySelector('#li-go').disabled = true;
      await backupFirst('Before importing from Life System');
      const merged = mergeImport(ctx.state, incoming);
      // An undoable change like any other (one step), then the cloud gets it.
      Object.assign(ctx.state, merged);
      for (const k of Object.keys(ctx.state)) if (!(k in merged)) delete ctx.state[k];
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(`Imported from Life System: ${p.add} new, ${p.update} updated`);
    });
  });
}

// ---------- Update badge (next to the app's name) ----------

function paintBadge() {
  const brand = document.querySelector('.tabbar .brand');
  if (!brand) return;
  let b = document.getElementById('update-badge');
  const u = updateStatus();
  const web = webUpdateWaiting();
  const show = web || ['available', 'downloading', 'ready', 'error'].includes(u.status) && u.status !== 'error';
  if (!show) { b?.remove(); return; }
  if (!b) {
    b = document.createElement('button');
    b.type = 'button';
    b.id = 'update-badge';
    b.className = 'btn small primary fh-update';
    b.dataset.testid = 'update-badge';
    // Its own row under the name, so the name and the sync line keep their room.
    brand.insertAdjacentElement('afterend', b);
  }
  const label = web ? 'Reload to update' : u.status === 'ready' ? 'Restart to update' : u.status === 'downloading' ? `Downloading ${u.percent}%` : 'Update available';
  b.textContent = label;
  b.dataset.act = web ? 'update-reload' : u.status === 'ready' ? 'update-install' : u.status === 'available' ? 'update-download' : 'go-updates';
  b.title = label;
}

// ---------- Clicks ----------

export function onClick(act, el) {
  if (act === 'cloud-signin') { openSignIn(); return true; }
  if (act === 'cloud-signout') { cloud.signOut(); refreshCard(); ctx.toast('Signed out of Cloud sync. Your data stays on this device.'); return true; }
  if (act === 'cloud-sync') {
    cloud.sync({ check: true }).then((r) => { after(r); ctx.toast(r.ok ? (r.got ? `Synced: ${r.got} records came in` : 'Synced: the server has everything') : r.error || r.skipped); });
    refreshCard();
    return true;
  }
  if (act === 'life-import') { document.getElementById('life-import-file')?.click(); return true; }
  if (act === 'go-updates') { location.hash = '#settings'; return true; }
  if (act === 'whats-new') { openWhatsNew(); return true; }
  if (act === 'srv-bot-check') { loadBotStatus(); return true; }
  if (act === 'srv-restore') { confirmRestore(el?.dataset.id); return true; }
  if (act === 'srv-backup-now') {
    bkBusy = 'now'; paintBackups();
    cloud.api('/api/money', { op: 'backup-now' }).then(() => ctx.toast('Backup saved on your server'), (e) => ctx.toast(e.message)).finally(() => { bkBusy = ''; bk = null; loadBackups(); });
    return true;
  }
  if (act === 'srv-bot-on') {
    loadBotStatus('on').then((st) => {
      if (st?.on) {
        ctx.toast(`@${st.bot} is always on now. Send it "coffee 35" to try.`);
        // The desktop's own reader stands aside: Telegram can only send to one place.
        if (isDesktop() && window.desktop?.telegram) window.desktop.telegram.disconnect?.().catch(() => {});
      }
    });
    return true;
  }
  if (act === 'srv-bot-off') { loadBotStatus('off').then((st) => { if (st && !st.on) ctx.toast('Always-on bot is off.'); }); return true; }
  return false;
}

// ---------- Start ----------

function notifyNow() {
  if (ctx.DEMO || ctx.state._sealed) return;
  runNotices(ctx.state, todayISO(), { hidden: isMoneyHidden() }).catch(() => {});
}

export function init() {
  if (started || typeof document === 'undefined') return;
  started = true;
  // Where Money is kept on this device (IndexedDB behind a localStorage-like store): for tests and the console.
  try {
    const st = deviceStorage() || globalThis.localStorage;
    // A read writes a waiting save first (saves wait 400 ms to group a burst of changes).
    globalThis.__fhStore = { getItem: (k) => { flushSave(); return st.getItem(k); }, setItem: (k, v) => st.setItem(k, v), removeItem: (k) => st.removeItem(k), flush: () => st.flush?.() };
  } catch { /* no storage */ }
  cloud = createCloud({
    transport,
    store: globalThis.localStorage,
    app: {
      getState: () => ctx.state,
      setState: (next) => { ctx.replaceState(next); renderWhenFree(); },
      backup: (label) => backupFirst(label),
      locked: () => !!ctx.state._sealed,
    },
  });
  cloud.subscribe(() => refreshCard());
  // "Backup before a risky step" (js/dupes.js): the desktop's own backup folder.
  if (isDesktop()) globalThis.__fhBackupBefore = () => ctx.backupNow?.();
  // Every change you make (js/screens/sync.js changed() calls this): sent a few seconds later, many changes as one.
  let noteTimer = null;
  globalThis.__fhCloudChanged = () => {
    if (ctx.DEMO) return;
    cloud.changed();
    if (cloud.config.signedIn) soon();
    clearTimeout(noteTimer);
    noteTimer = setTimeout(notifyNow, 5000);
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('.fh-ver')) return;
    e.stopPropagation();
    ctx.ui.settingsTab = 'health';
    if (location.hash === '#settings') ctx.render(); else location.hash = '#settings';
  }, true);
  document.addEventListener('change', (e) => {
    const k = e.target?.dataset?.botMsg;
    if (k) {
      const s = ctx.state.settings;
      s.botMsgs = { ...botMsgsOn(), [k]: e.target.checked };
      s.updatedAt = Date.now();
      ctx.commit();
      const name = BOT_MSGS.find((m) => m[0] === k)?.[1] || 'Message';
      ctx.toast(`${name}: ${e.target.checked ? 'on' : 'off'}`, 'Undo', () => ctx.undo());
      return;
    }
    if (e.target?.id === 'cloud-url') { cloud.setUrl(e.target.value); ctx.toast('Server address saved'); }
    if (e.target?.id === 'life-import-file') {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (f) f.text().then(onImportFile);
    }
  });
  injectStyle();
  paintStatus();
  // After an update: what changed, once (this device).
  setTimeout(() => {
    const m = ctx.state?.meta;
    if (!m || ctx.DEMO || document.querySelector('.sheet') || !shouldShow(m, APP_VERSION)) return;
    const from = m.previousVersion;
    m.whatsNewSeen = APP_VERSION;
    ctx.persist?.();
    openWhatsNew(from);
  }, 2500);
  // Once (1.86.0): the moving background starts off, like on new installs. Say so, and where to turn it back on.
  try {
    if (!ctx.DEMO && !localStorage.getItem('fh-calm-bg-1')) {
      localStorage.setItem('fh-calm-bg-1', '1');
      if (ctx.state.settings?.themeMotion === true) {
        ctx.state.settings.themeMotion = false;
        ctx.persist?.();
        ctx.render();
        setTimeout(() => ctx.toast('The moving background is off now. Turn it back on in Settings → Extras.'), 1200);
      }
    }
  } catch { /* no storage: nothing to change */ }
  if (!ctx.DEMO) {
    window.addEventListener('online', () => { paintStatus(); soon(500); });
    window.addEventListener('offline', paintStatus);
    window.addEventListener('focus', () => soon(1000));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) soon(800); });
    // Always in step: while the app is on screen it checks the server every minute
    // (every 5 minutes in the background), so what you log on the other device shows here.
    let lastPull = Date.now();
    setInterval(() => {
      if (!cloud.config.signedIn || cloud.status.busy) return;
      const gap = document.hidden ? 5 * 60_000 : 60_000;
      if (Date.now() - lastPull < gap) return;
      lastPull = Date.now();
      cloud.sync().then(after);
    }, 15_000);
    cloud.subscribe(() => { if (!cloud.status.busy) lastPull = Date.now(); });
    setInterval(paintStatus, 30_000);
    if (cloud.config.signedIn) soon(1500);
    // Desktop: when the always-on bot runs on the server, this computer's own bot reader stands aside
    // (Telegram can only send to one place; two readers would fight and the app would show a warning).
    if (isDesktop() && window.desktop?.telegram) {
      setTimeout(async () => {
        const st = await loadBotStatus().catch(() => null);
        const mine = await window.desktop.telegram.status?.().catch(() => null);
        if (st?.on && mine?.connected) {
          await window.desktop.telegram.disconnect?.().catch(() => {});
          ctx.toast(`Your bot @${st.bot} runs on your server now, so this computer stopped reading it.`);
        }
      }, 6000);
    }
    else if (isWeb()) {
      probeServer().then((here) => {
        if (!here || ctx.state._sealed || document.querySelector('.sheet')) return;
        // First visit with nothing here: sign in to load Money from the server.
        if (!(ctx.state.tx || []).length) { openSignIn({ first: true }); return; }
        // Money is here but not syncing: ask once per visit, so web and desktop never drift apart unnoticed.
        let asked = false;
        try { asked = sessionStorage.getItem('fh-keep-asked') === '1'; sessionStorage.setItem('fh-keep-asked', '1'); } catch { /* private window */ }
        if (!asked) openSignIn({ keep: true });
      });
    }
    // Desktop, signed out: the line under the name says so; nothing pops up by itself.
    notifyNow();
    setInterval(notifyNow, 30 * 60_000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) notifyNow(); });
  }
  onUpdateChange(paintBadge);
  watchServiceWorker();
  paintBadge();
}

/** For tests and the console: the cloud engine. */
export const cloudEngine = () => cloud;
