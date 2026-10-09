// "Check everything": one button that tries every connection on this device
// (storage, rates, coin prices, Google Drive, Binance, updates) and says in
// plain words what works and what doesn't.

import { ctx, esc } from '../ctx.js';
import { URLS, parseErApi, parseBinance } from '../rates.js';
import { STORAGE_KEYS, isEncrypted } from '../store.js';
import { deriveKey, seal, open, newSalt } from '../cipher.js';

let results = null;
let running = false;

const fetchText = (url) => (window.desktop?.fetchText ? window.desktop.fetchText(url) : fetch(url, { cache: 'no-store' }).then((r) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}));
const clean = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

async function check(name, fn) {
  const t0 = performance.now();
  try {
    const detail = await fn();
    return { name, ok: detail !== false, skip: detail === null, detail: detail || '', ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { name, ok: false, detail: clean(e), ms: Math.round(performance.now() - t0) };
  }
}

export async function runAll() {
  if (running) return;
  running = true;
  results = null;
  refresh();
  const d = window.desktop;
  const list = [];
  list.push(await check('Saving on this device', () => {
    const k = 'finance-helper.selftest';
    localStorage.setItem(k, '1');
    const ok = localStorage.getItem(k) === '1';
    localStorage.removeItem(k);
    if (!ok) throw new Error('Storage is blocked');
    const kb = Math.round((localStorage.getItem(isEncrypted() ? STORAGE_KEYS.ENC : STORAGE_KEYS.KEY) || '').length / 1024);
    return `works · your data uses ${kb} KB${isEncrypted() ? ', encrypted' : ''}`;
  }));
  list.push(await check('Encryption', async () => {
    const salt = newSalt();
    const key = await deriveKey('self-check', salt, 1000);
    if ((await open(await seal('ok', key, salt, 1000), key)) !== 'ok') throw new Error('Round trip failed');
    return isEncrypted() ? 'on · AES-256 with your PIN' : 'available (off)';
  }));
  list.push(await check('Exchange rates', async () => {
    const { usd, date } = parseErApi(await fetchText(URLS.fiat));
    return `1 USD = ${usd.MDL?.toFixed(2)} MDL (${date})`;
  }));
  if (d) {
    list.push(await check('Official BNM rate', async () => {
      const dt = new Date();
      const txt = await fetchText(URLS.bnm(`${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`));
      const usd = /<CharCode>USD<\/CharCode>[\s\S]*?<Value>([\d.,]+)<\/Value>/.exec(txt)?.[1];
      if (!usd) throw new Error('No USD rate in the answer');
      return `1 USD = ${usd} MDL`;
    }));
  }
  list.push(await check('Crypto prices (Binance)', async () => {
    const p = parseBinance(await fetchText(URLS.binance(['BTCUSDT'])));
    return `BTC = $${Math.round(p.BTC).toLocaleString()}`;
  }));
  list.push(await check('Google Drive sync', async () => {
    if (d?.drive) {
      if (!(await d.drive.status()).connected) return null;
      const txt = await d.drive.pull();
      return txt ? `connected · Drive copy ${Math.round(txt.length / 1024)} KB` : 'connected · no copy in Drive yet';
    }
    return ctx.state.meta.driveWebConnected ? 'connected (web)' : null;
  }));
  list.push(await check('Binance account', async () => {
    if (!d?.binance) return null;
    if (!(await d.binance.status()).connected) return null;
    const p = await d.binance.balances();
    return `connected · ${(p.spot?.balances || []).length} spot balances read`;
  }));
  list.push(await check('Updates', async () => {
    if (!d?.update) return null;
    const r = await d.update.check();
    if (r.type === 'error' || r.type === 'dev') throw new Error(r.message);
    return r.type === 'available' ? `version ${r.version} is available` : 'you have the latest version';
  }));
  list.push(await check('Backups', async () => {
    const m = ctx.state.meta;
    const last = Math.max(m.lastBackup || 0, m.lastAutoBackup || 0);
    if (!last) throw new Error('No backup yet. Make one in "Your data".');
    const days = Math.floor((Date.now() - last) / 864e5);
    if (days > 7) throw new Error(`Last backup ${days} days ago`);
    return days ? `last backup ${days} day${days === 1 ? '' : 's'} ago` : 'backed up today';
  }));
  results = list;
  running = false;
  ctx.state.meta.lastSelfCheck = { at: Date.now(), ok: list.filter((r) => r.ok && !r.skip).length, failed: list.filter((r) => !r.ok).length };
  ctx.persist();
  refresh();
}

function refresh() {
  const el = document.getElementById('selfcheck-card');
  if (el) el.outerHTML = settingsCard();
}

export function settingsCard() {
  const rows = (results || []).map((r) => `<div class="check-row ${r.skip ? 'skip' : r.ok ? 'ok' : 'bad'}">
      <span class="tag">${r.skip ? 'Off' : r.ok ? 'OK' : 'Fix'}</span>
      <span><b>${esc(r.name)}</b><span class="muted small">${r.skip ? 'not connected' : esc(r.detail)}</span></span>
    </div>`).join('');
  const last = ctx.state.meta.lastSelfCheck;
  return `<section class="card" id="selfcheck-card"><h2>Check everything</h2>
    <p class="muted small" style="margin-top:0">Tries every connection on this device and tells you what works.${last && !results ? ` Last run ${new Date(last.at).toLocaleString()}: ${last.ok} OK, ${last.failed} to fix.` : ''}</p>
    ${rows ? `<div class="checks">${rows}</div>` : ''}
    <button class="btn block" data-act="selfcheck" ${running ? 'disabled' : ''}>${running ? 'Checking…' : results ? 'Run again' : 'Run the check'}</button>
  </section>`;
}

export function onClick(act) {
  if (act === 'selfcheck') { runAll(); return true; }
  return false;
}
