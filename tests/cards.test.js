import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardHTML, BANK_CARDS, designOf, designGroups } from '../js/cards.js';

const money = (c) => `${c / 100} MDL`;
const acc = (extra = {}) => ({ id: 'a1', name: 'maib card', bank: 'maib', kind: 'card', currency: 'MDL', ...extra });

test('bank card designs: grouped by bank (yours first), drawn with the card name and network', () => {
  assert.ok(BANK_CARDS.some((d) => d.id === 'maib-business'));
  assert.ok(BANK_CARDS.filter((d) => d.bank === 'Victoriabank').length >= 8);
  assert.equal(new Set(BANK_CARDS.map((d) => d.id)).size, BANK_CARDS.length);
  assert.equal(designGroups('Victoriabank')[0][0], 'Victoriabank');
  assert.equal(designGroups('maib')[0][0], 'maib');
  const a = acc({ cardTheme: 'card:maib-business' });
  assert.equal(designOf(a).name, 'maib Business');
  const html = cardHTML({ account: a, own: 120000, inBase: 120000 }, { money });
  assert.match(html, /class="bcard design design-maib-business/);
  assert.match(html, /bc-product">business</);
  assert.match(html, /bc-net">Visa Business</);
  // Light designs get dark ink.
  assert.match(cardHTML({ account: acc({ cardTheme: 'card:vb-gold' }), own: 0, inBase: 0 }, { money }), /design-vb-gold light/);
  // An unknown design falls back to the color themes.
  assert.equal(designOf(acc({ cardTheme: 'card:nope' })), null);
});

test('a picture of the card is used only when it is a real image', () => {
  const ok = 'data:image/jpeg;base64,AAAA';
  assert.match(cardHTML({ account: acc({ cardImage: ok }), own: 0, inBase: 0 }, { money }), /bcard photo.*background-image:url\(&quot;data:image\/jpeg;base64,AAAA&quot;\)/s);
  const bad = cardHTML({ account: acc({ cardImage: 'javascript:alert(1)' }), own: 0, inBase: 0 }, { money });
  assert.doesNotMatch(bad, /photo|javascript/);
});

test('accountDisplayName and accountOptionsHTML group accounts into Cash, Cards, Savings, Business and Crypto optgroups', async () => {
  const { accountDisplayName, accountOptionsHTML } = await import('../js/logviews.js');
  const accounts = [
    { id: 'wallet', name: 'Wallet', kind: 'cash', emoji: '💵', currency: 'MDL' },
    { id: 'c1', name: 'maib card', bank: 'maib', kind: 'card', emoji: '💳', currency: 'MDL' },
    { id: 'b1', name: 'Business', kind: 'business', emoji: '💼', currency: 'EUR' },
    { id: 'b2', name: 'Business', kind: 'business', emoji: '💼', currency: 'MDL' },
    { id: 's1', name: 'Safe', kind: 'savings', savings: true, emoji: '🏦', currency: 'MDL' },
    { id: 's2', name: 'Safe', kind: 'savings', savings: true, emoji: '🏦', currency: 'USD' },
    { id: 'cr1', name: 'Crypto', kind: 'crypto', emoji: '🪙', currency: 'USD' },
  ];

  assert.equal(accountDisplayName(accounts[0]), '💵 Cash (Wallet) · MDL');
  assert.equal(accountDisplayName(accounts[1]), '💳 maib card · MDL');
  assert.equal(accountDisplayName(accounts[2]), '💼 Business · EUR');
  assert.equal(accountDisplayName(accounts[4]), '🏦 Safe · MDL');

  const html = accountOptionsHTML(accounts, 'wallet', { baseCur: 'MDL' });
  assert.ok(html.includes('<optgroup label="💵 Cash">'), 'contains Cash optgroup');
  assert.ok(html.includes('Cards &amp; Banks'), 'contains Cards & Banks optgroup');
  assert.ok(html.includes('<optgroup label="💼 Business">'), 'contains Business optgroup');
  assert.ok(html.includes('Savings &amp; Safe'), 'contains Savings & Safe optgroup');
  assert.ok(html.includes('<optgroup label="🪙 Crypto">'), 'contains Crypto optgroup');

  assert.ok(html.includes('<option value="wallet" selected>💵 Cash (Wallet) · MDL</option>'), 'wallet option formatted as Cash (Wallet) and selected');
  assert.ok(html.includes('value="b1"') && html.includes('Business · EUR'), 'currency distinguishes same-name accounts');
  assert.ok(html.includes('Safe · USD') && html.includes('Safe · MDL'), 'Safe USD and MDL accounts are distinguished');
});

test('AccountsScreen.view renders category filter chips including Cash section', async () => {
  const AccountsScreen = await import('../js/screens/accounts.js');
  const { ctx } = await import('../js/ctx.js');
  const { defaultState } = await import('../js/model.js');
  ctx.state = defaultState();
  ctx.ui = { accFilter: 'all' };
  ctx.bigMoney = (n) => `${n}`;
  ctx.money = (n) => `${n}`;
  ctx.countUp = (n) => `${n}`;

  const html = AccountsScreen.view();
  assert.ok(html.includes('acc-filter-chips'), 'renders filter chips container');
  assert.ok(html.includes('data-kind="cash"'), 'renders cash filter chip');
  assert.ok(html.includes('💵 Cash'), 'renders cash label with emoji');
  assert.ok(html.includes('Cards'), 'renders cards chip');

  // When filtered to cash
  ctx.ui.accFilter = 'cash';
  const cashHtml = AccountsScreen.view();
  assert.ok(cashHtml.includes('aria-pressed="true"') && cashHtml.includes('data-kind="cash"'), 'cash filter chip active');
});
