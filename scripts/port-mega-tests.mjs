#!/usr/bin/env node
// Copies Money's unit tests from Life System (MEGA) into tests/mega/, so they
// run here with node --test (tests/mega/_vitest.js stands in for vitest,
// tests/mega/_life.js for Life's FINANCE sync spec). Only tests that need
// nothing else from Life System are copied; the list is printed.
//   node scripts/port-mega-tests.mjs [path-to-MEGA-clone] [git-ref]
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mega = resolve(process.argv[2] || join(root, '..', 'MEGA-SYSTEM'));
const ref = process.argv[3] || 'origin/main';
const git = (...a) => execFileSync('git', ['-C', mega, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
// Tests that don't apply standalone even though they import nothing else (none yet).
const SKIP = new Set([]);
const files = git('grep', '-l', 'apps/finance/js', ref, '--', '*.test.ts').split('\n').filter(Boolean).map((l) => l.replace(`${ref}:`, ''));
const out = join(root, 'tests', 'mega');
mkdirSync(out, { recursive: true });
const done = [];
const left = [];
// Life System's own infrastructure (its database copy, sync, storage): a test that needs it stays in MEGA.
const INFRA = /sql\.js|fakeTurso|mirror|tursoHttp|appSync|browserDb|bigStore|fakeIdb|desktopSync|main\/|financeBot|financeInbox|restoreApps|moneySort|schema|backupPlan|dataCenter/;

/** The end of the call that opens at `start` (the index of its "("), skipping strings, templates and comments. */
function callEnd(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return -1; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) {
        if (src[i] === '\\') i++;
        else if (c === '`' && src[i] === '$' && src[i + 1] === '{') { const e = callEnd(src.replace(/\$\{/, '$('), i + 1); i = e < 0 ? i : e; }
      }
      continue;
    }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Drops the imports of Life modules and every it()/test() that uses what they imported. */
function withoutLife(src, mods) {
  const names = [];
  const lines = src.split('\n');
  src = lines.filter((line) => {
    const mm = line.match(/^import\s+(?:type\s+)?(.+?)\s+from\s+'([^']+)'/);
    if (!mm || !mods.includes(mm[2])) return true;
    for (const n of mm[1].replace(/[{}]/g, ' ').split(',')) {
      const w = n.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(w)) names.push(w);
    }
    return false;
  }).join('\n');
  const uses = new RegExp(`\\b(${names.map((n) => n.replace(/[$]/g, '\\$')).join('|') || '$^'})\\b`);
  let removed = 0;
  // First the single tests that use them, then a whole describe() whose own helpers still do.
  for (const kind of ['it|test', 'describe']) {
    let out = '';
    let i = 0;
    const callRe = new RegExp(`(^|\\n)([ \\t]*)(${kind})(\\.\\w+)?\\(`, 'g');
    let m;
    while ((m = callRe.exec(src))) {
      const open = m.index + m[0].length - 1;
      const end = callEnd(src, open);
      if (end < 0) break;
      if (uses.test(src.slice(m.index, end + 1))) {
        out += src.slice(i, m.index) + `${m[1]}${m[2]}// (left out here: needs Life System code)`;
        i = end + 1;
        removed++;
      }
      callRe.lastIndex = end + 1;
    }
    src = out + src.slice(i);
  }
  const out = src;
  return { src: out, removed, names };
}
for (const f of files) {
  const name = basename(f);
  let src = git('show', `${ref}:${f}`);
  const froms = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  const other = froms.filter((p) => !/apps\/finance\/js\//.test(p) && p !== 'vitest' && !p.startsWith('node:') && p !== './financeSync');
  if (SKIP.has(name) || other.some((p) => INFRA.test(p))) { left.push(`${name} (needs ${other.join(', ') || 'skip'})`); continue; }
  let note = '';
  if (other.length) {
    const r = withoutLife(src, other);
    src = r.src;
    note = ` ${r.removed} test(s) that need Life System code (${other.join(', ')}) are left out.`;
  }
  src = src
    .replace(/'(?:\.\.\/)+(?:renderer\/)?public\/apps\/finance\/js\//g, "'../../js/")
    .replace(/from 'vitest'/g, "from './_vitest.js'")
    .replace(/from '\.\/financeSync'/g, "from './_life.js'");
  writeFileSync(join(out, name), `// Copied from Life System (MEGA ${ref} ${git('rev-parse', '--short', ref).trim()}: ${f}) by scripts/port-mega-tests.mjs.${note}\n${src}`);
  done.push(name);
}
console.log(`Copied ${done.length} tests: ${done.join(', ')}`);
console.log(`Left in MEGA (need Life System code): ${left.join('; ')}`);
