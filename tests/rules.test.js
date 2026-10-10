import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, suggestCategory, matchRule, learnedCategory, ruleWord, addRule, removeRule, ruleTargets, applyRule } from '../js/model.js';

let n = 0;
const ex = (note, category, type = 'expense') => ({ id: `r${n++}`, type, amount: 1000, date: '2026-10-01', category, account: 'card', note });

test('rules win, longest match first, any type', () => {
  const s = defaultState();
  addRule(s, { match: 'Orange', type: 'expense', category: 'home' });
  addRule(s, { match: 'orange money', type: 'expense', category: 'other' });
  assert.equal(suggestCategory(s, 'Plata Orange Moldova', 'expense'), 'home');
  assert.equal(matchRule(s, 'ORANGE MONEY top-up', 'expense').category, 'other');
  assert.equal(suggestCategory(s, 'Orange', 'income'), null);
  // Same match and type replaces the old rule.
  addRule(s, { match: 'orange', type: 'expense', category: 'subscriptions' });
  assert.equal(s.settings.rules.length, 2);
  assert.equal(suggestCategory(s, 'orange', 'expense'), 'subscriptions');
  removeRule(s, s.settings.rules[0].id);
  assert.equal(s.settings.rules.length, 1);
});

test('learns words from bank lines', () => {
  const s = defaultState();
  s.tx.push(ex('Plata la NUMBEO SRL Chisinau #4411', 'fun'), ex('Plata la NUMBEO SRL Chisinau #9876', 'fun'), ex('Plata la Farmacia Familiei', 'health'));
  assert.equal(learnedCategory(s, 'Plata la NUMBEO SRL Chisinau #1111', 'expense'), 'fun');
  assert.equal(suggestCategory(s, 'Plata la NUMBEO SRL Chisinau #1111', 'expense'), 'fun');
  // "plata", "chisinau" are boilerplate, never learned.
  assert.equal(learnedCategory(s, 'Plata la Chisinau', 'expense'), null);
  // Mixed history: no confident guess.
  s.tx.push(ex('numbeo refill', 'food'));
  assert.equal(learnedCategory(s, 'numbeo', 'expense'), null);
});

test('rule word and applying to records still in Other', () => {
  assert.equal(ruleWord('Plata la LINELLA SRL Chisinau 2231'), 'linella');
  const s = defaultState();
  s.tx.push(ex('LINELLA 1', 'other'), ex('linella 2', 'other'), ex('Linella 3', 'gifts'), ex('Kaufland', 'other'));
  const rule = addRule(s, { match: 'Linella', type: 'expense', category: 'food' });
  assert.equal(ruleTargets(s, rule).length, 2);
  assert.equal(ruleTargets(s, rule, { onlyOther: false }).length, 3);
  assert.equal(applyRule(s, rule, undefined, 7), 2);
  assert.deepEqual(s.tx.map((t) => t.category), ['food', 'food', 'gifts', 'other']);
  assert.equal(s.tx[0].updatedAt, 7);
});
