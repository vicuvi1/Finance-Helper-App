// "Import from Life System" (Settings → Data & backups): Money's data as Life
// System saved it, brought into this app in one step. Pure; tested in
// tests/lifeimport.test.js.
//
// Files it reads (whatever Life System gave you):
//  - Data center → Money → Download: `life-system-money-<day>.json`, the app's
//    own saved data (or `-locked-` when Money was locked with its PIN: then
//    the PIN is asked and the file is opened here, never sent anywhere);
//  - a Finance Helper backup (`{app: 'finance-helper', …}`) made inside Life;
//  - Life's full backup (`financeState` / `financeEnc`, or its `tables` with
//    the synced copy `settings.app_sync_finance`);
//  - a synced copy itself (`{savedAt, editedAt, data}`) or a Drive copy
//    (`{app: 'finance-helper', data}`).
// The import is a merge: for each record the newer edit wins, records only on
// this device stay, and nothing is deleted (deletions in the file are not
// applied here).

import { mergeStates, toCloud } from './sync.js';
import { normalizeState, SCHEMA_VERSION } from './model.js';
import { isSealed } from './cipher.js';

const parse = (raw) => {
  if (raw && typeof raw === 'object') return raw;
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
};
const isState = (x) => !!x && typeof x === 'object' && Array.isArray(x.tx);

/** What a file holds: {kind: 'money', state, from} | {kind: 'sealed', box, from}. Throws a plain-English error otherwise. */
export function readLifeFile(text) {
  const data = parse(text);
  if (!data || typeof data !== 'object') throw new Error('This file is not JSON. Pick the Money file Life System saved (Data center → Money → Download).');
  if (isSealed(data)) return { kind: 'sealed', box: data, from: 'Money (locked with its PIN)' };
  if (isState(data) && data.settings) return { kind: 'money', state: data, from: data.app === 'finance-helper' ? 'Finance Helper backup' : 'Life System Money data' };
  // A synced copy ({savedAt, editedAt, data}) or a Drive copy ({app, data}).
  if (isState(data.data)) return { kind: 'money', state: { ...data.data, settings: data.data.settings || {} }, from: 'Life System synced copy' };
  // Life's full backup.
  const fs = parse(data.financeState);
  if (isState(fs)) return { kind: 'money', state: fs, from: 'Life System full backup' };
  const fe = parse(data.financeEnc);
  if (isSealed(fe)) return { kind: 'sealed', box: fe, from: 'Life System full backup (Money locked)' };
  const rows = data.tables?.settings;
  if (Array.isArray(rows)) {
    const row = rows.find((r) => r?.key === 'app_sync_finance');
    const v = parse(row?.value);
    if (isState(v?.data)) return { kind: 'money', state: { ...v.data, settings: v.data.settings || {} }, from: 'Life System full backup (synced copy)' };
  }
  throw new Error('No Money data found in this file. In Life System use Data center → Money → Download, or a full backup.');
}

/** The file's data ready to merge: the app's normal shape, deletions left out. */
export function incomingState(state) {
  const norm = normalizeState({ ...state, version: SCHEMA_VERSION });
  return { ...norm, deleted: {} };
}

const LISTS = ['tx', 'people', 'recurring', 'invoices', 'goals', 'goalAllocations', 'reconciliations'];

/** What the import would do: new records, newer edits taken, records kept as they are here. */
export function previewImport(local, incoming) {
  const out = { add: 0, update: 0, same: 0, keep: 0, records: (incoming.tx || []).length, first: '', last: '', other: 0 };
  const byId = new Map((local.tx || []).map((t) => [t.id, t]));
  const ids = new Set();
  for (const t of incoming.tx || []) {
    ids.add(t.id);
    const mine = byId.get(t.id);
    if (local.deleted?.[t.id] && local.deleted[t.id] >= (t.updatedAt || 0)) out.same++;
    else if (!mine) out.add++;
    else if ((t.updatedAt || 0) > (mine.updatedAt || 0)) out.update++;
    else out.same++;
    if (t.date && (!out.first || t.date < out.first)) out.first = t.date;
    if (t.date && (!out.last || t.date > out.last)) out.last = t.date;
  }
  for (const t of local.tx || []) if (!ids.has(t.id)) out.keep++;
  for (const k of LISTS.slice(1)) {
    const have = new Set((local[k] || []).map((x) => x.id));
    for (const x of incoming[k] || []) if (!have.has(x.id)) out.other++;
  }
  return out;
}

/** The merged data (this device's own settings like theme and Log view stay). Nothing is deleted. */
export function mergeImport(local, incoming) {
  const remote = { app: 'finance-helper', schema: SCHEMA_VERSION, savedAt: 0, data: toCloud(incoming, '').data };
  remote.data.deleted = {};
  return mergeStates(local, remote).state;
}
