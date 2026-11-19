// "Import from Life System": every file Life gives you reads, the preview
// counts right, and the merge keeps everything (newer edit wins, nothing deleted).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readLifeFile, incomingState, previewImport, mergeImport } from '../js/lifeimport.js';
import { normalizeState, SCHEMA_VERSION } from '../js/model.js';
import { deriveKey, seal, open } from '../js/cipher.js';

const tx = (id, amount, updatedAt, date = '2026-10-05') => ({ id, date, type: 'expense', amount, account: 'cash', category: 'food', note: `made-up ${id}`, createdAt: 1, updatedAt });
const lifeMoney = { version: SCHEMA_VERSION, settings: { updatedAt: 5, themeInLife: 'life' }, tx: [tx('a', 100, 10), tx('b', 250, 30), tx('c', 70, 5, '2026-09-01')], people: [], deleted: { gone: 40 } };

test('reads every kind of Life System file', () => {
  assert.equal(readLifeFile(JSON.stringify(lifeMoney)).kind, 'money');
  assert.equal(readLifeFile(JSON.stringify({ app: 'finance-helper', exportedAt: 'x', ...lifeMoney })).from, 'Finance Helper backup');
  assert.equal(readLifeFile(JSON.stringify({ savedAt: 1, editedAt: 2, data: lifeMoney })).state.tx.length, 3);
  assert.equal(readLifeFile(JSON.stringify({ tables: {}, financeState: lifeMoney })).state.tx.length, 3);
  assert.equal(readLifeFile(JSON.stringify({ financeState: JSON.stringify(lifeMoney) })).state.tx.length, 3);
  assert.equal(readLifeFile(JSON.stringify({ tables: { settings: [{ key: 'app_sync_finance', value: JSON.stringify({ savedAt: 1, data: lifeMoney }) }] } })).state.tx.length, 3);
  assert.throws(() => readLifeFile('nope'), /not JSON/);
  assert.throws(() => readLifeFile('{"days":{}}'), /No Money data/);
});

test('a locked Money file is opened with its PIN, here only', async () => {
  const key = await deriveKey('4321', 'c2FsdHNhbHRzYWx0c2FsdA==', 1000);
  const box = await seal(JSON.stringify(lifeMoney), key, 'c2FsdHNhbHRzYWx0c2FsdA==', 1000);
  const r = readLifeFile(JSON.stringify(box));
  assert.equal(r.kind, 'sealed');
  const opened = readLifeFile(await open(r.box, key));
  assert.equal(opened.state.tx.length, 3);
});

test('preview and merge: newer edit wins, records only here stay, nothing deleted', () => {
  const local = normalizeState({ version: SCHEMA_VERSION, settings: { theme: 'paper', updatedAt: 1 }, tx: [tx('a', 90, 20), tx('b', 200, 10), tx('gone', 5, 1), tx('mine', 1, 1)], people: [] });
  const inc = incomingState(readLifeFile(JSON.stringify(lifeMoney)).state);
  const p = previewImport(local, inc);
  assert.deepEqual({ add: p.add, update: p.update, same: p.same, keep: p.keep }, { add: 1, update: 1, same: 1, keep: 2 });
  assert.equal(p.first, '2026-09-01');
  const merged = mergeImport(local, inc);
  const byId = Object.fromEntries(merged.tx.map((t) => [t.id, t.amount]));
  assert.deepEqual(byId, { a: 90, b: 250, c: 70, gone: 5, mine: 1 });
  assert.equal(merged.settings.theme, 'paper', 'this device keeps its own look');
});
