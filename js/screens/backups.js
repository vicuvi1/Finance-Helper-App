// Automatic backups: once a day a full copy goes to this computer
// (Documents/Finance Helper/Backups, desktop app) and to Google Drive (when
// sync is on). Old ones are thinned out (js/backups.js). Any of them can be
// restored from Settings.

import { ctx, esc } from '../ctx.js';
import { backupJSON } from '../store.js';
import { backupName, dateOf, toPrune } from '../backups.js';
import { todayISO } from '../dates.js';
import { driveIfConnected } from './sync.js';

const local = () => window.desktop?.backups;
const st = { list: null, busy: false };

export async function autoBackup({ force = false } = {}) {
  if (ctx.DEMO || !ctx.state.tx.length) return;
  const today = todayISO();
  if (!force && ctx.state.meta.lastAutoBackupDay === today) return;
  const name = backupName(today);
  const text = backupJSON(ctx.state);
  const done = [];
  try {
    if (local()) {
      await local().write(name, text);
      const names = (await local().list()).map((f) => f.name);
      for (const n of toPrune(names, today)) await local().remove(n);
      done.push('this computer');
    }
  } catch (e) { console.warn('Local backup failed', e); }
  try {
    const d = driveIfConnected();
    if (d?.putSnapshot) {
      await d.putSnapshot(name, text);
      const files = await d.listSnapshots();
      const gone = new Set(toPrune(files.map((f) => f.name), today));
      for (const f of files) if (gone.has(f.name)) await d.deleteSnapshot(f.id);
      done.push('Google Drive');
    }
  } catch (e) { console.warn('Drive snapshot failed', e); }
  if (done.length) {
    ctx.state.meta.lastAutoBackupDay = today;
    ctx.state.meta.lastAutoBackup = Date.now();
    ctx.state.meta.lastAutoBackupWhere = done.join(' and ');
    ctx.persist();
  }
  return done;
}

export function initBackups() {
  setTimeout(() => autoBackup(), 20000); // after start-up settles (and after sync)
  setInterval(() => autoBackup(), 60 * 60000);
}

async function loadList() {
  st.busy = true;
  refresh();
  const out = [];
  try { for (const f of (await local()?.list()) || []) out.push({ where: 'computer', id: f.name, name: f.name, size: f.size }); } catch { /* none */ }
  try { for (const f of (await driveIfConnected()?.listSnapshots?.()) || []) out.push({ where: 'drive', id: f.id, name: f.name, size: Number(f.size) }); } catch { /* none */ }
  st.list = out.sort((a, b) => b.name.localeCompare(a.name) || a.where.localeCompare(b.where));
  st.busy = false;
  refresh();
}

function refresh() {
  const el = document.getElementById('backup-card');
  if (el) el.outerHTML = settingsCard();
}

export function settingsCard() {
  if (ctx.DEMO) return '';
  const m = ctx.state.meta;
  const where = local() && driveIfConnected() ? 'this computer and Google Drive' : local() ? 'this computer' : driveIfConnected() ? 'Google Drive' : null;
  const rows = (st.list || []).slice(0, 40).map((b) => `<div class="kv"><span>${esc(dateOf(b.name))} · ${b.where === 'drive' ? 'Drive' : 'computer'} · ${Math.max(1, Math.round(b.size / 1024))} KB</span><button class="card-link" data-act="bk-restore" data-where="${b.where}" data-id="${esc(b.id)}">Restore</button></div>`).join('');
  return `<section class="card" id="backup-card"><h2>Backup history</h2>
    <p class="muted small" style="margin-top:0">${where ? `Every day a full backup goes to ${where}. The last 30 days are kept, then one per month for 2 years.` : 'Automatic daily backups need the desktop app or Google Drive sync. Until then use "Back up" above.'}</p>
    <div class="kv"><span>Last automatic backup</span><b>${m.lastAutoBackup ? `${esc(new Date(m.lastAutoBackup).toLocaleString())}${m.lastAutoBackupWhere ? ` · ${esc(m.lastAutoBackupWhere)}` : ''}` : 'not yet'}</b></div>
    ${st.list ? (rows || '<p class="muted small">No backups found yet.</p>') : ''}
    <div class="btns" style="margin-top:10px">
      ${where ? '<button class="btn" data-act="bk-now">Back up now</button>' : ''}
      ${where ? `<button class="btn" data-act="bk-list" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Loading…' : st.list ? 'Refresh list' : 'Show backups'}</button>` : ''}
      ${local() ? '<button class="btn" data-act="bk-folder">Open folder</button>' : ''}
    </div>
  </section>`;
}

export function onClick(act, el) {
  if (act === 'bk-now') { autoBackup({ force: true }).then((d) => { ctx.toast(d?.length ? `Backed up to ${d.join(' and ')}` : 'Backup failed. Run "Check everything".'); refresh(); }); return true; }
  if (act === 'bk-list') { loadList(); return true; }
  if (act === 'bk-folder') { local()?.openFolder(); return true; }
  if (act === 'bk-restore') {
    const read = el.dataset.where === 'drive' ? driveIfConnected()?.readSnapshot(el.dataset.id) : local()?.read(el.dataset.id);
    Promise.resolve(read).then((text) => text && ctx.restoreFromText(text)).catch((e) => ctx.toast(`Couldn't read that backup: ${e.message || e}`));
    return true;
  }
  return false;
}
