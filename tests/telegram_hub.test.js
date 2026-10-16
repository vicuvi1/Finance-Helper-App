import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ctx } from '../js/ctx.js';
import * as TelegramHub from '../js/screens/telegram_hub.js';

test('simulateCommand handles built-in commands and quick parsing', () => {
  const state = {
    settings: {
      currency: 'MDL',
      accounts: [{ id: 'a1', name: 'Cash', kind: 'cash' }],
      categories: [{ id: 'food', name: 'Food & Dining', type: 'expense', emoji: '🍔' }],
      jars: [],
    },
    tx: [
      { id: '1', date: '2026-10-15', type: 'expense', amount: 3500, category: 'food', account: 'a1', note: 'coffee' }
    ],
    goals: [],
    rates: { usd: { MDL: 18.0 } },
  };

  const today = TelegramHub.simulateCommand('/today', state);
  assert.ok(today.includes('Today'), 'must answer /today');

  const balance = TelegramHub.simulateCommand('/balance', state);
  assert.ok(balance.includes('All my money'), 'must answer /balance');

  const safe = TelegramHub.simulateCommand('/safe', state);
  assert.ok(safe.includes('Safe to spend'), 'must answer /safe');

  const rates = TelegramHub.simulateCommand('/rates', state);
  assert.ok(rates.includes('Exchange Rates'), 'must answer /rates');

  const quick = TelegramHub.simulateCommand('coffee 45', state);
  assert.ok(quick.includes('Parsed transaction simulation'), 'must parse test expense');
});

test('view renders telegram hub header and subtabs', () => {
  ctx.state = {
    settings: {
      currency: 'MDL',
      accounts: [{ id: 'a1', name: 'Cash', kind: 'cash' }],
      categories: [{ id: 'food', name: 'Food', type: 'expense' }],
      jars: [],
    },
    tx: [],
    meta: {},
  };
  ctx.ui = { tab: 'telegram' };

  const html = TelegramHub.view();
  assert.ok(html.includes('Telegram bot'), 'must display Telegram bot title');
  assert.ok(html.includes('data-act="tg-load"'), 'must provide sync button');
  assert.ok(html.includes('seg-tg-tabs'), 'must provide segmented subtabs');
  assert.ok(html.includes('From your phone'), 'must render sync tab button');
  assert.ok(html.includes('data-tab="buttons"'), 'must render buttons tab button');
  assert.ok(html.includes('Try a command'), 'must render commands tab button');
  assert.ok(html.includes('When this PC is off'), 'says who answers while the PC is off');
});

test('index.html and app.js include telegram navigation and shortcuts', () => {
  const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const appJs = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

  assert.ok(indexHtml.includes('href="#telegram" data-tab="telegram" data-key="8"'), 'index.html must have telegram link with key 8');
  assert.ok(indexHtml.includes('Telegram bot</span>'), 'index.html must label tab Telegram bot');
  assert.ok(appJs.includes('8: \'telegram\''), 'app.js shortcut map must map 8 to telegram');
  assert.ok(appJs.includes('telegram: TelegramHub'), 'app.js SCREENS must register telegram');
  assert.ok(!appJs.includes('📥 From Telegram</button>'), 'app.js must not clutter Log toolbar with From Telegram');
});
