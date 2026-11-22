// Merging two copies of your data (this device and the copy in Google
// Drive). Every record carries updatedAt; for each record the newest copy
// wins. Deletions are remembered (state.deleted), so a record deleted on one
// device is not brought back by another. Device-only things (PIN, rates,
// theme, log view, backups info) never travel.

import { normalizeState, SCHEMA_VERSION } from './model.js';
import { mergeRules } from './learn.js';
import { settleArchive, buried } from './archive.js';
import { LOCAL_SETTINGS, BY_ID, BY_KEY_TIME, LATER_DAY, plainKeys, mergePlain, mergeKeyTimes } from './settingstamp.js';

export { LOCAL_SETTINGS };

// What goes to Drive.
export function toCloud(state, deviceId, now = Date.now()) {
  const settings = { ...state.settings };
  for (const k of LOCAL_SETTINGS) delete settings[k];
  return {
    app: 'finance-helper',
    schema: SCHEMA_VERSION,
    savedAt: now,
    deviceId,
    data: { settings, tx: state.tx, people: state.people, recurring: state.recurring || [], invoices: state.invoices || [], netWorth: state.netWorth || [], goals: state.goals || [], goalAllocations: state.goalAllocations || [], reconciliations: state.reconciliations || [], deleted: state.deleted, ...(sharedRates(state.rates) ? { lastRates: sharedRates(state.rates) } : {}) },
  };
}

// The latest known exchange rates travel too (once a day at most), so a
// device whose live rate download fails still prices USD and EUR: the fiat
// rates (units per 1 USD) and the day they are from.
const FIAT_CODES = ['MDL', 'USD', 'EUR', 'RON', 'GBP', 'UAH', 'CHF', 'PLN', 'TRY', 'CAD'];
export function sharedRates(rates) {
  if (!rates?.usd || !rates.fetchedAt) return null;
  const usd = {};
  for (const c of FIAT_CODES) if (rates.usd[c] > 0) usd[c] = Math.round(rates.usd[c] * 1e4) / 1e4;
  if (!usd.MDL) return null;
  const d = new Date(rates.fetchedAt);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { date, usd };
}

// Rates from another device, when they are newer than this device's.
function withRates(localRates, remote) {
  const mine = sharedRates(localRates);
  if (!remote?.usd?.MDL || !/^\d{4}-\d{2}-\d{2}$/.test(remote.date || '') || (mine && mine.date >= remote.date)) return localRates;
  return { ...(localRates || {}), usd: { ...(localRates?.usd || {}), ...remote.usd }, crypto: localRates?.crypto || {}, history: localRates?.history || {}, fetchedAt: Date.parse(`${remote.date}T12:00:00`), synced: true };
}

// `preferB`: which side wins when both copies carry the same time but differ
// (undefined = the same pick on both devices, so they end up equal).
function mergeList(a = [], b = [], deleted, preferB) {
  const byId = new Map();
  // A deleted record never takes part (js/archive.js `buried`): a copy remade
  // by a repeating rule on a device that was offline must not hide a copy that
  // was put back on purpose, and must not come back itself.
  for (const x of a || []) if (x && !buried(x, deleted)) byId.set(x.id, x);
  for (const x of b || []) {
    if (!x || buried(x, deleted)) continue;
    const mine = byId.get(x.id);
    // Same time on both sides but different content (two devices in the same
    // millisecond): the same pick on both devices, so they end up equal.
    if (!mine || (x.updatedAt || 0) > (mine.updatedAt || 0) || ((x.updatedAt || 0) === (mine.updatedAt || 0) && (preferB ?? JSON.stringify(x) > JSON.stringify(mine)))) byId.set(x.id, x);
  }
  return [...byId.values()];
}

// Same data = same fingerprint, whatever order the fields were written in.
const fingerprint = (data) => JSON.stringify(data, (k, v) => {
  if (k === 'savedAt') return undefined;
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]]));
  return v;
});

// This page has a change still waiting to be written (store.js saveSoon) and
// the stored copy changed meanwhile (Life System's sync, its Telegram inbox):
// both together, the same merge as above (newest copy of each record wins,
// deletions stick). Device-only parts stay this page's.
export function mergeLocal(local, stored) {
  return mergeStates(local, toCloud(stored, '')).state;
}

// Merge `remote` (the Drive file, or null) into `local`. Returns the merged
// state and whether this device and/or Drive need the new version.
export function mergeStates(local, remote) {
  if (!remote) return { state: local, pushNeeded: true, pullChanged: false };
  if (remote.app !== 'finance-helper' || !remote.data) throw new Error('The file in Google Drive is not Finance Helper data.');
  if ((remote.schema || 1) > SCHEMA_VERSION) throw new Error('Your data in Google Drive was saved by a newer version of the app. Update this app first (Settings → About & updates).');

  const r = normalizeState({ ...remote.data, version: remote.schema });
  const deleted = { ...local.deleted };
  for (const [id, ts] of Object.entries(r.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, ts);

  // Plain settings: key by key, the later change of each key wins (js/settingstamp.js).
  // A routine action on one device (a cash count, a check-up "Yes") no longer
  // takes every other setting with it.
  const newer = (r.settings.updatedAt || 0) > (local.settings.updatedAt || 0);
  const plain = mergePlain(local.settings, r.settings);
  const settings = { ...local.settings };
  for (const k of plainKeys(local.settings)) delete settings[k];
  Object.assign(settings, plain.values);
  if (Object.keys(plain.changedAt).length) settings.changedAt = plain.changedAt;
  settings.updatedAt = Math.max(local.settings.updatedAt || 0, r.settings.updatedAt || 0);
  // Lists kept by id (wishlist, saved Log views): item by item, the newer copy
  // of each wins, a removed one stays removed. The order is the order of the
  // side that changed the list last; items only the other side has come after.
  for (const k of BY_ID) {
    const a = local.settings[k];
    const b = r.settings[k];
    if (!Array.isArray(a) && !Array.isArray(b)) continue;
    const ta = Number(local.settings.changedAt?.[k]) || 0;
    const tb = Number(r.settings.changedAt?.[k]) || 0;
    const lt = local.settings.updatedAt || 0;
    const rt = r.settings.updatedAt || 0;
    // Nothing to tell the sides apart: the same pick on both devices (so they end up equal).
    const theirs = ta !== tb ? tb > ta : lt !== rt ? rt > lt : undefined;
    const list = mergeList(a, b, deleted, theirs);
    const ids = (l) => JSON.stringify((l || []).map((x) => x?.id));
    const first = theirs ?? ids(b) > ids(a);
    const pos = new Map();
    for (const x of [...(first ? b || [] : a || []), ...(first ? a || [] : b || [])]) if (x && !pos.has(x.id)) pos.set(x.id, pos.size);
    settings[k] = list.sort((x, y) => pos.get(x.id) - pos.get(y.id));
  }
  // Closed months: month by month, the later close or reopen wins.
  for (const k of BY_KEY_TIME) {
    if (local.settings[k] || r.settings[k]) settings[k] = mergeKeyTimes(local.settings[k], r.settings[k]);
  }
  // "Last done on" days: the later day.
  for (const k of LATER_DAY) {
    const days = [local.settings[k], r.settings[k]].filter((d) => typeof d === 'string' && d);
    if (days.length) settings[k] = days.sort().at(-1);
  }
  settings.accounts = mergeList(local.settings.accounts, r.settings.accounts, deleted);
  // The card order you set on one device is the order everywhere.
  settings.accounts.sort((a, b) => (Number.isFinite(a.order) ? a.order : 1e6) - (Number.isFinite(b.order) ? b.order : 1e6));
  settings.categories = mergeList(local.settings.categories, r.settings.categories, deleted);
  settings.jars = mergeList(local.settings.jars, r.settings.jars, deleted);
  // Income sources (js/incomesources.js): a list by id, the newer copy of each wins; archived ones stay, an undone add stays deleted.
  if (Array.isArray(local.settings.incomeSources) || Array.isArray(r.settings.incomeSources)) settings.incomeSources = mergeList(local.settings.incomeSources, r.settings.incomeSources, deleted);
  settings.subcats = mergeList(local.settings.subcats, r.settings.subcats, deleted);
  // Week, year and trip budgets (js/budgets.js): a list by id; the last check-up of each account: the later day.
  if (Array.isArray(local.settings.budgets) || Array.isArray(r.settings.budgets)) settings.budgets = mergeList(local.settings.budgets, r.settings.budgets, deleted);
  if (local.settings.checkupLast || r.settings.checkupLast) {
    const last = { ...(r.settings.checkupLast || {}) };
    for (const [id, d] of Object.entries(local.settings.checkupLast || {})) if (!last[id] || d > last[id]) last[id] = d;
    settings.checkupLast = last;
  }
  // Category rules (phase 5): a list by id, the newer rule wins, deleted ones stay deleted (js/learn.js).
  if (Array.isArray(local.settings.rules) || Array.isArray(r.settings.rules)) settings.rules = mergeRules(local.settings.rules, r.settings.rules, deleted, local.settings.updatedAt || 0, r.settings.updatedAt || 0);
  // Learned merchants: both sides, the newer settings winning on the same merchant.
  settings.subMemory = newer ? { ...(local.settings.subMemory || {}), ...(r.settings.subMemory || {}) } : { ...(r.settings.subMemory || {}), ...(local.settings.subMemory || {}) };

  const merged = {
    ...local,
    settings,
    tx: mergeList(local.tx, r.tx, deleted),
    people: mergeList(local.people, r.people, deleted),
    recurring: mergeList(local.recurring, r.recurring, deleted),
    invoices: mergeList(local.invoices, r.invoices, deleted),
    netWorth: mergeList(local.netWorth, r.netWorth, deleted),
    goals: mergeList(local.goals, r.goals, deleted),
    goalAllocations: mergeList(local.goalAllocations, r.goalAllocations, deleted),
    reconciliations: mergeList(local.reconciliations, r.reconciliations, deleted),
    deleted,
    rates: withRates(local.rates, remote.data.lastRates),
  };
  // Archived years (js/archive.js): the newest archive choice decides what is archived; every record of both sides stays.
  if (local.settings.archive || r.settings.archive) {
    const s = settleArchive(merged.tx, local, r, deleted);
    merged.tx = s.tx;
    merged.settings = { ...merged.settings, archive: s.archive };
  }
  const localData = toCloud(local, '').data;
  const mergedData = toCloud(merged, '').data;
  return {
    state: merged,
    pullChanged: fingerprint(localData) !== fingerprint(mergedData),
    pushNeeded: fingerprint(toCloud({ ...r, settings: { ...r.settings } }, '').data) !== fingerprint(mergedData),
  };
}
