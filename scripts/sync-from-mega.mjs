#!/usr/bin/env node
// Copies the Money web app from the Life System monorepo (MEGA) into this
// repo in one step, then puts back the standalone pieces.
//
//   node scripts/sync-from-mega.mjs [path-to-MEGA-clone] [git-ref]
//
// Defaults: ../MEGA-SYSTEM and origin/main (run `git -C <MEGA> fetch origin
// main` first). It copies from the git ref, never the working tree, so
// half-done work in that clone never lands here.
//
// What it copies: index.html, sw.js, manifest.webmanifest, css/, js/, icons/,
// fonts/ from src/renderer/public/apps/finance/. Files that exist here but
// not in MEGA are kept (the standalone's own modules). What it never copies:
// electron/ (the standalone's desktop app is its own), js/version.js (this
// repo's release number), js/screens/updates.js (the standalone's update
// screen), LICENSE, version.json. The server files in API below are copied
// from MEGA's api/ as they are.
//
// After copying it applies scripts/standalone-patches.mjs (small hooks for
// the update badge, notifications and "Import from Life System"). A patch
// whose anchor is gone stops the script with the file name, so nothing is
// silently lost. The MEGA commit copied is written to docs/MEGA_SYNC.json.
//
// Then: `npm test`, `xvfb-run -a npm run e2e`, bump the version, commit.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPatches } from './standalone-patches.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mega = resolve(process.argv[2] || join(root, '..', 'MEGA-SYSTEM'));
const ref = process.argv[3] || 'origin/main';
const SRC = 'src/renderer/public/apps/finance';
const COPY = ['index.html', 'sw.js', 'manifest.webmanifest', 'css', 'js', 'icons', 'fonts'];
const KEEP = ['js/version.js', 'js/screens/updates.js'];
// The server functions Money needs, copied as they are from MEGA's api/ (its
// security rules come with them). api/money.mjs and api/_money.mjs are this repo's own.
const API = ['_lib', '_sqlguard', '_schema', '_devices', '_push', '_passkey', '_snapshots', 'login', 'db'].map((n) => `api/${n}.mjs`);

if (!existsSync(join(mega, '.git'))) {
  console.error(`No MEGA clone at ${mega}. Pass its path: node scripts/sync-from-mega.mjs /path/to/MEGA-SYSTEM`);
  process.exit(1);
}
const git = (...args) => execFileSync('git', ['-C', mega, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
const commit = git('rev-parse', ref).trim();
const subject = git('log', '-1', '--format=%s', commit).trim();

const tmp = mkdtempSync(join(tmpdir(), 'mega-money-'));
try {
  const tar = execFileSync('git', ['-C', mega, 'archive', '--format=tar', commit, SRC], { maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', tmp], { input: tar });
  const from = join(tmp, SRC);
  const kept = Object.fromEntries(KEEP.filter((f) => existsSync(join(root, f))).map((f) => [f, readFileSync(join(root, f))]));
  for (const item of COPY) {
    if (!existsSync(join(from, item))) continue;
    cpSync(join(from, item), join(root, item), { recursive: true, force: true });
  }
  for (const [f, buf] of Object.entries(kept)) writeFileSync(join(root, f), buf);
  mkdirSync(join(root, 'api'), { recursive: true });
  for (const f of API) writeFileSync(join(root, f), git('show', `${commit}:${f}`));
  const applied = applyPatches(root);
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'MEGA_SYNC.json'), `${JSON.stringify({ repo: 'vicuvi1/mega-system', path: SRC, ref, commit, subject, copiedAt: new Date().toISOString().slice(0, 10) }, null, 2)}\n`);
  console.log(`Copied the Money app from MEGA ${commit.slice(0, 7)} (${subject}); ${applied} standalone patches applied.`);
  console.log('Next: npm test && xvfb-run -a npm run e2e, then bump the version and commit.');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
