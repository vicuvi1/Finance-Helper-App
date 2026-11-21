// Cloud sync with your own server (the Vercel project, api/money.mjs): sign in
// with the server PIN, then this device's Money and the server's copy are
// merged by the app's own rules (js/sync.js: the newer edit of each record
// wins, deletions stick, nothing else is removed). The web app and the desktop
// app use the same server, so both stay in step.
//
// How a round goes (sync()):
//  1. Read the server's copy (a big one as a manifest whose pieces this device
//     fetches; pieces it already holds are not downloaded again).
//  2. A copy marked as a restore this device hasn't taken yet replaces the
//     shared data here (a backup is taken first).
//  3. Merge it into this device's data. If the server lacks anything (an edit
//     here, a record only here), send this device's whole shared copy; the
//     server merges again (another device may have written meanwhile) and
//     answers with what it now holds: then this device is "synced" (confirmed).
//  4. Many edits while offline or busy are one send (the outbox is "this
//     device changed since it last agreed", not a list of changes).
// A missing piece on the server is put back from this device's copy (heal).
// Pure apart from the injected `transport`, `store` and app hooks; tested in
// tests/cloud.test.js against the real server code and a local database.

import { mergeStates, toCloud } from './sync.js';
import { normalizeState, SCHEMA_VERSION } from './model.js';
import { WHOLE_UP_TO, assemble, canonical, looksLikeManifest, manifestOf, parseManifest, splitText, hash64 } from './parts.js';

export const CLOUD_KEY = 'finance-helper.cloud';
export const DEFAULT_URL = 'https://mega-system-ten.vercel.app';
const UPLOAD_CHARS = 1_500_000;
const RENEW_BEFORE = 7 * 86400_000;

const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
export const share = (state) => toCloud(normalizeState({ ...state, version: SCHEMA_VERSION }), '').data;
const remote = (data) => ({ app: 'finance-helper', schema: SCHEMA_VERSION, savedAt: 0, data });

/** A session's expiry (ms) from its signed payload, or 0. */
export function sessionExpiry(token) {
  try {
    const data = String(token || '').split('.')[0];
    const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString();
    return Number(JSON.parse(json).exp) || 0;
  } catch { return 0; }
}

/** Plain-English words for what went wrong. */
export function cloudError(status, body) {
  const msg = body?.error || '';
  if (status === 401) return 'Signed out on the server: sign in again with your PIN.';
  if (status === 429) return msg || 'Too many PIN tries. Wait a little and try again.';
  if (status === 404) return 'This server has no Money sync yet. Check the server address in Settings.';
  if (status === 503 || status === 502 || status === 500) return 'The server or its database is not reachable right now. Your data is safe here; it will try again.';
  if (status === 0) return 'No connection. Your changes stay here and are sent when you are online.';
  return msg || `The server answered ${status}.`;
}

/**
 * The short line under the app's name: is this device in step with the server?
 * {text, tone: 'ok'|'busy'|'warn'|'bad'|'off', act} where act is what a click does
 * ('cloud-signin' | 'cloud-sync' | '').
 */
export function syncSummary({ server = true, signedIn = false, busy = false, state = '', dirty = false, okAt = 0, online = true, now = Date.now() } = {}) {
  if (!server) return { text: 'On this device only', tone: 'off', act: '' };
  if (!signedIn) return { text: 'Not synced · Sign in', tone: 'warn', act: 'cloud-signin' };
  if (busy) return { text: 'Syncing…', tone: 'busy', act: '' };
  if (!online) return { text: dirty ? 'Offline · changes wait' : 'Offline', tone: 'warn', act: 'cloud-sync' };
  if (state === 'signedout') return { text: 'Signed out · Sign in', tone: 'bad', act: 'cloud-signin' };
  if (state === 'error') return { text: 'Sync problem · Retry', tone: 'bad', act: 'cloud-sync' };
  if (state === 'skipped') return { text: 'Locked · not syncing', tone: 'warn', act: '' };
  if (dirty) return { text: 'Sending changes…', tone: 'busy', act: 'cloud-sync' };
  if (!okAt) return { text: 'Not synced yet · Sync', tone: 'warn', act: 'cloud-sync' };
  const s = Math.max(0, Math.round((now - okAt) / 1000));
  const when = s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
  return { text: `Synced ${when}`, tone: s < 3600 ? 'ok' : 'warn', act: 'cloud-sync' };
}

/**
 * The sync engine. `transport(path, body, token)` → {status, json};
 * `store`: getItem/setItem (device-only settings); `app`: {getState(), setState(next),
 * backup(label)?, locked()?}.
 */
export function createCloud({ transport, store, app, now = () => Date.now() }) {
  const cache = new Map(); // piece id → text (this session)
  const listeners = new Set();
  let cfg = { url: '', session: '', seen: 0, restore: '', dirtyAt: 0, okAt: 0, ...(parse(store.getItem(CLOUD_KEY)) || {}) };
  const status = { state: cfg.session ? 'idle' : 'signedout', error: '', note: '', busy: false, okAt: cfg.okAt || 0, sent: 0, got: 0 };
  let lastText = null; // the server value's whole text, as last read or written (for heal)
  let running = null;

  const save = () => { try { store.setItem(CLOUD_KEY, JSON.stringify(cfg)); } catch { /* private window */ } };
  const emit = () => { for (const fn of listeners) { try { fn({ ...status }); } catch { /* ignore */ } } };
  const set = (patch) => { Object.assign(status, patch); emit(); };
  const keep = (text) => { for (const t of splitText(text)) cache.set(hash64(t), t); };

  async function call(path, body, token = cfg.session) {
    let r;
    try { r = await transport(path, body, token); } catch { r = { status: 0, json: null }; }
    if (r.status === 200) return r.json;
    if (r.status === 401 && path === '/api/money') { cfg.session = ''; save(); }
    const err = new Error(cloudError(r.status, r.json));
    err.status = r.status;
    err.body = r.json;
    throw err;
  }
  const money = (body) => call('/api/money', body);

  /** The whole text of a stored value (`raw`: a manifest or the text). */
  async function textOf(raw, sliced, len) {
    if (sliced) {
      let out = '';
      while (out.length < len) {
        const r = await money({ op: 'read', from: out.length });
        if (!r.slice) break;
        out += r.slice;
      }
      return out;
    }
    const m = parseManifest(raw);
    if (!m) return raw;
    const want = m.p.filter((id) => !cache.has(id));
    for (let i = 0; i < want.length;) {
      const ids = want.slice(i, i + 200);
      const r = await money({ op: 'parts', ids });
      const got = Object.keys(r.parts || {});
      for (const id of got) cache.set(id, r.parts[id]);
      if (!got.length) break; // missing on the server
      i += got.length;
    }
    return assemble(m, (id) => cache.get(id));
  }

  /** Reads the server's copy: {raw, value, sealed}. Puts back lost pieces when this device can. */
  async function readServer(check = false) {
    const r = await money({ op: 'read' });
    if (r.raw == null && !r.sliced) return { raw: null, value: null, sealed: !!r.sealed };
    try {
      const text = await textOf(r.raw, r.sliced, r.len);
      lastText = text;
      // A check (first round, "Sync now"): pieces this device had in memory may be gone on the server.
      const m = check ? parseManifest(r.raw) : null;
      if (m) {
        const ids = [...new Set(m.p)];
        const have = new Set();
        for (let i = 0; i < ids.length; i += 1000) for (const id of (await money({ op: 'has', ids: ids.slice(i, i + 1000) })).have || []) have.add(id);
        if (ids.some((id) => !have.has(id))) await money({ op: 'heal', text });
      }
      return { raw: r.raw, value: parse(text), sealed: !!r.sealed };
    } catch (e) {
      // A piece is missing on the server: heal it from the copy this device last agreed on, then read again.
      if (lastText && looksLikeManifest(r.raw) && manifestOf('app_sync_finance', lastText).manifest === r.raw) {
        await money({ op: 'heal', text: lastText });
        return readServer();
      }
      throw new Error(`The server's copy of Money is damaged (${e.message}). Nothing was changed; sync from a device that has it.`);
    }
  }

  async function push(data, edited) {
    const text = JSON.stringify(data);
    let body;
    if (text.length > WHOLE_UP_TO) {
      const enc = manifestOf('app_sync_finance', text);
      for (const p of enc.parts) cache.set(p.id, p.text);
      const ids = [...new Set(enc.parts.map((p) => p.id))];
      const have = new Set();
      for (let i = 0; i < ids.length; i += 1000) for (const id of (await money({ op: 'has', ids: ids.slice(i, i + 1000) })).have || []) have.add(id);
      let batch = [];
      let size = 0;
      const flush = async () => { if (batch.length) await money({ op: 'upload', parts: batch }); batch = []; size = 0; };
      for (const id of ids) {
        if (have.has(id)) continue;
        const t = cache.get(id);
        if (batch.length && size + t.length > UPLOAD_CHARS) await flush();
        batch.push({ id, text: t });
        size += t.length;
      }
      await flush();
      body = { op: 'push', manifest: enc.manifest };
    } else body = { op: 'push', text };
    return money({ ...body, edited, editedAt: cfg.dirtyAt || 0 });
  }

  async function renewIfDue() {
    const exp = sessionExpiry(cfg.session);
    if (!exp || exp - now() > RENEW_BEFORE) return;
    try {
      const r = await call('/api/login', { renew: cfg.session });
      if (r?.session) { cfg.session = r.session; save(); }
    } catch { /* the next round tries again */ }
  }

  let checked = false;
  async function round({ check = false } = {}) {
    if (!cfg.session) { set({ state: 'signedout', busy: false }); return { ok: false, skipped: 'signed out' }; }
    if (app.locked?.()) { set({ state: 'skipped', note: 'Money is locked on this device: unlock it to sync.', busy: false }); return { ok: false, skipped: 'locked' }; }
    set({ busy: true, error: '' });
    try {
      await renewIfDue();
      const startState = app.getState();
      const edited = !!cfg.dirtyAt;
      const srv = await readServer(check || !checked);
      checked = true;
      let local = startState;
      let got = 0;
      // A restore made elsewhere: this device takes that copy as it is (its own device settings stay).
      if (srv.value?.restore && srv.value.restore !== cfg.restore) {
        await app.backup?.('Before taking a restore from the server');
        const own = {};
        for (const k of ['theme', 'themeMotion', 'logView']) if (local.settings && k in local.settings) own[k] = local.settings[k];
        const { lastRates: _r, settings, ...rest } = srv.value.data || {};
        local = normalizeState({ ...local, ...rest, settings: { ...(settings || {}), ...own }, version: SCHEMA_VERSION });
        cfg.restore = srv.value.restore;
        got = (rest.tx || []).length;
      }
      let merged = srv.value?.data ? mergeStates(local, remote(srv.value.data)).state : local;
      const mine = share(merged);
      let sent = 0;
      let raw = srv.raw;
      let editedAt = Number(srv.value?.editedAt ?? srv.value?.savedAt) || 0;
      const lacks = !srv.value?.data || canonical(mine) !== canonical(srv.value.data);
      if (lacks) {
        const r = await push(mine, edited);
        raw = r.raw;
        editedAt = r.editedAt;
        sent = srv.value?.data ? Math.max(0, mine.tx.length - srv.value.data.tx.length) : mine.tx.length;
        if (r.changed) {
          // The server merged with what another device sent meanwhile: take that too.
          const text = await textOf(raw);
          lastText = text;
          const after = parse(text);
          if (after?.data) merged = mergeStates(merged, remote(after.data)).state;
        }
      }
      if (app.getState() !== startState) {
        // Money changed here while this ran: never overwrite that edit; the next round merges it.
        set({ busy: false, state: 'waiting' });
        return { ok: true, again: true };
      }
      if (JSON.stringify(merged) !== JSON.stringify(startState)) {
        got = got || Math.max(0, (merged.tx || []).length - (startState.tx || []).length);
        app.setState(merged);
      }
      cfg.seen = editedAt;
      cfg.dirtyAt = 0;
      cfg.okAt = now();
      cfg.raw = typeof raw === 'string' && raw.length < 4000 ? raw : '';
      save();
      set({ state: 'ok', busy: false, okAt: cfg.okAt, sent, got, error: '', note: srv.sealed ? 'Life System also keeps a PIN-locked copy of Money; this app syncs the plain copy.' : '' });
      return { ok: true, sent, got, confirmed: true };
    } catch (e) {
      const signedOut = e.status === 401;
      set({ busy: false, state: signedOut ? 'signedout' : 'error', error: e.message });
      return { ok: false, error: e.message };
    }
  }

  return {
    get config() { return { url: cfg.url, signedIn: !!cfg.session, okAt: cfg.okAt, dirty: !!cfg.dirtyAt }; },
    get status() { return { ...status }; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setUrl(url) { cfg.url = String(url || '').trim().replace(/\/+$/, ''); save(); },
    /** This device changed Money (an edit, an import…): the next round sends it. */
    changed() { if (!cfg.dirtyAt) cfg.dirtyAt = Math.max(now(), (Number(cfg.seen) || 0) + 1); else cfg.dirtyAt = Math.max(now(), cfg.dirtyAt); save(); },
    async signIn(pin, { setupKey = '' } = {}) {
      // With the server's setup key: a new PIN (the first one, or a reset when it was forgotten).
      const body = setupKey ? { reset: setupKey, pin: String(pin) } : { pin: String(pin), ...(cfg.session ? { prev: cfg.session } : {}) };
      let r;
      try { r = await call('/api/login', body, ''); } catch (e) {
        if (e.status === 401) throw new Error(setupKey ? 'Wrong setup key. Copy CRON_SECRET from Vercel → your project → Settings → Environment Variables.' : 'Wrong PIN. Forgot it? Open "Forgot your PIN?" below.');
        if (e.status === 409 && e.body?.setup) throw new Error('No PIN is set on this server yet. Open "Forgot your PIN?" below and set one with the server setup key.');
        throw e;
      }
      cfg.session = r.session;
      // A first sign-in sends everything here (a merge: nothing on the server is removed).
      cfg.dirtyAt = cfg.dirtyAt || now();
      save();
      set({ state: 'idle', error: '' });
      return true;
    },
    signOut() { cfg.session = ''; save(); set({ state: 'signedout', error: '' }); },
    /** A new server PIN (needs the current one); this device stays signed in. */
    async changePin(current, next) {
      let r;
      try { r = await call('/api/login', { changePin: cfg.session, current: String(current), pin: String(next) }, ''); } catch (e) {
        if (e.status === 403) throw new Error('The current PIN is wrong.');
        throw e;
      }
      if (r?.session) { cfg.session = r.session; save(); }
      return true;
    },
    /** The devices signed in to the server, and which one is this. */
    devices() { return call('/api/login', { devices: cfg.session }, ''); },
    /** Signs one device out (it must enter the PIN again). */
    revokeDevice(sid) { return call('/api/login', { revokeDevice: sid, session: cfg.session }, ''); },
    /** Another server call with this device's session (e.g. /api/telegram). Throws a plain-English error. */
    api(path, body) { return call(path, body); },
    /** One round (a running one is joined). */
    sync(opts) {
      if (!running) running = round(opts).finally(() => { running = null; });
      return running;
    },
  };
}
