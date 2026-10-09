import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, save, flush, unlockStore, lockStore, enableEncryption, disableEncryption, wipeStore, isEncrypted, isPlaceholder, backupText, openImported, isSealed, STORAGE_KEYS } from '../js/store.js';
import { createLock } from '../js/lock.js';

function memory() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), dump: () => [...m.values()].join('\n'), has: (k) => m.has(k) };
}

async function withData(storage) {
  const s = load(storage);
  s.tx.push({ id: 't1', type: 'expense', amount: 4500, date: '2026-03-02', category: 'food', account: 'wallet', note: 'secret pizza', createdAt: 1, updatedAt: 1 });
  s.meta.lock = await createLock('2580');
  s.settings.theme = 'dark';
  save(s, storage);
  return s;
}

test('plain storage round-trips', async () => {
  const st = memory();
  await withData(st);
  assert.equal(load(st).tx[0].note, 'secret pizza');
  assert.equal(isEncrypted(st), false);
});

test('encryption hides the data and needs the PIN', async () => {
  const st = memory();
  const s = await withData(st);
  await enableEncryption(s, '2580', { storage: st, iter: 1000 });
  assert.equal(isEncrypted(st), true);
  assert.ok(!st.has(STORAGE_KEYS.KEY), 'readable copy removed');
  assert.ok(!st.dump().includes('secret pizza'));
  assert.ok(!st.dump().includes('4500'));

  // A later edit is sealed too.
  s.tx[0].note = 'secret sushi';
  assert.equal(save(s, st), true);
  await flush();
  assert.ok(!st.dump().includes('secret sushi'));

  await lockStore();
  const ph = load(st);
  assert.ok(isPlaceholder(ph));
  assert.equal(ph.tx.length, 0);
  assert.ok(ph.meta.lock?.hash, 'lock screen still knows the PIN hash');
  assert.equal(ph.settings.theme, 'dark');

  // The placeholder never overwrites the real data, but lock fields save.
  ph.meta.lockFails = 2;
  save(ph, st);
  await assert.rejects(unlockStore('0000', st), /Wrong PIN/);
  const back = await unlockStore('2580', st);
  assert.equal(back.tx[0].note, 'secret sushi');
  assert.equal(back.meta.lockFails, 2);
});

test('without the key nothing is written', async () => {
  const st = memory();
  const s = await withData(st);
  await enableEncryption(s, '2580', { storage: st, iter: 1000 });
  await lockStore();
  const before = st.getItem(STORAGE_KEYS.ENC);
  assert.equal(save(s, st), false);
  await flush();
  assert.equal(st.getItem(STORAGE_KEYS.ENC), before);
});

test('backups are sealed while encrypted and open with the PIN', async () => {
  const st = memory();
  const s = await withData(st);
  await enableEncryption(s, '2580', { storage: st, iter: 1000 });
  const text = await backupText(s);
  assert.ok(!text.includes('secret pizza'));
  const box = JSON.parse(text);
  assert.ok(isSealed(box));
  assert.match(await openImported(box), /secret pizza/);
  await lockStore();
  await assert.rejects(openImported(box), /encrypted/);
  assert.match(await openImported(box, '2580'), /secret pizza/);
  await assert.rejects(openImported(box, '1111'), /Wrong PIN/);
});

test('turning it off, and wiping', async () => {
  const st = memory();
  const s = await withData(st);
  await enableEncryption(s, '2580', { storage: st, iter: 1000 });
  await disableEncryption(s, st);
  assert.equal(isEncrypted(st), false);
  assert.equal(load(st).tx[0].note, 'secret pizza');
  assert.match(await backupText(s), /secret pizza/); // plain backups again
  wipeStore(st);
  assert.equal(load(st).tx.length, 0);
});
