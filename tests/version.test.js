import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION, isNewerVersion } from '../js/version.js';

test('js/version.js matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(APP_VERSION, pkg.version);
});

test('isNewerVersion compares semver correctly', () => {
  // Remote is older than local -> false
  assert.equal(isNewerVersion('1.71.0', '1.72.0'), false);
  assert.equal(isNewerVersion('v1.71.0', '1.72.0'), false);
  assert.equal(isNewerVersion('1.71.9', '1.72.0'), false);
  assert.equal(isNewerVersion('0.9.0', '1.72.0'), false);

  // Equal versions -> false
  assert.equal(isNewerVersion('1.72.0', '1.72.0'), false);
  assert.equal(isNewerVersion('v1.72.0', '1.72.0'), false);

  // Remote is strictly newer -> true
  assert.equal(isNewerVersion('1.72.1', '1.72.0'), true);
  assert.equal(isNewerVersion('1.73.0', '1.72.0'), true);
  assert.equal(isNewerVersion('2.0.0', '1.72.0'), true);
  assert.equal(isNewerVersion('v1.73.0', '1.72.0'), true);

  // Edge cases & prereleases
  assert.equal(isNewerVersion(null, '1.72.0'), false);
  assert.equal(isNewerVersion('1.72.0', null), false);
  assert.equal(isNewerVersion('1.72.0-beta.1', '1.72.0'), false);
  assert.equal(isNewerVersion('1.72.0', '1.72.0-beta.1'), true);
});

