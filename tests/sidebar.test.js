import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('index.html: modern executive sidebar markup', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  // Brand header with offline status
  assert.ok(html.includes('class="brand-meta"'), 'index.html has brand-meta');
  assert.ok(html.includes('Finance Helper'), 'index.html has brand title');
  assert.ok(html.includes('Private &amp; Offline'), 'index.html has private & offline status');

  // Search & Command bar
  assert.ok(html.includes('class="side-search" data-act="cmd-palette"'), 'index.html has side search command bar');
  assert.ok(html.includes('Search or command…'), 'index.html has command search label');
  assert.ok(html.includes('Ctrl K'), 'index.html displays Ctrl K badge');

  // New record CTA with keyboard hint
  assert.ok(html.includes('class="fab-kbd" aria-hidden="true">N</kbd>'), 'index.html has N key badge in FAB');

  // Section headers
  assert.ok(html.includes('<span class="nav-h">Overview</span>'), 'index.html has Overview header');
  assert.ok(html.includes('<span class="nav-h">Money</span>'), 'index.html has Money header');
  assert.ok(html.includes('<span class="nav-h">Insights</span>'), 'index.html has Insights header');

  // Foot actions
  assert.ok(html.includes('class="side-foot-actions"'), 'index.html has side-foot-actions container');
  assert.ok(html.includes('data-act="lock-app" title="Lock App (L)"'), 'index.html has quick Lock action button');
  assert.ok(html.includes('class="side-mini-kbd">0</kbd>'), 'index.html has 0 shortcut on Settings');
  assert.ok(html.includes('<kbd>H</kbd> hide balance'), 'index.html shortcuts list includes H');
});

test('app.js and css/app.css: sidebar logic, masking, and styling', () => {
  const appJs = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const appCss = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');

  // Mask balance support
  assert.ok(appJs.includes('maskBalance:'), 'app.js initializes maskBalance');
  assert.ok(appJs.includes("act === 'toggle-mask'"), 'app.js handles toggle-mask action');
  assert.ok(appJs.includes("e.key === 'h' || e.key === 'H'"), 'app.js binds H shortcut to balance masking');
  assert.ok(appJs.includes("act === 'cmd-palette'"), 'app.js handles cmd-palette action');
  assert.ok(appJs.includes("act === 'lock-app'"), 'app.js handles lock-app action');

  // Sparkline beacon dot and pulse
  assert.ok(appJs.includes('spark-dot'), 'app.js includes spark-dot in sparkline');
  assert.ok(appJs.includes('spark-pulse'), 'app.js includes spark-pulse in sparkline');

  // Modern Goal capsule
  assert.ok(appJs.includes('sf-goal-track'), 'app.js has sf-goal-track for goal capsule');
  assert.ok(appJs.includes('sf-goal-fill'), 'app.js has sf-goal-fill progress bar');

  // CSS definitions
  assert.ok(appCss.includes('.side-search'), 'app.css has .side-search styles');
  assert.ok(appCss.includes('.sc-mask-btn'), 'app.css has .sc-mask-btn styles');
  assert.ok(appCss.includes('.sc-badge'), 'app.css has .sc-badge trend badge styles');
  assert.ok(appCss.includes('.sf-goal-fill'), 'app.css has .sf-goal-fill styles');
  assert.ok(appCss.includes('.side-foot-actions'), 'app.css has .side-foot-actions styles');
});
