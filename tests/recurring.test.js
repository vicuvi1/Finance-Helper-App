import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nth, occurrences, nextDate, dueItems, upcomingItems, makeTx, markDone, perMonth, suggestions } from '../js/recurring.js';
import { defaultState, normalizeState } from '../js/model.js';
import { mergeStates, toCloud } from '../js/sync.js';
import { addDays, daysBetween } from '../js/dates.js';

const rule = (extra) => ({ id: 'r1', type: 'expense', amount: 500000, currency: 'MDL', account: 'card', category: 'home', note: 'rent', every: 'month', start: '2026-01-31', lastDone: null, auto: false, paused: false, updatedAt: 1, ...extra });

test('dates helpers', () => {
  assert.equal(addDays('2026-02-27', 3), '2026-03-02');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(daysBetween('2026-01-01', '2026-03-01'), 59);
});

test('monthly rules keep the day, clamped to short months', () => {
  const r = rule();
  assert.deepEqual([0, 1, 2, 3].map((n) => nth(r, n)), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(occurrences(rule({ every: 'week', start: '2026-03-02' }), '2026-03-01', '2026-03-31'), ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30']);
  assert.deepEqual(occurrences(rule({ every: 'year', start: '2024-02-29' }), '2025-01-01', '2028-12-31'), ['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  assert.deepEqual(occurrences(rule({ every: '3months', start: '2026-01-15', end: '2026-08-01' }), '2026-01-01', '2027-01-01'), ['2026-01-15', '2026-04-15', '2026-07-15']);
  assert.equal(nextDate(rule(), '2026-02-28'), '2026-03-31');
});

test('due and upcoming', () => {
  const s = defaultState();
  s.recurring = [rule({ lastDone: '2026-02-28' }), rule({ id: 'r2', type: 'income', note: 'salary', start: '2026-03-10', amount: 2000000 }), rule({ id: 'r3', paused: true })];
  const due = dueItems(s, '2026-04-05');
  assert.deepEqual(due.map((d) => `${d.rule.id} ${d.date}`), ['r2 2026-03-10', 'r1 2026-03-31']);
  const up = upcomingItems(s, '2026-04-05', 30);
  assert.deepEqual(up.map((d) => `${d.rule.id} ${d.date}`), ['r2 2026-04-10', 'r1 2026-04-30']);
});

test('making a record and marking done', () => {
  const r = rule({ currency: 'USD', amount: 10000 });
  const t = makeTx(r, '2026-03-31', { id: 'x', now: 5, rate: 17.5 });
  assert.equal(t.base, 175000);
  assert.equal(t.recurring, 'r1');
  markDone(r, '2026-03-31', 9);
  markDone(r, '2026-02-28', 10); // older date never moves it back
  assert.equal(r.lastDone, '2026-03-31');
  assert.equal(perMonth(rule({ every: 'year', amount: 120000 })), 10000);
});

test('suggests regular payments, not daily shopping', () => {
  const s = defaultState();
  const tx = (date, note, amount) => ({ id: `${date}${note}`, type: 'expense', amount, date, category: 'other', account: 'card', note });
  for (const m of ['06', '07', '08', '09']) {
    s.tx.push(tx(`2026-${m}-05`, 'Netflix', 19900));
    for (let d = 10; d < 20; d++) s.tx.push(tx(`2026-${m}-${d}`, 'groceries', 10000 + d * 300));
  }
  s.tx.push(tx('2026-07-03', 'gym', 50000), tx('2026-08-03', 'Gym', 50000), tx('2026-09-03', 'gym ', 52000));
  const got = suggestions(s, '2026-09-20').map((x) => x.tx.note.trim().toLowerCase());
  assert.deepEqual(got, ['gym', 'netflix']);
  s.recurring = [rule({ note: 'netflix' })];
  assert.deepEqual(suggestions(s, '2026-09-20').map((x) => x.tx.note.toLowerCase().trim()), ['gym']);
});

test('rules survive normalize and sync', () => {
  const a = normalizeState({ ...defaultState(), recurring: [rule(), { id: 'bad' }] });
  assert.equal(a.recurring.length, 1);
  const b = normalizeState(defaultState());
  b.recurring = [rule({ id: 'r9', note: 'gym', updatedAt: 3 })];
  const { state } = mergeStates(a, toCloud(b, 'phone'));
  assert.deepEqual(state.recurring.map((r) => r.id).sort(), ['r1', 'r9']);
  state.deleted.r1 = 10;
  const again = mergeStates(b, toCloud(state, 'pc'));
  assert.deepEqual(again.state.recurring.map((r) => r.id), ['r9']);
});

test('a one-time scheduled payment happens once', () => {
  const s = defaultState();
  const once = rule({ id: 'o1', every: 'once', start: '2026-10-20', note: 'car service', amount: 250000 });
  s.recurring = [once];
  assert.deepEqual(occurrences(once, '2026-01-01', '2027-12-31'), ['2026-10-20']);
  assert.equal(upcomingItems(s, '2026-10-10', 30).length, 1);
  assert.equal(dueItems(s, '2026-10-10').length, 0);
  assert.equal(dueItems(s, '2026-10-21').length, 1);
  markDone(once, '2026-10-20');
  assert.equal(dueItems(s, '2026-11-30').length, 0);
  assert.equal(nextDate(once, '2026-10-20'), null);
  assert.equal(perMonth(once), 0);
});

test('getSubGroup classifies subscriptions into recognizable categories', async () => {
  const { getSubGroup } = await import('../js/screens/plan.js');
  assert.equal(getSubGroup({ note: 'ChatGPT Plus' }).id, 'ai');
  assert.equal(getSubGroup({ note: 'Claude Pro' }).id, 'ai');
  assert.equal(getSubGroup({ note: 'Cursor' }).id, 'ai');
  assert.equal(getSubGroup({ note: 'Midjourney v6' }).id, 'ai');
  assert.equal(getSubGroup({ note: 'Netflix Premium' }).id, 'media');
  assert.equal(getSubGroup({ note: 'Spotify' }).id, 'media');
  assert.equal(getSubGroup({ note: 'Moldtelecom Fiber' }).id, 'utilities');
  assert.equal(getSubGroup({ note: 'Rent Apartment' }).id, 'living');
  assert.equal(getSubGroup({ note: 'Gym Premier' }).id, 'health');
});

test('PRESET_SUBS contains top AI services and popular tools', async () => {
  const { PRESET_SUBS } = await import('../js/screens/plan.js');
  const names = PRESET_SUBS.map((p) => p.name);
  assert.ok(names.includes('ChatGPT Plus'));
  assert.ok(names.includes('Claude Pro'));
  assert.ok(names.includes('Cursor Pro'));
  assert.ok(names.includes('GitHub Copilot'));
  assert.ok(names.includes('Midjourney'));
  assert.ok(names.includes('Netflix'));
});

test('Plan screen renders Subscriptions Hub, What-If simulator, and tabs', async () => {
  const { ctx } = await import('../js/ctx.js');
  const PlanScreen = await import('../js/screens/plan.js');
  const s = defaultState();
  s.recurring = [
    { id: 'sub-gpt', type: 'expense', amount: 2000, currency: 'USD', note: 'ChatGPT Plus', every: 'month', start: '2026-10-01', category: 'work', account: 'card', auto: true, paused: false },
    { id: 'sub-net', type: 'expense', amount: 1199, currency: 'EUR', note: 'Netflix', every: 'month', start: '2026-10-05', category: 'fun', account: 'card', auto: true, paused: false },
  ];
  ctx.state = s;
  ctx.money = (v) => `${v} MDL`;
  ctx.countUp = (v) => `${v}`;
  ctx.catColor = () => 'var(--c1)';
  ctx.ui = { planTab: 'subs' };

  const html = PlanScreen.view();
  assert.match(html, /Plan &amp; Subscriptions/);
  assert.match(html, /ChatGPT Plus/);
  assert.match(html, /Netflix/);
  assert.match(html, /sub-kpi-grid/);
  assert.match(html, /sub-dist-bar/);
  assert.match(html, /plan-tabs/);
});

test('preset price customization: getPresetSubs, setPresetPrice, resetPresetPrice, formatPresetPrice', async () => {
  const { getPresetSubs, setPresetPrice, resetPresetPrice, formatPresetPrice } = await import('../js/screens/plan.js');
  const s = defaultState();

  // Initially all presets have isCustom: false and default prices
  const initialPresets = getPresetSubs(s);
  const gpt = initialPresets.find((p) => p.name === 'ChatGPT Plus');
  assert.equal(gpt.amount, 2000);
  assert.equal(gpt.currency, 'USD');
  assert.equal(gpt.isCustom, false);
  assert.equal(formatPresetPrice(gpt), '$20');

  const netflix = initialPresets.find((p) => p.name === 'Netflix');
  assert.equal(netflix.amount, 1199);
  assert.equal(netflix.currency, 'EUR');
  assert.equal(formatPresetPrice(netflix), '€11.99');

  const gym = initialPresets.find((p) => p.name === 'Gym Membership');
  assert.equal(gym.amount, 65000);
  assert.equal(gym.currency, 'MDL');
  assert.equal(formatPresetPrice(gym), '650 MDL');

  // Customize ChatGPT Plus to $25 and Gym Membership to 450 MDL
  setPresetPrice(s, 'ChatGPT Plus', 2500, 'USD');
  setPresetPrice(s, 'Gym Membership', 45000, 'MDL');

  assert.equal(s.settings.presetPrices['ChatGPT Plus'].amount, 2500);
  assert.equal(s.settings.presetPrices['Gym Membership'].amount, 45000);

  const updatedPresets = getPresetSubs(s);
  const updatedGpt = updatedPresets.find((p) => p.name === 'ChatGPT Plus');
  assert.equal(updatedGpt.amount, 2500);
  assert.equal(updatedGpt.currency, 'USD');
  assert.equal(updatedGpt.isCustom, true);
  assert.equal(formatPresetPrice(updatedGpt), '$25');

  const updatedGym = updatedPresets.find((p) => p.name === 'Gym Membership');
  assert.equal(updatedGym.amount, 45000);
  assert.equal(updatedGym.isCustom, true);
  assert.equal(formatPresetPrice(updatedGym), '450 MDL');

  // Reset a single preset
  resetPresetPrice(s, 'ChatGPT Plus');
  assert.equal(s.settings.presetPrices['ChatGPT Plus'], undefined);
  assert.equal(getPresetSubs(s).find((p) => p.name === 'ChatGPT Plus').isCustom, false);
  assert.equal(getPresetSubs(s).find((p) => p.name === 'Gym Membership').isCustom, true);

  // Reset all
  resetPresetPrice(s);
  assert.deepEqual(s.settings.presetPrices, {});
  assert.equal(getPresetSubs(s).find((p) => p.name === 'Gym Membership').isCustom, false);
});

test('preset price editor mode and custom price rendering', async () => {
  const { ctx } = await import('../js/ctx.js');
  const PlanScreen = await import('../js/screens/plan.js');
  const s = defaultState();
  s.settings.presetPrices = {
    'Claude Pro': { amount: 2200, currency: 'USD' },
  };
  ctx.state = s;
  ctx.ui = { planTab: 'subs', showPresets: true, editingPresets: false };

  // View mode renders custom price badge and pill
  let html = PlanScreen.view();
  assert.match(html, /Custom prices active/);
  assert.match(html, /\$22/);
  assert.match(html, /plan-toggle-edit-presets/);
  assert.match(html, /plan-edit-price-one/);

  // In edit mode renders input fields
  ctx.ui.editingPresets = true;
  html = PlanScreen.view();
  assert.match(html, /Preset Price Editor/);
  assert.match(html, /preset-input-amt/);
  assert.match(html, /preset-input-cur/);
  assert.match(html, /✓ Done editing/);
});

test('plan-use-preset uses customized price when clicked', async () => {
  const { ctx } = await import('../js/ctx.js');
  const PlanScreen = await import('../js/screens/plan.js');
  const s = defaultState();
  s.settings.presetPrices = {
    'ChatGPT Plus': { amount: 2400, currency: 'USD' },
  };
  ctx.state = s;
  const presets = PlanScreen.getPresetSubs(s);
  const customGpt = presets.find((p) => p.name === 'ChatGPT Plus');
  assert.equal(customGpt.amount, 2400);
  assert.equal(customGpt.currency, 'USD');
  assert.equal(customGpt.isCustom, true);
});



