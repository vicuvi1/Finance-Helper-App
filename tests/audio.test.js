import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sound } from '../js/audio.js';

test('audio: sound functions run safely without error in node environment', () => {
  assert.doesNotThrow(() => sound.click());
  assert.doesNotThrow(() => sound.click({ settings: { sound: true } }));
  assert.doesNotThrow(() => sound.click({ settings: { sound: false } }));
  assert.doesNotThrow(() => sound.expense({ settings: { sound: true } }));
  assert.doesNotThrow(() => sound.income({ settings: { sound: true } }));
  assert.doesNotThrow(() => sound.chime({ settings: { sound: true } }));
  assert.doesNotThrow(() => sound.test({ settings: { sound: true } }));
});
