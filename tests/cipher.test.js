import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveKey, seal, open, openWithPin, newSalt, isSealed } from '../js/cipher.js';

test('seals and opens with the same PIN, refuses another', async () => {
  const salt = newSalt();
  const key = await deriveKey('2580', salt, 1000);
  const box = await seal('{"note":"secret lunch"}', key, salt, 1000);
  assert.ok(isSealed(box));
  assert.ok(!JSON.stringify(box).includes('secret'));
  assert.equal(await open(box, key), '{"note":"secret lunch"}');
  assert.equal(await openWithPin(box, '2580'), '{"note":"secret lunch"}');
  await assert.rejects(openWithPin(box, '0000'), /Wrong PIN/);
  const again = await seal('{"note":"secret lunch"}', key, salt, 1000);
  assert.notEqual(again.ct, box.ct); // fresh IV every time
});

test('handles large data', async () => {
  const salt = newSalt();
  const key = await deriveKey('pin', salt, 1000);
  const big = JSON.stringify({ tx: Array.from({ length: 20000 }, (_, i) => ({ id: `t${i}`, note: 'x'.repeat(20) })) });
  assert.equal(await open(await seal(big, key, salt, 1000), key), big);
});
