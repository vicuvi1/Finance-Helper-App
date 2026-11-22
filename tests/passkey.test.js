import test from 'node:test';
import assert from 'node:assert/strict';
import { b64u, fromB64u, deviceLabel, hasLocalPasskey, setLocalPasskey, passkeyPossible } from '../js/passkey.js';

test('base64url round trip', () => {
  const bytes = new Uint8Array([0, 251, 255, 62, 63, 1, 2]);
  const t = b64u(bytes);
  assert.doesNotMatch(t, /[+/=]/);
  assert.deepEqual([...fromB64u(t)], [...bytes]);
  assert.equal(b64u(Buffer.from('hello')), Buffer.from('hello').toString('base64url'));
});

test('device label from the browser', () => {
  assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Windows PC (fingerprint)');
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 14)'), 'Android phone (fingerprint)');
  assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)'), 'iPhone (fingerprint)');
});

test('local flag and possibility', () => {
  const m = new Map();
  const store = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  assert.equal(hasLocalPasskey(store), false);
  setLocalPasskey(true, store);
  assert.equal(hasLocalPasskey(store), true);
  setLocalPasskey(false, store);
  assert.equal(hasLocalPasskey(store), false);
  assert.equal(passkeyPossible({}), false);
  assert.equal(passkeyPossible({ PublicKeyCredential: {}, navigator: { credentials: {} }, isSecureContext: true, location: { protocol: 'app:' } }), false);
  assert.equal(passkeyPossible({ PublicKeyCredential: {}, navigator: { credentials: {} }, isSecureContext: true, location: { protocol: 'https:' } }), true);
});
