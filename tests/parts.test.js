// js/parts.js must name and cut pieces exactly as Life System does (its
// src/core/textHash.ts and settingParts.ts): the values below were made by
// Life System's own code. If one changes, stored pieces no longer match.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hash64, splitText, manifestOf, parseManifest, assemble, WHOLE_UP_TO } from '../js/parts.js';

const big = JSON.stringify({ savedAt: 1, editedAt: 2, data: { tx: Array.from({ length: 4000 }, (_, i) => ({ id: 't' + i, date: '2026-01-' + String(1 + (i % 28)).padStart(2, '0'), amount: i * 7, note: 'Coffee ☕ ' + i })) } });

test('hash64 matches Life System', () => {
  assert.deepEqual([hash64(''), hash64('abc'), hash64('Coffee ☕')], ['488bdcb81aee8d83', '9bd099588f6f1534', 'b2126052b58feaa8']);
});

test('pieces and manifest match Life System', () => {
  assert.equal(big.length, 288233);
  assert.deepEqual(splitText(big).map((p) => p.length), [24929, 17640, 8540, 10500, 15754, 9216, 8136, 14665, 15695, 10512, 13797, 18907, 37303, 10512, 19491, 13359, 17666, 21611]);
  const { manifest, parts } = manifestOf('app_sync_finance', big);
  const m = parseManifest(manifest);
  assert.equal(m.sum, 'df609b0c6e2037c6');
  assert.equal(m.p[0], 'e1ee388a2a3ef0eb');
  const byId = new Map(parts.map((p) => [p.id, p.text]));
  assert.equal(assemble(m, (id) => byId.get(id)), big);
  assert.throws(() => assemble(m, (id) => (id === m.p[3] ? 'x' : byId.get(id))), /damaged/);
  assert.throws(() => assemble(m, (id) => (id === m.p[3] ? undefined : byId.get(id))), /missing/);
  assert.ok(WHOLE_UP_TO < big.length);
});

test('a damaged manifest is not a manifest', () => {
  const { manifest } = manifestOf('app_sync_finance', big);
  assert.equal(parseManifest(manifest.replace('"len":288233', '"len":288234')), null);
  assert.equal(parseManifest('{"savedAt":1}'), null);
});
