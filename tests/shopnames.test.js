import test from 'node:test';
import assert from 'node:assert/strict';
import { shopKey, cleanName, nameGroups, canonicalFor, tidyGroup, keepGroup } from '../js/shopnames.js';
import { defaultState } from '../js/model.js';

test('only notes that are just a shop name count', () => {
  assert.equal(shopKey('LINELLA SRL 123'), 'linella');
  assert.equal(shopKey('Linella'), 'linella');
  assert.equal(shopKey('linella #4411'), 'linella');
  assert.equal(shopKey('linella bread'), 'linella bread', 'a different note, never joined with "linella"');
  assert.equal(shopKey('bought bread and milk for the whole family today'), '');
  assert.equal(shopKey('Plata la LINELLA'), 'linella');
  assert.equal(cleanName('Kaufland Chisinau S.R.L.'), 'kaufland');
});

test('groups, spelling for new records, tidy and keep', () => {
  const s = defaultState();
  const acc = s.settings.accounts[0].id;
  let n = 0;
  const add = (note) => s.tx.push({ id: `t${n++}`, date: '2026-11-01', type: 'expense', amount: 1000, currency: 'MDL', account: acc, category: 'other', note, createdAt: 1, updatedAt: 1 });
  add('bus 3'); add('bus'); add('taxi 45'); add('taxi');
  add('Linella'); add('Linella'); add('LINELLA SRL 123'); add('linella #44'); add('linella bread'); add('Kaufland');
  const g = nameGroups(s);
  assert.equal(g.length, 1);
  assert.equal(g[0].canonical, 'Linella');
  assert.equal(g[0].ids.length, 4);
  assert.equal(canonicalFor(s, 'LINELLA SRL 9'), 'Linella');
  assert.equal(canonicalFor(s, 'NEW SHOP SRL'), 'New Shop');
  assert.equal(canonicalFor(s, 'linella bread'), 'linella bread');
  assert.equal(tidyGroup(s, g[0], 'Linella', 5), 2);
  assert.equal(s.tx.find((t) => t.id === 't6').note, 'Linella');
  assert.equal(s.tx.find((t) => t.id === 't6').updatedAt, 5);
  assert.equal(s.tx.find((t) => t.id === 't8').note, 'linella bread');
  assert.equal(s.tx.find((t) => t.id === 't0').note, 'bus 3', 'your own notes with a number stay');
  assert.equal(nameGroups(s).length, 0);
  add('KAUFLAND SRL');
  keepGroup(s, 'kaufland', 6);
  assert.equal(nameGroups(s).length, 0);
});
