// Binance in the app: connect a read-only API key (desktop app only), then
// the coins of your Binance account fill in by themselves every 30 minutes.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { parseSpot, parseFunding, parseEarn, mergeHoldings } from '../binance.js';

const api = () => window.desktop?.binance;
const st = { status: null, busy: false, error: '' };

const when = (ts) => (ts ? new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'never');

// The account the coins go into: the one marked as Binance, or a new one.
function binanceAccount(state) {
  let a = state.settings.accounts.find((x) => x.id === state.meta.binanceAccount)
    || state.settings.accounts.find((x) => /binance/i.test(x.bank || '') && x.kind === 'crypto');
  if (!a) {
    a = { id: `a-${M.uid()}`, name: 'Binance', bank: 'Binance', kind: 'crypto', currency: 'USD', start: 0, last4: '', color: 4, savings: false, archived: false, holdings: [], updatedAt: Date.now() };
    state.settings.accounts.push(a);
  }
  state.meta.binanceAccount = a.id;
  return a;
}

function apply(payload) {
  const { state } = ctx;
  const rows = mergeHoldings({ spot: parseSpot(payload.spot), funding: parseFunding(payload.funding), earn: parseEarn(payload.earn) });
  const a = binanceAccount(state);
  a.holdings = rows.map((r) => ({ asset: r.asset, qty: r.qty }));
  M.touch(a);
  state.meta.binanceSyncedAt = Date.now();
  ctx.commit();
  ctx.updateRates({ force: true }); // prices for any new coin
  return rows.length;
}

export async function syncBinance({ announce = false } = {}) {
  if (!api() || st.busy) return;
  st.busy = true;
  st.error = '';
  refresh();
  try {
    const n = apply(await api().balances());
    if (announce) ctx.toast(`Binance synced: ${n} coin${n === 1 ? '' : 's'}`);
  } catch (e) {
    st.error = cleanError(e);
    if (announce) ctx.toast(`Binance: ${st.error}`);
  }
  st.busy = false;
  refresh();
}

function cleanError(e) {
  const m = String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  if (/-2015|Invalid API-key|IP/.test(m)) return 'Binance refused the key. Check it is correct, has "Enable Reading" on, and any IP limit includes this computer.';
  if (/-1021|timestamp/i.test(m)) return 'Your computer clock is off. Sync the clock and try again.';
  return m;
}

export async function initBinance() {
  if (!api()) return;
  st.status = await api().status().catch(() => ({ connected: false }));
  const due = !ctx.state.meta.binanceSyncedAt || Date.now() - ctx.state.meta.binanceSyncedAt > 30 * 60000;
  if (st.status.connected && due) syncBinance();
  setInterval(() => { if (st.status?.connected) syncBinance(); }, 30 * 60000);
}

function refresh() {
  const el = document.getElementById('binance-card');
  if (el) el.outerHTML = settingsCard();
}

export function settingsCard() {
  const m = ctx.state.meta;
  if (!api()) {
    return `<section class="card" id="binance-card"><h2>Binance</h2>
      <p class="muted small" style="margin:0">Automatic Binance balances work in the desktop app. Here you can type the coins you hold in a crypto account (Accounts → your Binance account → Edit), and prices update live.</p></section>`;
  }
  const s = st.status;
  if (!s?.connected) {
    return `<section class="card" id="binance-card"><h2>Binance</h2>
      <p class="muted small" style="margin-top:0">Connect a <b>read-only</b> API key and your coins fill in by themselves. A read-only key can't trade or withdraw.</p>
      <ol class="steps small">
        <li>On Binance: Profile → <b>API Management</b> → Create API → System generated.</li>
        <li>Leave only <b>Enable Reading</b> on. Don't enable trading or withdrawals.</li>
        <li>Copy the API key and secret here. They are encrypted on this computer and never leave it except to talk to Binance.</li>
      </ol>
      <form id="bn-form" autocomplete="off">
        <label class="field"><span>API key</span><input id="bn-key" type="text" spellcheck="false"></label>
        <label class="field"><span>Secret key</span><input id="bn-secret" type="password" autocomplete="off"></label>
        ${st.error ? `<p class="lock-msg">${esc(st.error)}</p>` : ''}
        <button class="btn primary block" type="submit" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Connecting…' : 'Connect Binance'}</button>
      </form></section>`;
  }
  const acc = M.account(ctx.state, m.binanceAccount);
  return `<section class="card" id="binance-card"><h2>Binance</h2>
    <div class="kv"><span>Key</span><b>connected (…${esc(s.keyEnd)})</b></div>
    <div class="kv"><span>Coins go into</span><b>${esc(acc?.name || 'Binance')}</b></div>
    <div class="kv"><span>Last synced</span><b>${esc(when(m.binanceSyncedAt))}</b></div>
    ${st.error ? `<p class="lock-msg">${esc(st.error)}</p>` : ''}
    <div class="btns" style="margin-top:10px"><button class="btn primary" data-act="bn-sync" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Syncing…' : 'Sync now'}</button><button class="btn danger" data-act="bn-forget">Disconnect</button></div>
  </section>`;
}

export function onClick(act) {
  if (act === 'bn-sync') { syncBinance({ announce: true }); return true; }
  if (act === 'bn-forget') {
    api()?.forget().then(() => { st.status = { connected: false }; refresh(); ctx.toast('Binance disconnected. The key was deleted from this computer.'); });
    return true;
  }
  return false;
}

// The connect form submits through the document 'submit' listener in app.js.
export async function onSubmit(form) {
  if (form.id !== 'bn-form') return false;
  const key = form.querySelector('#bn-key').value;
  const secret = form.querySelector('#bn-secret').value;
  st.busy = true;
  st.error = '';
  refresh();
  try {
    const payload = await api().connect(key, secret);
    st.status = await api().status();
    const n = apply(payload);
    ctx.toast(`Binance connected: ${n} coin${n === 1 ? '' : 's'}`);
  } catch (e) {
    st.error = cleanError(e);
  }
  st.busy = false;
  refresh();
  return true;
}
