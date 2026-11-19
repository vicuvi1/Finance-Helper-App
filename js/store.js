// Saves everything on this device. Nothing is sent anywhere from here; sync
// and backups take copies.
//
// Where: IndexedDB, through one store that answers from memory like
// localStorage did (js/bigstore.js, `deviceStorage()` below). localStorage
// holds about 5 million characters, which was the limit for Money at about
// 20,000 records. Inside Life System the frame uses its parent's store, so
// both see a save at once. The data leaves localStorage only after it was
// written to IndexedDB and read back the same (`storeReady()`, which app.js
// awaits before the first load()); if IndexedDB is not there, everything
// stays in localStorage as before. Small things stay in localStorage:
//   finance-helper.head   (below)
//   finance-helper.paint  the theme, for the first paint (index.html)
//   finance-helper.store  the mark that this Money has started here
//
// With "Encrypt my data" on, the data is kept only as an AES-GCM box made
// with a key from your PIN (js/cipher.js):
//   finance-helper.enc   the sealed data
//   finance-helper.head  what is needed before unlocking (PIN hash, lock
//                        timing, theme, the key's salt); no money, no notes
// Until the PIN is entered, load() returns an empty placeholder that save()
// never writes over the real data.

import { normalizeState, defaultState } from './model.js';
import { deriveKey, seal, open, openWithPin, newSalt, isSealed } from './cipher.js';
import { demoFinanceState } from './seedFinance.js';
import { createBigStore, moneyMerge, CHANNEL, MONEY_MARK as MARK } from './bigstore.js';
import { mergeLocal } from './sync.js';

// Nothing here writes to the Life System database: Life's own sync
// (src/renderer/src/web/appSync.ts, settings.app_sync_finance) copies the
// data. Older versions also wrote the whole state to finance_backup_json on
// every save; Life still reads that old key once on a new device.

const KEY = 'finance-helper.state';
const ENC = 'finance-helper.enc';
const HEAD = 'finance-helper.head';
const PAINT = 'finance-helper.paint';
export const STORAGE_KEYS = { KEY, ENC, HEAD, PAINT };

// ---------- Where the data is kept ----------

let device; // this window's store (a Storage); undefined until first asked for

// The store Money saves to: Life System's (when Money runs in its frame), else
// this window's own over the same IndexedDB. Null where there is no storage.
export function deviceStorage() {
  if (device !== undefined) return device;
  const g = globalThis;
  let ls = null;
  try { ls = g.localStorage ?? null; } catch { ls = null; }
  if (!ls) return (device = null);
  try {
    if (g.parent && g.parent !== g) {
      const host = g.parent.__lifeStore;
      if (host?.forWindow) return (device = host.forWindow(g));
      // Inside a Life System page of an older version (a tab left open over an update): it reads Money
      // from localStorage, so nothing may move while it runs. Unless Money has moved already; then it is
      // read where it is.
      if (g.parent.location.origin === g.location.origin && ls.getItem(MARK) !== 'idb') return (device = ls);
    }
  } catch { /* another site's frame: our own store */ }
  try {
    let channel = null;
    try { channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null; } catch { channel = null; }
    const root = createBigStore({ local: ls, channel, merge: moneyMerge(mergeLocal, normalizeState), onError: (m) => console.warn('[storage]', m) });
    device = typeof g.addEventListener === 'function' ? root.forWindow(g) : root;
    g.__lifeStore = device; // for the smoke test, and for looking at it by hand
  } catch {
    device = ls;
  }
  return device;
}

// Call (and await) once before the first load(): opens the store, and moves
// the data out of localStorage (checked before the old copy goes). Never
// throws; with no IndexedDB the data simply stays where it was.
export async function storeReady() {
  const s = deviceStorage();
  try { await s?.moveIn?.(); } catch { /* localStorage, as before */ }
  return storageInfo();
}

// Where the data is kept now, for "Check everything".
export function storageInfo(storage = deviceStorage()) {
  let st = null;
  try { st = storage?.status?.() ?? null; } catch { st = null; }
  const key = isEncrypted(storage) ? ENC : KEY;
  const where = st?.keys?.find((k) => k.key === key)?.where ?? 'localStorage';
  return { where, error: st?.error ?? null };
}

// A write that could not be stored anywhere is said out loud (the toast in app.js).
function watch(storage) {
  const f = storage?.flush;
  if (typeof f === 'function') f.call(storage).catch((e) => failed(e));
}

// The theme, where the page can read it before anything else has loaded.
let painted = null;
function paint(state, storage) {
  try {
    const text = JSON.stringify({ theme: state?.settings?.theme || '', themeInLife: state?.settings?.themeInLife || '' });
    if (text === painted) return;
    painted = text;
    if (storage?.getItem(PAINT) !== text) storage?.setItem(PAINT, text);
  } catch { /* only the first paint's colours */ }
}

// Lock fields that live in the header so the lock screen works before unlock.
const HEAD_META = ['lock', 'lockAfter', 'lockFails', 'lockUntil', 'lockHint'];

// While unlocked: the key for this device's data, and the PIN (to open
// sync copies and backups sealed on other devices with their own salt).
let session = null; // { key, salt, iter, pin }
let queue = Promise.resolve();
const keyCache = new Map();

const readHead = (storage) => {
  try { return JSON.parse(storage?.getItem(HEAD) || 'null'); } catch { return null; }
};

export const isEncrypted = (storage = deviceStorage()) => !!readHead(storage)?.enc;
export const isPlaceholder = (state) => !!state?._sealed;
export const hasSession = () => !!session;

function fresh() {
  const s = defaultState();
  s.meta.createdAt = Date.now();
  return s;
}

export function load(storage = deviceStorage()) {
  const head = readHead(storage);
  const encBox = storage?.getItem(ENC);
  if (head?.enc && encBox) {
    const s = fresh();
    Object.assign(s.meta, head.meta || {});
    if (head.theme) s.settings.theme = head.theme;
    s._sealed = true;
    return s;
  }
  let raw = null;
  try { raw = storage?.getItem(KEY) ?? null; } catch {}
  const pick = initialSource(raw, { demo: globalThis.FH_DEMO === true });
  if (pick === 'stored') {
    try {
      const state = normalizeState(JSON.parse(raw));
      paint(state, storage);
      return state;
    } catch {}
  }
  // The example data is shown, never saved here: the first real save
  // replaces it, and it never reaches the Life System database.
  if (pick === 'demo') return normalizeState(demoFinanceState());
  return fresh();
}

// What load() starts from. Whatever this device has saved always wins (even
// a short list: records are deleted by removing them, so "fewer records"
// is real data, not a reason to bring old data back). The example data is
// only for the demo preview on a device with nothing saved.
export function initialSource(raw, { demo = false } = {}) {
  if (raw != null && raw !== '') {
    try { if (JSON.parse(raw)) return 'stored'; } catch {}
  }
  return demo ? 'demo' : 'fresh';
}

function headerOf(state, enc) {
  const meta = {};
  for (const k of HEAD_META) if (state.meta[k] != null) meta[k] = state.meta[k];
  return JSON.stringify({ v: 1, enc, theme: state.settings?.theme || '', meta });
}

function failed(e) {
  console.error('Save failed', e);
  globalThis.dispatchEvent?.(new Event('fh-save-failed'));
}

export function save(state, storage = deviceStorage()) {
  // A direct save is the newest copy: a waiting (debounced) one must not land after it.
  cancelPending();
  try {
    const head = readHead(storage);
    if (!head?.enc) {
      if (isPlaceholder(state)) return false;
      storage?.setItem(KEY, JSON.stringify(state));
      paint(state, storage);
      watch(storage);
      return true;
    }
    storage.setItem(HEAD, headerOf(state, head.enc));
    if (isPlaceholder(state)) return true; // only the lock fields changed
    paint(state, storage);
    if (!session) return false;
    const text = JSON.stringify(state);
    const { key, salt, iter } = session;
    queue = queue.then(async () => { storage.setItem(ENC, JSON.stringify(await seal(text, key, salt, iter))); await storage.flush?.(); }).catch(failed);
    return true;
  } catch {
    return false;
  }
}

// ---------- Saving soon (debounced) ----------
// With thousands of records, writing the whole state on every tap is slow and
// makes Life System's sync re-merge it each time. saveSoon() keeps only the
// latest state and writes it once things are quiet for SAVE_DELAY ms (one
// write for a burst of changes). The write is the same full, plain save(), so
// Life System's sync (appSync.ts) sees exactly what it saw before, only less
// often. flushSave() writes a waiting save now: on leaving the page, before
// reading the stored copy back, and before encryption or a reset.

export const SAVE_DELAY = 400;
let pending = null; // { state, storage }
let timer = null;
const savedHooks = new Set();

function cancelPending() {
  pending = null;
  if (timer) { clearTimeout(timer); timer = null; }
}

// Called after each debounced write lands, with whether it worked.
export function onSaved(fn) {
  savedHooks.add(fn);
  return () => savedHooks.delete(fn);
}

export const hasPendingSave = () => !!pending;

export function saveSoon(state, storage = deviceStorage(), delay = SAVE_DELAY) {
  if (isPlaceholder(state) && !readHead(storage)?.enc) return false;
  pending = { state, storage };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; flushSave(); }, delay);
  return true;
}

// Writes the waiting save now (if any). Returns whether it worked (true when nothing waited).
export function flushSave() {
  if (!pending) return true;
  const { state, storage } = pending;
  const ok = save(state, storage); // clears `pending`
  for (const fn of savedHooks) { try { fn(ok); } catch {} }
  return ok;
}

// Resolves once every waiting and queued write is on disk (a write that could
// not be stored was already said out loud, so this never throws).
export const flush = () => { flushSave(); return queue.then(() => deviceStorage()?.flush?.()).catch(() => {}); };

async function keyFor(pin, salt, iter) {
  const id = `${salt}|${iter}|${pin}`;
  if (!keyCache.has(id)) keyCache.set(id, deriveKey(pin, salt, iter));
  return keyCache.get(id);
}

// Opens this device's encrypted data. Throws on a wrong PIN.
export async function unlockStore(pin, storage = deviceStorage()) {
  const head = readHead(storage);
  if (!head?.enc) throw new Error('The data on this device is not encrypted.');
  const box = JSON.parse(storage.getItem(ENC) || 'null');
  if (!isSealed(box)) throw new Error('The encrypted data is missing on this device.');
  const key = await keyFor(pin, head.enc.salt, head.enc.iter);
  const state = normalizeState(JSON.parse(await open(box, key)));
  Object.assign(state.meta, head.meta || {});
  session = { key, salt: head.enc.salt, iter: head.enc.iter, pin: String(pin) };
  return state;
}

// Another window saved the encrypted data: read it again with our key.
export async function reopen(storage = deviceStorage()) {
  if (!session) return null;
  const state = normalizeState(JSON.parse(await open(JSON.parse(storage.getItem(ENC)), session.key)));
  Object.assign(state.meta, readHead(storage)?.meta || {});
  return state;
}

// On lock: forget the key and PIN (the data stays sealed on disk).
export async function lockStore() {
  await flush();
  session = null;
  keyCache.clear();
}

// Turns encryption on (or re-keys it with a new PIN): seals the data with a
// fresh salt, then removes the readable copy.
export async function enableEncryption(state, pin, { storage = deviceStorage(), iter = 310000 } = {}) {
  await flush();
  const salt = newSalt();
  const key = await keyFor(pin, salt, iter);
  const box = await seal(JSON.stringify(state), key, salt, iter);
  storage.setItem(ENC, JSON.stringify(box));
  await storage.flush?.(); // the sealed copy is on disk before the readable one goes
  storage.setItem(HEAD, headerOf(state, { salt, iter }));
  storage.removeItem(KEY);
  session = { key, salt, iter, pin: String(pin) };
  // Read it back before trusting it.
  const check = JSON.parse(await open(JSON.parse(storage.getItem(ENC)), key));
  if (!Array.isArray(check.tx) || check.tx.length !== state.tx.length) throw new Error('Encryption check failed; nothing was changed.');
}

export async function disableEncryption(state, storage = deviceStorage()) {
  await flush();
  storage.setItem(KEY, JSON.stringify(state));
  await storage.flush?.(); // the readable copy is on disk before the sealed one goes
  storage.removeItem(ENC);
  storage.removeItem(HEAD);
  session = null;
  keyCache.clear();
}

// "Reset this device": every stored copy goes.
export function wipeStore(storage = deviceStorage()) {
  cancelPending();
  session = null;
  keyCache.clear();
  painted = null;
  for (const k of [KEY, ENC, HEAD, PAINT]) storage?.removeItem(k);
}

// Text for a sync copy or a backup: sealed when encryption is on.
export async function sealForExport(text) {
  if (!session) return text;
  const { key, salt, iter } = session;
  return JSON.stringify({ app: 'finance-helper', exportedAt: new Date().toISOString(), ...(await seal(text, key, salt, iter)) });
}

// Opens a sealed sync copy or backup with the PIN in use (or one given).
export async function openImported(box, pin = session?.pin) {
  if (!pin) throw new Error('This file is encrypted. Enter the PIN it was made with.');
  if (session && box.salt === session.salt && (box.iter || 310000) === session.iter) return open(box, session.key);
  return open(box, await keyFor(pin, box.salt, box.iter || 310000));
}

export { isSealed, openWithPin };

export function backupJSON(state) {
  return JSON.stringify({ app: 'finance-helper', exportedAt: new Date().toISOString(), ...state }, null, 1);
}

// Backup text for files, Drive snapshots and the backup history.
export const backupText = (state) => (session ? sealForExport(JSON.stringify(state)) : Promise.resolve(backupJSON(state)));

// Accepts a backup file; throws a readable error if it isn't one.
export function restoreJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not a Finance Helper backup (not JSON).');
  }
  if (!data || !Array.isArray(data.tx) || !data.settings) {
    throw new Error('This file is not a Finance Helper backup.');
  }
  return normalizeState(data);
}

// Ask the browser not to evict our data when the phone runs low on space.
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // Not supported; nothing to do.
  }
}
