// Undo / redo for everything you change: records, accounts, categories,
// goals, invoices, settings. After each save we compare the data with how
// it was before, record by record, and keep only what changed. Undoing
// puts those records back (stamped "changed now", so sync keeps the undo)
// and the reverse becomes the redo. Device-only things (meta, rates, theme,
// the Log view) are never undone. Kept in memory only, for this session.

const LISTS = ['tx', 'people', 'recurring', 'invoices', 'netWorth', 'goals'];
const SETTING_LISTS = ['accounts', 'categories', 'jars'];
const NOT_UNDONE = new Set(['theme', 'themeMotion', 'logView', 'updatedAt', ...SETTING_LISTS]);

const WORDS = {
  tx: ['record', 'records'],
  people: ['person', 'people'],
  recurring: ['scheduled payment', 'scheduled payments'],
  invoices: ['invoice', 'invoices'],
  netWorth: ['net worth entry', 'net worth entries'],
  goals: ['goal', 'goals'],
  'settings.accounts': ['account', 'accounts'],
  'settings.categories': ['category', 'categories'],
  'settings.jars': ['jar', 'jars'],
};

const listOf = (state, key) => (key.startsWith('settings.') ? state.settings[key.slice(9)] : state[key]);

function mapOf(arr) {
  const m = new Map();
  for (const x of arr || []) if (x && x.id != null) m.set(x.id, JSON.stringify(x));
  return m;
}

function scalars(settings) {
  const out = {};
  for (const k of Object.keys(settings).sort()) if (!NOT_UNDONE.has(k)) out[k] = settings[k];
  return JSON.stringify(out);
}

export function snapshot(state) {
  const lists = {};
  for (const k of LISTS) lists[k] = mapOf(state[k]);
  for (const k of SETTING_LISTS) lists[`settings.${k}`] = mapOf(state.settings[k]);
  return { lists, scalars: scalars(state.settings) };
}

// What changed from `a` to `b`, with the old version of each thing.
export function diff(a, b) {
  const out = [];
  for (const key of Object.keys(b.lists)) {
    const was = a.lists[key] || new Map();
    const now = b.lists[key];
    let i = 0;
    for (const [id, json] of was) {
      if (!now.has(id)) out.push({ list: key, id, before: json, index: i, kind: 'removed' });
      else if (now.get(id) !== json) out.push({ list: key, id, before: json, kind: 'edited' });
      i++;
    }
    for (const id of now.keys()) if (!was.has(id)) out.push({ list: key, id, before: null, kind: 'added' });
  }
  if (a.scalars !== b.scalars) out.push({ list: 'settings', before: a.scalars, kind: 'edited' });
  return out;
}

// Put the old versions back.
export function apply(state, changes, now = Date.now()) {
  for (const c of changes) {
    if (c.list === 'settings') {
      const old = JSON.parse(c.before);
      for (const k of Object.keys(state.settings)) if (!NOT_UNDONE.has(k) && !(k in old)) delete state.settings[k];
      Object.assign(state.settings, old, { updatedAt: now });
      continue;
    }
    const arr = listOf(state, c.list);
    if (!arr) continue;
    const i = arr.findIndex((x) => x.id === c.id);
    if (c.before == null) {
      if (i >= 0) arr.splice(i, 1);
      state.deleted[c.id] = now;
    } else {
      const obj = { ...JSON.parse(c.before), updatedAt: now };
      delete state.deleted[c.id];
      if (i >= 0) arr[i] = obj;
      else arr.splice(Math.min(c.index ?? arr.length, arr.length), 0, obj);
    }
  }
}

const n = (count, key) => {
  const w = WORDS[key][count === 1 ? 0 : 1];
  return `${count === 1 ? (/^[aeiou]/.test(w) ? 'an' : 'a') : count} ${w}`;
};

// "deleted 3 records", "edited a record and a category", "changed settings".
export function describe(changes) {
  const groups = new Map();
  for (const c of changes) {
    if (c.list === 'settings') continue;
    const k = `${c.kind}|${c.list}`;
    groups.set(k, (groups.get(k) || 0) + 1);
  }
  const verb = { added: 'added', removed: 'deleted', edited: 'edited' };
  const parts = [...groups.entries()]
    .sort((x, y) => (x[0].endsWith('|tx') ? -1 : 0) - (y[0].endsWith('|tx') ? -1 : 0) || y[1] - x[1])
    .map(([k, count]) => { const [kind, list] = k.split('|'); return `${verb[kind]} ${n(count, list)}`; });
  if (changes.some((c) => c.list === 'settings')) parts.push('changed settings');
  if (!parts.length) return 'a change';
  return parts.length > 2 ? `${parts.slice(0, 2).join(', ')} and more` : parts.join(' and ');
}

export function createHistory({ limit = 60 } = {}) {
  let base = null;
  const undos = [];
  const redos = [];
  const step = (state, from, to, now) => {
    const e = from.pop();
    if (!e) return null;
    apply(state, e.changes, now);
    const next = snapshot(state);
    to.push({ changes: diff(base, next), label: e.label });
    base = next;
    return e;
  };
  return {
    // Start over from this data, without an undo step (sync, unlock, start).
    reset(state) { base = state && !state._sealed ? snapshot(state) : null; },
    // After a save: remember what changed. Returns the new step, or null.
    record(state, label) {
      if (!state || state._sealed) { base = null; return null; }
      const next = snapshot(state);
      if (!base) { base = next; return null; }
      const changes = diff(base, next);
      base = next;
      if (!changes.length) return null;
      const e = { changes, label: label || describe(changes) };
      undos.push(e);
      if (undos.length > limit) undos.shift();
      redos.length = 0;
      return e;
    },
    undo(state, now = Date.now()) { return base ? step(state, undos, redos, now) : null; },
    redo(state, now = Date.now()) { return base ? step(state, redos, undos, now) : null; },
    canUndo: () => undos.length > 0,
    canRedo: () => redos.length > 0,
    nextUndo: () => undos.at(-1)?.label || null,
    nextRedo: () => redos.at(-1)?.label || null,
    clear() { undos.length = 0; redos.length = 0; },
  };
}
