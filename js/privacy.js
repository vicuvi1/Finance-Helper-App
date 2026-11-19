// Privacy for money: every amount is hidden when the app opens. Space shows or
// hides them all (here and in Life System's Money page, which share this file).
// One state per window, kept in step with the other windows and the Finance
// frame by a BroadcastChannel. The two settings live in localStorage (same
// origin, so Life and Finance read the same ones; they are not synced).

import { setMoneyHidden } from './money.js';

const KEY_ON = 'finance-helper.privacy.hide-on-open';
const KEY_AFTER = 'finance-helper.privacy.after';
export const AFTER_CHOICES = [1, 5, 15, 0]; // minutes; 0 = only when I close the window
const CHANNEL = 'life-money-privacy';

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export const hideOnOpen = () => read(KEY_ON) !== '0';
export const hideAfter = () => {
  const raw = read(KEY_AFTER);
  const n = Number(raw);
  return raw != null && AFTER_CHOICES.includes(n) ? n : 5;
};

let hidden = hideOnOpen();
const listeners = new Set();
let channel = null;
let timer = 0;
let lastPing = 0;

setMoneyHidden(hidden);

export const isHidden = () => hidden;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function post(msg) { try { channel?.postMessage(msg); } catch { /* closed */ } }

function apply(next, { broadcast = true } = {}) {
  next = !!next;
  if (next === hidden) return false;
  hidden = next;
  setMoneyHidden(hidden);
  armTimer();
  if (broadcast) post({ t: 'state', hidden });
  for (const fn of [...listeners]) { try { fn(hidden); } catch { /* a listener must not break the rest */ } }
  return true;
}

export const setHidden = (on) => apply(on);
export const toggle = () => { apply(!hidden); return hidden; };

// Settings.
export function setHideOnOpen(on) { write(KEY_ON, on ? '1' : '0'); }
export function setHideAfter(min) { write(KEY_AFTER, String(AFTER_CHOICES.includes(Number(min)) ? Number(min) : 5)); armTimer(); }

// Idle re-hide: shown amounts hide again after N minutes with no key, click or move.
export function armTimer() {
  clearTimeout(timer);
  timer = 0;
  const min = hideAfter();
  if (hidden || !min) return;
  timer = setTimeout(() => apply(true), min * 60000);
}

// Any input in any window counts as activity for all of them (each runs a timer).
export function noteActivity({ now = Date.now() } = {}) {
  if (hidden) return;
  armTimer();
  if (now - lastPing > 5000) { lastPing = now; post({ t: 'active' }); }
}

// Window hidden or minimised: hide again (unless "only when I close the window").
export function onVisibility(isHiddenNow) {
  if (isHiddenNow && hideAfter()) apply(true);
}

export const isTyping = (el) => !!el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');

// Space shows or hides. Not while typing (Space types a space there). With a
// button focused it still toggles (Enter presses the button). Returns true when used.
let swallowKeyup = false;
export function onKey(e) {
  if (e.code !== 'Space' && e.key !== ' ') return false;
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return false;
  if (isTyping(e.target)) return false;
  e.preventDefault();
  swallowKeyup = true;
  if (!e.repeat) toggle();
  return true;
}
// A button fires its click on Space's key-up: stop that when we used the key.
export function onKeyUp(e) {
  if (!swallowKeyup || (e.code !== 'Space' && e.key !== ' ')) return false;
  swallowKeyup = false;
  e.preventDefault();
  return true;
}

let started = false;
// Listens for activity, visibility and the other windows. Idempotent.
export function start({ keys = false } = {}) {
  if (started) return;
  started = true;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.t === 'state') apply(!!m.hidden, { broadcast: false });
      else if (m.t === 'active') { if (!hidden) armTimer(); }
      else if (m.t === 'hello') post({ t: 'state', hidden });
    };
    // Finance Helper opened inside Life joins Life's state (its own window does not:
    // a fresh window always starts hidden).
    if (window.parent !== window) post({ t: 'hello' });
  } catch { channel = null; }
  const act = () => noteActivity();
  for (const ev of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart']) window.addEventListener(ev, act, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => onVisibility(document.hidden));
  if (keys) {
    window.addEventListener('keydown', (e) => { onKey(e); });
    window.addEventListener('keyup', (e) => { onKeyUp(e); });
  }
  armTimer();
}

// For tests: forget everything and start again from the saved settings.
export function _reset() {
  clearTimeout(timer);
  timer = 0;
  listeners.clear();
  hidden = hideOnOpen();
  setMoneyHidden(hidden);
  swallowKeyup = false;
}
