// Daily backups on the server (api/_backups.mjs, api/cron.mjs, /api/money backups|restore),
// against the real server code and a local stand-in for Turso. Made-up data.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeTurso } from '../e2e/faketurso.mjs';
import { startDevServer } from '../e2e/devserver.mjs';
import { createCloud } from '../js/cloud.js';
import { normalizeState, SCHEMA_VERSION } from '../js/model.js';
import { pruneBackups, listBackups, KEEP_DAYS } from '../api/_backups.mjs';
import { config } from '../api/_lib.mjs';

const SETUP = 'test-setup-key';
const PIN = '2468';
let turso;
let server;
before(async () => {
  turso = await startFakeTurso();
  server = await startDevServer({ env: { TURSO_URL: turso.url, TURSO_TOKEN: turso.token, CRON_SECRET: SETUP, SESSION_SECRET: 'test-session-secret' } });
  await post('/api/login', { setup: SETUP, pin: PIN });
});
after(async () => { await server?.close(); await turso?.close(); });

const post = (path, body, token) => fetch(`${server.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const transport = (path, body, token) => post(path, body, token);
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const tx = (id, amount) => ({ id, date: '2026-11-01', type: 'expense', amount, account: 'cash', category: 'food', note: `made-up ${id}`, createdAt: 1, updatedAt: 1 });
function device(initial) {
  let state = normalizeState({ version: SCHEMA_VERSION, tx: [], ...initial });
  const backups = [];
  const cloud = createCloud({ transport, store: memStore(), app: { getState: () => state, setState: (s) => { state = s; }, backup: async (l) => backups.push(l) } });
  return { cloud, backups, get state() { return state; }, set state(s) { state = s; } };
}
const cron = (job) => fetch(`${server.url}/api/cron?job=${job}`, { headers: { Authorization: `Bearer ${SETUP}` } }).then(async (r) => ({ status: r.status, json: await r.json() }));

test('only the scheduler runs the nightly job', async () => {
  const r = await fetch(`${server.url}/api/cron?job=morning`).then((x) => x.status);
  assert.equal(r, 401);
});

test('the nightly backup, then a restore that every device takes', async () => {
  const a = device({ tx: [tx('a1', 1000), tx('a2', 2000)] });
  await a.cloud.signIn(PIN);
  assert.equal((await a.cloud.sync()).ok, true);

  const night = await cron('morning');
  assert.equal(night.status, 200);
  assert.equal(night.json.backup.records, 2);
  const session = (await post('/api/login', { pin: PIN })).json.session;
  let list = (await post('/api/money', { op: 'backups' }, session)).json.backups;
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'daily');
  const nightly = list[0].id;

  // Something goes wrong: two records get deleted on a device and synced.
  const s = structuredClone(a.state);
  s.tx = [];
  s.deleted = { a1: Date.now(), a2: Date.now() };
  a.state = normalizeState(s);
  a.cloud.changed();
  await a.cloud.sync();
  const b = device();
  await b.cloud.signIn(PIN);
  await b.cloud.sync();
  assert.equal(b.state.tx.length, 0);

  // Restore last night's backup.
  const r = await post('/api/money', { op: 'restore', id: nightly }, session);
  assert.equal(r.status, 200);
  assert.equal(r.json.records, 2);
  assert.ok(r.json.before, 'how things were just before is saved too');
  list = (await post('/api/money', { op: 'backups' }, session)).json.backups;
  assert.equal(list.length, 2);
  assert.equal(list[0].kind, 'before-restore');

  // Both devices take the restored copy on their next sync, backing themselves up first.
  await b.cloud.sync();
  assert.deepEqual(b.state.tx.map((t) => t.id).sort(), ['a1', 'a2']);
  assert.ok(b.backups.length >= 1);
  await a.cloud.sync();
  assert.deepEqual(a.state.tx.map((t) => t.id).sort(), ['a1', 'a2']);
});

test('a device that signs in for the first time after a restore is merged, not replaced', async () => {
  // The server's copy keeps its restore mark. A new device (or the web app in a new browser) with
  // records of its own never synced before: the sign-in sheet promises a merge where nothing is deleted.
  const c = device({ tx: [tx('c1', 300)] });
  await c.cloud.signIn(PIN);
  assert.equal((await c.cloud.sync()).ok, true);
  assert.deepEqual(c.state.tx.map((t) => t.id).sort(), ['a1', 'a2', 'c1'], 'its own record is still here');
  assert.equal(c.backups.length, 0, 'nothing was replaced, so no "before a restore" backup');
  const d = device();
  await d.cloud.signIn(PIN);
  await d.cloud.sync();
  assert.ok(d.state.tx.some((t) => t.id === 'c1'), 'and it reached the server');
  // That device still takes the next restore like every other one.
  const session = (await post('/api/login', { pin: PIN })).json.session;
  const list = (await post('/api/money', { op: 'backups' }, session)).json.backups;
  const nightly = list.find((x) => x.kind === 'daily').id;
  assert.equal((await post('/api/money', { op: 'restore', id: nightly }, session)).status, 200);
  await c.cloud.sync();
  assert.deepEqual(c.state.tx.map((t) => t.id).sort(), ['a1', 'a2']);
  assert.equal(c.backups.length, 1);
});

test('back up now, and only the last 30 days are kept', async () => {
  const session = (await post('/api/login', { pin: PIN })).json.session;
  const now = await post('/api/money', { op: 'backup-now' }, session);
  assert.equal(now.status, 200);
  assert.equal(now.json.backup.kind, 'manual');
  const cfg = config({ TURSO_URL: turso.url, TURSO_TOKEN: turso.token });
  await pruneBackups(cfg, { now: Date.now() + (KEEP_DAYS + 1) * 86400_000 });
  assert.equal((await listBackups(cfg)).length, 0);
});
