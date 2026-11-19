// Change history (#15), the pure part. Every add, edit, delete, restore,
// bulk change, merge, undo and "Put back" of a Money record becomes one entry:
// when, on which device, what changed (field: old -> new) and the record.
//
// Where it is kept (docs/DECISIONS.md, 2026-11-17): on this device only
// (js/changestore.js, IndexedDB; sealed with the Money PIN when the data is
// encrypted), at most 90 days and 2,000 entries. It never goes into the synced
// Money copy: that copy drops unknown top-level keys, a settings key would be
// overwritten whole by the newer settings, and the server's Money readers
// would carry it. What travels is the record itself: each record changed here
// is stamped `editedOn` (desktop / web / phone), so another device logs the
// change with the right device when the sync brings it in.
//
// "Put back" uses history.js `apply`: the record's old version goes back with
// updatedAt = now (so it wins every merge, and a deletion's tombstone, which is
// older, no longer hides it); putting back an add removes the record with a new
// tombstone. Either way the sync carries it like any other edit.

import { snapshot, diff, apply } from './history.js';
import { archivedTx } from './archive.js';

export const MAX_ENTRIES = 2000;
export const MAX_DAYS = 90;
const DAY = 86400000;
/** At most this many entries for one save; a bigger step keeps a summary line too. */
export const MAX_STEP = 500;
/** A sync bringing in more than this at once (a first sync, a restore) is one summary line. */
export const MAX_SYNC_STEP = 200;

/** The lists that are logged (settings scalars and the daily net-worth snapshots are not records you edit). */
export const LOGGED = ['tx', 'goals', 'goalAllocations', 'recurring', 'invoices', 'people', 'reconciliations', 'settings.accounts', 'settings.categories', 'settings.jars', 'settings.incomeSources'];
/** Bookkeeping fields: never shown as a change. */
export const QUIET_FIELDS = new Set(['updatedAt', 'createdAt', 'editedOn', 'lastMilestone']);

export const DEVICES = { desktop: 'Desktop', web: 'Web', phone: 'Phone', bot: 'Telegram bot', auto: 'Automatic', other: 'Another device' };

/** This device: the desktop app (Electron), a phone browser or the website. */
export function deviceLabel(ua = globalThis.navigator?.userAgent || '') {
  if (/Electron/i.test(ua)) return 'desktop';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return 'phone';
  return 'web';
}

const rid = () => `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const parse = (json) => { try { return json == null ? null : JSON.parse(json); } catch { return null; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The fields that differ between two versions of a record: [{ f, from, to }]. */
export function fieldChanges(before, after) {
  const out = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const f of keys) {
    if (QUIET_FIELDS.has(f)) continue;
    const from = before?.[f];
    const to = after?.[f];
    if (!same(from, to)) out.push({ f, from, to });
  }
  return out;
}

/** Who made a change: this device, or (for changes that arrived) the device stamped on the record. */
function whoOf(before, after, mode, dev) {
  if (!before && after?.source === 'telegram') return 'bot';
  if (!before && after?.source === 'capture') return 'phone';
  if (mode === 'local' || mode === 'undo' || mode === 'redo' || mode === 'putback') return dev;
  if (after && after.editedOn && DEVICES[after.editedOn] && (!before || after.editedOn !== before.editedOn || after.updatedAt !== before.updatedAt)) return after.editedOn;
  return mode === 'sync' ? 'other' : 'auto';
}

function actOf(before, after, mode) {
  if (mode === 'undo' || mode === 'redo' || mode === 'putback') return mode;
  if (!before) return 'add';
  if (!after) return 'delete';
  return 'edit';
}

/**
 * The entries for one step: `changes` from history.js `diff`, `next` the
 * snapshot after it. `info`: { at, mode ('local' | 'quiet' | 'sync' | 'undo' |
 * 'redo' | 'putback'), dev, label, of (the entry put back) }.
 */
export function entriesFrom(changes, next, info) {
  const { at = Date.now(), mode = 'local', dev = 'web', label = '', of = null } = info || {};
  const list = (changes || []).filter((c) => LOGGED.includes(c.list));
  if (!list.length) return [];
  const grp = rid();
  const limit = mode === 'sync' || mode === 'quiet' ? MAX_SYNC_STEP : MAX_STEP;
  if ((mode === 'sync' || mode === 'quiet') && list.length > limit) {
    return [{ id: rid(), at, dev: mode === 'sync' ? 'other' : 'auto', act: 'many', list: null, rid: null, grp, n: list.length, label: label || `${list.length} changes at once` }];
  }
  const out = [];
  for (const c of list) {
    if (out.length >= limit) break;
    const before = parse(c.before);
    const after = parse(next?.lists?.[c.list]?.get(c.id) ?? null);
    if (before && after && !fieldChanges(before, after).length) continue; // only bookkeeping changed
    const e = { id: rid(), at, dev: whoOf(before, after, mode, dev), act: actOf(before, after, mode), list: c.list, rid: c.id, grp };
    if (before) e.before = before;
    if (!before && after) e.after = after;
    if (before && after) {
      const set = {};
      const unset = [];
      for (const ch of fieldChanges(before, after)) { if (ch.to === undefined) unset.push(ch.f); else set[ch.f] = ch.to; }
      e.set = set;
      if (unset.length) e.unset = unset;
    }
    if (!after) e.gone = true;
    if (of) e.of = of;
    out.push(e);
  }
  if (list.length > out.length && out.length >= limit) out.push({ id: rid(), at, dev, act: 'many', list: null, rid: null, grp, n: list.length - out.length, label: `and ${list.length - out.length} more changes in the same step` });
  for (const e of out) { e.n = out.length; if (label) e.label = label; }
  return out;
}

/** The record as it was right after the change (null when the change deleted it). */
export function afterOf(e) {
  if (e.gone) return null;
  if (e.after) return e.after;
  if (!e.before) return null;
  const out = { ...e.before, ...(e.set || {}) };
  for (const f of e.unset || []) delete out[f];
  return out;
}

/** The changes of an entry, for "field: old -> new" lines. */
export const changesOf = (e) => (e.act === 'many' ? [] : fieldChanges(e.before || null, afterOf(e)));

/** Newest first, nothing older than MAX_DAYS, at most MAX_ENTRIES. */
export function prune(list, now = Date.now()) {
  const cut = now - MAX_DAYS * DAY;
  return (list || [])
    .filter((e) => e && typeof e.id === 'string' && Number.isFinite(e.at) && e.at >= cut)
    .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .slice(0, MAX_ENTRIES);
}

/** Two copies of the log (two windows of this device): every entry once. */
export function mergeLogs(a, b, now = Date.now()) {
  const byId = new Map();
  for (const e of [...(a || []), ...(b || [])]) if (e && typeof e.id === 'string' && !byId.has(e.id)) byId.set(e.id, e);
  return prune([...byId.values()], now);
}

const listOf = (state, key) => (key.startsWith('settings.') ? state.settings?.[key.slice(9)] : state[key]);

/** The record as it is now (null when it is not there). */
export function currentOf(state, e) {
  if (!e?.list || !e.rid) return null;
  return (listOf(state, e.list) || []).find((x) => x && x.id === e.rid)
    // A record of an archived year is still there (js/archive.js), only kept elsewhere.
    || (e.list === 'tx' ? archivedTx(state).find((x) => x.id === e.rid) : null) || null;
}

/** Putting this entry back would change nothing (the record is already as it was before). */
export function alreadyBack(state, e) {
  if (!e || e.act === 'many' || !e.list) return true;
  const cur = currentOf(state, e);
  if (!e.before) return !cur;
  return !!cur && !fieldChanges(e.before, cur).length;
}

/**
 * Puts records back the way they were before these entries (oldest change
 * last, so with several entries for one record the earliest "before" wins).
 * Returns how many records changed.
 */
export function putBack(state, entries, now = Date.now()) {
  const todo = [];
  const seen = new Set();
  for (const e of [...(entries || [])].filter((x) => x && x.list && x.rid && x.act !== 'many').sort((a, b) => a.at - b.at)) {
    const k = `${e.list}|${e.rid}`;
    if (seen.has(k) || alreadyBack(state, e)) continue;
    seen.add(k);
    todo.push({ list: e.list, id: e.rid, before: e.before ? JSON.stringify(e.before) : null });
  }
  if (todo.length) apply(state, todo, now);
  return todo.length;
}

/**
 * Follows the data from save to save. `observe(state, mode)` returns the new
 * entries (and, for a change made here, stamps the changed records with this
 * device). `reset(state)` starts over without logging (start, lock, unlock).
 */
export function createTracker({ dev = deviceLabel(), now = () => Date.now() } = {}) {
  let base = null;
  let archived = new Set(); // ids in the archived years at `base`
  let next = null; // { mode, of, label } for the coming save (Put back)
  const archivedIds = (state) => new Set(archivedTx(state).map((t) => t.id));
  return {
    dev,
    reset(state) { base = state && !state._sealed ? snapshot(state) : null; archived = base ? archivedIds(state) : new Set(); },
    /** The coming save is a Put back of entry `of`. */
    expect(info) { next = info; },
    observe(state, mode = 'local') {
      if (!state || state._sealed) { base = null; next = null; return []; }
      const snap = snapshot(state);
      const nowArchived = archivedIds(state);
      if (!base) { base = snap; archived = nowArchived; next = null; return []; }
      const plan = next;
      next = null;
      if (plan?.mode && mode === 'local') mode = plan.mode;
      const wasArchived = archived;
      archived = nowArchived;
      // Archiving (here or arriving by sync) MOVES records out of the everyday
      // list, and unarchiving moves them back: neither is a delete or an add,
      // so "Bring back" can never add a second copy.
      const moved = (c) => c.list === 'tx' && ((c.kind === 'removed' && nowArchived.has(c.id)) || (c.kind === 'added' && wasArchived.has(c.id)));
      const changes = diff(base, snap).filter((c) => LOGGED.includes(c.list) && !moved(c));
      if (!changes.length) { base = snap; return []; }
      // A change made here: the record says on which device (other devices log it with that name).
      if (mode === 'local' || mode === 'putback') {
        for (const c of changes) {
          const json = snap.lists[c.list]?.get(c.id);
          if (json == null) continue;
          const rec = (listOf(state, c.list) || []).find((x) => x && x.id === c.id);
          if (!rec || rec.editedOn === dev) continue;
          const before = parse(c.before);
          if (before && !fieldChanges(before, rec).length) continue;
          rec.editedOn = dev;
          snap.lists[c.list].set(c.id, JSON.stringify(rec));
        }
      }
      base = snap;
      return entriesFrom(changes, snap, { at: now(), mode, dev, of: plan?.of || null, label: plan?.label || '' });
    },
  };
}
