import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPrune, backupName, dateOf } from '../js/backups.js';

test('keeps 30 days and one per month for two years', () => {
  const names = [];
  for (let i = 0; i < 900; i++) {
    const d = new Date(Date.UTC(2026, 9, 9) - i * 864e5).toISOString().slice(0, 10);
    names.push(backupName(d));
  }
  const gone = new Set(toPrune(names, '2026-10-09'));
  const kept = names.filter((n) => !gone.has(n));
  assert.ok(kept.includes(backupName('2026-10-09')));
  assert.ok(kept.includes(backupName('2026-09-10'))); // 29 days ago
  assert.ok(!kept.includes(backupName('2026-09-05'))); // 34 days, not first of month
  assert.ok(kept.includes(backupName('2026-09-01'))); // first of its month
  assert.ok(kept.includes(backupName('2025-01-01')));
  assert.ok(!kept.includes(backupName('2024-05-01'))); // older than 24 months
  assert.equal(dateOf('finance-helper-2026-03-01.json'), '2026-03-01');
  assert.ok(kept.length < 60);
});
