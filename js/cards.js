// Accounts drawn as real bank cards: the bank's name or your own logo, a
// color theme (or your own color), chip for physical cards, the last 4
// digits and the balance. Used on the Accounts screen and in its sheets.

import { esc } from './ctx.js';
import { formatMoney } from './money.js';

export const CARD_THEMES = [
  { id: 'midnight', name: 'Midnight' },
  { id: 'ocean', name: 'Ocean' },
  { id: 'emerald', name: 'Emerald' },
  { id: 'teal', name: 'Teal' },
  { id: 'plum', name: 'Plum' },
  { id: 'rose', name: 'Rose' },
  { id: 'crimson', name: 'Crimson' },
  { id: 'sunset', name: 'Sunset' },
  { id: 'gold', name: 'Gold', light: true },
  { id: 'silver', name: 'Silver', light: true },
  { id: 'graphite', name: 'Graphite' },
  { id: 'forest', name: 'Forest' },
];

// Card designs in the style of the cards Moldovan banks issue (and a few
// others), so an account looks like the card in your wallet. They are drawn
// here from each card's colors and look, not copied from the banks' artwork
// (this code is public). For the exact look: "A picture of my card".
// `dot` is the list color that goes with the design.
export const BANK_CARDS = [
  { id: 'maib-gama-orange', bank: 'maib', product: 'gama', name: 'gama universal, orange', network: 'Mastercard', dot: 2 },
  { id: 'maib-gama-teal', bank: 'maib', product: 'gama', name: 'gama universal, turquoise', network: 'Mastercard', dot: 3 },
  { id: 'maib-gama-pink', bank: 'maib', product: 'gama', name: 'gama universal, pink', network: 'Mastercard', dot: 5 },
  { id: 'maib-gama-navy', bank: 'maib', product: 'gama', name: 'gama universal, navy', network: 'Mastercard', dot: 1 },
  { id: 'maib-gama-premium', bank: 'maib', product: 'gama premium', name: 'gama premium', network: 'Mastercard', dot: 7 },
  { id: 'maib-liber', bank: 'maib', product: 'liber', name: 'maib liber', network: 'Visa', dot: 3 },
  { id: 'maib-business', bank: 'maib', product: 'business', name: 'maib Business', network: 'Visa Business', dot: 1 },
  { id: 'maib-digital', bank: 'maib', product: 'digital', name: 'maib virtual / digital', network: 'Visa', dot: 3 },
  { id: 'maib-classic', bank: 'maib', product: '', name: 'maib debit (classic)', network: 'Visa', dot: 3 },
  { id: 'vb-star', bank: 'Victoriabank', product: 'STAR', name: 'STAR Card', network: 'Visa', dot: 1 },
  { id: 'vb-star-platinum', bank: 'Victoriabank', product: 'STAR Platinum', name: 'STAR Platinum Card', network: 'Visa', dot: 7 },
  { id: 'vb-salut', bank: 'Victoriabank', product: 'salut', name: 'Salut', network: 'Visa', dot: 5 },
  { id: 'vb-payroll', bank: 'Victoriabank', product: 'payroll', name: 'Public sector payroll card', network: 'Visa', dot: 8 },
  { id: 'vb-social', bank: 'Victoriabank', product: 'social', name: 'Social Card', network: 'Visa', dot: 5 },
  { id: 'vb-gold', bank: 'Victoriabank', product: 'gold', name: 'Mastercard Gold', network: 'Mastercard', dot: 4, light: true },
  { id: 'vb-platinum', bank: 'Victoriabank', product: 'platinum', name: 'Mastercard Platinum', network: 'Mastercard', dot: 7, light: true },
  { id: 'vb-lunch', bank: 'Victoriabank', product: 'VB Lunch', name: 'VB Lunch', network: 'Visa', dot: 7 },
  { id: 'vb-business', bank: 'Victoriabank', product: 'business', name: 'Business card', network: 'Visa Business', dot: 1 },
  { id: 'micb', bank: 'MICB', product: '', name: 'MICB card', network: 'Visa', dot: 6 },
  { id: 'otp', bank: 'OTP Bank', product: '', name: 'OTP Bank card', network: 'Mastercard', dot: 6 },
  { id: 'mobias', bank: 'Moldindconbank', product: '', name: 'Moldindconbank card', network: 'Visa', dot: 1 },
  { id: 'revolut', bank: 'Revolut', product: '', name: 'Revolut', network: 'Visa', dot: 7 },
  { id: 'wise', bank: 'Wise', product: '', name: 'Wise', network: 'Visa', dot: 3, light: true },
  { id: 'paynet', bank: 'Paynet', product: '', name: 'Paynet', network: 'Visa', dot: 2 },
];
export const designOf = (a) => (String(a.cardTheme || '').startsWith('card:') ? BANK_CARDS.find((d) => d.id === a.cardTheme.slice(5)) || null : null);
// Designs grouped by bank, the account's own bank first.
export function designGroups(bank) {
  const groups = new Map();
  for (const d of BANK_CARDS) groups.set(d.bank, [...(groups.get(d.bank) || []), d]);
  const b = String(bank || '').toLowerCase();
  return [...groups.entries()].sort(([x], [y]) => (y.toLowerCase() === b) - (x.toLowerCase() === b));
}

const BY_KIND = { cash: 'emerald', card: 'ocean', virtual: 'plum', business: 'graphite', savings: 'gold', crypto: 'midnight', other: 'teal' };
const KIND_LABEL = { cash: 'Cash', card: 'Debit', virtual: 'Virtual', business: 'Business', savings: 'Savings', crypto: 'Crypto', other: 'Account' };

export const themeOf = (a) => CARD_THEMES.find((t) => t.id === a.cardTheme) || CARD_THEMES.find((t) => t.id === BY_KIND[a.kind]) || CARD_THEMES[0];

// A user color becomes a two-stop gradient: darker to the color itself.
function customStyle(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '';
  const n = parseInt(hex.slice(1), 16);
  const dark = [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.round(c * 0.38).toString(16).padStart(2, '0')).join('');
  return `--g1:#${dark};--g2:${hex};`;
}
const isLightHex = (hex) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return false;
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 170;
};

const CHIP = '<svg class="bc-chip" viewBox="0 0 40 30" aria-hidden="true"><rect x="1" y="1" width="38" height="28" rx="5"/><path d="M1 10h12M1 20h12M27 10h12M27 20h12M13 1v28M27 1v28M13 15h14"/></svg>';
const WAVES = '<svg class="bc-nfc" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7a7 7 0 0 1 0 10M12 4.5a11 11 0 0 1 0 15M16 2a15 15 0 0 1 0 20"/></svg>';
const ICON = {
  cash: '<svg class="bc-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/></svg>',
  savings: '<svg class="bc-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="12" cy="12" r="4"/><path d="M12 8v1.5M12 14.5V16M8 12h1.5M14.5 12H16"/></svg>',
  crypto: '<svg class="bc-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 7.5h4a2.2 2.2 0 0 1 0 4.5h-4zm0 4.5h4.6a2.3 2.3 0 0 1 0 4.5H9.5zM9.5 6v12M12 6v1.5M12 16.5V18"/></svg>',
};

// `v` is an accountValues() entry; `money` formats main-currency cents.
export function cardHTML(v, { money, act = 'acc-open', big = false, base = 'MDL', attrs = '' } = {}) {
  const a = v.account;
  const t = themeOf(a);
  const d = designOf(a);
  const photo = /^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(a.cardImage || '') ? a.cardImage : null;
  const custom = a.cardTheme === 'custom' ? a.cardColor : null;
  const light = photo ? false : d ? !!d.light : custom ? isLightHex(custom) : t.light;
  const physical = a.kind === 'card' || a.kind === 'business';
  const holdings = a.kind === 'crypto' && (a.holdings || []).length;
  const shown = holdings ? money(Math.round((v.inBase || 0) / 100) * 100) : formatMoney(v.own, a.currency);
  const sub = (a.currency !== base || holdings) && v.inBase != null && !holdings ? `≈ ${money(Math.round(v.inBase / 100) * 100)}` : holdings ? `${a.holdings.length} coin${a.holdings.length === 1 ? '' : 's'}` : '';
  const bankName = d ? d.bank : a.bank && a.bank !== 'Cash' ? a.bank : a.kind === 'cash' ? 'Cash' : a.name;
  const mark = a.logo
    ? `<img class="bc-logo" src="${esc(a.logo)}" alt="">`
    : `<span class="bc-mono" aria-hidden="true">${esc((bankName || '?').trim()[0]?.toUpperCase() || '?')}</span>`;
  const tag = `${act ? `button type="button" data-act="${act}" data-id="${esc(a.id)}"` : 'div'}${attrs ? ` ${attrs}` : ''}`;
  const look = photo ? 'photo' : d ? `design design-${d.id}` : `theme-${custom ? 'custom' : t.id}`;
  const style = photo ? `background-image:url(&quot;${photo}&quot;)` : d ? '' : customStyle(custom);
  return `<${tag} class="bcard ${look}${light ? ' light' : ''}${big ? ' big' : ''}${a.archived ? ' archived' : ''}" style="${style}" aria-label="${esc(a.name)}: ${esc(shown)}">
    ${d ? '<span class="bc-art" aria-hidden="true"></span>' : ''}
    <span class="bc-shine" aria-hidden="true"></span>
    <span class="bc-top"><span class="bc-bank">${mark}<b>${esc(bankName)}</b>${d?.product ? `<small class="bc-product">${esc(d.product)}</small>` : ''}</span><span class="bc-kind">${d ? `<span class="bc-net">${esc(d.network)}</span>` : esc(a.savings && a.kind !== 'savings' ? 'Savings' : KIND_LABEL[a.kind] || '')}${a.currency !== base ? ` · ${esc(a.currency)}` : ''}</span></span>
    <span class="bc-mid">${physical ? CHIP + WAVES : ICON[a.kind] || ICON[a.savings ? 'savings' : ''] || ''}</span>
    <span class="bc-bal"><b class="${v.own < 0 ? 'neg' : ''}">${shown}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span>
    <span class="bc-bottom"><span class="bc-name">${esc(a.name)}</span><span class="bc-num">${a.last4 ? `•••• ${esc(a.last4)}` : ''}</span></span>
  </${act ? 'button' : 'div'}>`;
}

// Cards lean toward the mouse a little.
export function bindTilt(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.addEventListener('pointermove', (e) => {
    const c = e.target.closest?.('.bcard');
    if (!c || e.pointerType !== 'mouse') return;
    const r = c.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    c.style.setProperty('--ry', `${(x * 10).toFixed(2)}deg`);
    c.style.setProperty('--rx', `${(-y * 8).toFixed(2)}deg`);
    c.style.setProperty('--mx', `${((x + 0.5) * 100).toFixed(1)}%`);
  });
  root.addEventListener('pointerout', (e) => {
    const c = e.target.closest?.('.bcard');
    if (c && !c.contains(e.relatedTarget)) { c.style.removeProperty('--rx'); c.style.removeProperty('--ry'); }
  });
}

// A picture of your card: resized to a light JPEG (about 60 KB) kept in your data.
export function readCardPhoto(file, maxW = 640) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) { reject(new Error('Pick an image file (PNG, JPG).')); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * s));
      c.height = Math.max(1, Math.round(img.height * s));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

// Shrinks a picked image to a small PNG (keeps sync and storage light).
export function readLogo(file, max = 96) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) { reject(new Error('Pick an image file (PNG, JPG, SVG).')); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * s));
      c.height = Math.max(1, Math.round(img.height * s));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}
