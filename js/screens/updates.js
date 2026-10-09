// "About & updates": which version you run, when it was last updated, and a
// one-click update for the desktop app (from GitHub Releases). The web app
// updates itself: it always loads the newest version when online.

import { ctx, esc } from '../ctx.js';
import { APP_VERSION } from '../version.js';

const desk = () => window.desktop?.update;
const u = { status: 'idle', version: null, percent: 0, message: '' };
let started = false;

const when = (ts) => (ts ? new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'never');

// Remember when this device moved to a new version.
export async function initUpdates() {
  if (started) return;
  started = true;
  const info = (await window.desktop?.appInfo?.().catch(() => null)) || { version: APP_VERSION };
  u.current = info.version;
  const m = ctx.state.meta;
  if (m.installedVersion !== info.version) {
    if (m.installedVersion) m.previousVersion = m.installedVersion;
    m.installedVersion = info.version;
    m.installedAt = Date.now();
    ctx.persist();
    if (m.previousVersion) ctx.toast(`Updated to version ${info.version}`);
  }
  desk()?.onEvent((e) => {
    if (e.type === 'available') Object.assign(u, { status: 'available', version: e.version });
    else if (e.type === 'none') { if (u.status === 'checking') u.status = 'latest'; }
    else if (e.type === 'progress') Object.assign(u, { status: 'downloading', percent: e.percent });
    else if (e.type === 'ready') Object.assign(u, { status: 'ready', version: e.version });
    else if (e.type === 'error') Object.assign(u, { status: 'error', message: e.message });
    if (e.type !== 'progress') { ctx.state.meta.lastUpdateCheck = Date.now(); ctx.persist(); }
    refresh();
  });
}

function refresh() {
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
    body = `<p class="muted small" style="margin:0 0 10px">This is the web version: it loads the newest version by itself whenever it opens online. For one-click updates use the desktop app.</p>
      <button class="btn block" data-act="update-reload">Reload now</button>`;
  } else {
    const s = u.status;
    const line = {
      idle: 'Not checked yet this session.',
      checking: 'Checking GitHub for a new version…',
      latest: 'You have the latest version.',
      available: `Version ${esc(u.version)} is available.`,
      downloading: `Downloading version ${esc(u.version || '')}… ${u.percent}%`,
      ready: `Version ${esc(u.version)} is ready. Restart to finish.`,
      error: `Couldn't update: ${esc(u.message)}`,
      dev: esc(u.message),
    }[s];
    const btn = {
      available: '<button class="btn primary block" data-act="update-download">Update now</button>',
      ready: '<button class="btn primary block" data-act="update-install">Restart to update</button>',
      downloading: `<div class="bar gold"><i style="width:${u.percent}%"></i></div>`,
      checking: '<button class="btn block" disabled>Checking…</button>',
    }[s] || '<button class="btn block" data-act="update-check">Check for updates</button>';
    body = `<p style="margin:0 0 10px" class="${s === 'error' ? 'expense' : s === 'latest' ? 'income' : ''}">${line}</p>${btn}`;
  }
  return `<section class="card" id="update-card"><h2>About &amp; updates</h2>
    <div class="kv"><span>Version</span><b>${esc(current)}</b></div>
    <div class="kv"><span>On this device since</span><b>${esc(when(m.installedAt))}</b></div>
    ${m.previousVersion ? `<div class="kv"><span>Updated from</span><b>${esc(m.previousVersion)}</b></div>` : ''}
    ${desk() ? `<div class="kv"><span>Last check</span><b>${esc(when(m.lastUpdateCheck))}</b></div>` : ''}
    <div style="margin-top:12px">${body}</div>
  </section>`;
}

export async function onClick(act) {
  if (act === 'update-reload') { location.reload(); return true; }
  if (!desk() || !act.startsWith('update-')) return false;
  if (act === 'update-check') {
    u.status = 'checking';
    refresh();
    try {
      const r = await desk().check();
      if (r.type === 'dev') Object.assign(u, { status: 'dev', message: r.message });
      else if (r.type === 'error') Object.assign(u, { status: 'error', message: r.message });
      else if (r.type === 'available') Object.assign(u, { status: 'available', version: r.version });
      else u.status = 'latest';
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
