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
  const count = () => page.evaluate(() => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).tx.filter((t) => t.note === 'e2e coffee').length);
  assert.equal(await count(), 1);
  const amount = await page.evaluate(() => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).tx.find((t) => t.note === 'e2e coffee').amount);
  assert.equal(amount, 16500, 'the calculator adds 120+45');

  await page.click('body', { position: { x: 900, y: 20 } });
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => !JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).tx.some((t) => t.note === 'e2e coffee'));
  await page.keyboard.press('Control+y');
  await page.waitForFunction(() => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).tx.some((t) => t.note === 'e2e coffee'));

  await page.fill('#search', 'e2e >100');
  await page.waitForSelector('.search-card');
  assert.match(await page.textContent('.search-card'), /1 record/);

  await page.reload();
  await page.waitForSelector('#app header.top');
  assert.equal(await count(), 1, 'still there after a reload');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a record for an earlier day: Yesterday under the Date, and "yesterday" in Quick add', async () => {
  const { page, errors, context } = await openPage(browser, server.url);
  await page.goto(`${server.url}#log`);
  await page.waitForSelector('#app header.top');
  const dayOf = (note) => page.evaluate((n) => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).tx.find((t) => t.note === n)?.date, note);
  const yesterday = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await page.keyboard.press('n');
  await page.waitForSelector('[data-testid="day-chips"]');
  await page.fill('#tx-amount', '35');
  await page.fill('#tx-note', 'e2e remembered bread');
  await page.click('[data-day-back="1"]');
  assert.equal(await page.inputValue('#tx-date'), yesterday);
  await page.click('.sheet button[type=submit]');
  await page.waitForFunction(() => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).tx.some((t) => t.note === 'e2e remembered bread'));
  assert.equal(await dayOf('e2e remembered bread'), yesterday);

  await page.evaluate(() => { location.hash = '#home'; });
  await page.waitForSelector('[data-testid="qa-input"]');
  await page.fill('[data-testid="qa-input"]', 'yesterday 60 e2e late taxi');
  await page.waitForSelector('[data-testid="qa-day"]');
  assert.equal(await page.textContent('[data-testid="qa-day"]'), 'Yesterday');
  await page.press('[data-testid="qa-input"]', 'Enter');
  await page.waitForFunction(() => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).tx.some((t) => t.note === 'e2e late taxi'));
  assert.equal(await dayOf('e2e late taxi'), yesterday);
  assert.deepEqual(errors, []);
  await context.close();
});

test('subscriptions table: add one in USD, edit it, pick a type; Quick add keeps the subcategory', async () => {
  const { page, errors, context } = await openPage(browser, server.url);
  await page.goto(`${server.url}#plan`);
  await page.waitForSelector('[data-testid="sub-table"]');
  await page.fill('[data-st-new="name"]', 'Made-up AI');
  await page.fill('[data-st-new="amount"]', '20');
  await page.selectOption('[data-st-new="currency"]', 'USD');
  await page.click('[data-testid="sub-add"]');
  await page.waitForSelector('[data-testid="sub-row"]');
  const rule = () => page.evaluate(() => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).recurring.find((r) => r.note === 'Made-up AI'));
  await page.waitForFunction(() => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).recurring.some((r) => r.note === 'Made-up AI'));
  let r = await rule();
  assert.equal(r.amount, 2000);
  assert.equal(r.currency, 'USD');
  assert.equal(r.subscription, true);
  // Edit the amount in place.
  await page.fill('[data-testid="sub-row"] [data-st="amount"]', '25');
  await page.press('[data-testid="sub-row"] [data-st="amount"]', 'Enter');
  await page.waitForFunction(() => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).recurring.find((x) => x.note === 'Made-up AI').amount === 2500);
  // Pick a type (subcategory) when there is one.
  const types = await page.$$eval('[data-testid="sub-row"] [data-st="sub"] option', (o) => o.map((x) => x.value).filter((v) => v && v !== '__new'));
  if (types.length) {
    await page.selectOption('[data-testid="sub-row"] [data-st="sub"]', types[0]);
    await page.waitForFunction((id) => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).recurring.find((x) => x.note === 'Made-up AI').sub === id, types[0]);
  }
  // Quick add: choose the Subscriptions category, then a type.
  await page.evaluate(() => { location.hash = '#home'; });
  await page.waitForSelector('[data-testid="qa-input"]');
  await page.fill('[data-testid="qa-input"]', '450 made-up gpt');
  await page.waitForSelector('[data-testid="qa-cat"]');
  const subsCat = await page.$$eval('[data-testid="qa-cat"] option', (o) => o.find((x) => /subscri/i.test(x.textContent))?.value);
  if (subsCat) {
    await page.selectOption('[data-testid="qa-cat"]', subsCat);
    await page.waitForSelector('[data-testid="qa-sub"]');
    const opt = await page.$$eval('[data-testid="qa-sub"] option', (o) => o.map((x) => x.value).find(Boolean));
    await page.selectOption('[data-testid="qa-sub"]', opt);
    await page.click('[data-testid="qa-save"]');
    await page.waitForFunction((id) => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).tx.some((t) => t.note === 'made-up gpt' && t.sub === id), opt);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('Reports → Report: Excel for last month, and the printable page', async () => {
  const { page, errors, context } = await openPage(browser, server.url);
  await page.goto(`${server.url}#log`);
  await page.waitForSelector('#app header.top');
  await page.keyboard.press('n');
  await page.waitForSelector('#tx-amount');
  await page.fill('#tx-amount', '42');
  await page.fill('#tx-note', 'e2e report item');
  await page.click('.sheet button[type=submit]');
  await page.evaluate(() => { location.hash = '#reports'; });
  await page.waitForSelector('[data-testid="report-open"]');
  await page.click('[data-testid="report-open"]');
  await page.check('input[name="rep-period"][value="this-month"]');
  const dl = page.waitForEvent('download');
  await page.click('[data-testid="rep-xlsx"]');
  const file = await dl;
  assert.match(file.suggestedFilename(), /^finance-helper-report-\d{4}-\d{2}\.xlsx$/);
  await page.evaluate(() => { window.print = () => {}; });
  await page.click('[data-testid="rep-pdf"]');
  await page.waitForSelector('#print-root .report');
  assert.match(await page.textContent('#print-root .report'), /Where the money went/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Plan → Planned: add a big expense, it is spread over the months', async () => {
  const { page, errors, context } = await openPage(browser, server.url);
  await page.goto(`${server.url}#plan`);
  await page.waitForSelector('[data-testid="plan-tab-planned"]');
  await page.click('[data-testid="plan-tab-planned"]');
  await page.waitForSelector('[data-testid="planned-card"]');
  await page.fill('[data-pl="name"]', 'Made-up insurance');
  await page.fill('[data-pl="amount"]', '3600');
  await page.click('[data-testid="plan-add"]');
  await page.waitForSelector('[data-testid="plan-row"]');
  assert.match(await page.textContent('[data-testid="plan-row"]'), /a month/);
  const saved = await page.evaluate(() => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).settings.planned);
  assert.equal(saved[0].amount, 360000);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Log table: ＋ on a past day, type a record in its row; drag a record onto another day', async () => {
  const { page, errors, context } = await openPage(browser, server.url);
  await page.goto(`${server.url}#log`);
  await page.waitForSelector('#app header.top');
  await page.click('[data-view="table"]').catch(() => {});
  await page.waitForSelector('#tx-table');
  const days = await page.$$eval('[data-day-add]', (b) => b.map((x) => x.dataset.dayAdd));
  assert.ok(days.length >= 1, 'every day up to today has a ＋');
  const first = days.sort()[0];
  // ＋ opens a line in the day's row: type like Quick add, Enter saves.
  await page.click(`[data-day-add="${first}"]`);
  await page.waitForSelector(`[data-day-quick="${first}"]:visible`);
  await page.fill(`[data-day-quick="${first}"]`, '15 e2e plus day');
  await page.press(`[data-day-quick="${first}"]`, 'Enter');
  await page.waitForFunction((d) => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).tx.some((t) => t.note === 'e2e plus day' && t.date === d), first);
  const id = await page.evaluate(() => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).tx.find((t) => t.note === 'e2e plus day').id);
  const target = days.find((d) => d !== first);
  if (target) {
    await page.waitForSelector(`#tx-table tr[data-id="${id}"]`);
    await page.evaluate((i) => document.querySelector(`#tx-table tr[data-id="${i}"]`).scrollIntoView({ block: 'center' }), id);
    const h = await (await page.$(`#tx-table tr[data-id="${id}"] .drag-h`)).boundingBox();
    const to = await (await page.$(`#tx-table tr[data-day="${target}"]`)).boundingBox();
    await page.mouse.move(h.x + 4, h.y + 8);
    await page.mouse.down();
    await page.mouse.move(h.x + 30, h.y + 20, { steps: 5 });
    await page.mouse.move(to.x + 100, to.y + 10, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction(([i, d]) => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).tx.find((t) => t.id === i)?.date === d, [id, target]);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('Close the month: the checklist, then marked as checked', async () => {
  const { page, errors, context } = await openPage(browser, server.url);
  await page.goto(`${server.url}#log`);
  await page.waitForSelector('#app header.top');
  // Go to last month, log something there, then close it.
  await page.keyboard.press('ArrowLeft');
  await page.waitForSelector('[data-testid="log-close-month"]');
  await page.click('[data-testid="log-close-month"]');
  await page.waitForSelector('[data-testid="cm-steps"]');
  assert.equal(await page.$$eval('[data-testid="cm-steps"] li', (x) => x.length), 4);
  await page.click('[data-testid="cm-close"]');
  await page.waitForFunction(() => Object.keys(JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).settings.closedMonths || {}).length === 1);
  await page.waitForFunction(() => /Checked/.test(document.querySelector('[data-testid="log-close-month"]')?.textContent || ''));
  assert.deepEqual(errors, []);
  await context.close();
});

test('Home: a verdict, a spending limit that sets Safe to spend, and the month recap story', async () => {
  const { page, errors, context } = await openPage(browser, server.url);
  await page.goto(`${server.url}#home`);
  await page.waitForSelector('#app header.top');
  await page.keyboard.press('n');
  await page.waitForSelector('#tx-amount');
  await page.fill('#tx-amount', '200');
  await page.fill('#tx-note', 'e2e lunch');
  await page.click('.sheet button[type=submit]');
  await page.waitForSelector('.safe-hero');
  assert.match(await page.textContent('.home-top h1'), /month|today|limit|first until/i, 'the title is a verdict');

  // Set a limit from the hero: 3 000 a month.
  await page.click('.sh-setlimit');
  await page.waitForSelector('#limit-amount');
  await page.fill('#limit-amount', '3000');
  assert.match(await page.textContent('#limit-preview'), /a day/);
  await page.click('#limit-form button[type=submit]');
  await page.waitForSelector('.sh-limit');
  const lim = await page.evaluate(() => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).settings.limit);
  assert.deepEqual(lim, { on: true, amount: 300000 });
  assert.match(await page.textContent('.sh-limit'), /200\sMDL of 3\s000/);

  // The recap: opens from Reports, moves with the arrow keys, closes with Esc.
  await page.evaluate(() => { location.hash = 'reports'; });
  await page.waitForSelector('[data-act="recap-open"]');
  await page.click('[data-act="recap-open"]');
  await page.waitForSelector('.recap .rc-slide.on');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.recap')?.dataset.slide === '1');
  assert.match(await page.textContent('.rc-slide.on'), /spent|kept/i);
  await page.click('.rc-tap.next');
  await page.waitForFunction(() => document.querySelector('.recap')?.dataset.slide === '2');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.recap'));
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
    const s = JSON.parse(globalThis.__fhStore.getItem('finance-helper.state'));
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
  const find = () => page.evaluate(() => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).tx.find((t) => t.note === 'sheet bread'));
  await page.fill(key('note'), 'sheet bread');
  await page.fill(key('amount'), '10+5');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).tx.some((t) => t.note === 'sheet bread'));
  assert.equal((await find()).amount, 1500);
  assert.equal((await find()).date, day);
  // The sheet redraws right after a save: edit the redrawn cell, not the old one.
  await page.waitForSelector(`${key('amount')}[value="15"]:not([data-id=""])`);
  await page.fill(key('amount'), '20');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).tx.find((t) => t.note === 'sheet bread')?.amount === 2000);
  await page.waitForSelector(`${key('amount')}[value="20"]`);
  await page.fill(key('amount'), '');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => !JSON.parse(globalThis.__fhStore.getItem('finance-helper.state')).tx.some((t) => t.note === 'sheet bread'));
  assert.match(await page.textContent('#sheet-grid'), /Spending: note & category/);
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
      await general();
      assert.equal(await page.locator('[data-set="theme"]:checked').inputValue(), theme);
      assert.equal(await page.locator('#theme-atmosphere .atmosphere-particle').count(), 12);
      // Measured once the section's slide-in animation has settled.
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, null, { timeout: 3000 }).catch(() => {});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    await page.locator('.style-choice:has(input[value="forest"])').click();
    await page.locator('input[value="forest"]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('[data-set="theme"]:checked').inputValue(), 'paper', 'radio gallery supports arrow keys');
    await extras();
    await page.locator('[data-set="themeMotion"]').uncheck();
    await page.reload();
    await general();
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
