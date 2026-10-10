// The desktop app starts, shows its window (also when the page is slow),
// renders Home, saves data in its own folder and comes back after a restart.
// On Linux run it under a display: xvfb-run -a npm run e2e
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
