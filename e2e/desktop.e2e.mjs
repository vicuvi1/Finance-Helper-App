// The desktop app starts, shows its window (also when the page is slow),
// renders Home, saves data in its own folder and comes back after a restart.
// On Linux run it under a display: xvfb-run -a npm run e2e
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';
import { ROOT } from './helpers.mjs';

const canRun = process.platform !== 'linux' || !!process.env.DISPLAY;

async function start(userData) {
  const app = await electron.launch({
    args: [ROOT, '--no-sandbox', '--password-store=basic'],
    env: { ...process.env, FH_USER_DATA: userData, FH_TG_TEST_MEMORY: '1', FH_TG_API: 'http://127.0.0.1:9' },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.waitForSelector('#app header.top', { timeout: 20000 });
  return { app, win, errors };
}

test('desktop app opens a visible window and keeps data across restarts', { skip: !canRun && 'needs a display (xvfb-run)' }, async () => {
  const userData = mkdtempSync(join(tmpdir(), 'fh-e2e-'));
  try {
    let { app, win, errors } = await start(userData);
    assert.equal(await win.title(), 'Finance Helper');
    const visible = await app.evaluate(({ BrowserWindow }) => new Promise((ok) => {
      const w = BrowserWindow.getAllWindows()[0];
      const check = (n) => (w.isVisible() || n <= 0 ? ok(w.isVisible()) : setTimeout(() => check(n - 1), 250));
      check(24);
    }));
    assert.equal(visible, true, 'the window is shown');
    assert.match(await win.evaluate(() => location.href), /^app:\/\/finance\//);

    await win.evaluate(() => { location.hash = 'log'; });
    await win.keyboard.press('n');
    await win.waitForSelector('#tx-amount');
    await win.fill('#tx-amount', '42');
    await win.fill('#tx-note', 'desktop e2e');
    await win.click('.sheet button[type=submit]');
    await win.waitForFunction(() => JSON.parse(localStorage.getItem('finance-helper.state') || '{}').tx?.some((t) => t.note === 'desktop e2e'));
    assert.deepEqual(errors, []);
    await app.evaluate(({ app: a }) => { a.quit(); });
    await app.close().catch(() => {});

    ({ app, win, errors } = await start(userData));
    const kept = await win.evaluate(() => JSON.parse(localStorage.getItem('finance-helper.state')).tx.some((t) => t.note === 'desktop e2e'));
    assert.equal(kept, true, 'the record is still there after a restart');
    assert.deepEqual(errors, []);
    await app.evaluate(({ app: a }) => { a.quit(); });
    await app.close().catch(() => {});
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});

test('desktop: sync through the Google Drive folder in one click', { skip: !canRun && 'needs a display (xvfb-run)' }, async () => {
  const userData = mkdtempSync(join(tmpdir(), 'fh-e2e-'));
  const home = mkdtempSync(join(tmpdir(), 'fh-home-'));
  const drive = join(home, 'Google Drive');
  mkdirSync(drive);
  try {
    const app = await electron.launch({
      args: [ROOT, '--no-sandbox', '--password-store=basic'],
      env: { ...process.env, HOME: home, FH_USER_DATA: userData, FH_TG_TEST_MEMORY: '1', FH_TG_API: 'http://127.0.0.1:9' },
    });
    const win = await app.firstWindow();
    const errors = [];
    win.on('pageerror', (e) => errors.push(e.message));
    await win.waitForSelector('#app header.top', { timeout: 20000 });
    await win.evaluate(() => { location.hash = 'log'; });
    await win.keyboard.press('n');
    await win.waitForSelector('#tx-amount');
    await win.fill('#tx-amount', '77');
    await win.fill('#tx-note', 'folder sync e2e');
    await win.click('.sheet button[type=submit]');
    await win.evaluate(() => { location.hash = 'settings'; });
    await win.click('[data-act="set-tab"][data-sec="data"]');
    await win.waitForSelector('[data-act="sync-folder-use"]');
    assert.match(await win.textContent('.sync-found'), /Google Drive/);
    await win.click('[data-act="sync-folder-use"]');
    const file = join(drive, 'Finance Helper', 'finance-helper-sync.json');
    for (let i = 0; i < 40 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 250));
    assert.ok(existsSync(file), 'sync file written into the Drive folder');
    assert.match(readFileSync(file, 'utf8'), /folder sync e2e/);
    assert.match(await win.textContent('#sync-card'), /Connected/);
    assert.deepEqual(errors, []);
    await app.evaluate(({ app: a }) => { a.quit(); });
    await app.close().catch(() => {});
  } finally {
    rmSync(userData, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('desktop: the Telegram bot logs what you send, custom amounts too, and says when its token stops working', { skip: !canRun && 'needs a display (xvfb-run)' }, async () => {
  const { fakeTelegram } = await import('./faketelegram.mjs');
  const tg = fakeTelegram();
  await new Promise((r) => tg.server.listen(0, '127.0.0.1', r));
  const userData = mkdtempSync(join(tmpdir(), 'fh-e2e-'));
  const app = await electron.launch({
    args: [ROOT, '--no-sandbox', '--password-store=basic'],
    env: { ...process.env, FH_USER_DATA: userData, FH_TG_TEST_MEMORY: '1', FH_TG_API: tg.url() },
  });
  try {
    const win = await app.firstWindow();
    const errors = [];
    win.on('pageerror', (e) => errors.push(e.message));
    await win.waitForSelector('#app header.top', { timeout: 20000 });
    const TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const { code } = await win.evaluate(async (t) => { await window.desktop.telegram.connect(t); return window.desktop.telegram.pair(); }, TOKEN);
    tg.say(`/start ${code}`);
    await win.waitForFunction(async () => (await window.desktop.telegram.status()).linked, null, { timeout: 15000 });
    const tx = () => win.evaluate(() => JSON.parse(localStorage.getItem('finance-helper.state')).tx.filter((t) => t.source === 'telegram'));
    const until = (fn) => win.waitForFunction(fn, null, { timeout: 15000 });

    // Just a number: logged, with category buttons to file it.
    tg.say('70 mdl');
    await until(() => JSON.parse(localStorage.getItem('finance-helper.state')).tx.some((t) => t.source === 'telegram' && t.amount === 7000));
    const seventy = (await tx()).find((t) => t.amount === 7000);
    const asked = tg.sent.at(-1);
    assert.match(asked.text, /What was it\?/);
    const food = asked.reply_markup.inline_keyboard.flat().find((b) => /Food/.test(b.text));
    tg.tap(food.callback_data);
    await until(() => JSON.parse(localStorage.getItem('finance-helper.state')).tx.some((t) => t.source === 'telegram' && t.amount === 7000 && t.category === 'food'));

    // "coffee 45": the Coffee block's category with this amount.
    tg.say('coffee 45');
    await until(() => JSON.parse(localStorage.getItem('finance-helper.state')).tx.some((t) => t.source === 'telegram' && t.amount === 4500));
    assert.equal((await tx()).find((t) => t.amount === 4500).category, 'food');

    // A block without an amount asks how much.
    tg.say('/addblock 🥤 Drinks');
    await new Promise((r) => setTimeout(r, 800));
    tg.say('🥤 Drinks …');
    await new Promise((r) => setTimeout(r, 800));
    assert.match(tg.sent.at(-1).text, /How much for/);
    tg.say('55');
    await until(() => JSON.parse(localStorage.getItem('finance-helper.state')).tx.some((t) => t.source === 'telegram' && t.amount === 5500 && t.note === 'Drinks'));
    assert.ok(seventy);

    // The token is revoked: the app says so; a new token for the same bot keeps the link.
    tg.revoke(TOKEN);
    await win.waitForFunction(async () => (await window.desktop.telegram.status()).errorCode === 'token', null, { timeout: 20000 });
    await win.evaluate(() => { location.hash = 'home'; });
    await win.waitForSelector('#tg-alert:not([hidden])', { timeout: 40000 });
    const r = await win.evaluate(() => window.desktop.telegram.connect('123456789:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'));
    assert.equal(r.kept, true);
    tg.say('taxi 50');
    await until(() => JSON.parse(localStorage.getItem('finance-helper.state')).tx.some((t) => t.source === 'telegram' && t.amount === 5000));
    assert.deepEqual(errors, []);
  } finally {
    await app.evaluate(({ app: a }) => { a.quit(); }).catch(() => {});
    await app.close().catch(() => {});
    tg.server.close();
    rmSync(userData, { recursive: true, force: true });
  }
});
