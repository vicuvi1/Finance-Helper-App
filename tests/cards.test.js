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
