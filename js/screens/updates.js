// "About & updates": which version you run, when it was last updated, and a
// one-click update for the desktop app (from GitHub Releases). The web app
// updates itself: it always loads the newest version when online.

import { ctx, esc } from '../ctx.js';
import { APP_VERSION, isNewerVersion } from '../version.js';

const desk = () => (typeof window !== 'undefined' ? window.desktop?.update : null);
const u = { status: 'idle', version: null, latestVersion: null, percent: 0, message: '' };
let started = false;
const watchers = new Set();
/** The update state (status: idle | checking | latest | available | downloading | ready | error | dev). */
export const updateStatus = () => ({ ...u, current: u.current || APP_VERSION });
/** Called whenever the update state changes (the sidebar badge listens). */
export function onUpdateChange(fn) { watchers.add(fn); return () => watchers.delete(fn); }

/** electron-updater's messages in plain English. */
export function plainUpdateError(msg) {
  const m = String(msg || '');
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|net::ERR_|getaddrinfo|network|socket hang up/i.test(m)) return 'No internet connection, or GitHub can\'t be reached right now. Try again in a moment.';
  if (/rate limit|status code 403|\b403\b/i.test(m)) return 'GitHub is getting too many checks right now. Try again in an hour.';
  if (/404|Cannot find latest|No published versions|latest(-linux)?\.yml|Unable to find latest version/i.test(m)) return 'No new release was found on GitHub. Try again later.';
  if (/sha512|checksum|mismatch/i.test(m)) return 'The download came through damaged. Check again to download it once more.';
  if (/EPERM|EACCES|EBUSY|permission|operation not permitted/i.test(m)) return 'Windows blocked the update. Close the app, then run the newest Setup file from the GitHub Releases page.';
  if (/can.t update itself|portable/i.test(m)) return m;
  return `Couldn't update: ${m.split('\n')[0]}`;
}

const when = (ts) => (ts ? new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'never');

// Remember when this device moved to a new version.
export async function initUpdates() {
  if (started) return;
  started = true;
  const info = (await (typeof window !== 'undefined' ? window.desktop?.appInfo?.().catch(() => null) : null)) || { version: APP_VERSION };
  u.current = info.version;
  const m = ctx.state.meta;
  if (m.installedVersion !== info.version) {
    if (m.installedVersion) m.previousVersion = m.installedVersion;
    m.installedVersion = info.version;
    m.installedAt = Date.now();
    ctx.persist();
  }
  desk()?.onEvent((e) => {
    if (e.type === 'available') {
      if (isNewerVersion(e.version, u.current || APP_VERSION)) {
        Object.assign(u, { status: 'available', version: e.version });
      } else {
        u.status = 'latest';
        u.latestVersion = e.version;
      }
    }
    else if (e.type === 'none') {
      u.status = 'latest';
      if (e.version) u.latestVersion = e.version;
    }
    else if (e.type === 'progress') Object.assign(u, { status: 'downloading', percent: e.percent });
    else if (e.type === 'ready') Object.assign(u, { status: 'ready', version: e.version });
    else if (e.type === 'error') Object.assign(u, { status: 'error', message: e.message });
    if (e.type !== 'progress') { ctx.state.meta.lastUpdateCheck = Date.now(); ctx.persist(); }
    refresh();
  });
}

function refresh() {
  for (const fn of watchers) { try { fn(updateStatus()); } catch { /* ignore */ } }
  const el = document.getElementById('update-card');
  if (el) el.outerHTML = settingsCard();
  else if (ctx.ui.tab === 'home' && ['available', 'ready'].includes(u.status)) ctx.render();
}

export const updateBanner = () => (desk() && ['available', 'ready'].includes(u.status)
  ? `<div class="banner"><p>${u.status === 'ready' ? `Version ${esc(u.version)} is downloaded.` : `Version ${esc(u.version)} is available.`}</p><button class="btn primary" data-act="${u.status === 'ready' ? 'update-install' : 'update-download'}">${u.status === 'ready' ? 'Restart to update' : 'Update now'}</button></div>`
  : '');

export function settingsCard() {
  const m = ctx.state.meta;
  const current = u.current || APP_VERSION;
  let body;
  if (!desk()) {
    const waiting = webUpdateWaiting();
    body = `<div class="set-status-box ${waiting ? 'accent' : 'success'}">
      <div class="set-sb-icon">${waiting ? '🚀' : '✓'}</div>
      <div class="set-sb-content">
        <b>${waiting ? 'A new version is ready' : `Up to date (v${esc(current)})`}</b>
        <p class="muted small" style="margin:2px 0 0">${waiting ? 'Reload to update. Your data stays as it is.' : 'The web app loads the newest version whenever you are online, and works offline too.'}</p>
      </div>
    </div>
    <button class="btn ${waiting ? 'primary ' : ''}block" style="margin-top:12px" data-act="update-reload" data-testid="update-reload">${waiting ? 'Reload to update' : 'Check for updates'}</button>`;
  } else {
    const s = u.status;
    const line = {
      idle: 'Not checked yet this session.',
      checking: 'Checking GitHub for a new version…',
      latest: u.latestVersion && isNewerVersion(current, u.latestVersion)
        ? `Up to date (v${esc(current)}). This copy is newer than the latest release on GitHub (v${esc(u.latestVersion)}).`
        : `Up to date (v${esc(current)}).`,
      available: `Version ${esc(u.version)} is available.`,
      downloading: `Downloading ${u.percent}%`,
      ready: `Version ${esc(u.version)} is downloaded. Restart to update.`,
      error: esc(plainUpdateError(u.message)),
      dev: esc(u.message),
    }[s];
    const btn = {
      available: '<button class="btn primary block" data-act="update-download">Download update</button>',
      ready: '<button class="btn primary block" data-act="update-install">Restart to update</button>',
      downloading: `<div class="bar gold"><i style="width:${u.percent}%"></i></div>`,
      checking: '<button class="btn block" disabled>Checking GitHub…</button>',
    }[s] || '<button class="btn block" data-act="update-check">🔍 Check for updates</button>';
    body = `<div class="set-status-box ${s === 'error' ? 'danger' : s === 'latest' ? 'success' : s === 'available' || s === 'ready' ? 'accent' : ''}">
      <div class="set-sb-icon">${s === 'error' ? '⚠️' : s === 'latest' ? '✓' : s === 'available' ? '🚀' : 'ℹ️'}</div>
      <div class="set-sb-content">
        <b>${s === 'latest' ? `Up to date (v${esc(current)})` : s === 'available' ? 'Update available' : s === 'ready' ? 'Restart to update' : s === 'downloading' ? `Downloading ${u.percent}%` : s === 'error' ? 'Update problem' : 'Updates'}</b>
        <p class="muted small" style="margin:2px 0 0">${line}</p>
      </div>
    </div>
    <div style="margin-top:12px">${btn}</div>`;
  }
  return `<section class="card set-update-card" id="update-card">
    <div class="card-head-pill">
      <h2>📦 Application Release</h2>
      <span class="set-badge gold">v${esc(current)}</span>
    </div>
    <div class="set-version-hero">
      <div class="set-vh-badge">v${esc(current)}</div>
      <div class="set-vh-meta">
        <b>Finance Helper</b>
        <span class="muted small">Offline-first personal finance platform</span>
      </div>
    </div>
    <div class="set-kv-list">
      <div class="kv"><span>Installed on this device</span><b>${esc(when(m.installedAt))}</b></div>
      ${m.previousVersion ? `<div class="kv"><span>Previous version</span><b>v${esc(m.previousVersion)}</b></div>` : ''}
      <div class="kv"><span>Channel</span><b>${desk() ? 'Desktop (Electron)' : 'Progressive Web App (PWA)'}</b></div>
      ${desk() ? `<div class="kv"><span>Last update check</span><b>${esc(when(m.lastUpdateCheck))}</b></div>` : ''}
    </div>
    <div style="margin-top:14px">${body}</div>
    <button type="button" class="btn block" style="margin-top:8px" data-act="whats-new" data-testid="whats-new-btn">What's new</button>
  </section>`;
}

// ---------- Web: a new version is waiting (the service worker took over) ----------
let swWaiting = false;
export const webUpdateWaiting = () => swWaiting;
/** Watches the service worker: when a newer version takes over this open page, offer "Reload to update". */
export function watchServiceWorker() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker || desk()) return;
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!had) return; // the first install: this page is already the newest
    swWaiting = true;
    refresh();
  });
  navigator.serviceWorker.getRegistration?.().then((reg) => {
    if (!reg) return;
    if (reg.waiting && had) { swWaiting = true; refresh(); }
    setInterval(() => reg.update().catch(() => {}), 30 * 60_000);
  }).catch(() => {});
}

export async function onClick(act) {
  if (act === 'update-reload') {
    if (!swWaiting) {
      const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
      await reg?.update?.().catch(() => {});
    }
    location.reload();
    return true;
  }
  if (!desk() || !act.startsWith('update-')) return false;
  if (act === 'update-check') {
    u.status = 'checking';
    refresh();
    try {
      const r = await desk().check();
      if (r.type === 'dev') Object.assign(u, { status: 'dev', message: r.message });
      else if (r.type === 'error') Object.assign(u, { status: 'error', message: r.message });
      else if (r.type === 'available' && isNewerVersion(r.version, u.current || APP_VERSION)) {
        Object.assign(u, { status: 'available', version: r.version });
      } else {
        u.status = 'latest';
        if (r.version) u.latestVersion = r.version;
      }
    } catch (e) {
      Object.assign(u, { status: 'error', message: String(e?.message || e).split('\n')[0] });
    }
    ctx.state.meta.lastUpdateCheck = Date.now();
    ctx.persist();
    refresh();
    return true;
  }
  if (act === 'update-download') {
    Object.assign(u, { status: 'downloading', percent: 0 });
    refresh();
    desk().download().catch((e) => { Object.assign(u, { status: 'error', message: String(e?.message || e) }); refresh(); });
    return true;
  }
  if (act === 'update-install') { desk().install(); return true; }
  return false;
}
