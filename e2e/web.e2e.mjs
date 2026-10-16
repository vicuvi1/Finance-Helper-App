// The web app from a clean start: every screen opens, logging, undo/redo,
// search, importing a sheet with the import check, and data surviving a
// reload. Run: npm run e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { serve, launch, openPage, ROOT } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await serve(); browser = await launch(); });
after(async () => { await browser?.close(); server?.close(); });

const SCREENS = ['home', 'log', 'accounts', 'rates', 'goals', 'plan', 'clients', 'people', 'reports', 'review', 'settings'];

test('every screen opens without errors, at desktop and phone width', async () => {
  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const { page, errors, context } = await openPage(browser, server.url, size);
    await page.goto(server.url);
    await page.waitForSelector('#app header.top');
    for (const s of SCREENS) {
      await page.evaluate((h) => { location.hash = h; }, s);
      await page.waitForFunction((h) => document.getElementById('app').className.includes(`view-${h}`), s);
      assert.ok((await page.textContent('#app')).trim().length > 20, `${s} rendered something`);
    }
    assert.deepEqual(errors, [], `no page errors at ${size.width}px`);
    await context.close();
  }
});

test('log a record, undo, redo, search, and it survives a reload', async () => {
  const { page, errors, context } = await openPage(browser, server.url);
  await page.goto(`${server.url}#log`);
  await page.waitForSelector('#app header.top');
  await page.keyboard.press('n');
  await page.waitForSelector('#tx-amount');
  await page.fill('#tx-amount', '120+45');
  await page.fill('#tx-note', 'e2e coffee');
  await page.click('.sheet button[type=submit]');
  await page.waitForFunction(() => !document.querySelector('.sheet:not(.closing)') || !document.querySelector('#tx-amount'));
  const count = () => page.evaluate(() => JSON.parse(localStorage.getItem('finance-helper.state')).tx.filter((t) => t.note === 'e2e coffee').length);
  assert.equal(await count(), 1);
  const amount = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-helper.state')).tx.find((t) => t.note === 'e2e coffee').amount);
  assert.equal(amount, 16500, 'the calculator adds 120+45');

  await page.click('body', { position: { x: 900, y: 20 } });
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem('finance-helper.state')).tx.some((t) => t.note === 'e2e coffee'));
  await page.keyboard.press('Control+y');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('finance-helper.state')).tx.some((t) => t.note === 'e2e coffee'));

  await page.fill('#search', 'e2e >100');
  await page.waitForSelector('.search-card');
  assert.match(await page.textContent('.search-card'), /1 record/);

  await page.reload();
  await page.waitForSelector('#app header.top');
  assert.equal(await count(), 1, 'still there after a reload');
  assert.deepEqual(errors, []);
  await context.close();
});

test('import the sample sheet: records in, import check flags the stray row', async () => {
  const { page, errors, context } = await openPage(browser, server.url);
  await page.goto(`${server.url}#settings`);
  await page.waitForSelector('#app header.top');
  await page.setInputFiles('#file-csv', join(ROOT, 'tests/fixtures/sample-month.csv'));
  await page.waitForSelector('#imp-go');
  await page.click('#imp-go');
  await page.waitForSelector('.ic-sum');
  assert.match(await page.textContent('.ic-sum'), /doesn't match/);
  assert.match(await page.textContent('.ic-why'), /Row 34 "Decembrie"/);
  const totals = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('finance-helper.state'));
    const m = s.tx.filter((t) => t.date.startsWith('2026-03'));
    return [m.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0), m.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0)];
  });
  assert.deepEqual(totals, [2446500, 660500], 'same totals as the sheet');
  assert.deepEqual(errors, []);
  await context.close();
});

test('sheet view: type an amount in a day row, edit it, clear it', async () => {
  const { page, errors, context } = await openPage(browser, server.url, { width: 1800, height: 1000 });
  await page.goto(`${server.url}#log`);
  await page.waitForSelector('#sheet-grid');
  const day = await page.evaluate(() => document.querySelector('#sheet-grid tbody tr[data-date]').dataset.date);
  const key = (f) => `[data-sh="${day}|out|0|${f}"]`;
  const find = () => page.evaluate(() => JSON.parse(localStorage.getItem('finance-helper.state')).tx.find((t) => t.note === 'sheet bread'));
  await page.fill(key('note'), 'sheet bread');
  await page.fill(key('amount'), '10+5');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('finance-helper.state')).tx.some((t) => t.note === 'sheet bread'));
  assert.equal((await find()).amount, 1500);
  assert.equal((await find()).date, day);
  // The sheet redraws right after a save: edit the redrawn cell, not the old one.
  await page.waitForSelector(`${key('amount')}[value="15"]:not([data-id=""])`);
  await page.fill(key('amount'), '20');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('finance-helper.state')).tx.find((t) => t.note === 'sheet bread')?.amount === 2000);
  await page.waitForSelector(`${key('amount')}[value="20"]`);
  await page.fill(key('amount'), '');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem('finance-helper.state')).tx.some((t) => t.note === 'sheet bread'));
  assert.match(await page.textContent('#sheet-grid'), /Amount invested/i);
  assert.deepEqual(errors, []);
  await context.close();
});

test('theme gallery persists choices and respects motion preferences', async () => {
  for (const width of [1440, 390]) {
    const { page, errors, context } = await openPage(browser, server.url, { width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(`${server.url}#settings`);
    // The moving background is an Extra (off for new installs): turn it on there.
    const extras = async () => { await page.click('[data-act="set-tab"][data-sec="extras"]'); await page.waitForSelector('[data-set="themeMotion"]'); };
    const general = async () => { await page.click('[data-act="set-tab"][data-sec="general"]'); await page.waitForSelector('.style-picker'); };
    await extras();
    await page.locator('[data-set="themeMotion"]').check();
    await general();
    for (const theme of ['forest', 'ocean', 'paper', 'dark', 'light', 'system']) {
      await page.locator(`.style-choice:has(input[value="${theme}"])`).click();
      await page.reload();
      await page.waitForSelector('.style-picker');
      assert.equal(await page.locator('[data-set="theme"]:checked').inputValue(), theme);
      assert.equal(await page.locator('#theme-atmosphere .atmosphere-particle').count(), 12);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    await page.locator('.style-choice:has(input[value="forest"])').click();
    await page.locator('input[value="forest"]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('[data-set="theme"]:checked').inputValue(), 'paper', 'radio gallery supports arrow keys');
    await extras();
    await page.locator('[data-set="themeMotion"]').uncheck();
    await page.reload();
    await page.waitForSelector('.style-picker');
    assert.equal(await page.locator('#theme-atmosphere').count(), 0);
    await extras();
    assert.equal(await page.locator('[data-set="themeMotion"]').isChecked(), false);
    await page.locator('[data-set="themeMotion"]').check();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => !document.getElementById('theme-atmosphere'));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForSelector('#theme-atmosphere');
    assert.deepEqual(errors, []);
    await context.close();
  }
});
