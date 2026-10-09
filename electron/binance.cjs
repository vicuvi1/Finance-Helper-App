// Binance read-only access for the desktop app. The API key and secret are
// encrypted with the operating system's key store (Electron safeStorage) and
// kept in this device's app data folder. They are never sent to the page,
// never synced and never written in plain text.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const API = 'https://api.binance.com';

// HMAC-SHA256 of the query string, as Binance's signed endpoints require.
function sign(query, secret) {
  return crypto.createHmac('sha256', secret).update(query).digest('hex');
}

function createBinance({ app, net, safeStorage }) {
  const file = () => path.join(app.getPath('userData'), 'binance.bin');

  function readKeys() {
    try {
      const buf = fs.readFileSync(file());
      return JSON.parse(safeStorage.decryptString(buf));
    } catch {
      return null;
    }
  }

  function saveKeys(key, secret) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer has no secure key storage available.');
    fs.writeFileSync(file(), safeStorage.encryptString(JSON.stringify({ key, secret })), { mode: 0o600 });
  }

  function forget() {
    try { fs.unlinkSync(file()); } catch { /* already gone */ }
  }

  let offset = 0; // our clock vs Binance's, so signed calls aren't rejected

  async function call(method, pathName, params = {}, keys) {
    const qs = new URLSearchParams({ ...params, recvWindow: '10000', timestamp: String(Date.now() + offset) }).toString();
    const url = `${API}${pathName}?${qs}&signature=${sign(qs, keys.secret)}`;
    const r = await net.fetch(url, { method, headers: { 'X-MBX-APIKEY': keys.key } });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    if (!r.ok) {
      const msg = json?.msg || `HTTP ${r.status}`;
      const e = new Error(msg);
      e.code = json?.code;
      throw e;
    }
    return json;
  }

  async function syncClock() {
    try {
      const r = await net.fetch(`${API}/api/v3/time`);
      const { serverTime } = await r.json();
      offset = serverTime - Date.now();
    } catch { /* keep the old offset */ }
  }

  // Raw payloads; the page parses them with js/binance.js.
  async function balances() {
    const keys = readKeys();
    if (!keys) throw new Error('Binance is not connected.');
    await syncClock();
    const spot = await call('GET', '/api/v3/account', { omitZeroBalances: 'true' }, keys);
    // Funding and Earn are optional: a key without those permissions still
    // gives Spot balances.
    const funding = await call('POST', '/sapi/v1/asset/get-funding-asset', {}, keys).catch(() => []);
    const earn = await call('GET', '/sapi/v1/simple-earn/flexible/position', { size: '100' }, keys).catch(() => ({ rows: [] }));
    return { spot, funding, earn };
  }

  function status() {
    const k = readKeys();
    return k ? { connected: true, keyEnd: k.key.slice(-4) } : { connected: false };
  }

  return { saveKeys, forget, balances, status };
}

module.exports = { createBinance, sign };
