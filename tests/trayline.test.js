import test from 'node:test';
import assert from 'node:assert/strict';
import { trayLine } from '../js/trayline.js';
import { defaultState } from '../js/model.js';

test('trayLine says what is safe to spend today', () => {
  const s = defaultState();
  const r = trayLine(s, '2026-11-22');
  assert.match(r.line, /^Safe to spend today: /);
  assert.ok(r.tip.startsWith('Finance Helper\n'));
});

test('trayLine shows no amount when locked or hidden', () => {
  assert.deepEqual(trayLine({ _sealed: true }, '2026-11-22'), { tip: 'Finance Helper (locked)', line: '' });
  assert.equal(trayLine(defaultState(), '2026-11-22', { hidden: true }).line, '');
});
