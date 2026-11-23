// A screen's styles must not be overwritten by another screen's rules with the same class name
// (1.112 styled the phone-payment card rows as .pp-card and squashed the People cards).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');

test('People cards (.pp-card) are styled in one place only', () => {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const roots = plain.match(/(^|[}\s,])\.pp-card\s*\{/g) || [];
  assert.equal(roots.length, 1, 'another .pp-card rule would restyle every People card');
});

test('the phone-payments sheet uses its own class names', () => {
  const js = readFileSync(new URL('../js/standalone.js', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /class="pp-(card|cards|how|app)\b/);
});
