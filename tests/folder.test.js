import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { createFolderSync, findDriveFolder } = require('../electron/folder.cjs');

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'fh-folder-'));
  const prefs = {};
  const f = createFolderSync({ getPref: (k) => prefs[k], setPref: (k, v) => { prefs[k] = v; }, dialog: null, shell: null, win: () => null });
  return { dir, prefs, f, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('use a folder, push, pull, snapshots', () => {
  const { dir, prefs, f, done } = setup();
  assert.equal(f.status().connected, false);
  assert.throws(() => f.use(join(dir, 'missing')), /does not exist/);
  f.use(dir);
  assert.equal(prefs.syncFolder, dir);
  assert.equal(f.status().connected, true);
  assert.equal(f.pull(), null, 'nothing there yet');
  f.push('{"a":1}');
  assert.equal(f.pull(), '{"a":1}');
  assert.ok(existsSync(join(dir, 'Finance Helper', 'finance-helper-sync.json')));
  f.putSnapshot('finance-helper-2026-10-10.json', 'x');
  assert.throws(() => f.putSnapshot('../evil.json', 'x'), /Bad backup name/);
  assert.deepEqual(f.listSnapshots().map((s) => s.name), ['finance-helper-2026-10-10.json']);
  assert.equal(f.readSnapshot('finance-helper-2026-10-10.json'), 'x');
  f.deleteSnapshot('finance-helper-2026-10-10.json');
  assert.deepEqual(f.listSnapshots(), []);
  assert.ok(!readdirSync(join(dir, 'Finance Helper')).some((n) => n.includes('.tmp')), 'no temp files left');
  f.disconnect();
  assert.equal(f.status().connected, false);
  done();
});

test('finds Google Drive for desktop on Windows', () => {
  const seen = new Set(['G:\\My Drive']);
  assert.equal(findDriveFolder({ platform: 'win32', home: 'C:\\Users\\me', exists: (p) => seen.has(p) }), 'G:\\My Drive');
  assert.equal(findDriveFolder({ platform: 'win32', home: 'C:\\Users\\me', exists: () => false }), null);
  const ro = new Set(['H:\\Drive-ul meu']);
  assert.equal(findDriveFolder({ platform: 'win32', home: 'C:\\Users\\me', exists: (p) => ro.has(p) }), 'H:\\Drive-ul meu');
});
