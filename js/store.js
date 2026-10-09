// Saves everything on this device (localStorage). Nothing is sent anywhere
// from here; sync and backups take copies.
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

const KEY = 'finance-helper.state';
const ENC = 'finance-helper.enc';
const HEAD = 'finance-helper.head';
export const STORAGE_KEYS = { KEY, ENC, HEAD };

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

export const isEncrypted = (storage = globalThis.localStorage) => !!readHead(storage)?.enc;
export const isPlaceholder = (state) => !!state?._sealed;
export const hasSession = () => !!session;

function fresh() {
  const s = defaultState();
  s.meta.createdAt = Date.now();
  return s;
}

export function load(storage = globalThis.localStorage) {
  const head = readHead(storage);
  if (head?.enc) {
    const s = fresh();
    Object.assign(s.meta, head.meta || {});
    if (head.theme) s.settings.theme = head.theme;
    s._sealed = true;
    return s;
  }
  try {
    const raw = storage?.getItem(KEY);
    if (raw) return normalizeState(JSON.parse(raw));
  } catch {
    // Corrupt or blocked storage: start clean rather than crash.
  }
  return fresh();
}

function headerOf(state, enc) {
  const meta = {};
  for (const k of HEAD_META) if (state.meta[k] != null) meta[k] = state.meta[k];
  return JSON.stringify({ v: 1, enc, theme: state.settings?.theme || '', meta });
}

function failed(e) {
  console.error('Encrypted save failed', e);
  globalThis.dispatchEvent?.(new Event('fh-save-failed'));
}

export function save(state, storage = globalThis.localStorage) {
  try {
    const head = readHead(storage);
    if (!head?.enc) {
      if (isPlaceholder(state)) return false;
      storage?.setItem(KEY, JSON.stringify(state));
      return true;
    }
    storage.setItem(HEAD, headerOf(state, head.enc));
    if (isPlaceholder(state)) return true; // only the lock fields changed
    if (!session) return false;
    const text = JSON.stringify(state);
    const { key, salt, iter } = session;
    queue = queue.then(async () => storage.setItem(ENC, JSON.stringify(await seal(text, key, salt, iter)))).catch(failed);
    return true;
  } catch {
    return false;
  }
}

// Resolves once every queued encrypted write is on disk.
export const flush = () => queue;

async function keyFor(pin, salt, iter) {
  const id = `${salt}|${iter}|${pin}`;
  if (!keyCache.has(id)) keyCache.set(id, deriveKey(pin, salt, iter));
  return keyCache.get(id);
}

// Opens this device's encrypted data. Throws on a wrong PIN.
export async function unlockStore(pin, storage = globalThis.localStorage) {
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
export async function reopen(storage = globalThis.localStorage) {
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
export async function enableEncryption(state, pin, { storage = globalThis.localStorage, iter = 310000 } = {}) {
  await flush();
  const salt = newSalt();
  const key = await keyFor(pin, salt, iter);
  const box = await seal(JSON.stringify(state), key, salt, iter);
  storage.setItem(ENC, JSON.stringify(box));
  storage.setItem(HEAD, headerOf(state, { salt, iter }));
  storage.removeItem(KEY);
  session = { key, salt, iter, pin: String(pin) };
  // Read it back before trusting it.
  const check = JSON.parse(await open(JSON.parse(storage.getItem(ENC)), key));
  if (!Array.isArray(check.tx) || check.tx.length !== state.tx.length) throw new Error('Encryption check failed; nothing was changed.');
}

export async function disableEncryption(state, storage = globalThis.localStorage) {
  await flush();
  storage.setItem(KEY, JSON.stringify(state));
  storage.removeItem(ENC);
  storage.removeItem(HEAD);
  session = null;
  keyCache.clear();
}

// "Reset this device": every stored copy goes.
export function wipeStore(storage = globalThis.localStorage) {
  session = null;
  keyCache.clear();
  for (const k of [KEY, ENC, HEAD]) storage?.removeItem(k);
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
