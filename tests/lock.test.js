import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLock, checkPin, validPin, waitAfter } from '../js/lock.js';

test('a PIN is stored only as a salted hash and checks correctly', async () => {
  const lock = await createLock('2580');
  assert.ok(!JSON.stringify(lock).includes('2580'));
  assert.equal(lock.salt.length, 24);
  assert.equal(await checkPin(lock, '2580'), true);
  assert.equal(await checkPin(lock, '2581'), false);
  const again = await createLock('2580');
  assert.notEqual(again.hash, lock.hash); // different salt each time
});

test('PIN rules and back-off after wrong tries', () => {
  assert.match(validPin('12'), /at least 4/);
  assert.equal(validPin('1234'), null);
  assert.equal(waitAfter(4), 0);
  assert.equal(waitAfter(5), 30000);
  assert.equal(waitAfter(6), 60000);
  assert.equal(waitAfter(20), 900000);
});
