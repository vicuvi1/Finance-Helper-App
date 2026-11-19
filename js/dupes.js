// Duplicate finder (pure, tested). Groups records with the same type, account,
// currency and amount, at most a day apart, with a similar note. Nothing is
// removed here: the screen shows each group, you keep one and remove the rest
// (one Undo for the whole batch). Records you marked "not a duplicate"
// (`notDupe: true`) are skipped, and so are parts of one split receipt, loans'
// reconciliation adjustments, and points buys.

import { isCorrection, isPointsReward } from './catshare.js';
import { removeTx } from './model.js';

const DAY = 864e5;
const dayNo = (iso) => Math.floor(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / DAY);

const tokens = (s) => String(s || '').toLowerCase().replace(/#[\p{L}\p{N}_-]+/gu, ' ').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const clean = (s) => tokens(s).join(' ');

// "Similar": the same words, one note empty, one inside the other, or at
// least half the words in common.
export function similarNote(a, b) {
  const x = clean(a);
  const y = clean(b);
  if (!x || !y || x === y) return true;
  if (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x))) return true;
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  const common = [...A].filter((w) => B.has(w)).length;
  return common / Math.max(A.size, B.size) >= 0.5;
}

const eligible = (t) => t && t.type !== 'transfer' && !t.notDupe && !t.splitOf && !isCorrection(t) && !isPointsReward(t) && t.amount > 0 && t.account;

// How much a record carries beyond the basics: the one with more is kept first.
const richness = (t) => ['sub', 'person', 'tax', 'receipts', 'recurring', 'tags', 'refund'].filter((k) => t[k] && (!Array.isArray(t[k]) || t[k].length)).length + (t.note ? 1 : 0);

// Groups of likely duplicates: [{ id, records, keep }]. `records` are oldest
// first; `keep` is the id suggested to keep (the richest, then the oldest).
export function findDuplicates(state) {
  const buckets = new Map();
  for (const t of state.tx) {
    if (!eligible(t)) continue;
    const k = `${t.type}|${t.account}|${t.currency || ''}|${t.amount}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(t);
  }
  const groups = [];
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const parent = list.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (Math.abs(dayNo(list[i].date) - dayNo(list[j].date)) <= 1 && similarNote(list[i].note, list[j].note)) parent[find(i)] = find(j);
      }
    }
    const byRoot = new Map();
    list.forEach((t, i) => { const r = find(i); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(t); });
    for (const recs of byRoot.values()) {
      if (recs.length < 2) continue;
      recs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
      const keep = [...recs].sort((a, b) => richness(b) - richness(a) || recs.indexOf(a) - recs.indexOf(b))[0];
      groups.push({ id: recs.map((r) => r.id).sort()[0], records: recs, keep: keep.id });
    }
  }
  return groups.sort((a, b) => (a.records[0].date < b.records[0].date ? 1 : a.records[0].date > b.records[0].date ? -1 : 0));
}

// Removes every record of the picked groups except the one kept, in one go.
// `picks` is [{ keep: id, ids: [ids of the group] }]. Returns the removed records.
export function removeDuplicates(state, picks, now = Date.now()) {
  const gone = [];
  for (const p of picks) {
    if (!p.ids.includes(p.keep)) continue;
    for (const id of p.ids) if (id !== p.keep) { const r = removeTx(state, id, now); if (r) gone.push(r); }
  }
  return gone;
}

// "Not a duplicate": these records are skipped from now on.
export function markNotDuplicate(state, ids, now = Date.now()) {
  let n = 0;
  for (const t of state.tx) if (ids.includes(t.id) && !t.notDupe) { t.notDupe = true; t.updatedAt = now; n++; }
  return n;
}

// Asks Life System for a full backup before the removal (the "backup before a
// risky step" bridge). Resolves { ok: true } when it was saved or when there is
// no Life System around (standalone: Undo is the safety net), { ok: false, error }
// when the backup failed (then do not remove anything).
export function backupBefore(label, { win = typeof window !== 'undefined' ? window : null, timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    if (!win || !win.parent || win.parent === win) {
      const own = globalThis.__fhBackupBefore;
      if (!own) { resolve({ ok: true, skipped: true }); return; }
      Promise.resolve(own(label)).then(() => resolve({ ok: true }), (e) => resolve({ ok: false, error: e?.message || 'The backup could not be saved' }));
      return;
    }
    const id = `dupes-${Date.now().toString(36)}`;
    const done = (v) => { win.removeEventListener('message', on); clearTimeout(timer); resolve(v); };
    const on = (e) => {
      const d = e.data;
      if (e.origin !== win.location.origin || !d || d.type !== 'LIFE_BACKUP_DONE' || d.id !== id) return;
      done(d.ok ? { ok: true } : { ok: false, error: d.error || 'The backup could not be saved' });
    };
    const timer = setTimeout(() => done({ ok: true, skipped: true }), timeout);
    win.addEventListener('message', on);
    try { win.parent.postMessage({ type: 'LIFE_SYSTEM_BRIDGE', action: 'BACKUP_BEFORE', payload: { label, id } }, win.location.origin); } catch { done({ ok: true, skipped: true }); }
  });
}
