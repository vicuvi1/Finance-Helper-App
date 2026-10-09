// Saves everything in this browser (localStorage). Nothing is sent anywhere,
// so backups (Settings → Export) are the way to move or protect your data.

import { normalizeState, defaultState } from './model.js';

const KEY = 'finance-helper.state';

export function load(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY);
    if (raw) return normalizeState(JSON.parse(raw));
  } catch {
    // Corrupt or blocked storage: start clean rather than crash.
  }
  const s = defaultState();
  s.meta.createdAt = Date.now();
  return s;
}

export function save(state, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function backupJSON(state) {
  return JSON.stringify({ app: 'finance-helper', exportedAt: new Date().toISOString(), ...state }, null, 1);
}

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
