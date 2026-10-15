import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarHTML } from '../js/logviews.js';

test('calendarHTML builds modern day cards, week totals, and insights bar', () => {
  const state = {
    settings: {
      currency: 'MDL',
      categories: [
        { id: 'c1', name: 'Food', emoji: '🍔' },
        { id: 'c2', name: 'Work', emoji: '💼' },
      ],
      accounts: [{ id: 'a1', name: 'Card' }],
    },
    tx: [
      { id: 't1', date: '2026-10-04', type: 'income', amount: 200000, category: 'c2', account: 'a1' },
      { id: 't2', date: '2026-10-04', type: 'expense', amount: 20700, category: 'c1', account: 'a1' },
      { id: 't3', date: '2026-10-10', type: 'expense', amount: 574500, category: 'c1', account: 'a1', note: 'groceries' },
      { id: 't4', date: '2026-10-15', type: 'expense', amount: 8000, category: 'c1', account: 'a1', note: 'lunch' },
    ],
  };

  const html = calendarHTML(state, '2026-10');

  // Container and grid
  assert.ok(html.includes('cal-container'), 'must wrap in cal-container');
  assert.ok(html.includes('cal-dow'), 'must render day of week headers');
  assert.ok(html.includes('Weekly'), 'must include weekly header');

  // Day cards and content
  assert.ok(html.includes('cal-date-badge'), 'must render date badges');
  assert.ok(html.includes('cal-quick-add'), 'must render quick add buttons');
  assert.ok(html.includes('data-act="day-add"'), 'quick add button must have day-add action');
  assert.ok(html.includes('cal-pill income'), 'must render income pill for +2 000');
  assert.ok(html.includes('cal-pill expense'), 'must render expense pill for spent days');

  // Category emoji
  assert.ok(html.includes('cal-emojis'), 'must display category emojis');
  assert.ok(html.includes('🍔'), 'must show food emoji');

  // Week card
  assert.ok(html.includes('cal-week-card'), 'must render week cards');
  assert.ok(html.includes('cw-out'), 'must render weekly outflow');

  // Insights bar
  assert.ok(html.includes('cal-insights-bar'), 'must render month insights bar');
  assert.ok(html.includes('Peak spend:'), 'must identify peak spend day');
  assert.ok(html.includes('Daily avg:'), 'must display daily average');
  assert.ok(html.includes('No-spend days:'), 'must display no-spend days count');
});
