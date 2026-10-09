// Google Drive for the web/phone app: Google's own sign-in popup (Google
// Identity Services, token model) and the Drive REST API, which allows calls
// from web pages. Same one hidden app-folder file as the desktop app.

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE = 'finance-helper.json';
let gis = null;
let tok = null; // { token, until }
let fileId = null;

function loadGis() {
  if (gis) return gis;
  gis = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => { gis = null; reject(new Error('Could not load Google sign-in. Check the connection.')); };
    document.head.appendChild(s);
  });
  return gis;
}

// Asks Google for a 1-hour access token. `interactive` shows the account
// chooser; otherwise Google answers silently when already allowed.
export async function signIn(clientId, interactive = false) {
  const google = await loadGis();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      prompt: interactive ? 'consent' : '',
      callback: (r) => {
        if (r.error) { reject(new Error(r.error_description || r.error)); return; }
        tok = { token: r.access_token, until: Date.now() + (Number(r.expires_in || 3600) - 60) * 1000 };
        resolve(true);
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'Sign-in window was closed.' : e?.message || 'Sign-in failed.')),
    });
    client.requestAccessToken();
  });
}

async function api(clientId, url, opts = {}) {
  if (!tok || Date.now() > tok.until) await signIn(clientId, false);
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${tok.token}` } });
  if (r.status === 401) { tok = null; return api(clientId, url, opts); }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error?.message || `Google Drive error (HTTP ${r.status})`);
  }
  return r;
}

async function findFile(clientId) {
  if (fileId) return fileId;
  const q = encodeURIComponent(`name='${FILE}'`);
  const r = await api(clientId, `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`);
  fileId = (await r.json()).files?.[0]?.id || null;
  return fileId;
}

export function webDrive(clientId) {
  return {
    async pull() {
      const id = await findFile(clientId);
      if (!id) return null;
      return (await api(clientId, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).text();
    },
    async push(text) {
      const id = await findFile(clientId);
      if (id) {
        await api(clientId, `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text });
        return true;
      }
      const meta = new Blob([JSON.stringify({ name: FILE, parents: ['appDataFolder'] })], { type: 'application/json' });
      const form = new FormData();
      form.append('metadata', meta);
      form.append('file', new Blob([text], { type: 'application/json' }));
      const r = await api(clientId, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', body: form });
      fileId = (await r.json()).id;
      return true;
    },
    async listSnapshots() {
      const q = encodeURIComponent("name contains 'finance-helper-2'");
      const r = await api(clientId, `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name,size)&pageSize=200`);
      return ((await r.json()).files || []).sort((a, b) => b.name.localeCompare(a.name));
    },
    async putSnapshot(name, text) {
      const existing = (await this.listSnapshots()).find((f) => f.name === name);
      if (existing) {
        await api(clientId, `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text });
        return true;
      }
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify({ name, parents: ['appDataFolder'] })], { type: 'application/json' }));
      form.append('file', new Blob([text], { type: 'application/json' }));
      await api(clientId, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', body: form });
      return true;
    },
    readSnapshot: async (id) => (await api(clientId, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).text(),
    deleteSnapshot: async (id) => { await api(clientId, `https://www.googleapis.com/drive/v3/files/${id}`, { method: 'DELETE' }); return true; },
    async disconnect() {
      if (tok && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(tok.token, () => {});
      tok = null;
      fileId = null;
      return true;
    },
  };
}
