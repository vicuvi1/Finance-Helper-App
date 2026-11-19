// Saved views of the Log: a name, the search text, the type filter and the
// Log view (Sheet / Table / List / Calendar), shown as chips above the Log.
// Pure (the page passes `today`). Kept in the plain settings key
// `savedViews`, so it syncs with the rest of the Money data.
//
// Dates stay relative: "this month", "last month" and "this year" in the search
// text are resolved when the view is opened, and a search that spells out the
// dates of the current month (from:2026-11-01 to:2026-11-30) is saved as
// "this month". The month the Log shows is saved as `now` (follows today) or
// `prev` (the month before) unless it is an older month, which is kept as is.

import { relRange } from './search.js';

export const MAX_PINNED = 8;
export const MAX_VIEWS = 40;
const FILTERS = ['all', 'expense', 'income', 'transfer', 'loan'];
const VIEWS = ['sheet', 'table', 'list', 'calendar'];
const REL_TEXT = { month: 'this month', lastmonth: 'last month', year: 'this year', lastyear: 'last year', week: 'this week' };
const DATE = '\\d{4}-\\d{2}-\\d{2}';

const addMonths = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Spelled-out dates that cover exactly a relative period become that period's words. */
export function relativize(query, today) {
  let q = String(query || '').trim();
  if (!q || !today) return q;
  const word = (from, to) => {
    for (const rel of ['month', 'lastmonth', 'year', 'lastyear', 'week']) {
      const r = relRange(rel, today);
      if (r && r.from === from && r.to === to) return REL_TEXT[rel];
    }
    return null;
  };
  q = q.replace(new RegExp(`\\bfrom:(${DATE})\\s+to:(${DATE})`, 'gi'), (m, a, b) => word(a, b) || m);
  q = q.replace(new RegExp(`(${DATE})\\.\\.(${DATE})`, 'g'), (m, a, b) => word(a, b) || m);
  return q.replace(/\s+/g, ' ').trim();
}

/** A new view from what the Log shows now: `{ search, filter, month, view }`. */
export function snapshotView(name, cur, today, id) {
  const month = cur.month === today.slice(0, 7) ? 'now' : cur.month === addMonths(today.slice(0, 7), -1) ? 'prev' : cur.month || 'now';
  return {
    id: id || `sv-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`,
    name: String(name || '').trim().slice(0, 40) || suggestName(cur.search),
    q: relativize(cur.search, today),
    filter: FILTERS.includes(cur.filter) ? cur.filter : 'all',
    month,
    view: VIEWS.includes(cur.view) ? cur.view : '',
    pinned: true,
  };
}

/** What a view sets on the Log today: `{ search, filter, month, view }` (`view` '' = leave the Log view alone). */
export function resolveView(v, today) {
  const now = today.slice(0, 7);
  const month = !v.month || v.month === 'now' ? now : v.month === 'prev' ? addMonths(now, -1) : v.month;
  return { search: v.q || '', filter: FILTERS.includes(v.filter) ? v.filter : 'all', month, view: VIEWS.includes(v.view) ? v.view : '' };
}

/** A name for a search: "food over 200 this month" -> "Food over 200 this month". */
export function suggestName(q) {
  const t = String(q || '').trim().replace(/\s+/g, ' ');
  if (!t) return 'My view';
  const s = t[0].toUpperCase() + t.slice(1);
  return s.length > 32 ? `${s.slice(0, 30)}…` : s;
}

const clean = (v) => v && typeof v === 'object' && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.q === 'string';

/**
 * The views: `settings.savedViews`, else the older saved searches
 * (`settings.savedFilters`, a name and a query) as views, so nothing is lost.
 */
export function viewsOf(state) {
  const s = state.settings || {};
  if (Array.isArray(s.savedViews)) return s.savedViews.filter(clean);
  const old = Array.isArray(s.savedFilters) ? s.savedFilters.filter((f) => f && typeof f.q === 'string' && f.q.trim()) : [];
  return old.slice(0, MAX_PINNED).map((f, i) => ({ id: `sv-old${i}`, name: String(f.name || f.q).slice(0, 40), q: f.q.trim(), filter: 'all', month: 'now', view: '', pinned: true }));
}

/** The pinned ones, in order: the chips above the Log. */
export const pinnedViews = (state) => viewsOf(state).filter((v) => v.pinned).slice(0, MAX_PINNED);

function write(state, list) {
  state.settings.savedViews = list.slice(0, MAX_VIEWS);
  state.settings.updatedAt = Date.now();
  return state.settings.savedViews;
}

/** Same search, filter and month already saved? */
export const sameView = (a, b) => a.q === b.q && a.filter === b.filter && a.month === b.month && a.view === b.view;

/** Adds a view (pinned while there is room), or replaces the one with the same name. */
export function addView(state, v) {
  const list = viewsOf(state);
  const i = list.findIndex((x) => x.name.toLowerCase() === v.name.toLowerCase());
  const pinnedNow = list.filter((x, j) => x.pinned && j !== i).length;
  const next = { ...v, pinned: v.pinned && pinnedNow < MAX_PINNED };
  if (i >= 0) list[i] = { ...next, id: list[i].id };
  else list.push(next);
  return write(state, list);
}

export function renameView(state, id, name) {
  const n = String(name || '').trim().slice(0, 40);
  if (!n) return viewsOf(state);
  return write(state, viewsOf(state).map((v) => (v.id === id ? { ...v, name: n } : v)));
}

export const removeView = (state, id) => write(state, viewsOf(state).filter((v) => v.id !== id));

/** Moves a view one place up (dir < 0) or down (dir > 0). */
export function moveView(state, id, dir) {
  const list = viewsOf(state);
  const i = list.findIndex((v) => v.id === id);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  return write(state, list);
}

/** Pin or unpin. Pinning a ninth is refused (returns null). */
export function setPinned(state, id, on) {
  const list = viewsOf(state);
  if (on && list.filter((v) => v.pinned && v.id !== id).length >= MAX_PINNED) return null;
  return write(state, list.map((v) => (v.id === id ? { ...v, pinned: !!on } : v)));
}
