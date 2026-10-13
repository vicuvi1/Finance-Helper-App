import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { serve, launch, openPage, ROOT } from './helpers.mjs';
let server, browser;
before(async () => { server = await serve(); browser = await launch(); });
after(async () => { await browser?.close(); server?.close(); });
async function fixture(size) {
  const r = await openPage(browser, server.url, size);
  await r.page.goto(server.url + '#goals');
  await r.page.waitForSelector('#app header.top');
  await r.page.evaluate(async () => {
    const { defaultState } = await import('/js/model.js');
    const s = defaultState();
    s.settings.theme = 'forest'; s.settings.themeMotion = false;
    s.settings.accounts[0].start = 1000000;
    s.goals = [
      { id: 'fund', name: 'Emergency fund', emoji: '🛟', target: 3000000, account: 'all', theme: 'teal', updatedAt: 0 },
      { id: 'trip', name: 'Summer trip', emoji: '✈️', target: 1500000, account: 'allocated', theme: 'ocean', updatedAt: 0 },
    ];
    s.tx = [{ id: 'pay', type: 'income', currency: 'MDL', amount: 100000, base: 100000, account: 'wallet', category: 'work', date: '2026-10-01', note: 'Example pay', updatedAt: 1 }];
    localStorage.setItem('finance-helper.state', JSON.stringify(s));
  });
  await r.page.reload(); await r.page.waitForSelector('.goal-reservations');
  return r;
}
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('finance-helper.state')));

test('allocate income across goals, block excess, release, undo, and persist at desktop and phone widths', async () => {
  for (const width of [1440, 390]) {
    const { page, context, errors } = await fixture({ width, height: 1000 });
    await page.locator('.top [data-act="goal-allocate"]').click();
    await page.selectOption('#allocation-source', 'pay');
    await page.fill('[data-allocation-goal="fund"]', '700');
    await page.fill('[data-allocation-goal="trip"]', '400');
    assert.equal(await page.locator('#allocation-save').isDisabled(), true);
    assert.match(await page.textContent('#allocation-error'), /exceeds/);
    await page.fill('[data-allocation-goal="trip"]', '300');
    assert.equal(await page.locator('#allocation-save').isEnabled(), true);
    await page.screenshot({ path: join(ROOT, `goal-allocation-form-${width}.png`), fullPage: false });
    await page.click('#allocation-save');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('finance-helper.state')).goalAllocations.length === 2);
    let s = await stored(page);
    assert.equal(s.goals[0].account, 'allocated');
    assert.equal(s.goalAllocations.reduce((n, a) => n + a.amount, 0), 100000);
    assert.equal(s.tx.length, 1);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(ROOT, `goal-allocation-goals-${width}.png`), fullPage: false });
    await page.locator('.goal-reservations summary').click();
    await page.locator('[data-act="goal-release"]').first().click();
    await page.fill('#release-allocation-amount', '200');
    await page.click('#release-allocation-form button[type="submit"]');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('finance-helper.state')).goalAllocations.reduce((n, a) => n + a.amount, 0) === 80000);
    await page.click('.top h1'); await page.keyboard.press('Control+z');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('finance-helper.state')).goalAllocations.reduce((n, a) => n + a.amount, 0) === 100000);
    await page.reload(); await page.waitForSelector('.goal-reservations');
    s = await stored(page); assert.equal(s.goalAllocations.reduce((n, a) => n + a.amount, 0), 100000);
    assert.deepEqual(errors, []); await context.close();
  }
});

test('new income and edited income both offer goal allocation; shortages can be resolved', async () => {
  const { page, context, errors } = await fixture({ width: 1440, height: 1000 });
  await page.keyboard.press('n'); await page.waitForSelector('#tx-amount');
  await page.click('.sheet [data-type="income"]');
  await page.fill('#tx-amount', '50'); await page.fill('#tx-note', 'Example new income');
  await page.click('#tx-form button[type="submit"]'); await page.waitForSelector('#split-goals');
  await page.click('#split-goals'); await page.waitForSelector('#allocation-source');
  const id = await page.inputValue('#allocation-source'); assert.ok(id && id !== 'pay');
  await page.fill('[data-allocation-goal="fund"]', '50'); await page.click('#allocation-save');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('finance-helper.state')).goalAllocations.length === 1);
  await page.evaluate(() => { location.hash = 'log'; }); await page.waitForSelector('.view-log');
  await page.keyboard.press('Escape');
  // Open an existing income directly through the rendered list.
  await page.locator('[data-act="log-view"][data-view="list"]').click();
  await page.locator('.tx').filter({ hasText: 'Example new income' }).click();
  await page.waitForSelector('[data-act="tx-allocate"]'); await page.click('[data-act="tx-allocate"]');
  await page.waitForSelector('#allocation-source'); assert.equal(await page.inputValue('#allocation-source'), id);
  await page.fill('[data-allocation-goal="trip"]', '1'); assert.equal(await page.locator('#allocation-save').isDisabled(), true);
  await page.keyboard.press('Escape');
  await page.evaluate((incomeId) => {
    const s = JSON.parse(localStorage.getItem('finance-helper.state')); const t = s.tx.find((t) => t.id === incomeId); t.amount = t.base = 1000;
    localStorage.setItem('finance-helper.state', JSON.stringify(s)); location.hash = 'goals';
  }, id);
  await page.reload(); await page.waitForSelector('.allocation-warning');
  await page.locator('.goal-reservations summary').click(); await page.locator('[data-act="goal-release"]').click();
  await page.click('#release-allocation-form button[type="submit"]');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('finance-helper.state')).goalAllocations.length === 0);
  assert.deepEqual(errors, []); await context.close();
});
