// Small motion touches that make the app feel alive, all switched off for
// people who ask their system for less motion:
// - screens cross-fade (View Transitions, where the browser has them)
// - segmented switches slide their highlight to the chosen option
// - cards get a soft light that follows the mouse (desktop)
// - a "+1 200" / "−35" floats up from the balance when it changes

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const canHover = () => window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

// Runs `update` as a cross-fade from the old screen to the new one.
export function crossFade(update) {
  if (reduced() || typeof document.startViewTransition !== 'function') { update(); return; }
  try { document.startViewTransition(update); } catch { update(); }
}

// Each switch remembers where its highlight was, so after a redraw it
// slides from there instead of jumping.
const seen = new Map();
const keyOf = (seg, i) => seg.getAttribute('aria-label') || seg.className + i;

export function slideSegs(root = document) {
  root.querySelectorAll('.seg').forEach((seg, i) => {
    const on = seg.querySelector('button[aria-pressed="true"]');
    if (!on) { seg.classList.remove('has-thumb'); return; }
    // has-thumb makes the switch the offset parent, so offsets are measured
    // from it (and, unlike screen rects, ignore the sheet's pop-in scale).
    seg.classList.add('has-thumb');
    const to = { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight };
    if (!to.w) return; // not laid out (hidden)
    const key = keyOf(seg, i);
    const from = seen.get(key);
    seen.set(key, to);
    const set = (p) => {
      seg.style.setProperty('--tx', `${p.x}px`);
      seg.style.setProperty('--ty', `${p.y}px`);
      seg.style.setProperty('--tw', `${p.w}px`);
      seg.style.setProperty('--th', `${p.h}px`);
    };
    if (from && !reduced() && (from.x !== to.x || from.w !== to.w)) {
      seg.classList.add('has-thumb', 'no-anim');
      set(from);
      requestAnimationFrame(() => { seg.classList.remove('no-anim'); requestAnimationFrame(() => set(to)); });
    } else {
      set(to);
      seg.classList.add('has-thumb');
    }
  });
}

// A switch inside a sheet changes without a full redraw: slide it on click.
function onSegClick(e) {
  const b = e.target.closest('.seg button');
  if (!b) return;
  // Let the page's own handler update aria-pressed first.
  setTimeout(() => slideSegs(b.closest('.sheet') || document), 0);
}

// The light under the mouse, as two CSS variables on the card.
let lit = null;
function onMove(e) {
  const card = e.target.closest?.('.card');
  if (card !== lit) { lit?.classList.remove('lit'); lit = card; card?.classList.add('lit'); }
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty('--mx', `${e.clientX - r.left}px`);
  card.style.setProperty('--my', `${e.clientY - r.top}px`);
}

// "+1 200" rising from an element, e.g. the sidebar balance.
export function floatDelta(host, text, kind) {
  if (!host || reduced()) return;
  const el = document.createElement('span');
  el.className = `delta-float ${kind}`;
  el.textContent = text;
  el.setAttribute('aria-hidden', 'true');
  host.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
  setTimeout(() => el.remove(), 2000);
}

export function initMotion() {
  document.addEventListener('click', onSegClick, true);
  if (canHover() && !reduced()) {
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', () => { lit?.classList.remove('lit'); lit = null; });
  }
  // Fonts and the window size change where the highlights sit.
  window.addEventListener('resize', () => { seen.clear(); slideSegs(); });
  document.fonts?.ready.then(() => { seen.clear(); slideSegs(); });
}
