// Google Drive for the desktop app: sign in with Google in the browser
// (OAuth for installed apps: loopback redirect + PKCE), then read and write
// one file in Drive's hidden app folder (scope drive.appdata: the app sees
// only its own file, nothing else in your Drive). The refresh token is
// encrypted with the OS key store.

const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE = 'finance-helper.json';
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function createDrive({ app, net, safeStorage, shell }) {
  const store = () => path.join(app.getPath('userData'), 'gdrive.bin');
  let access = null; // { token, until }
  let fileId = null;

  const read = () => {
    try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(store()))); } catch { return null; }
  };
  const write = (o) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer has no secure key storage available.');
    fs.writeFileSync(store(), safeStorage.encryptString(JSON.stringify(o)), { mode: 0o600 });
  };

  async function tokenRequest(params) {
    const r = await net.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.error || `Google sign-in failed (HTTP ${r.status})`);
    return j;
  }

  // Opens Google's sign-in page and waits for it to come back to us.
  async function connect(clientId, clientSecret) {
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    const { code, redirect } = await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/') { res.writeHead(404).end(); return; }
        const ok = u.searchParams.get('code') && u.searchParams.get('state') === state;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Finance Helper</title><body style="font:16px system-ui;background:#0a0d12;color:#e9edf3;display:grid;place-items:center;height:100vh;margin:0"><p>${ok ? 'Connected. You can close this tab and go back to Finance Helper.' : 'Sign-in was cancelled. You can close this tab.'}</p></body>`);
        server.close();
        clearTimeout(timer);
        if (ok) resolve({ code: u.searchParams.get('code'), redirect: `http://127.0.0.1:${port}` });
        else reject(new Error(u.searchParams.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : 'Sign-in failed.'));
      });
      let port;
      const timer = setTimeout(() => { server.close(); reject(new Error('Sign-in timed out. Try again.')); }, 5 * 60000);
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({
          client_id: clientId, redirect_uri: `http://127.0.0.1:${port}`, response_type: 'code', scope: SCOPE,
          code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', state,
        }).toString();
        shell.openExternal(url.toString());
      });
    });
    const t = await tokenRequest({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier });
    if (!t.refresh_token) throw new Error('Google did not grant offline access. Remove the app in your Google account permissions and connect again.');
    write({ clientId, clientSecret, refreshToken: t.refresh_token });
    access = { token: t.access_token, until: Date.now() + (t.expires_in - 60) * 1000 };
    fileId = null;
    return true;
  }

  async function token() {
    if (access && Date.now() < access.until) return access.token;
    const c = read();
    if (!c) throw new Error('Google Drive is not connected.');
    const t = await tokenRequest({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: 'refresh_token' });
    access = { token: t.access_token, until: Date.now() + (t.expires_in - 60) * 1000 };
    return access.token;
  }

  async function api(url, opts = {}) {
    const r = await net.fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${await token()}` } });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error?.message || `Google Drive error (HTTP ${r.status})`);
    }
    return r;
  }

  async function findFile() {
    if (fileId) return fileId;
    const q = encodeURIComponent(`name='${FILE}'`);
    const r = await api(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`);
    const { files } = await r.json();
    fileId = files?.[0]?.id || null;
    return fileId;
  }

  async function pull() {
    const id = await findFile();
    if (!id) return null;
    const r = await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
    return r.text();
  }

  async function push(text) {
    const id = await findFile();
    if (id) {
      await api(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text });
      return true;
    }
    const boundary = `fh${crypto.randomBytes(8).toString('hex')}`;
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: FILE, parents: ['appDataFolder'] })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
    const r = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    fileId = (await r.json()).id;
    return true;
  }

  async function disconnect() {
    const c = read();
    if (c?.refreshToken) await net.fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(c.refreshToken)}`, { method: 'POST' }).catch(() => {});
    try { fs.unlinkSync(store()); } catch { /* already gone */ }
    access = null;
    fileId = null;
    return true;
  }

  // Daily snapshots (finance-helper-YYYY-MM-DD.json) next to the live file.
  async function listSnapshots() {
    const q = encodeURIComponent("name contains 'finance-helper-2'");
    const r = await api(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name,size)&pageSize=200`);
    return ((await r.json()).files || []).sort((a, b) => b.name.localeCompare(a.name));
  }
  async function putSnapshot(name, text) {
    const existing = (await listSnapshots()).find((f) => f.name === name);
    if (existing) {
      await api(`https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text });
      return true;
    }
    const boundary = `fh${crypto.randomBytes(8).toString('hex')}`;
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: ['appDataFolder'] })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
    await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    return true;
  }
  const readSnapshot = async (id) => (await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).text();
  const deleteSnapshot = async (id) => { await api(`https://www.googleapis.com/drive/v3/files/${id}`, { method: 'DELETE' }); return true; };

  const status = () => ({ connected: !!read() });

  return { connect, pull, push, disconnect, status, listSnapshots, putSnapshot, readSnapshot, deleteSnapshot };
}

module.exports = { createDrive };
