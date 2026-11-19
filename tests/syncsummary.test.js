// The line under the app's name says, in plain words, whether this device is in step with the server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncSummary } from '../js/cloud.js';

const now = 1_800_000_000_000;

test('no server here (plain file server): data stays on this device', () => {
  assert.deepEqual(syncSummary({ server: false }), { text: 'On this device only', tone: 'off', act: '' });
});

test('signed out: asks to sign in, a click opens the sign-in', () => {
  const s = syncSummary({ signedIn: false });
  assert.equal(s.text, 'Not synced · Sign in');
  assert.equal(s.act, 'cloud-signin');
});

test('in step: says how long ago, in plain words', () => {
  assert.equal(syncSummary({ signedIn: true, state: 'ok', okAt: now - 10_000, now }).text, 'Synced just now');
  assert.equal(syncSummary({ signedIn: true, state: 'ok', okAt: now - 5 * 60_000, now }).text, 'Synced 5 min ago');
  const old = syncSummary({ signedIn: true, state: 'ok', okAt: now - 3 * 3600_000, now });
  assert.equal(old.text, 'Synced 3 h ago');
  assert.equal(old.tone, 'warn');
});

test('busy, offline, waiting changes, problems', () => {
  assert.equal(syncSummary({ signedIn: true, busy: true }).text, 'Syncing…');
  assert.equal(syncSummary({ signedIn: true, online: false, dirty: true }).text, 'Offline · changes wait');
  assert.equal(syncSummary({ signedIn: true, dirty: true, okAt: now, now }).text, 'Sending changes…');
  const err = syncSummary({ signedIn: true, state: 'error', okAt: now, now });
  assert.equal(err.text, 'Sync problem · Retry');
  assert.equal(err.act, 'cloud-sync');
  assert.equal(syncSummary({ signedIn: true, state: 'signedout' }).act, 'cloud-signin');
  assert.equal(syncSummary({ signedIn: true, okAt: 0 }).text, 'Not synced yet · Sync');
});
