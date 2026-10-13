import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ctx } from '../js/ctx.js';
import { APP_VERSION } from '../js/version.js';
import * as Updates from '../js/screens/updates.js';
import * as SelfCheck from '../js/screens/selfcheck.js';

test('updates settings card renders modern layout, ID and version badge', () => {
  ctx.state = { meta: { installedAt: Date.now(), previousVersion: '1.62.0' } };
  ctx.ui = { tab: 'settings' };
  const html = Updates.settingsCard();
  assert.ok(html.includes('id="update-card"'), 'must preserve update-card id for live DOM refresh');
  assert.ok(html.includes(`v${APP_VERSION}`), 'must display current app version');
  assert.ok(html.includes('set-version-hero'), 'must render version hero banner');
  assert.ok(html.includes('set-status-box'), 'must render status box');
  assert.ok(html.includes('data-act="update-reload"'), 'must provide reload button');
});

test('selfcheck settings card renders modern diagnostics header and action', () => {
  ctx.state = { meta: { lastSelfCheck: { at: Date.now(), ok: 6, failed: 0 } } };
  ctx.ui = { tab: 'settings' };
  const html = SelfCheck.settingsCard();
  assert.ok(html.includes('id="selfcheck-card"'), 'must preserve selfcheck-card id for live DOM refresh');
  assert.ok(html.includes('set-diag-card'), 'must render diag card class');
  assert.ok(html.includes('data-act="selfcheck"'), 'must preserve selfcheck action');
  assert.ok(html.includes('All 6 OK'), 'must format passed diagnostics badge');
});

test('css contains settings modernization rules and responsive grid', () => {
  const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.view-settings { max-width: 1680px; }'), 'must widen settings view');
  assert.ok(css.includes('.set-hero-banner'), 'must include hero banner styles');
  assert.ok(css.includes('.set-nav-header'), 'must style navigation header');
  assert.ok(css.includes('.set-tab-chevron'), 'must style tab chevron');
  assert.ok(css.includes('.set-privacy-badge'), 'must include offline privacy badge');
  assert.ok(css.includes('.set-danger-card'), 'must style danger card');
  assert.ok(!css.includes('.set-grid { display: block; columns: 2;'), 'must not use fragile CSS multi-columns in set-grid');
});
