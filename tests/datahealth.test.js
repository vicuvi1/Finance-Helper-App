// Data & health numbers (js/datahealth.js). Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, dataCounts, recordsPerMonth, roomLeft, yearsText, healthChecks, deviceName, SERVER_LIMIT } from '../js/datahealth.js';

test('sizes in plain units', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1024 ** 2), '5.0 MB');
  assert.equal(formatBytes(SERVER_LIMIT), '5.0 GB');
});

test('what is in the data, and the pace', () => {
  const tx = [];
  for (let i = 0; i < 90; i++) tx.push({ id: `t${i}`, date: `2026-${['08', '09', '10'][i % 3]}-1${i % 9}` });
  const s = { tx, recurring: [{}], settings: { accounts: [{}, { archived: true }], categories: [{}] }, deleted: { a: 1 } };
  const c = dataCounts(s);
  assert.equal(c.records, 90);
  assert.equal(c.accounts, 1);
  assert.equal(c.deleted, 1);
  assert.equal(c.first, '2026-08-10');
  assert.equal(recordsPerMonth(s, '2026-11-20'), 30);
});

test('how long the room lasts', () => {
  const r = roomLeft({ used: 1024 ** 3, limit: 2 * 1024 ** 3, bytes: 1000 * 400, records: 1000, perMonthRecords: 100 });
  assert.equal(r.perMonth, 48000); // 400 B a record × 100 a month × 1.2
  assert.equal(r.pct, 50);
  assert.equal(r.years, null, 'more than 100 years');
  assert.equal(yearsText(null), 'more than 100 years');
  assert.equal(yearsText(2.34), 'about 2.3 years');
  assert.equal(yearsText(0.5), 'about 6 months');
  const tight = roomLeft({ used: 90, limit: 100, bytes: 100, records: 10, perMonthRecords: 10 });
  assert.ok(tight.years < 1);
});

test('checks say plainly what is wrong', () => {
  const c = healthChecks({ sync: { signedIn: false }, server: { used: 95, limit: 100, pct: 95, years: 0.1 }, bot: { on: false, why: 'No token' }, update: { version: '1.0.0', waiting: false }, lastBackup: 0, now: 10 });
  assert.deepEqual(c.map((x) => [x.id, x.level]), [['sync', 'bad'], ['server', 'bad'], ['bot', 'warn'], ['update', 'ok'], ['backup', 'warn']]);
  assert.match(c[0].text, /Sign in/);
  assert.equal(healthChecks({ lock: { on: true, minutes: 5 } })[0].level, 'ok');
  assert.match(healthChecks({ lock: { on: false } })[0].text, /Settings → Security/);
  assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0) Electron/33'), 'Desktop app · Windows');
});
