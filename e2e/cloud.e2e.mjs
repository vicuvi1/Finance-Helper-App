// The web app with its own server (api/*.mjs) on a throwaway local database
// (made-up data): the first visit asks for the PIN and loads Money from the
// server, a record logged on the web reaches a desktop-like client, the
// update card and Import from Life System work. Run: npm run e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, openPage } from './helpers.mjs';
import { startFakeTurso } from './faketurso.mjs';
import { startDevServer } from './devserver.mjs';
import { createCloud } from '../js/cloud.js';
import { normalizeState, SCHEMA_VERSION } from '../js/model.js';

let turso;
let server;
let browser;
const PIN = '5791';

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const transport = (path, body, token) => fetch(`${server.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const tx = (id, amount, note) => ({ id, date: '2026-11-02', type: 'expense', amount, account: 'wallet', category: 'food', note, createdAt: 1, updatedAt: 1 });

function desktopLike(initial) {
  let state = normalizeState({ version: SCHEMA_VERSION, tx: [], ...initial });
  const cloud = createCloud({ transport, store: memStore(), app: { getState: () => state, setState: (s) => { state = s; } } });
  return { cloud, get state() { return state; } };
}

before(async () => {
  turso = await startFakeTurso();
  server = await startDevServer({ env: { TURSO_URL: turso.url, TURSO_TOKEN: turso.token, CRON_SECRET: 'e2e-setup', SESSION_SECRET: 'e2e-secret' } });
  assert.equal((await transport('/api/login', { setup: 'e2e-setup', pin: PIN })).status, 200);
  // The desktop already has Money on the server.
  const desk = desktopLike({ tx: [tx('desk-1', 4200, 'made-up lunch'), tx('desk-2', 1500, 'made-up bus')] });
  await desk.cloud.signIn(PIN);
  assert.equal((await desk.cloud.sync()).ok, true);
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
  await turso?.close();
});

test('first visit: sign in with the PIN and Money comes from the server; a web record reaches the desktop', async () => {
  const url = `${server.url}/`;
  const { page, errors, context } = await openPage(browser, url);
  await page.goto(url);
  await page.waitForSelector('[data-testid="cloud-pin"]', { timeout: 15000 });
  await page.fill('[data-testid="cloud-pin"]', '0000');
  await page.click('[data-testid="cloud-pin-go"]');
  await page.waitForFunction(() => /Wrong PIN/.test(document.getElementById('cloud-err')?.textContent || ''));
  await page.fill('[data-testid="cloud-pin"]', PIN);
  await page.click('[data-testid="cloud-pin-go"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="cloud-pin"]'));
  await page.waitForFunction(() => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state') || '{}').tx?.some((t) => t.note === 'made-up lunch'), null, { timeout: 15000 });
  await page.evaluate(() => { location.hash = '#log'; });
  await page.waitForFunction(() => document.getElementById('app').innerHTML.includes('made-up lunch'), null, { timeout: 15000 });

  // Log a record on the web: it is sent a few seconds later.
  await page.keyboard.press('n');
  await page.waitForSelector('#tx-amount');
  await page.fill('#tx-amount', '77');
  await page.fill('#tx-note', 'made-up web coffee');
  await page.click('.sheet button[type=submit]');
  const desk = desktopLike();
  await desk.cloud.signIn(PIN);
  let found = false;
  for (let i = 0; i < 30 && !found; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    await desk.cloud.sync();
    found = desk.state.tx.some((t) => t.note === 'made-up web coffee');
  }
  assert.ok(found, 'the web record reached the desktop-like client');

  // The line under the app's name says it is in step (no more "Private & Offline").
  await page.waitForFunction(() => /^Synced /.test(document.querySelector('[data-testid="sync-status"]')?.textContent || ''), null, { timeout: 15000 });

  // A record logged on the desktop shows on the open web page without a reload (it checks when the window comes back).
  desk.state.tx.push(tx('desk-3', 2500, 'made-up desk taxi'));
  desk.cloud.changed();
  assert.equal((await desk.cloud.sync()).ok, true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => document.getElementById('app').innerHTML.includes('made-up desk taxi'), null, { timeout: 15000 });

  // Settings → Data & backups shows the cloud card as synced.
  await page.evaluate(() => { location.hash = '#settings'; });
  await page.waitForSelector('#app header.top');
  await page.click('[data-act="set-tab"][data-sec="data"]');
  await page.waitForSelector('[data-testid="cloud-card"]');
  assert.match(await page.textContent('[data-testid="cloud-status"]'), /Synced|waiting/);
  // Data & health: the server's space and how long it lasts, and the checks.
  await page.click('[data-act="set-tab"][data-sec="health"]');
  await page.waitForSelector('[data-testid="data-health"]');
  await page.waitForFunction(() => /of 5\.0 GB/.test(document.querySelector('[data-testid="dh-space"]')?.textContent || ''), null, { timeout: 15000 });
  assert.match(await page.textContent('[data-testid="dh-space"]'), /Lasts (more than 100 years|about)/);
  assert.match(await page.textContent('[data-testid="dh-check-sync"]'), /In sync|waiting/);
  // About & updates: the web build's update card.
  await page.click('[data-act="set-tab"][data-sec="about"]');
  assert.match(await page.textContent('#update-card'), /Up to date \(v\d+\.\d+\.\d+\)/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Import from Life System: preview, back up and merge (nothing deleted)', async () => {
  const url = `${server.url}/`;
  const { page, errors, context } = await openPage(browser, url);
  await page.goto(url);
  // Skip signing in this time.
  await page.waitForSelector('[data-testid="cloud-pin"]', { timeout: 15000 });
  await page.click('.sheet [data-close].btn');
  const dir = mkdtempSync(join(tmpdir(), 'life-'));
  const file = join(dir, 'life-system-money-2026-11-19.json');
  writeFileSync(file, JSON.stringify({ version: SCHEMA_VERSION, settings: {}, tx: [tx('life-1', 9900, 'made-up from Life'), tx('life-2', 300, 'made-up gum')], people: [] }));
  await page.evaluate(() => { location.hash = '#settings'; });
  await page.waitForSelector('#app header.top');
  // The import card lives in Settings → Data & backups; the file input is the same wherever the card is drawn.
  await page.click('[data-act="set-tab"][data-sec="data"]');
  await page.waitForSelector('[data-testid="life-import-file"]', { state: 'attached', timeout: 10000 });
  await page.setInputFiles('[data-testid="life-import-file"]', file);
  await page.waitForSelector('[data-testid="life-import-preview"]');
  const preview = await page.textContent('[data-testid="life-import-preview"]');
  assert.match(preview, /New records to add\s*2/);
  page.on('download', () => {}); // the web backup file
  await page.click('[data-testid="life-import-go"]');
  await page.evaluate(() => { location.hash = '#log'; });
  await page.waitForFunction(() => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state') || '{}').tx?.some((t) => t.note === 'made-up from Life'), null, { timeout: 10000 });
  await page.waitForFunction(() => document.getElementById('app').innerHTML.includes('made-up from Life'), null, { timeout: 10000 });
  // Not syncing: the line under the name says so and a click opens the sign-in.
  assert.equal(await page.textContent('[data-testid="sync-status"]'), 'Not synced · Sign in');
  await page.click('[data-testid="sync-status"]');
  await page.waitForSelector('[data-testid="cloud-pin"]');
  await page.click('.sheet [data-close].btn');
  // Money is here but not syncing: the next visit asks once to keep this device in step.
  await page.waitForTimeout(600); // the save waits a moment to group changes
  const page2 = await context.newPage();
  await page2.goto(url);
  await page2.waitForSelector('[data-testid="cloud-pin"]', { timeout: 15000 });
  assert.match(await page2.textContent('.sheet h3'), /Keep this device in step/);
  assert.deepEqual(errors, []);
  await context.close();
});
