// Settings → Data & health: checks at the top (sync, server space, this device's
// space, bot, version, backups), then how big your data is and how long the
// room lasts at your pace, your devices, and what is in your data.
// Numbers: js/datahealth.js. Server figures come from /api/money {op:'stats'}.

import { ctx, esc } from '../ctx.js';
import { todayISO } from '../dates.js';
import { APP_VERSION } from '../version.js';
import { updateStatus, webUpdateWaiting } from './updates.js';
import { cloudEngine, lastServerBackup } from '../standalone.js';
import { SERVER_LIMIT, formatBytes, dataCounts, recordsPerMonth, roomLeft, yearsText, healthChecks, ago } from '../datahealth.js';

let srv = null; // {moneyChars, pieces, dbBytes, devices} | {error}
let bot = null;
let srvBackupAt = 0; // the newest server backup
let dev = null; // {usage, quota}
let loading = false;
let loadedAt = 0;

async function load(force = false) {
  if (loading || (!force && Date.now() - loadedAt < 60_000)) return;
  loading = true;
  const cloud = cloudEngine();
  const jobs = [];
  if (navigator.storage?.estimate) jobs.push(navigator.storage.estimate().then((e) => { dev = { usage: e.usage || 0, quota: e.quota || 0 }; }).catch(() => {}));
  if (cloud?.config.signedIn) {
    jobs.push(cloud.api('/api/money', { op: 'stats' }).then((r) => { srv = r; }).catch((e) => { srv = { error: e.message }; }));
    jobs.push(cloud.api('/api/money', { op: 'backups' }).then((r) => { srvBackupAt = r.backups?.[0]?.at || 0; }).catch(() => {}));
    jobs.push(cloud.api('/api/telegram', { op: 'status' }).then((r) => { bot = r; }).catch(() => { bot = null; }));
  }
  await Promise.all(jobs);
  loading = false;
  loadedAt = Date.now();
  const el = document.getElementById('dh-card');
  if (el) ctx.render();
}

const bar = (pct, lvl) => `<span class="dh-bar ${lvl}"><i style="width:${Math.max(1, Math.min(100, pct)).toFixed(1)}%"></i></span>`;
const lvlOf = (pct) => (pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok');

export function card() {
  const { state } = ctx;
  if (state._sealed) return '<section class="card" id="dh-card"><h2>Data & health</h2><p class="muted">Unlock your data first.</p></section>';
  if (!ctx.DEMO) setTimeout(() => load(), 0);
  const today = todayISO();
  const cloud = cloudEngine();
  const counts = dataCounts(state);
  const bytes = JSON.stringify(state).length; // characters ≈ bytes for this data
  const perMonthRecords = recordsPerMonth(state, today);

  const server = srv && !srv.error ? (() => {
    const used = srv.dbBytes || srv.settingsChars || srv.moneyChars;
    return { used, limit: SERVER_LIMIT, money: srv.moneyChars, ...roomLeft({ used, limit: SERVER_LIMIT, bytes: srv.moneyChars || bytes, records: counts.records, perMonthRecords }) };
  })() : null;
  const device = dev?.quota ? { used: dev.usage, limit: dev.quota, ...roomLeft({ used: dev.usage, limit: dev.quota, bytes, records: counts.records, perMonthRecords }) } : null;
  const u = updateStatus();
  const checks = healthChecks({
    sync: cloud ? { signedIn: cloud.config.signedIn, okAt: cloud.config.okAt, dirty: cloud.config.dirty, error: cloud.status.state === 'error' ? cloud.status.error : '' } : null,
    server, device,
    bot: bot && bot.configured !== undefined ? bot : null,
    update: { version: APP_VERSION, waiting: webUpdateWaiting() || u.status === 'ready' || u.status === 'available' },
    lock: { on: !!state.meta?.lock, minutes: state.meta?.lockAfter ?? 5 },
    lastBackup: Math.max(state.meta?.lastBackup || 0, lastServerBackup(), srvBackupAt),
  });
  const icon = { ok: '✅', warn: '🟡', bad: '🔴' };
  const worst = checks.some((c) => c.level === 'bad') ? 'bad' : checks.some((c) => c.level === 'warn') ? 'warn' : 'ok';
  const headline = { ok: 'All good', warn: 'Mostly fine: a few things to look at', bad: 'Something needs you' }[worst];

  const devices = (srv?.devices || []).map((d) => `<div class="kv"><span>${esc(d.label)}</span><b>${d.lastSeen ? `signed in ${esc(ago(Date.now() - d.lastSeen))}` : '—'}</b></div>`).join('');
  return `<section class="card dh-card" id="dh-card" data-testid="data-health">
    <div class="dh-head"><div><h2 style="margin:0">${icon[worst]} ${esc(headline)}</h2>
      <p class="muted small" style="margin:4px 0 0">Version ${esc(APP_VERSION)} · checked ${loadedAt ? esc(ago(Date.now() - loadedAt)) : 'now'}</p></div>
      <button type="button" class="btn sm" data-dh-act="refresh">${loading ? 'Checking…' : 'Check again'}</button></div>
    <div class="dh-checks">${checks.map((c) => `<div class="dh-check ${c.level}" data-testid="dh-check-${c.id}"><span aria-hidden="true">${icon[c.level]}</span><div><b>${esc(c.title)}</b><p>${esc(c.text)}</p></div></div>`).join('')}</div>
  </section>

  <section class="card dh-card" data-testid="dh-space">
    <h2>Space and how long it lasts</h2>
    <p class="muted small" style="margin-top:0">Your Money is <b>${esc(formatBytes(bytes))}</b> (${counts.records.toLocaleString()} records). At your pace (about ${Math.round(perMonthRecords)} records a month) it grows about <b>${esc(formatBytes((server || device || roomLeft({ used: 0, limit: 1, bytes, records: counts.records, perMonthRecords })).perMonth))}</b> a month.</p>
    <div class="dh-room">
      <div><div class="dh-room-top"><b>Your server</b><span>${server ? `${esc(formatBytes(server.used))} of ${esc(formatBytes(server.limit))}` : srv?.error ? esc(srv.error) : cloud?.config.signedIn ? 'Checking…' : 'Sign in to see it'}</span></div>
        ${server ? `${bar(server.pct, lvlOf(server.pct))}<p class="muted small">Lasts <b>${esc(yearsText(server.years))}</b> at your pace. Money itself: ${esc(formatBytes(server.money))}${srv.pieces ? ` in ${srv.pieces} pieces` : ''}. The limit assumes Turso's free plan (5 GB).</p>` : ''}</div>
      <div><div class="dh-room-top"><b>This device</b><span>${device ? `${esc(formatBytes(device.used))} of ${esc(formatBytes(device.limit))}` : 'This browser doesn\'t say'}</span></div>
        ${device ? `${bar(device.pct, lvlOf(device.pct))}<p class="muted small">Lasts <b>${esc(yearsText(device.years))}</b> at your pace. Everything this app keeps here (data, offline copy, caches).</p>` : ''}</div>
    </div>
  </section>

  <section class="card dh-card" data-testid="dh-details">
    <h2>What is in your data</h2>
    <div class="set-kv-list">
      <div class="kv"><span>Records</span><b>${counts.records.toLocaleString()}</b></div>
      <div class="kv"><span>From – to</span><b>${counts.first ? `${esc(counts.first)} – ${esc(counts.last)}` : '—'}</b></div>
      <div class="kv"><span>Repeating payments and subscriptions</span><b>${counts.repeating}</b></div>
      <div class="kv"><span>Accounts · categories</span><b>${counts.accounts} · ${counts.categories}</b></div>
      <div class="kv"><span>People · goals · invoices</span><b>${counts.people} · ${counts.goals} · ${counts.invoices}</b></div>
      <div class="kv"><span>Deletion markers (keep deletions in sync)</span><b>${counts.deleted.toLocaleString()}</b></div>
    </div>
  </section>

  ${devices ? `<section class="card dh-card" data-testid="dh-devices"><h2>Your devices</h2><p class="muted small" style="margin-top:0">Signed in to your server (the last sign-in or session renewal).</p><div class="set-kv-list">${devices}</div></section>` : ''}`;
}

let bound = false;
export function init() {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('[data-dh-act="refresh"]')) { load(true); ctx.render(); }
  });
}
