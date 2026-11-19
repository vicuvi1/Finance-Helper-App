// Archive old years: the records of finished years move out of the everyday
// list (state.tx) into settings.archive, so the app stays quick after years
// of use. Nothing is lost:
// - settings.archive.opening keeps each account's balance from the archived
//   records, so balances (and net worth today) stay exactly as they were;
// - history readers (Year in review, Reports, Long view, net worth chart,
//   search with "Include archived years") look at withArchive(state);
// - Unarchive puts every record back, unchanged.
//
// Storage and sync (docs/DECISIONS.md): the archive is a SETTINGS key, because
// sync, the bots and older app versions keep settings keys and drop unknown
// top-level keys. It travels with the rest of the data; sync.js settles it
// with settleArchive (the newest archive choice decides what is archived, the
// records of both sides are all kept).
//
// Pure: no DOM, no storage, no clock (callers pass `now`).

const yearOf = (d) => String(d || '').slice(0, 4);

export const isArchived = (state) => !!state?.settings?.archive?.cutoff;
export const cutoffOf = (state) => state?.settings?.archive?.cutoff || '';

// What one record does to the balances (the same rules as model.accountBalances).
function applyTx(bal, t) {
  if (t.type === 'income') bal[t.account] = (bal[t.account] || 0) + t.amount;
  else if (t.type === 'expense') bal[t.account] = (bal[t.account] || 0) - t.amount;
  else if (t.type === 'transfer') {
    bal[t.from] = (bal[t.from] || 0) - t.amount;
    bal[t.to] = (bal[t.to] || 0) + (Number.isInteger(t.toAmount) ? t.toAmount : t.amount);
  }
}

export function openingOf(list) {
  const bal = {};
  for (const t of list) applyTx(bal, t);
  for (const k of Object.keys(bal)) if (!bal[k] || k === 'undefined') delete bal[k];
  return bal;
}

// Deleted for good? A deletion (state.deleted: id -> time) hides a record that
// was not changed after it. One more case: a record a repeating rule made by
// itself (id rec-<rule>-<date>) and nobody touched since. A device that was
// offline makes that record again with a LATER time than the deletion, so for
// it the deletion always wins. Anything done to the record on purpose (Put
// back, Redo, an edit, "Log now" after a deletion) moves updatedAt past
// createdAt, and then the usual "newest wins" decides.
export const ruleMade = (t) => typeof t?.id === 'string' && t.id.startsWith('rec-') && !!t.recurring && (t.updatedAt || 0) === (t.createdAt || 0);
export const buried = (t, deleted) => {
  const gone = deleted?.[t?.id];
  return !!gone && (gone >= (t.updatedAt || 0) || ruleMade(t));
};

// Every archived record, oldest first.
export function archivedTx(state) {
  const years = state?.settings?.archive?.years;
  if (!years) return [];
  return Object.keys(years).sort().flatMap((y) => years[y] || []);
}

export function archiveInfo(state) {
  const a = state?.settings?.archive;
  const years = Object.keys(a?.years || {}).sort().map((y) => ({ year: Number(y), count: (a.years[y] || []).length })).filter((y) => y.count);
  return { archived: !!a?.cutoff, cutoff: a?.cutoff || '', years, count: years.reduce((n, y) => n + y.count, 0), bytes: a?.cutoff ? JSON.stringify(a.years || {}).length : 0 };
}

// Adds the archived records' effect to `bal` (accountBalances): the whole
// opening for today, only the records up to the day for a past day.
export function archivedBalanceUpTo(state, upTo, bal) {
  const a = state.settings.archive;
  if (!a?.cutoff) return;
  if (!upTo || upTo >= a.cutoff) {
    for (const [id, v] of Object.entries(a.opening || {})) if (id in bal) bal[id] += v;
    return;
  }
  for (const t of archivedTx(state)) {
    if (t.date > upTo) continue;
    const tmp = {};
    applyTx(tmp, t);
    for (const [id, v] of Object.entries(tmp)) if (id in bal) bal[id] += v;
  }
}

// Records that other data points at stay in the everyday list.
const keptIds = (state) => new Set((state.goalAllocations || []).map((g) => g?.incomeId).filter(Boolean));

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function build(cutoff, at, archivedList) {
  const years = {};
  for (const t of [...archivedList].sort(byDate)) (years[yearOf(t.date)] ||= []).push(t);
  return { v: 1, cutoff, at, opening: openingOf(archivedList), years };
}

// The records an archive before `beforeYear` would move (for the preview).
export function archivable(state, beforeYear) {
  const cut = `${beforeYear}-01-01`;
  const keep = keptIds(state);
  return state.tx.filter((t) => t && typeof t.date === 'string' && t.date < cut && !keep.has(t.id));
}

// Moves the records before January 1 of `beforeYear` into the archive.
// Archiving again with a later year adds to it; an earlier year is refused
// (unarchive first). Returns the number of records moved.
export function archiveBefore(state, beforeYear, now = Date.now()) {
  const year = Number(beforeYear);
  if (!Number.isInteger(year) || year < 1900 || year > 2999) return 0;
  const cut = `${year}-01-01`;
  const have = state.settings.archive;
  if (have?.cutoff && cut < have.cutoff) return 0;
  const move = archivable(state, year);
  if (!move.length) return 0;
  const ids = new Set(move.map((t) => t.id));
  const before = archivedTx(state);
  state.tx = state.tx.filter((t) => !ids.has(t.id));
  state.settings.archive = build(cut, now, [...before, ...move]);
  state.settings.updatedAt = now;
  return move.length;
}

// Is this record in the archive?
export const inArchive = (state, id) => archivedTx(state).some((t) => t.id === id);

// Undo / Put back of a record that sits in the archive: `rec` takes its place
// (null removes it), and the opening balance is worked out again. A record
// whose date is now on or after the cut-off goes to the everyday list. Returns
// false when the record is not archived (the caller handles state.tx).
export function replaceArchived(state, id, rec) {
  const a = state?.settings?.archive;
  if (!a?.cutoff || !inArchive(state, id)) return false;
  const rest = archivedTx(state).filter((t) => t.id !== id);
  const stays = rec && typeof rec.date === 'string' && rec.date < a.cutoff;
  state.settings.archive = build(a.cutoff, a.at, stays ? [...rest, rec] : rest);
  if (rec && !stays) state.tx.push(rec);
  return true;
}

// Puts every archived record back, exactly as it was. The empty archive stays
// as a marker with a new time, so another device does not archive them again.
export function unarchiveAll(state, now = Date.now()) {
  if (!state.settings.archive) return 0;
  const list = archivedTx(state);
  const have = new Set(state.tx.map((t) => t.id));
  for (const t of list) if (!have.has(t.id)) state.tx.push(t);
  state.settings.archive = { v: 1, cutoff: '', at: now, opening: {}, years: {} };
  state.settings.updatedAt = now;
  return list.length;
}

// A copy of the state with every record in tx and no archive, so everything
// that reads history sees all the years (start + all records is the same as
// start + opening + the rest). Cached per list.
const cache = new WeakMap();
export function withArchive(state) {
  if (!state?.settings?.archive?.cutoff) return state;
  const a = state.settings.archive;
  const hit = cache.get(state.tx);
  if (hit && hit.a === a && hit.base === state.settings) return hit.out;
  const { archive: _gone, ...rest } = state.settings;
  const out = { ...state, tx: [...archivedTx(state), ...state.tx], settings: rest };
  cache.set(state.tx, { a, base: state.settings, out });
  return out;
}

// The state to read for a period starting on `from`: with archived years in
// reach, all the years; otherwise the everyday data as it is (fast).
export function forRange(state, from) {
  const c = state?.settings?.archive?.cutoff;
  return c && from < c ? withArchive(state) : state;
}

// Sync: both sides' records and archive choices settle into one state. The
// archive with the newest `at` decides the cut-off; every record from either
// side stays (nothing is dropped, only placed), so two devices end up equal.
export function settleArchive(mergedTx, localState, remoteState, deleted = {}) {
  const A = localState?.settings?.archive;
  const B = remoteState?.settings?.archive;
  if (!A && !B) return { tx: mergedTx, archive: undefined };
  const winner = (() => {
    if (!A) return B;
    if (!B) return A;
    const ta = Number(A.at) || 0;
    const tb = Number(B.at) || 0;
    if (ta !== tb) return ta > tb ? A : B;
    return (A.cutoff || '') >= (B.cutoff || '') ? A : B;
  })();
  const byId = new Map();
  const add = (t) => {
    if (!t || !t.id || buried(t, deleted)) return;
    const mine = byId.get(t.id);
    if (!mine || (t.updatedAt || 0) > (mine.updatedAt || 0)) byId.set(t.id, t);
  };
  for (const t of mergedTx) add(t);
  for (const t of archivedTx(localState)) add(t);
  for (const t of archivedTx(remoteState)) add(t);
  const alive = [...byId.values()];
  const at = Number(winner.at) || 0;
  if (!winner.cutoff) return { tx: alive, archive: { v: 1, cutoff: '', at, opening: {}, years: {} } };
  const keep = keptIds({ goalAllocations: [...(localState.goalAllocations || []), ...(remoteState.goalAllocations || [])] });
  const moved = alive.filter((t) => typeof t.date === 'string' && t.date < winner.cutoff && !keep.has(t.id));
  const movedIds = new Set(moved.map((t) => t.id));
  return { tx: alive.filter((t) => !movedIds.has(t.id)), archive: build(winner.cutoff, at, moved) };
}

// Years the picker offers as "Archive years before …": every year after the
// oldest one with records, up to this year (this year is never archived).
export function archiveChoices(state, today) {
  const thisYear = Number(String(today).slice(0, 4));
  const ys = state.tx.map((t) => Number(yearOf(t.date))).filter((y) => y && y < thisYear);
  if (!ys.length) return [];
  const out = [];
  for (let y = Math.min(...ys) + 1; y <= thisYear; y++) out.push(y);
  return out.reverse();
}
