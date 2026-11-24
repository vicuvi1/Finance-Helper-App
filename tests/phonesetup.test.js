import test from 'node:test';
import assert from 'node:assert/strict';
import { setupItems, problems } from '../js/phonesetup.js';
import { defaultState } from '../js/model.js';

test('setup check: what is missing, with a fix for each', () => {
  const s = defaultState();
  const card = s.settings.accounts.find((a) => a.kind === 'card') || Object.assign(s.settings.accounts[0], { kind: 'card' });
  card.last4 = '';
  const bad = problems({ listener: false, banks: 0, battery: false, notify: true, promoted: false, capture: true }, s).map((x) => x.id);
  assert.deepEqual(bad.sort(), ['banks', 'battery', 'cards', 'listener', 'promoted'].sort());
  card.last4 = '4821';
  for (const a of s.settings.accounts) if (a.kind === 'card' || a.kind === 'virtual') a.last4 = '1234';
  assert.equal(problems({ listener: true, banks: 1, battery: true, notify: true, promoted: null, capture: true }, s).length, 0);
  assert.equal(setupItems({ battery: false }, s).find((x) => x.id === 'battery').fix, 'battery');
});
