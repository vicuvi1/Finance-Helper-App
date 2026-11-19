// The server's doors (api/_sqlguard.mjs from Life System, kept as it is):
// server-only tables and statements that reach past the data are refused,
// backups are read-only, and no handler answers without a session.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pipelineProblem, pipelineWrites, stmtProblem } from '../api/_sqlguard.mjs';
import { schemaTooOld, SCHEMA_VERSION } from '../api/_schema.mjs';
import dbHandler from '../api/db.mjs';
import moneyHandler from '../api/money.mjs';
import loginHandler from '../api/login.mjs';

const ex = (sql, args = []) => ({ requests: [{ type: 'execute', stmt: { sql, args } }] });

test('server tables, PIN hash, ATTACH and PRAGMA are refused', () => {
  for (const sql of ['SELECT * FROM sys_auth', 'select * from "sys_auth"', 'SELECT * FROM [sys_login_guard]', 'DELETE FROM sys_devices', 'SELECT * FROM sys_newthing', 'PRAGMA table_info(settings)', "ATTACH DATABASE 'x' AS y", 'SELECT * FROM pragma_table_info("settings")', 'VACUUM', 'SELECT load_extension("x")', "SELECT value FROM settings WHERE key = 'pin_hash'"]) {
    assert.ok(pipelineProblem(ex(sql)), sql);
  }
  assert.ok(pipelineProblem(ex('SELECT value FROM settings WHERE key = ?', [{ type: 'text', value: 'pin_hash' }])));
  assert.ok(stmtProblem({ sql: "SELECT 'unclosed" }));
  assert.ok(pipelineProblem({ requests: [{ type: 'store_sql', sql: 'x' }] }));
  assert.ok(pipelineProblem({ baton: 'b', requests: [] }));
});

test('the app\'s own data and the sync bookkeeping pass; backups are read-only', () => {
  assert.equal(pipelineProblem(ex("SELECT value FROM settings WHERE key = 'app_sync_finance'")), null);
  assert.equal(pipelineProblem(ex('INSERT INTO sys_cas (ok) VALUES (1)')), null);
  assert.equal(pipelineProblem(ex('SELECT * FROM cloud_snapshots')), null);
  assert.ok(pipelineProblem(ex('DELETE FROM cloud_snapshots')));
  assert.equal(pipelineWrites(ex('SELECT 1')), false);
  assert.equal(pipelineWrites(ex('UPDATE settings SET value = 1')), true);
});

test('an older page may read but not write (schema rule)', () => {
  assert.equal(SCHEMA_VERSION, 25);
  assert.equal(schemaTooOld('24'), true);
  assert.equal(schemaTooOld('25'), false);
  assert.equal(schemaTooOld(undefined), false);
});

function call(handler, req) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: b ? JSON.parse(b) : null }); } };
    handler({ method: 'POST', headers: {}, url: '/', body: {}, ...req }, res);
  });
}

test('no session, no data; no server keys is a 503', async () => {
  const saved = { url: process.env.TURSO_URL, token: process.env.TURSO_TOKEN };
  try {
    delete process.env.TURSO_URL;
    delete process.env.TURSO_TOKEN;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    assert.equal((await call(moneyHandler, {})).status, 503);
    process.env.TURSO_URL = 'libsql://fake.turso.io';
    process.env.TURSO_TOKEN = 'k';
    assert.equal((await call(dbHandler, { headers: { authorization: 'Bearer forged.token' } })).status, 401);
    assert.equal((await call(moneyHandler, { headers: { authorization: 'Bearer forged.token' }, body: { op: 'read' } })).status, 401);
    assert.equal((await call(moneyHandler, { method: 'GET' })).status, 405);
    assert.equal((await call(loginHandler, { method: 'GET' })).status, 405);
  } finally {
    for (const [k, v] of [['TURSO_URL', saved.url], ['TURSO_TOKEN', saved.token]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
