// Quick blocks: the buttons under the Telegram bot's message box
// ("☕ Coffee 20", "🥙 Kebab 70"). One tap logs the record for that day.
// You edit them in Settings → Telegram buttons. The list is one setting
// (settings.tgBlocks): it syncs whole, the newest edit wins. Pure, tested.

import { suggestCategory, sortTx, account } from './model.js';
import { evalAmount } from './money.js';

// A palette to pick from, so a block is easy to spot.
export const EMOJIS = ['☕', '🥙', '🍔', '🍕', '🥗', '🍫', '🥐', '🍺', '🥤', '💧', '🛒', '🍎', '🚌', '🚕', '⛽', '🅿️', '🚇', '💊', '🧴', '🪥', '👕', '🎬', '🎮', '📱', '💡', '🏠', '🎁', '🐶', '🥋', '📚', '💼', '💰', '💵', '❤️', '⭐', '🔥'];

// Starters until you make your own (fixed ids, so two devices agree).
const STARTERS = [
  ['coffee', '☕', 'Coffee', 20, 'food'],
  ['kebab', '🥙', 'Kebab', 70, 'food'],
  ['lunch', '🍔', 'Lunch', 100, 'food'],
  ['snack', '🍫', 'Snack', 15, 'food'],
  ['water', '💧', 'Water', 10, 'food'],
  ['groceries', '🛒', 'Groceries', 200, 'food'],
  ['bus', '🚌', 'Bus', 6, 'transport'],
  ['taxi', '🚕', 'Taxi', 50, 'transport'],
  ['fuel', '⛽', 'Fuel', 300, 'transport'],
];

export function starterBlocks(state) {
  const has = (id) => state.settings.categories.some((c) => c.id === id && c.type === 'expense');
  return STARTERS.map(([id, emoji, name, lei, cat]) => ({
    id: `b-${id}`, emoji, name, amount: lei * 100, type: 'expense', category: has(cat) ? cat : 'other', account: null, updatedAt: 0,
  }));
}

// Your blocks in their order.
export const blocks = (state) => (Array.isArray(state.settings.tgBlocks) ? state.settings.tgBlocks : starterBlocks(state));

const plain = (cents) => String(cents / 100).replace('.', ',');
export const blockLabel = (b) => `${b.emoji ? `${b.emoji} ` : ''}${b.type === 'income' ? '+' : ''}${b.name} ${plain(b.amount)}`;

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();

// The block a message is: its button text, or just its name ("coffee").
export function matchBlock(state, text) {
  const t = fold(text);
  if (!t) return null;
  const list = blocks(state);
  return list.find((b) => fold(blockLabel(b)) === t) || list.find((b) => fold(b.name) === t) || null;
}

// The record a block makes. No fixed account: the one you used last for it.
export function blockFields(state, b) {
  const usable = (id) => id && account(state, id) && !account(state, id).archived;
  let acc = usable(b.account) ? b.account : null;
  if (!acc) {
    const recent = sortTx(state.tx).filter((x) => x.type !== 'transfer');
    acc = recent.find((x) => fold(x.note) === fold(b.name) && usable(x.account))?.account
      || recent.find((x) => usable(x.account))?.account
      || state.settings.accounts.find((a) => !a.archived)?.id;
  }
  return { type: b.type, amount: b.amount, note: b.name, account: acc, category: b.category };
}

// "/addblock 🍕 Pizza 120" or "🍕 pizza 120" -> a new block (or null).
export function blockFromText(state, text, now = Date.now()) {
  let t = String(text || '').replace(/^\/(addblock|block|add)(@\w+)?\s*/i, '').trim();
  const emoji = (t.match(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}]+/u) || [''])[0];
  t = t.slice(emoji.length).trim();
  let type = 'expense';
  if (t.startsWith('+')) { type = 'income'; t = t.slice(1).trim(); }
  const m = t.match(/(\d[\d.,]*)\s*(lei|mdl)?\s*$/i);
  if (!m) return null;
  const amount = evalAmount(m[1]);
  const name = t.slice(0, m.index).trim();
  if (!amount || amount <= 0 || !name) return null;
  const category = suggestCategory(state, name, type) || (type === 'income' ? 'other-in' : 'other');
  return { id: `b-${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, emoji, name: name[0].toUpperCase() + name.slice(1), amount, type, category, account: null, updatedAt: now };
}

// Writes the list (the first edit turns the starters into your own list).
export function setBlocks(state, list, now = Date.now()) {
  state.settings.tgBlocks = list;
  state.settings.updatedAt = now;
  return list;
}

export function upsertBlock(state, b, now = Date.now()) {
  const list = [...blocks(state)];
  const i = list.findIndex((x) => x.id === b.id);
  const next = { ...b, updatedAt: now };
  if (i >= 0) list[i] = next; else list.push(next);
  return setBlocks(state, list, now);
}

export function removeBlock(state, id, now = Date.now()) {
  return setBlocks(state, blocks(state).filter((b) => b.id !== id), now);
}

export function moveBlock(state, id, dir, now = Date.now()) {
  const list = [...blocks(state)];
  const i = list.findIndex((b) => b.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  return setBlocks(state, list, now);
}

// Telegram reply keyboard: blocks three per row, then the helpers.
export const HELPER_ROWS = [['📊 Today', '📅 Month', '💰 Balance'], ['🧾 Last', '↩️ Undo', '❓ Help']];

export function blockKeyboard(state, perRow = 3) {
  const list = blocks(state).filter((b) => b.amount > 0 && b.name);
  const rows = [];
  for (let i = 0; i < list.length; i += perRow) rows.push(list.slice(i, i + perRow).map((b) => ({ text: blockLabel(b) })));
  for (const r of HELPER_ROWS) rows.push(r.map((text) => ({ text })));
  return { keyboard: rows, resize_keyboard: true, is_persistent: true, input_field_placeholder: 'Tap a block or type e.g. coffee 35' };
}
