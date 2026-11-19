// The small changes the standalone app makes to files copied from Life System
// (MEGA). scripts/sync-from-mega.mjs applies them after every copy; each is
// "find this exact text, put this instead". Applying twice changes nothing.
// When MEGA changed the text a patch looks for, the copy stops and names the
// patch: update its `find` to the new text (keep the same meaning).
//
// Everything bigger lives in files MEGA doesn't have: js/standalone.js,
// js/cloud.js, js/parts.js, js/lifeimport.js, js/notifier.js, and the
// standalone-owned js/screens/updates.js and js/version.js (never copied).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const STANDALONE_FILES = ['js/standalone.js', 'js/cloud.js', 'js/parts.js', 'js/lifeimport.js', 'js/notifier.js'];

export const PATCHES = [
  // ---- js/app.js: four hooks into the standalone pieces ----
  { file: 'js/app.js', why: 'load the standalone pieces',
    find: "import * as Updates from './screens/updates.js';\n",
    replace: "import * as Updates from './screens/updates.js';\nimport * as Standalone from './standalone.js'; // standalone app: cloud sync, Life import, update badge, notifications\n" },
  { file: 'js/app.js', why: 'Cloud sync and Import from Life System cards in Settings → Data & backups',
    find: 'html: () => cards.data + ArchiveCard.settingsCard()',
    replace: 'html: () => cards.data + Standalone.dataCards() + ArchiveCard.settingsCard()' },
  { file: 'js/app.js', why: 'their buttons',
    find: "  if (SCREENS[ui.tab]?.onClick?.(act, el)) return;\n  if (act === 'acc-open')",
    replace: "  if (Standalone.onClick(act, el)) return;\n  if (SCREENS[ui.tab]?.onClick?.(act, el)) return;\n  if (act === 'acc-open')" },
  { file: 'js/app.js', why: 'start them',
    find: 'Updates.initUpdates();\n',
    replace: 'Updates.initUpdates();\nStandalone.init();\n' },
  { file: 'js/app.js', why: 'no Life System to make the backup',
    find: 'Life System saves a backup first, and one Undo brings them all back.',
    replace: 'A backup is saved first, and one Undo brings them all back.' },
  // ---- every change you make also goes to the cloud sync ----
  { file: 'js/screens/sync.js', why: 'tell the cloud sync about each change',
    find: 'export function changed() {\n',
    replace: 'export function changed() {\n  try { globalThis.__fhCloudChanged?.(); } catch { /* standalone cloud sync */ }\n' },
  // ---- "backup before a risky step": the desktop's own backups instead of Life's ----
  { file: 'js/dupes.js', why: 'backup before a risky step without Life System',
    find: "    if (!win || !win.parent || win.parent === win) { resolve({ ok: true, skipped: true }); return; }\n",
    replace: "    if (!win || !win.parent || win.parent === win) {\n      const own = globalThis.__fhBackupBefore;\n      if (!own) { resolve({ ok: true, skipped: true }); return; }\n      Promise.resolve(own(label)).then(() => resolve({ ok: true }), (e) => resolve({ ok: false, error: e?.message || 'The backup could not be saved' }));\n      return;\n    }\n" },
  // ---- words that named Life System ----
  { file: 'js/screens/budgetwarn.js', why: 'the app sends budget warnings itself',
    find: 'Life System sends one calm notification for each, once a month. They count toward its 4 notifications a day.',
    replace: 'the app sends one calm notification for each (a system notification on the desktop, a browser notification on the web), once a month. At most 4 notifications a day.' },
  { file: 'js/flow.js', why: 'no Life System Calm mode here',
    find: " Life System's Calm mode does not affect it.",
    replace: null },
  // ---- offline: the standalone files are in the app shell ----
  { file: 'sw.js', why: 'standalone files work offline',
    find: "const SHELL = [\n  './',\n",
    replace: `const SHELL = [\n  './',\n${STANDALONE_FILES.map((f) => `  './${f}',\n`).join('')}` },
];

/** Applies every patch under `root`; returns how many changed something. Throws on a patch whose text is gone. */
export function applyPatches(root) {
  let n = 0;
  const files = new Map();
  const read = (f) => { if (!files.has(f)) files.set(f, readFileSync(join(root, f), 'utf8')); return files.get(f); };
  for (const p of PATCHES) {
    const text = read(p.file);
    if (p.replace ? text.includes(p.replace) : !text.includes(p.find)) continue; // already applied
    if (!text.includes(p.find)) throw new Error(`Standalone patch "${p.why}" no longer fits ${p.file}: MEGA changed that text. Update its "find" in scripts/standalone-patches.mjs.`);
    files.set(p.file, text.replace(p.find, p.replace || ''));
    n++;
  }
  // The offline cache gets a new name with each version, so a release replaces the old files.
  const version = readFileSync(join(root, 'js/version.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)?.[1] || '0';
  const before = read('sw.js');
  const sw = before.replace(/const CACHE = 'finance-helper-v(\d+)(?:-[\w.]+)?';/, (_m, v) => `const CACHE = 'finance-helper-v${v}-${version}';`);
  if (sw !== before) { files.set('sw.js', sw); n++; }
  for (const [f, text] of files) writeFileSync(join(root, f), text);
  return n;
}
