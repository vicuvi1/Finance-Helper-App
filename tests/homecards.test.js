import test from 'node:test';
import assert from 'node:assert/strict';
import { showOnHome, setShown, applyPreset, HOME_CARDS, CALM } from '../js/homecards.js';
import { defaultState } from '../js/model.js';

test('everything shows until hidden; presets', () => {
  const s = defaultState();
  assert.ok(HOME_CARDS.every((c) => showOnHome(s, c.id)));
  setShown(s, 'jars', false, 5);
  assert.equal(showOnHome(s, 'jars'), false);
  assert.equal(s.settings.updatedAt, 5);
  setShown(s, 'jars', true, 6);
  assert.equal(showOnHome(s, 'jars'), true);
  applyPreset(s, 'calm', 7);
  assert.deepEqual(HOME_CARDS.filter((c) => showOnHome(s, c.id)).map((c) => c.id).sort(), [...CALM].sort());
  applyPreset(s, 'all', 8);
  assert.ok(HOME_CARDS.every((c) => showOnHome(s, c.id)));
});
