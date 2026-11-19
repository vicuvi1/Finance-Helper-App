// Undo and "Recent actions" built on the change history (js/changelog.js).
// Pure: the log (newest first, as changestore.js keeps it) goes in, the undo
// and redo stacks and the list of recent actions come out. Because the log
// lives in IndexedDB, the stack survives a reload and is the same on every
// screen. The session undo (js/history.js) is still used first while it has a
// step (it also covers plain settings); this is what takes over after a reload
// and what the Recent actions panel shows.
//
// An "action" is one save: all the entries that share a `grp`. Undoing writes
// the records' old versions back (history.js `apply`, stamped "now" so the
// sync keeps the undo) and is logged as an `undo` group whose `of` is the first
// entry of the action it reverted; redo is the same with `redo`. Replaying the
// log in time order gives the stacks, so a new action clears the redo stack
// like everywhere else. Only changes made on THIS device are on the stack:
// others' changes are listed but never undone without asking.

import { apply } from './history.js';
import { afterOf, fieldChanges, alreadyBack } from './changelog.js';

export const RECENT = 10;
const VERB = { add: 'Added', edit: 'Edited', delete: 'Deleted', putback: 'Put back', undo: 'Undid', redo: 'Redid' };
const WORD = {
  tx: ['record', 'records'],
  goals: ['goal', 'goals'],
  goalAllocations: ['goal reservation', 'goal reservations'],
  recurring: ['scheduled payment', 'scheduled payments'],
  invoices: ['invoice', 'invoices'],
  people: ['person', 'people'],
  reconciliations: ['reconciliation', 'reconciliations'],
  'settings.accounts': ['account', 'accounts'],
  'settings.categories': ['category', 'categories'],
  'settings.jars': ['jar', 'jars'],
};

const isRevert = (g) => g.act === 'undo' || g.act === 'redo';

/** The log as actions, newest first: { grp, at, dev, act, entries, mine }. Summary lines ("many") join their group. */
export function groupsOf(log, dev = 'web') {
  const by = new Map();
  for (const e of log || []) {
    if (!e || !e.grp) continue;
    let g = by.get(e.grp);
    if (!g) { g = { grp: e.grp, at: e.at, dev: e.dev, act: e.act, of: e.of || null, entries: [], idx: by.size }; by.set(e.grp, g); }
    if (e.at > g.at) g.at = e.at;
    if (e.act !== 'many') g.entries.push(e);
    else g.more = (g.more || 0) + (e.n || 0);
  }
  const out = [...by.values()].filter((g) => g.entries.length);
  for (const g of out) {
    g.mine = g.entries.every((e) => e.dev === dev);
    g.foreign = g.entries.filter((e) => e.dev !== dev).map((e) => e.dev);
    g.act = g.entries[0].act;
    g.dev = g.entries[0].dev;
    g.of = g.entries.find((e) => e.of)?.of || null;
  }
  return out.sort((a, b) => b.at - a.at || a.idx - b.idx); // same millisecond: the log's own order (newest first)
}

/**
 * Replays the log (oldest first) into { undo: [group...], redo: [group...] }
 * (each newest last) and `status` (grp -> 'done' | 'undone').
 */
export function stacksOf(log, dev = 'web') {
  const groups = groupsOf(log, dev).reverse();
  const entryGrp = new Map();
  for (const g of groups) for (const e of g.entries) entryGrp.set(e.id, g.grp);
  const byGrp = new Map(groups.map((g) => [g.grp, g]));
  const undo = [];
  const redo = [];
  const status = new Map();
  const drop = (arr, grp) => { const i = arr.findIndex((x) => x.grp === grp); if (i >= 0) arr.splice(i, 1); };
  for (const g of groups) {
    if (isRevert(g)) {
      const t = byGrp.get(entryGrp.get(g.of));
      if (!t) continue;
      if (g.act === 'undo') { drop(undo, t.grp); if (g.mine) redo.push(t); status.set(t.grp, 'undone'); } else { drop(redo, t.grp); undo.push(t); status.set(t.grp, 'done'); }
      continue;
    }
    status.set(g.grp, 'done');
    if (g.mine && g.dev !== 'auto') { undo.push(g); redo.length = 0; }
  }
  return { undo, redo, status };
}

/** The last `n` actions for the panel, newest first: not the automatic ones, not undo/redo lines. */
export function recentActions(log, dev = 'web', n = RECENT) {
  const { status } = stacksOf(log, dev);
  return groupsOf(log, dev)
    .filter((g) => !isRevert(g) && g.dev !== 'auto' && g.entries.some((e) => e.list))
    .slice(0, n)
    .map((g) => ({ ...g, status: status.get(g.grp) || 'done' }));
}

const nameOf = (e, fmt) => {
  const r = afterOf(e) || e.before || {};
  if (e.list === 'tx') {
    const what = r.type === 'transfer' ? 'move' : r.note || (r.type === 'income' ? 'income' : 'record');
    return r.amount != null && fmt ? `${what} (${fmt(r.amount, r.currency)})` : what;
  }
  return r.name || r.title || r.label || (WORD[e.list] || ['record'])[0];
};

/** "Added Lunch (50 MDL)", "Deleted 3 records", "Edited the category Food". `fmt(amount, currency)` writes money. */
export function labelOf(g, fmt) {
  if (g.label) return g.label[0].toUpperCase() + g.label.slice(1);
  const es = g.entries;
  const verb = VERB[es[0].act] || 'Changed';
  const total = es.length + (g.more || 0);
  if (total === 1) return `${verb} ${nameOf(es[0], fmt)}`;
  const lists = new Set(es.map((e) => e.list));
  const w = lists.size === 1 ? WORD[es[0].list]?.[1] || 'records' : 'items';
  return `${verb} ${total} ${w}`;
}

const listOf = (state, key) => (key.startsWith('settings.') ? state.settings?.[key.slice(9)] : state[key]);
const nowOf = (state, e) => (listOf(state, e.list) || []).find((x) => x && x.id === e.rid) || null;

/** What the data must look like for this step to be a clean undo (dir < 0) or redo (dir > 0). */
const expected = (e, dir) => (dir < 0 ? afterOf(e) : e.before || null);

/** The entries whose record has been changed since (by anyone), so the step would overwrite something newer. */
export function changedSince(state, entries, dir = -1) {
  const out = [];
  for (const e of entries) {
    if (!e.list || !e.rid) continue;
    const want = expected(e, dir);
    const cur = nowOf(state, e);
    if (!want && !cur) continue;
    if (!want !== !cur || fieldChanges(want, cur).length) out.push(e);
  }
  return out;
}

/** Entries whose step would change nothing now. */
export const nothingToDo = (state, entries, dir = -1) => entries.every((e) => (dir < 0 ? alreadyBack(state, e) : !changedSince(state, [e], 1).length));

/** Undo (dir < 0) or redo (dir > 0) one action on `state`. Returns how many records changed. */
export function applyGroup(state, entries, dir = -1, now = Date.now()) {
  const todo = [];
  for (const e of entries) {
    if (!e.list || !e.rid) continue;
    const to = dir < 0 ? e.before || null : afterOf(e);
    todo.push({ list: e.list, id: e.rid, before: to ? JSON.stringify(to) : null });
  }
  if (todo.length) apply(state, todo, now);
  return todo.length;
}

/** What to ask before a step: { foreign: [devices], changed: [entries] } (both empty = go ahead silently). */
export function risks(state, g, dir = -1) {
  const dev = g.entries.map((e) => e.dev);
  return { foreign: [...new Set(g.foreign || dev.filter((d) => d !== g.dev))], changed: changedSince(state, g.entries, dir) };
}
