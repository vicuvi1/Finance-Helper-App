// Bills and subscriptions as a calendar (api/calendar.mjs). Made-up data.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeTurso } from '../e2e/faketurso.mjs';
import { startDevServer } from '../e2e/devserver.mjs';
import { calendarICS } from '../api/calendar.mjs';
import { normalizeState } from '../js/model.js';

test('one all-day event per payment, with a reminder', () => {
  const s = normalizeState({ settings: { accounts: [{ id: 'm', name: 'Made-up card', currency: 'MDL', kind: 'card' }] }, recurring: [
    { id: 'r1', type: 'expense', note: 'Made-up Stream', amount: 19900, currency: 'MDL', account: 'm', every: 'month', start: '2026-12-05' },
    { id: 'r2', type: 'expense', note: 'Paused one', amount: 100, currency: 'MDL', every: 'month', start: '2026-12-01', paused: true },
    { id: 'r3', type: 'income', note: 'Pay', amount: 100, currency: 'MDL', every: 'month', start: '2026-12-01' },
  ] });
  const ics = calendarICS(s, '2026-11-21', { months: 2 });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2, '5 Dec and 5 Jan; paused and income left out');
  assert.match(ics, /DTSTART;VALUE=DATE:20261205/);
  assert.match(ics, /SUMMARY:Made-up Stream 199\sMDL · Made-up card/);
  assert.match(ics, /BEGIN:VALARM/);
});

test('a long name with emoji is folded between characters, never inside one', () => {
  const note = `x${'🎬'.repeat(60)}`;
  const s = normalizeState({ recurring: [{ id: 'r1', type: 'expense', note, amount: 19900, currency: 'MDL', every: 'month', start: '2026-12-05' }] });
  const ics = calendarICS(s, '2026-11-21', { months: 1 });
  assert.equal(Buffer.from(ics, 'utf8').toString('utf8'), ics, 'no half emoji at the end of a folded line');
  assert.ok(ics.replace(/\r\n /g, '').includes(note), 'unfolded, the name is whole');
});

let turso; let server;
before(async () => {
  turso = await startFakeTurso();
  server = await startDevServer({ env: { TURSO_URL: turso.url, TURSO_TOKEN: turso.token, CRON_SECRET: 'k', SESSION_SECRET: 's' } });
});
after(async () => { await server?.close(); await turso?.close(); });

test('only the private link opens it; a new link replaces the old one', async () => {
  const post = (body, token) => fetch(`${server.url}/api/calendar`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post({ op: 'link' })).status, 401);
  const session = (await (await fetch(`${server.url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setup: 'k', pin: '2468' }) })).json()).session;
  const url = (await (await post({ op: 'link' }, session)).json()).url;
  const k = new URL(url).searchParams.get('k');
  assert.ok(k.length > 20);
  const ok = await fetch(`${server.url}/api/calendar?k=${k}`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /text\/calendar/);
  assert.equal((await fetch(`${server.url}/api/calendar?k=wrong`)).status, 404);
  const url2 = (await (await post({ op: 'reset' }, session)).json()).url;
  assert.notEqual(url2, url);
  assert.equal((await fetch(`${server.url}/api/calendar?k=${k}`)).status, 404, 'the old link stops working');
});
