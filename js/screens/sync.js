// Google Drive sync: everything stays on this device (fast, works offline),
// and a copy in your own Google Drive keeps all devices in step. Syncs at
// start, after you change something (a few seconds later), every 5 minutes
// and when the internet comes back.
// Two ways in: the desktop app can simply use the Google Drive folder on the
// computer (Google Drive for desktop uploads it: no keys, no sign-in), or
// connect to Drive itself with Google Cloud keys (advanced; the web app).

import { ctx, esc } from '../ctx.js';
import { mergeStates, toCloud } from '../sync.js';
import { uid } from '../model.js';
import { webDrive, signIn } from '../gdrive-web.js';
import { hasSession, isEncrypted, isSealed, openImported, sealForExport } from '../store.js';

const s = { busy: false, error: '', connected: false, mode: null, folder: null, suggested: null };
let timer = null;

const meta = () => ctx.state.meta;
const when = (ts) => (ts ? new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'never');
const isDesktop = () => !!window.desktop?.drive;
const hasFolder = () => !!window.desktop?.folder;
const transport = () => (s.mode === 'folder' ? window.desktop.folder : isDesktop() ? window.desktop.drive : meta().driveWebClientId ? webDrive(meta().driveWebClientId) : null);

function deviceId() {
  if (!meta().deviceId) { meta().deviceId = `d-${uid()}`; ctx.persist(); }
  return meta().deviceId;
}

const clean = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// The Drive connection, when it's on (used for daily snapshots too).
export const driveIfConnected = () => (s.connected && !ctx.DEMO ? transport() : null);

// The Drive copy as data: opened with the PIN when it is encrypted.
async function readRemote(text) {
  if (!text) return null;
  const data = JSON.parse(text);
  if (!isSealed(data)) return data;
  if (!hasSession()) throw new Error('The copy in Google Drive is encrypted with a PIN. Turn on "Encrypt my data" (Settings → Security) with the same PIN to sync.');
  try {
    return JSON.parse(await openImported(data));
  } catch {
    throw new Error('The copy in Google Drive was encrypted with a different PIN. Use the same PIN on all your devices.');
  }
}

export async function syncNow({ announce = false } = {}) {
  const t = transport();
  if (!t || !s.connected || s.busy || ctx.DEMO || ctx.state._sealed) return;
  if (isEncrypted() && !hasSession()) return;
  const start = ctx.state;
  s.busy = true;
  s.error = '';
  refresh();
  try {
    const text = await t.pull();
    const remote = await readRemote(text);
    // Encryption on here but the Drive copy is still readable: replace it.
    const reseal = hasSession() && !!text && !isSealed(JSON.parse(text));
    // Locked, restored or erased meanwhile: leave it for the next round.
    if (ctx.state !== start) throw Object.assign(new Error(''), { quiet: true });
    const { state: merged, pullChanged, pushNeeded } = mergeStates(ctx.state, remote);
    if (pullChanged) {
      ctx.replaceState(merged);
      if (!document.querySelector('.sheet')) ctx.render();
    }
    if (pushNeeded || reseal) await t.push(await sealForExport(JSON.stringify(toCloud(ctx.state, deviceId()))));
    meta().lastSync = Date.now();
    meta().lastSyncNote = pullChanged && pushNeeded ? 'Got changes and sent yours' : pullChanged ? 'Got changes from another device' : pushNeeded ? 'Sent your changes' : 'Everything matches';
    ctx.persist();
    if (announce) ctx.toast(`Synced: ${meta().lastSyncNote.toLowerCase()}.`);
  } catch (e) {
    s.error = e.quiet ? '' : clean(e);
    if (announce && !e.quiet) ctx.toast(`Sync failed: ${s.error}`);
  }
  s.busy = false;
  refresh();
}

// Called after every save: sync a little later, once things settle.
export function changed() {
  if (!s.connected) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), 8000);
}

// Desktop asks the main process; the web app remembers it in meta (which
// is only readable after unlocking when the data is encrypted).
export async function refreshConnected() {
  if (ctx.DEMO) return false;
  if (hasFolder()) {
    const f = await window.desktop.folder.status().catch(() => ({}));
    s.folder = f.folder || null;
    s.suggested = f.suggested || null;
    if (f.connected) { s.mode = 'folder'; s.connected = true; return true; }
  }
  s.mode = isDesktop() || meta().driveWebConnected ? 'drive' : null;
  s.connected = isDesktop() ? !!(await window.desktop.drive.status().catch(() => ({}))).connected : !!meta().driveWebConnected;
  return s.connected;
}

// The easy way: use the Google Drive folder on this computer.
async function useFolder(pick) {
  s.busy = true;
  s.error = '';
  refresh();
  try {
    const f = pick ? await window.desktop.folder.pick() : await window.desktop.folder.use(s.suggested);
    s.busy = false;
    if (!f.connected) { refresh(); return; }
    s.folder = f.folder;
    s.mode = 'folder';
    s.connected = true;
    ctx.toast('Connected to your Google Drive folder');
    await syncNow({ announce: true });
    // A first backup there right away, not only at tomorrow's.
    ctx.backupNow?.().catch(() => {});
  } catch (e) {
    s.error = clean(e);
    s.busy = false;
  }
  refresh();
}

export async function initSync() {
  if (ctx.DEMO) return;
  if (await refreshConnected()) syncNow();
  setInterval(() => syncNow(), 5 * 60000);
  window.addEventListener('online', () => syncNow());
}

function refresh() {
  const el = document.getElementById('sync-card');
  if (el) el.outerHTML = settingsCard();
}

const steps = (desktop) => `<ol class="steps small">
  <li>Open <b>console.cloud.google.com</b>, create a project (e.g. "Finance Helper").</li>
  <li>APIs &amp; Services → Library → enable <b>Google Drive API</b>.</li>
  <li>OAuth consent screen → External → fill the app name and your email. Add the scope <b>…/auth/drive.appdata</b>. Then <b>Publish app</b> (so the connection doesn't expire after 7 days).</li>
  <li>Credentials → Create credentials → OAuth client ID → ${desktop ? '<b>Desktop app</b>. Copy the Client ID and Client secret below.' : '<b>Web application</b>, with Authorized JavaScript origin <b>https://vicuvi1.github.io</b>. Copy the Client ID below.'}</li>
</ol>`;

export function settingsCard() {
  const m = meta();
  if (ctx.DEMO) {
    return `<section class="card" id="sync-card"><h2>Google Drive sync</h2><p class="muted small" style="margin:0">Sync works in the installed app. Your data stays on each device and a copy in your own Google Drive keeps them in step.</p></section>`;
  }
  if (!s.connected) {
    const desktop = isDesktop();
    const form = `<form id="sync-form" autocomplete="off">
        <label class="field"><span>Client ID</span><input id="g-id" type="text" spellcheck="false" value="${esc(desktop ? '' : m.driveWebClientId || '')}" placeholder="…apps.googleusercontent.com"></label>
        ${desktop ? '<label class="field"><span>Client secret</span><input id="g-secret" type="password"></label>' : ''}
        <button class="btn block" type="submit" ${s.busy ? 'disabled' : ''}>${s.busy ? 'Waiting for Google…' : 'Connect Google Drive'}</button>
        ${desktop ? '<p class="muted small">Your browser opens Google\'s sign-in. Allow access, then come back here.</p>' : ''}
      </form>`;
    if (!hasFolder()) {
      return `<section class="card" id="sync-card"><h2>Google Drive sync</h2>
      <p class="muted small" style="margin-top:0">Keep this device and your others in step through your own Google Drive. The easiest way is the desktop app with <b>Google Drive for desktop</b> (one click, no keys). Here in the browser it needs a one-time setup, about 5 minutes:</p>
      ${steps(false)}${s.error ? `<p class="lock-msg">${esc(s.error)}</p>` : ''}${form}</section>`;
    }
    return `<section class="card" id="sync-card"><h2>Google Drive sync</h2>
      <p class="muted small" style="margin-top:0">Uses the <b>Google Drive folder on this computer</b> (Google Drive for desktop). The app saves a copy and a daily backup in <b>Finance Helper</b> there; Drive uploads them by itself. No keys, no sign-in. Another computer using the same Drive stays in step.</p>
      ${s.suggested
    ? `<div class="sync-found"><span class="muted small">Found your Google Drive</span><b>${esc(s.suggested)}</b></div>
        <div class="btns"><button class="btn primary" data-act="sync-folder-use" ${s.busy ? 'disabled' : ''}>${s.busy ? 'Connecting…' : 'Use this folder'}</button><button class="btn" data-act="sync-folder-pick" ${s.busy ? 'disabled' : ''}>Choose another folder…</button></div>`
    : `<p class="small" style="margin:0 0 10px">Google Drive for desktop wasn't found. Install it from <b>google.com/drive/download</b> and sign in, or pick any folder that is synced.</p>
        <button class="btn primary block" data-act="sync-folder-pick" ${s.busy ? 'disabled' : ''}>${s.busy ? 'Connecting…' : 'Choose folder…'}</button>`}
      ${s.error ? `<p class="lock-msg">${esc(s.error)}</p>` : ''}
      <details class="sync-adv"><summary>Advanced: connect to Drive with Google Cloud keys</summary>${steps(true)}${form}</details>
    </section>`;
  }
  return `<section class="card" id="sync-card"><h2>Google Drive sync</h2>
    <div class="kv"><span>Status</span><b class="${s.error ? 'expense' : 'income'}">${s.busy ? 'Syncing…' : s.error ? 'Problem' : 'Connected'}</b></div>
    ${s.mode === 'folder' ? `<div class="kv"><span>Folder</span><b class="sync-path">${esc(s.folder)} › Finance Helper</b></div>` : ''}
    <div class="kv"><span>Last sync</span><b>${esc(when(m.lastSync))}</b></div>
    ${m.lastSyncNote && !s.error ? `<div class="kv"><span>Result</span><b>${esc(m.lastSyncNote)}</b></div>` : ''}
    ${s.error ? `<p class="lock-msg">${esc(s.error)}</p>` : ''}
    <div class="btns" style="margin-top:10px"><button class="btn primary" data-act="sync-now" ${s.busy ? 'disabled' : ''}>Sync now</button>${s.mode === 'folder' ? '<button class="btn" data-act="sync-folder-open">Open folder</button>' : ''}<button class="btn danger" data-act="sync-off">${s.mode === 'folder' ? 'Stop' : 'Disconnect'}</button></div>
  </section>`;
}

export async function onSubmit(form) {
  if (form.id !== 'sync-form') return false;
  const id = form.querySelector('#g-id').value.trim();
  s.busy = true;
  s.error = '';
  refresh();
  try {
    if (isDesktop()) {
      await window.desktop.drive.connect(id, form.querySelector('#g-secret').value.trim());
      s.mode = 'drive';
    } else {
      if (!/\.apps\.googleusercontent\.com$/.test(id)) throw new Error('The Client ID should end with .apps.googleusercontent.com');
      await signIn(id, true);
      meta().driveWebClientId = id;
      meta().driveWebConnected = true;
      ctx.persist();
      s.mode = 'drive';
    }
    s.connected = true;
    s.busy = false;
    ctx.toast('Google Drive connected');
    await syncNow({ announce: true });
  } catch (e) {
    s.error = clean(e);
    s.busy = false;
  }
  refresh();
  return true;
}

export function onClick(act) {
  if (act === 'sync-now') { syncNow({ announce: true }); return true; }
  if (act === 'sync-folder-use') { useFolder(false); return true; }
  if (act === 'sync-folder-pick') { useFolder(true); return true; }
  if (act === 'sync-folder-open') { window.desktop?.folder?.open(); return true; }
  if (act === 'sync-off') {
    transport()?.disconnect();
    if (s.mode === 'folder') refreshConnected().then(refresh);
    s.mode = null;
    s.connected = false;
    meta().driveWebConnected = false;
    ctx.persist();
    refresh();
    ctx.toast('Disconnected. Your data stays on this device; the copy in Drive is kept.');
    return true;
  }
  return false;
}
