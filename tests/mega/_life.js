// The bits of Life System's sync that Money's ported tests use, rebuilt from
// this app's own modules (Life's src/renderer/src/web/financeSync.ts FINANCE
// spec and appSync.ts gapOf): the same share / merge / gap rules the server
// and js/cloud.js use here.
import { mergeStates, toCloud, LOCAL_SETTINGS } from '../../js/sync.js';
import { normalizeState, SCHEMA_VERSION } from '../../js/model.js';
import { canonical } from '../../js/parts.js';

const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
export { canonical };

/** What `theirs` lacks from `mine` (both as they travel): records and other changes. */
export function gapOf(mine, theirs) {
  const out = { records: 0, other: 0 };
  const walk = (a, b) => {
    if (Array.isArray(a)) {
      if (!Array.isArray(b)) { out.records += a.length; return; }
      const have = new Set(b.map(canonical));
      for (const x of a) if (!have.has(canonical(x))) out.records++;
      return;
    }
    if (isPlain(a)) {
      if (!isPlain(b)) { out.other++; return; }
      for (const k of Object.keys(a)) {
        if (a[k] === undefined) continue;
        if (!(k in b)) { if (Array.isArray(a[k])) out.records += a[k].length; else out.other++; continue; }
        walk(a[k], b[k]);
      }
      return;
    }
    if (a !== b && !(a == null && b == null)) out.other++;
  };
  walk(mine, theirs);
  return out;
}

const remote = (data) => ({ app: 'finance-helper', schema: SCHEMA_VERSION, savedAt: 0, data });
const share = (state) => toCloud(normalizeState(state), '').data;
const withoutRates = ({ lastRates: _r, ...rest } = {}) => rest;
const ratesDay = (data) => String(data?.lastRates?.date ?? '');

export function financeGap(mine, theirs) {
  const base = normalizeState({ ...(theirs ?? {}), version: SCHEMA_VERSION });
  const mineShared = share(mine);
  const both = mergeStates(base, remote(mineShared)).state;
  const gap = gapOf(withoutRates(share(both)), withoutRates(theirs));
  if (ratesDay(mineShared) > ratesDay(theirs)) gap.other++;
  return gap;
}

export const FINANCE = {
  localKey: 'finance-helper.state',
  setting: 'app_sync_finance',
  label: 'Money',
  legacySetting: 'finance_backup_json',
  event: 'life-finance-changed',
  share,
  fromShared: (data) => normalizeState({ ...data, version: SCHEMA_VERSION }),
  merge: (mine, theirs) => mergeStates(normalizeState(mine), remote(theirs)).state,
  adopt: (mine, data) => {
    const { lastRates: _rates, settings, ...rest } = data ?? {};
    if (!settings || typeof settings !== 'object') return normalizeState({ ...mine, ...rest, version: SCHEMA_VERSION });
    const own = {};
    for (const k of LOCAL_SETTINGS) if (mine?.settings && k in mine.settings) own[k] = mine.settings[k];
    return normalizeState({ ...mine, ...rest, settings: { ...settings, ...own }, version: SCHEMA_VERSION });
  },
  gap: financeGap,
};
