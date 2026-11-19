// Change history (#15): where the log lives on this device, and the hooks
// app.js calls on each save. Pure rules are in js/changelog.js.
//
// IndexedDB (not localStorage: Life System shares that space and must never
// run out of it). With "Encrypt my data" on, the log is sealed with the same
// key as the data (store.js sealForExport); while locked nothing is read or
// written. When this device has no Money data at all (erased, reset) the log
// goes too. A storage that fails only means a shorter history: it never
// stops a save.

import { createTracker, mergeLogs, prune } from './changelog.js';
import { isEncrypted, sealForExport, openImported, isSealed, deviceStorage, STORAGE_KEYS } from './store.js';

const DB = 'finance-helper-changes';
const STORE = 'kv';
const KEY = 'log';
const WRITE_DELAY = 800;

let memory = []; // newest first
let loaded = false;
let loading = null;
let timer = null;
let disabled = globalThis.FH_DEMO === true; // the demo preview keeps nothing
const listeners = new Set();
const tracker = createTracker();

// ---------- Backend (IndexedDB; tests pass their own) ----------

function idbBackend() {
  const idb = globalThis.indexedDB;
  if (!idb) return null;
  const open = () => new Promise((res, rej) => {
    const r = idb.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const run = (mode, fn) => open().then((db) => new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); res(req?.result); };
    tx.onerror = () => { db.close(); rej(tx.error); };
  }));
  return {
    get: () => run('readonly', (s) => s.get(KEY)),
    set: (v) => run('readwrite', (s) => s.put(v, KEY)),
    clear: () => run('readwrite', (s) => s.delete(KEY)),
  };
}

let backend = null;
const be = () => (backend ??= idbBackend());

/** Tests: a backend `{ get, set, clear }` (all async) and a fresh start. */
export function _setBackend(b, { demo = false } = {}) {
  backend = b;
  memory = [];
  loaded = false;
  loading = null;
  disabled = demo;
  if (timer) { clearTimeout(timer); timer = null; }
}

const noMoneyHere = () => {
  try {
    const ls = deviceStorage();
    return !!ls && !ls.getItem(STORAGE_KEYS.KEY) && !ls.getItem(STORAGE_KEYS.ENC);
  } catch { return false; }
};

async function readStored() {
  const b = be();
  if (!b || disabled) return [];
  const raw = await b.get();
  if (raw == null || raw === '') return [];
  let data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (isSealed(data)) data = JSON.parse(await openImported(data));
  return Array.isArray(data) ? data : [];
}

/** Reads the stored log once (after unlock when the data is encrypted). */
export function ensureLoaded() {
  if (loaded) return Promise.resolve(memory);
  if (loading) return loading;
  loading = (async () => {
    try {
      if (noMoneyHere()) await be()?.clear?.();
      else memory = mergeLogs(memory, await readStored());
      loaded = true;
    } catch {
      // Locked, or a copy sealed with another PIN: keep this session's entries; try again later.
    } finally {
      loading = null;
    }
    notify();
    return memory;
  })();
  return loading;
}

async function writeNow() {
  timer = null;
  const b = be();
  if (!b || disabled) return;
  await ensureLoaded();
  if (!loaded) return; // could not read the stored copy: never write over it
  try {
    memory = mergeLogs(memory, await readStored().catch(() => []));
    const text = JSON.stringify(memory);
    await b.set(isEncrypted() ? await sealForExport(text) : text);
  } catch { /* a full or blocked storage: the history stays in memory for this session */ }
}

function writeSoon() {
  if (disabled) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { writeNow(); }, WRITE_DELAY);
}

/** Writes now (tests, leaving the page). */
export const flushChanges = () => { if (timer) { clearTimeout(timer); return writeNow(); } return Promise.resolve(); };

// Told after the current save is done (never in the middle of one).
let notifyQueued = false;
function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  setTimeout(() => { notifyQueued = false; for (const fn of listeners) { try { fn(); } catch {} } }, 0);
}
export function onChanges(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ---------- Hooks app.js calls ----------

/** Start over from this data without logging (start, lock, unlock). */
export function reset(state) {
  tracker.reset(state);
  if (state && !state._sealed && !loaded) ensureLoaded();
}

/** After a save: log what changed. `mode`: 'local' (you), 'quiet' (automatic), 'sync' (another device), 'undo', 'redo'. */
export function track(state, mode = 'local') {
  let added = [];
  try { added = tracker.observe(state, mode); } catch { return []; }
  if (!added.length) return added;
  memory = prune([...added, ...memory]);
  notify();
  writeSoon();
  return added;
}

/** The coming save is a Put back (logged as one, linked to the entry). */
export const expectPutBack = (of, label) => tracker.expect({ mode: 'putback', of, label });

/** The log, newest first. */
export const entries = () => memory;
export const isLoaded = () => loaded;
export const device = () => tracker.dev;

if (typeof window !== 'undefined') {
  for (const ev of ['pagehide', 'beforeunload']) window.addEventListener(ev, () => { flushChanges(); });
}

/** This device's name in the log ('desktop', 'web' or 'phone'). */
export const thisDevice = tracker.dev;
/** The coming save is an undo or redo of the action whose first entry is `of`. */
export const expectRevert = (of) => tracker.expect({ of });
