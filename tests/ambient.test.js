import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AmbientMusic } from '../js/ambient.js';

test('AmbientMusic: has valid tracks list', () => {
  assert.ok(Array.isArray(AmbientMusic.TRACKS));
  assert.ok(AmbientMusic.TRACKS.length >= 3);
  const ids = AmbientMusic.TRACKS.map((t) => t.id);
  assert.ok(ids.includes('sakura'));
  assert.ok(ids.includes('temple'));
  assert.ok(ids.includes('rain'));
});

test('AmbientMusic: getState returns state object and tracks track changes', () => {
  const initial = AmbientMusic.getState();
  assert.equal(typeof initial.playing, 'boolean');
  assert.equal(typeof initial.volume, 'number');

  AmbientMusic.setTrack('temple');
  assert.equal(AmbientMusic.getState().track, 'temple');

  AmbientMusic.setTrack('non-existent');
  assert.equal(AmbientMusic.getState().track, 'temple');

  AmbientMusic.nextTrack();
  assert.equal(AmbientMusic.getState().track, 'rain');

  AmbientMusic.nextTrack();
  assert.equal(AmbientMusic.getState().track, 'sakura');
});

test('AmbientMusic: setVolume clamps values within 0 and 1', () => {
  AmbientMusic.setVolume(0.5);
  assert.equal(AmbientMusic.getState().volume, 0.5);

  AmbientMusic.setVolume(1.5);
  assert.equal(AmbientMusic.getState().volume, 1);

  AmbientMusic.setVolume(-0.2);
  assert.equal(AmbientMusic.getState().volume, 0);

  AmbientMusic.setVolume('invalid');
  assert.equal(AmbientMusic.getState().volume, 0);

  // Restore reasonable default
  AmbientMusic.setVolume(0.35);
  assert.equal(AmbientMusic.getState().volume, 0.35);
});

test('AmbientMusic: subscribe notifies listeners on changes', () => {
  let calls = 0;
  let received = null;
  const unsub = AmbientMusic.subscribe((st) => {
    calls++;
    received = st;
  });

  AmbientMusic.setTrack('rain');
  assert.ok(calls >= 1);
  assert.equal(received.track, 'rain');

  unsub();
  const prevCalls = calls;
  AmbientMusic.setTrack('sakura');
  assert.equal(calls, prevCalls);
});

test('AmbientMusic: safe invocation of playback controls in node', () => {
  assert.doesNotThrow(() => AmbientMusic.play());
  assert.doesNotThrow(() => AmbientMusic.pause());
  assert.doesNotThrow(() => AmbientMusic.toggle());
});
