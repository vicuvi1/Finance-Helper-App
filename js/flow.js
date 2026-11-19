// How Finance Helper feels: short fades between screens, numbers that count
// to a new value, rows that ease in or out when a record is added or removed,
// a soft highlight on a saved row, and a gentle shake on a wrong field.
//
// Rules (docs/areas/rewards-money.md, "Finance motion"):
// - all of it is off with the system's "reduce motion", with Life System's
//   Calm mode (inside Life), and with localStorage finance-helper.motion = 'off'
//   (the smoke run uses that, so animations never slow a step down);
// - only transform and opacity move (the motion budget test), 150-220 ms;
// - nothing changes the layout, and nothing plays on an ordinary re-render
//   (only when a screen opens, or a record really is added, removed or saved);
// - a number never shows digits while amounts are hidden, not even for a frame.
//
// The helpers are pure where they can be (tests: web/financeFlow.test.ts).

export const PREF_KEY = 'finance-helper.motion';

// Off when the system asks for less motion or the device switch says off.
// Life's Calm mode does NOT turn Money's motion off (owner's choice).
export function motionOff({ reduced = false, calm = false, pref = '' } = {}) {
  return !!(reduced || calm || pref === 'off');
}

const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };

export function flowOff(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return true;
  return motionOff({
    reduced: safe(() => win.matchMedia('(prefers-reduced-motion: reduce)').matches, false),
    pref: safe(() => win.localStorage.getItem(PREF_KEY) || '', ''),
  });
}

// ---------- Numbers that count ----------

const ease = (t) => 1 - (1 - t) ** 3;
export const COUNT_MS = 520;

// The number shown at time t (0..1) between from and to. Whole units while
// counting unless the real value has bani, so digits do not flicker.
export function countValue(from, to, t) {
  if (t >= 1) return to;
  const v = from + (to - from) * ease(Math.max(0, t));
  return to % 100 ? Math.round(v) : Math.round(v / 100) * 100;
}

// Rolls `el` from `from` to `to`. `fmt(value)` makes the text (money's
// formatter, which shows dots while amounts are hidden). While hidden the
// element jumps straight to its final text: no in-between value is ever
// formatted, so no digit can show. Returns 'hidden' | 'off' | 'same' | 'run'.
export function countTo(el, { from, to, fmt, hidden = () => false, off = () => false, now = () => performance.now(), raf = (f) => requestAnimationFrame(f), dur = COUNT_MS }) {
  if (hidden()) { el.textContent = fmt(to); return 'hidden'; }
  if (from === to) return 'same';
  if (off()) { el.textContent = fmt(to); return 'off'; }
  const start = now();
  const step = () => {
    if (el.isConnected === false) return;
    // Hidden mid-count (Space pressed): finish at once, masked.
    if (hidden()) { el.textContent = fmt(to); return; }
    const t = Math.min(1, (now() - start) / dur);
    el.textContent = fmt(countValue(from, to, t));
    if (t < 1) raf(step);
  };
  el.textContent = fmt(from);
  raf(step);
  return 'run';
}

// ---------- Rows that ease in and out ----------

// What changed between two renders of the same list: ids and a small
// signature of what the row shows.
export function diffRows(prev, next, { max = 6 } = {}) {
  const added = [];
  const changed = [];
  const removed = [];
  for (const [id, sig] of next) {
    if (!prev.has(id)) added.push(id);
    else if (prev.get(id) !== sig) changed.push(id);
  }
  for (const id of prev.keys()) if (!next.has(id)) removed.push(id);
  // A bulk change (import, a month switch, a sync) is not animated row by row.
  if (added.length + removed.length > max) return { added: [], changed: [], removed: [], bulk: true };
  return { added, changed, removed, bulk: false };
}

// Record rows: list rows and Table rows (Home, Log list and Table, accounts, search).
const ROWS = '.tx[data-id], tr[data-id]';
const rowsOf = (root) => {
  const m = new Map();
  root.querySelectorAll(ROWS).forEach((el) => m.set(el.dataset.id, (el.textContent || '').replace(/\s+/g, ' ').trim()));
  return m;
};

let lastKey = null;
let lastRows = new Map();
let lastEls = new Map(); // id -> { el, left, top, width, height } (page coordinates), first rows only
let lastScreen = null;
const GHOSTS = 80;

// Call right after a screen is drawn. `key` names what the list shows (the
// screen, month, filter and search), so only a real add / remove / edit
// inside the same list animates. `enter` is true when a screen just opened
// (the stagger and chart grow-in already play then).
export function afterRender(app, key, { enter = false, off = flowOff() } = {}) {
  if (!app) return;
  const next = rowsOf(app);
  const els = new Map();
  app.querySelectorAll(ROWS).forEach((el) => els.set(el.dataset.id, el));
  const same = !enter && key === lastKey;
  const prevRows = lastRows;
  const prevEls = lastEls;
  lastKey = key;
  lastRows = next;
  lastEls = new Map();
  if (off) return;
  // Where the first rows are, so a removed one can fade out in place.
  let n = 0;
  for (const [id, el] of els) {
    if (n++ >= GHOSTS) break;
    const r = el.getBoundingClientRect();
    lastEls.set(id, { el, left: r.left + scrollX, top: r.top + scrollY, width: r.width, height: r.height });
  }
  if (!same) return;
  const d = diffRows(prevRows, next);
  if (d.bulk) return;
  for (const id of d.added) els.get(id)?.classList.add('row-in');
  for (const id of d.changed) els.get(id)?.classList.add('row-saved');
  for (const id of d.removed) ghost(prevEls.get(id));
  setTimeout(() => { for (const el of els.values()) el.classList.remove('row-in', 'row-saved'); }, 1100);
}

// A removed row fades out where it was, as a copy that does not take space
// (so nothing below it jumps).
function ghost(rec) {
  if (!rec?.width || !rec.height || rec.el.tagName === 'TR') return; // a table row cannot stand alone
  const g = rec.el.cloneNode(true);
  g.classList.remove('row-in', 'row-saved', 'flash');
  g.classList.add('row-ghost');
  g.setAttribute('aria-hidden', 'true');
  g.removeAttribute('data-act');
  g.removeAttribute('data-id');
  g.tabIndex = -1;
  Object.assign(g.style, { position: 'fixed', left: `${rec.left - scrollX}px`, top: `${rec.top - scrollY}px`, width: `${rec.width}px`, height: `${rec.height}px`, margin: '0', pointerEvents: 'none', zIndex: '5' });
  document.body.appendChild(g);
  g.addEventListener('animationend', () => g.remove());
  setTimeout(() => g.remove(), 600);
}

// ---------- Screen changes inside one tab ----------

// A short fade-and-slide when a sub-screen replaces another (Settings
// sections, Log views, Report tabs). A new tab already cross-fades.
export function afterScreen(app, key, { enter = false, off = flowOff() } = {}) {
  const was = lastScreen;
  lastScreen = key;
  if (!app || enter || off || was == null || was === key) return false;
  app.classList.remove('flow-in');
  void app.offsetWidth; // restart the animation
  app.classList.add('flow-in');
  setTimeout(() => app.classList.remove('flow-in'), 260);
  return true;
}

// ---------- A wrong field ----------

// Shakes the field once and says what is wrong right under it. The message
// goes away when the person types again. Returns the message element.
export function invalidField(input, message, { off = flowOff() } = {}) {
  if (!input) return null;
  clearInvalid(input);
  input.classList.add('fld-bad');
  input.setAttribute('aria-invalid', 'true');
  const msg = document.createElement('small');
  msg.className = 'fld-msg';
  msg.setAttribute('role', 'alert');
  msg.textContent = message;
  input.insertAdjacentElement('afterend', msg);
  input.dataset.msgId = '1';
  if (!off) {
    input.classList.remove('fld-shake');
    void input.offsetWidth;
    input.classList.add('fld-shake');
    setTimeout(() => input.classList.remove('fld-shake'), 360);
  }
  try { input.focus({ preventScroll: false }); } catch { /* not focusable */ }
  return msg;
}

// Only the shake (a field that already says what is wrong another way).
export function shake(el, { off = flowOff() } = {}) {
  if (!el || off) return;
  el.classList.remove('fld-shake');
  void el.offsetWidth;
  el.classList.add('fld-shake');
  setTimeout(() => el.classList.remove('fld-shake'), 360);
}

export function clearInvalid(input) {
  if (!input) return;
  input.classList.remove('fld-bad', 'fld-shake');
  input.removeAttribute('aria-invalid');
  if (input.dataset.msgId) {
    const n = input.nextElementSibling;
    if (n?.classList?.contains('fld-msg')) n.remove();
    delete input.dataset.msgId;
  }
}

// The switch in Settings -> General (per device, like the tips).
export function settingsRow(win = window) {
  const on = !safe(() => win.localStorage.getItem(PREF_KEY) === 'off', false);
  return `<label class="motion-setting"><span><b>Animations in Money</b><small>Fades, counting numbers and rows easing in. Off automatically if your system asks for reduced motion.</small></span><input type="checkbox" data-anim-toggle ${on ? 'checked' : ''} aria-label="Animations in Money"></label>`;
}

// ---------- Start ----------

let started = false;
export function initFlow(win = window) {
  if (started) return;
  started = true;
  const doc = win.document;
  const apply = () => { doc.documentElement.toggleAttribute('data-flow-off', flowOff(win)); };
  apply();
  safe(() => win.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', apply));
  doc.addEventListener('change', (e) => {
    const t = e.target?.closest?.('[data-anim-toggle]');
    if (!t) return;
    safe(() => win.localStorage.setItem(PREF_KEY, t.checked ? 'on' : 'off'));
    apply();
  });
  win.addEventListener('storage', apply);
  // Typing in a wrong field clears its message.
  doc.addEventListener('input', (e) => { if (e.target?.classList?.contains('fld-bad')) clearInvalid(e.target); }, true);
}

export const _reset = () => { lastKey = null; lastRows = new Map(); lastEls = new Map(); lastScreen = null; started = false; };
