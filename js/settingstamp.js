// When each plain setting last changed on purpose, so two devices merge their
// settings key by key (js/sync.js) and not "all of them from the newer side".
//
// - settings.changedAt = { key: time }: stamped here, after every save made on
//   this device, for each plain key whose value changed (the page calls
//   stampSettings with the settings as they were at the last save or sync).
// - The lists kept by id (wishlist, saved Log views, your own record fields): each added or changed
//   item gets its own updatedAt, and a removed one a deletion marker
//   (state.deleted), so sync.js merges them item by item.
//
// Older app versions know nothing of this: they keep `changedAt` as one more
// plain key and still read settings.updatedAt, which the settings screens go
// on setting. Pure: no DOM, no storage, no clock (callers pass `now`).

/** Device-only settings: never travel. */
export const LOCAL_SETTINGS = ['theme', 'themeInLife', 'themeMotion', 'logView'];
/** Settings lists merged item by item (id + updatedAt, deletions in state.deleted). */
export const BY_ID = ['wishlist', 'savedViews', 'customFields', 'realityHistory', 'planned'];
/** Maps of key → time merged key by key: the later time wins (a negative time = undone at that time). */
export const BY_KEY_TIME = ['closedMonths'];
/** "Last done on" days: the later day wins, whoever saved last. */
export const LATER_DAY = ['cashCountLast', 'checkupSnooze'];
/** Keys with their own merge in sync.js. */
const OWN_MERGE = ['jars', 'incomeSources', 'accounts', 'categories', 'subcats', 'subMemory', 'rules', 'archive', 'budgets', 'checkupLast', 'updatedAt', 'changedAt'];
const NOT_PLAIN = new Set([...LOCAL_SETTINGS, ...BY_ID, ...BY_KEY_TIME, ...LATER_DAY, ...OWN_MERGE]);

/** Two key → time maps merged: per key the later moment wins (|time|; negative = undone). */
export function mergeKeyTimes(a, b) {
  const out = { ...(a && typeof a === 'object' ? a : {}) };
  for (const [k, v] of Object.entries(b && typeof b === 'object' ? b : {})) {
    const t = Number(v) || 0;
    if (!(k in out) || Math.abs(t) > Math.abs(Number(out[k]) || 0)) out[k] = t;
  }
  return out;
}

/** The plain keys of a settings object: merged key by key, by their change time. */
export const plainKeys = (settings) => Object.keys(settings || {}).filter((k) => !NOT_PLAIN.has(k));

const items = (list) => (Array.isArray(list) ? list.filter((x) => x && typeof x === 'object' && typeof x.id === 'string') : []);

/** The settings as they are now, to compare with at the next save. */
export function settingsBase(state) {
  const s = state?.settings;
  if (!s || state._sealed) return null;
  const plain = {};
  for (const k of plainKeys(s)) plain[k] = JSON.stringify(s[k]);
  const lists = {};
  for (const k of BY_ID) lists[k] = { has: Array.isArray(s[k]), order: items(s[k]).map((x) => x.id).join('\n'), byId: new Map(items(s[k]).map((x) => [x.id, JSON.stringify(x)])) };
  return { plain, lists };
}

/**
 * After a change made on this device: stamps what changed since `base` and
 * returns the new base. With no base (start, after a sync) nothing is stamped.
 */
export function stampSettings(state, base, now = Date.now()) {
  const s = state?.settings;
  if (!s || state._sealed) return null;
  if (!base) return settingsBase(state);
  const at = { ...(s.changedAt && typeof s.changedAt === 'object' ? s.changedAt : {}) };
  let changed = false;
  for (const k of new Set([...Object.keys(base.plain), ...plainKeys(s)])) {
    if (JSON.stringify(s[k]) === base.plain[k]) continue;
    at[k] = now;
    changed = true;
  }
  for (const k of BY_ID) {
    const was = base.lists[k] || { has: false, order: '', byId: new Map() };
    const list = items(s[k]);
    let touched = was.has !== Array.isArray(s[k]) || was.order !== list.map((x) => x.id).join('\n');
    const here = new Set();
    for (const x of list) {
      here.add(x.id);
      if (was.byId.get(x.id) === JSON.stringify(x)) continue;
      x.updatedAt = Math.max(now, Number(x.updatedAt) || 0);
      if (state.deleted) delete state.deleted[x.id];
      touched = true;
    }
    for (const id of was.byId.keys()) if (!here.has(id) && state.deleted) state.deleted[id] = now;
    if (touched) { at[k] = now; changed = true; }
  }
  if (changed) s.changedAt = at;
  return settingsBase(state);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The plain keys of two settings objects, merged key by key. For a key whose
 * values differ: the later change time wins; with no time to compare (data
 * from before this, or from an older app version) the side that has the key,
 * then the side with the newer settings.updatedAt, as before.
 * Returns { values, changedAt } (a key missing from `values` is removed).
 */
export function mergePlain(local = {}, remote = {}) {
  const la = local.changedAt && typeof local.changedAt === 'object' ? local.changedAt : {};
  const ra = remote.changedAt && typeof remote.changedAt === 'object' ? remote.changedAt : {};
  const lt = local.updatedAt || 0;
  const rt = remote.updatedAt || 0;
  const values = {};
  const changedAt = {};
  for (const k of new Set([...Object.keys(la), ...Object.keys(ra)])) changedAt[k] = Math.max(Number(la[k]) || 0, Number(ra[k]) || 0);
  for (const k of new Set([...plainKeys(local), ...plainKeys(remote)])) {
    const a = local[k];
    const b = remote[k];
    const ta = Number(la[k]) || 0;
    const tb = Number(ra[k]) || 0;
    let mine;
    if (same(a, b)) mine = true;
    else if (ta !== tb) mine = ta > tb;
    else if (a === undefined || b === undefined) mine = b === undefined;
    else if (lt !== rt) mine = lt > rt;
    else mine = JSON.stringify(a) >= JSON.stringify(b);
    const v = mine ? a : b;
    if (v !== undefined) values[k] = v;
  }
  return { values, changedAt };
}
