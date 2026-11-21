import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTES, notesSince, shouldShow } from '../js/whatsnew.js';
import { APP_VERSION } from '../js/version.js';

test('the newest note is for this version', () => {
  assert.equal(NOTES[0].v, APP_VERSION, 'add a line to js/whatsnew.js with each release');
});

test('shown once after an update, with the notes since the old version', () => {
  assert.deepEqual(notesSince('1.94.0', '1.96.0').map((n) => n.v), ['1.96.0', '1.95.0']);
  assert.equal(shouldShow({ previousVersion: '1.95.0' }, '1.96.0'), true);
  assert.equal(shouldShow({ previousVersion: '1.95.0', whatsNewSeen: '1.96.0' }, '1.96.0'), false);
  assert.equal(shouldShow({}, '1.96.0'), false, 'not on a first install');
});
