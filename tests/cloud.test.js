// The server (api/*.mjs) and the cloud sync (js/cloud.js) end to end, against
// a local SQLite database through a fake Turso (e2e/faketurso.mjs), with
// made-up data: first PIN, sign-in, a web and a desktop-like client syncing
// both ways, a big copy in pieces, healing a lost piece, a database hiccup
// (503, never a sign-out), and data Life System wrote reading as it is.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeTurso } from '../e2e/faketurso.mjs';
import { startDevServer } from '../e2e/devserver.mjs';
import { createCloud } from '../js/cloud.js';
import { normalizeState, SCHEMA_VERSION } from '../js/model.js';
import { manifestOf } from '../js/parts.js';

const SETUP = 'test-setup-key';
let turso;
let server;

before(async () => {
  turso = await startFakeTurso();
  server = await startDevServer({ env: { TURSO_URL: turso.url, TURSO_TOKEN: turso.token, CRON_SECRET: SETUP, SESSION_SECRET: 'test-session-secret' } });
});
after(async () => {
  await server?.close();
  await turso?.close();
});

const transport = (path, body, token) => fetch(`${server.url}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

let t0 = Date.parse('2026-11-01T10:00:00Z');
const tx = (id, amount, extra = {}) => ({ id, date: '2026-11-01', type: 'expense', amount, account: 'cash', category: 'food', note: `made-up ${id}`, createdAt: t0, updatedAt: t0++, ...extra });

function client(initial) {
  let state = normalizeState({ version: SCHEMA_VERSION, tx: [], ...initial });
  const backups = [];
  const app = { getState: () => state, setState: (s) => { state = s; }, backup: async (label) => backups.push(label) };
  const cloud = createCloud({ transport, store: memStore(), app });
  return { cloud, get state() { return state; }, set state(s) { state = s; }, edit(fn) { state = fn(structuredClone(state)); cloud.changed(); }, backups };
}

test('no default PIN: a login before the first PIN is refused, the setup key sets it', async () => {
  const r = await transport('/api/login', { pin: '1234' });
  assert.equal(r.status, 409);
  assert.equal(r.json.setup, true);
  const bad = await transport('/api/login', { setup: 'wrong', pin: '2468' });
  assert.equal(bad.status, 401);
  const ok = await transport('/api/login', { setup: SETUP, pin: '2468' });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.session);
});

test('wrong PIN is refused; money needs a session', async () => {
  const c = client();
  await assert.rejects(c.cloud.signIn('0000'), /Wrong PIN/);
  const r = await transport('/api/money', { op: 'read' }, 'not-a-session');
  assert.equal(r.status, 401);
});

test('/api/db keeps Life System\'s guards: no sys_auth, no PRAGMA', async () => {
  const s = (await transport('/api/login', { pin: '2468' })).json.session;
  const q = (sql) => transport('/api/db', { requests: [{ type: 'execute', stmt: { sql } }, { type: 'close' }] }, s);
  assert.equal((await q('SELECT * FROM sys_auth')).status, 403);
  assert.equal((await q('PRAGMA table_info(settings)')).status, 403);
  assert.equal((await q("SELECT value FROM settings WHERE key = 'pin_hash'")).status, 403);
  assert.equal((await q('SELECT 1')).status, 200);
});

test('web and desktop clients sync both ways; deletions stick; newer edit wins', async () => {
  const web = client({ tx: [tx('w1', 100)] });
  const desk = client({ tx: [tx('d1', 200)] });
  await web.cloud.signIn('2468');
  await desk.cloud.signIn('2468');
  assert.equal((await web.cloud.sync()).ok, true);
  assert.equal((await desk.cloud.sync()).ok, true);
  await web.cloud.sync();
  assert.deepEqual(web.state.tx.map((t) => t.id).sort(), ['d1', 'w1']);
  assert.deepEqual(desk.state.tx.map((t) => t.id).sort(), ['d1', 'w1']);
  assert.equal(web.cloud.status.state, 'ok');

  // An edit on the desktop, a delete on the web.
  desk.edit((s) => { s.tx.find((t) => t.id === 'w1').amount = 150; s.tx.find((t) => t.id === 'w1').updatedAt = t0++; return s; });
  web.edit((s) => { s.deleted = { ...s.deleted, d1: t0++ }; s.tx = s.tx.filter((t) => t.id !== 'd1'); return s; });
  await desk.cloud.sync();
  await web.cloud.sync();
  await desk.cloud.sync();
  for (const c of [web, desk]) {
    assert.deepEqual(c.state.tx.map((t) => [t.id, t.amount]), [['w1', 150]]);
  }
});

test('offline edits are kept and sent once online; a database hiccup is a 503, not a sign-out', async () => {
  const c = client({ tx: [tx('o1', 10)] });
  await c.cloud.signIn('2468');
  await c.cloud.sync();
  c.edit((s) => { s.tx.push(tx('o2', 20)); return s; });
  c.edit((s) => { s.tx.push(tx('o3', 30)); return s; });
  turso.state.down = true;
  const r = await c.cloud.sync();
  assert.equal(r.ok, false);
  assert.equal(c.cloud.config.signedIn, true, 'still signed in');
  assert.equal(c.cloud.config.dirty, true, 'changes still waiting');
  assert.match(c.cloud.status.error, /not reachable/);
  turso.state.down = false;
  assert.equal((await c.cloud.sync()).ok, true);
  const other = client();
  await other.cloud.signIn('2468');
  await other.cloud.sync();
  assert.ok(['o1', 'o2', 'o3'].every((id) => other.state.tx.some((t) => t.id === id)));
});

test('a big copy travels in pieces, reads back whole, and a lost piece is healed', async () => {
  const big = client({ tx: Array.from({ length: 2500 }, (_, i) => tx(`b${i}`, i + 1)) });
  await big.cloud.signIn('2468');
  assert.equal((await big.cloud.sync()).ok, true);
  const [[raw]] = turso.db.prepare("SELECT value FROM settings WHERE key = 'app_sync_finance'").all().map((r) => Object.values(r));
  assert.ok(raw.startsWith('{"lifeParts":1,'), 'stored as a manifest');
  const fresh = client();
  await fresh.cloud.signIn('2468');
  await fresh.cloud.sync();
  assert.ok(fresh.state.tx.length >= 2500);
  // A piece goes missing on the server: the device that holds the copy puts it back.
  const one = turso.db.prepare("SELECT id FROM setting_parts WHERE key = 'app_sync_finance' LIMIT 1").all()[0].id;
  turso.db.prepare('DELETE FROM setting_parts WHERE id = ?').run(one);
  assert.equal((await big.cloud.sync({ check: true })).ok, true);
  assert.equal(turso.db.prepare('SELECT COUNT(*) AS n FROM setting_parts WHERE id = ?').all(one)[0].n, 1);
});

test('a copy Life System wrote (manifest + pieces) reads as it is, and Life keeps reading ours', async () => {
  const data = { settings: { updatedAt: 1 }, tx: Array.from({ length: 3000 }, (_, i) => tx(`life${i}`, 5)), people: [], deleted: {} };
  const text = JSON.stringify({ savedAt: 5, editedAt: 7, data });
  const { manifest, parts } = manifestOf('app_sync_finance', text);
  turso.db.exec('CREATE TABLE IF NOT EXISTS setting_parts (key TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (key, id))');
  for (const p of parts) turso.db.prepare('INSERT OR IGNORE INTO setting_parts (key, id, data, at) VALUES (?, ?, ?, ?)').run('app_sync_finance', p.id, p.text, Date.now());
  turso.db.prepare("INSERT INTO settings (key, value) VALUES ('app_sync_finance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(manifest);
  const c = client({ tx: [tx('mine1', 9)] });
  await c.cloud.signIn('2468');
  assert.equal((await c.cloud.sync()).ok, true);
  assert.equal(c.state.tx.filter((t) => t.id.startsWith('life')).length, 3000);
  // What the server holds now is {savedAt, editedAt, data} with both sides, edit time after Life's.
  const raw = turso.db.prepare("SELECT value FROM settings WHERE key = 'app_sync_finance'").all()[0].value;
  const res = await transport('/api/money', { op: 'read' }, (await transport('/api/login', { pin: '2468' })).json.session);
  assert.equal(res.json.raw, raw);
  const dv = turso.db.prepare("SELECT value FROM settings WHERE key = 'data_version'").all()[0]?.value;
  assert.ok(dv, 'Life devices are told something changed');
});

test('forgot the PIN: the setup key sets a new one, the old PIN and old sessions stop working', async () => {
  const before = await transport('/api/login', { pin: '2468' });
  assert.equal(before.status, 200);
  const oldSession = before.json.session;
  assert.equal((await transport('/api/money', { op: 'read' }, oldSession)).status, 200);
  // A wrong key is refused and changes nothing.
  assert.equal((await transport('/api/login', { reset: 'wrong', pin: '1357' })).status, 401);
  assert.equal((await transport('/api/login', { pin: '2468' })).status, 200);
  // A PIN that is not 4 to 8 digits is refused.
  assert.equal((await transport('/api/login', { reset: SETUP, pin: '12' })).status, 400);
  // The app's "Forgot your PIN?": the key and a new PIN sign this device in.
  const c = client();
  await assert.rejects(c.cloud.signIn('1357', { setupKey: 'nope' }), /Wrong setup key/);
  assert.equal(await c.cloud.signIn('1357', { setupKey: SETUP }), true);
  assert.equal((await c.cloud.sync()).ok, true);
  // The old PIN and every older session are done.
  assert.equal((await transport('/api/login', { pin: '2468' })).status, 401);
  assert.equal((await transport('/api/money', { op: 'read' }, oldSession)).status, 401);
  assert.equal((await transport('/api/login', { pin: '1357' })).status, 200);
});

test('change the server PIN from the app; list devices and sign one out', async () => {
  const c = client();
  await c.cloud.signIn('1357');
  await assert.rejects(c.cloud.changePin('0000', '8642'), /current PIN is wrong/);
  assert.equal(await c.cloud.changePin('1357', '8642'), true);
  assert.equal((await c.cloud.sync()).ok, true, 'this device stays signed in');
  assert.equal((await transport('/api/login', { pin: '8642' })).status, 200);
  assert.equal((await transport('/api/login', { pin: '1357' })).status, 401);
  const other = client();
  await other.cloud.signIn('8642');
  const list = await c.cloud.devices();
  assert.ok(list.devices.length >= 1);
  assert.ok(list.current);
  const theirs = list.devices.find((d) => d.sid !== list.current);
  if (theirs) {
    await c.cloud.revokeDevice(theirs.sid);
    assert.equal((await c.cloud.devices()).devices.some((d) => d.sid === theirs.sid), false);
  }
});

test('a sync with nothing new on either side is one small read, no merge', async () => {
  const c = client({ tx: [tx('fast1', 1234)] });
  await c.cloud.signIn('8642');
  assert.equal((await c.cloud.sync()).ok, true);
  const before = c.state;
  const r = await c.cloud.sync();
  assert.equal(r.ok, true);
  assert.equal(r.same, true);
  assert.equal(c.state, before, 'the data is not touched');
  // Another device changes something: the next sync merges it as usual.
  const d = client();
  await d.cloud.signIn('8642');
  await d.cloud.sync();
  d.edit((s) => { s.tx.push(tx('fast2', 99)); return s; });
  await d.cloud.sync();
  const r2 = await c.cloud.sync();
  assert.equal(r2.same, undefined);
  assert.ok(c.state.tx.some((t) => t.id === 'fast2'));
});
