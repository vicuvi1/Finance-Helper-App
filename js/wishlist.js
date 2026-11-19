// Wishlist with a wait: things you want, each locked for a few days before
// you can buy it ("Ready on 20 Nov"), then "Still want it?". Removing an
// item you decided against adds its price to "Saved by waiting". Pure; the
// list lives in the settings so it syncs with the rest.
//   settings.wishlist     [{ id, name, price (cents), note, added, createdAt, updatedAt,
//                           removedAt?, boughtAt? }]
//   settings.wishlistDays how long to wait, default 7

import { addDays, daysBetween } from './dates.js';

export const WAIT_DEFAULT = 7;

export function waitDays(state) {
  const n = Number(state.settings?.wishlistDays);
  return Number.isInteger(n) && n >= 0 && n <= 90 ? n : WAIT_DEFAULT;
}

export const items = (state) => (Array.isArray(state.settings?.wishlist) ? state.settings.wishlist : [])
  .filter((x) => x && typeof x.id === 'string' && x.name && Number.isFinite(x.price));

export const readyOn = (item, wait) => addDays(item.added, wait);

export function statusOf(item, today, wait) {
  if (item.removedAt) return 'removed';
  if (item.boughtAt) return 'bought';
  return readyOn(item, wait) > today ? 'locked' : 'ready';
}

export const daysLeft = (item, today, wait) => Math.max(0, daysBetween(today, readyOn(item, wait)));

export function summary(state) {
  const wait = waitDays(state);
  const all = items(state);
  const waiting = all.filter((x) => !x.removedAt && !x.boughtAt);
  const removed = all.filter((x) => x.removedAt);
  return {
    wait,
    waiting: [...waiting].sort((a, b) => readyOn(a, wait).localeCompare(readyOn(b, wait)) || a.createdAt - b.createdAt),
    bought: all.filter((x) => x.boughtAt),
    removed,
    total: waiting.reduce((a, x) => a + x.price, 0),
    saved: removed.reduce((a, x) => a + x.price, 0),
  };
}

const touch = (state, item, now) => { item.updatedAt = now; state.settings.updatedAt = now; return item; };

export function addItem(state, { name, price, note = '' }, today, { now = Date.now(), id = `w-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}` } = {}) {
  const item = { id, name: String(name).trim(), price: Math.round(price), note: String(note || '').trim(), added: today, createdAt: now, updatedAt: now };
  if (!Array.isArray(state.settings.wishlist)) state.settings.wishlist = [];
  state.settings.wishlist.push(item);
  state.settings.updatedAt = now;
  return item;
}

const find = (state, id) => items(state).find((x) => x.id === id);

export function removeItem(state, id, today, now = Date.now()) {
  const it = find(state, id);
  if (!it || it.removedAt || it.boughtAt) return null;
  it.removedAt = today;
  return touch(state, it, now);
}

export function buyItem(state, id, today, now = Date.now()) {
  const it = find(state, id);
  if (!it || it.removedAt || it.boughtAt) return null;
  it.boughtAt = today;
  return touch(state, it, now);
}

export function putBack(state, id, now = Date.now()) {
  const it = find(state, id);
  if (!it) return null;
  delete it.boughtAt;
  delete it.removedAt;
  return touch(state, it, now);
}
