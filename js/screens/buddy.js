// The buddy: a little robot that floats in the corner, now and then flies
// a loop, and reacts to what you log (js/buddy.js decides what it says).
// Settings (device only, state.meta.buddy): show it, its name, its color,
// and "only the important things".

import { ctx, esc } from '../ctx.js';
import { reactToTx, greeting } from '../buddy.js';
import { todayISO } from '../dates.js';

export const COLORS = [
  { id: 'gold', name: 'Gold', a: '#f3d27a', b: '#c9962f' },
  { id: 'sky', name: 'Sky', a: '#8fd0ff', b: '#3b82d6' },
  { id: 'mint', name: 'Mint', a: '#8ff0c8', b: '#22a776' },
  { id: 'pink', name: 'Pink', a: '#ffb3d1', b: '#d4578e' },
  { id: 'violet', name: 'Violet', a: '#c9b5ff', b: '#7a4fd6' },
  { id: 'silver', name: 'Silver', a: '#f1f4f8', b: '#9aa3b2' },
];
const IMPORTANT = new Set(['worried', 'surprised', 'excited', 'proud']);

const prefs = () => ({ on: true, name: 'Bit', color: 'gold', quiet: false, ...(ctx.state.meta.buddy || {}) });
let el = null;
let hideTimer = null;
let flyTimer = null;
let greeted = false;
let lastTx = null;

const ROBOT = `<svg class="bd-svg" viewBox="0 0 120 150" aria-hidden="true">
  <defs>
    <linearGradient id="bd-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--bd-a)"/><stop offset="1" stop-color="var(--bd-b)"/></linearGradient>
    <radialGradient id="bd-flame" cx="0.5" cy="0" r="1"><stop offset="0" stop-color="#fff6c2"/><stop offset="0.45" stop-color="#ffb347"/><stop offset="1" stop-color="#ff5e3a" stop-opacity="0"/></radialGradient>
  </defs>
  <ellipse class="bd-shadow" cx="60" cy="146" rx="22" ry="3.5"/>
  <g class="bd-flame"><path d="M50 116 Q60 146 70 116 Z" fill="url(#bd-flame)"/></g>
  <rect x="49" y="108" width="22" height="9" rx="3" class="bd-nozzle"/>
  <g class="bd-arm bd-arm-l"><path d="M41 90 Q28 92 26 102" class="bd-limb"/><circle cx="26" cy="103" r="4.5" fill="url(#bd-g)"/></g>
  <g class="bd-arm bd-arm-r"><path d="M79 90 Q92 92 94 102" class="bd-limb"/><circle cx="94" cy="103" r="4.5" fill="url(#bd-g)"/></g>
  <rect x="39" y="80" width="42" height="31" rx="13" fill="url(#bd-g)"/>
  <circle cx="60" cy="95.5" r="8" class="bd-coin"/><text x="60" y="99.5" text-anchor="middle" class="bd-coin-t">L</text>
  <line x1="60" y1="22" x2="60" y2="9" class="bd-limb"/><circle cx="60" cy="7" r="4.5" class="bd-tip"/>
  <circle cx="20" cy="50" r="6" fill="url(#bd-g)"/><circle cx="100" cy="50" r="6" fill="url(#bd-g)"/>
  <rect x="20" y="20" width="80" height="60" rx="26" fill="url(#bd-g)"/>
  <rect x="29" y="31" width="62" height="39" rx="17" class="bd-visor"/>
  <g class="bd-face bd-f-happy bd-f-proud bd-f-excited"><path d="M41 52 q6 -8 12 0" class="bd-eye-l"/><path d="M67 52 q6 -8 12 0" class="bd-eye-l"/><path d="M52 60 q8 6 16 0" class="bd-mouth"/></g>
  <g class="bd-face bd-f-idle bd-f-thinking"><g class="bd-blink"><rect x="42" y="44" width="10" height="13" rx="5" class="bd-eye"/><rect x="68" y="44" width="10" height="13" rx="5" class="bd-eye"/></g><path d="M54 62 q6 3 12 0" class="bd-mouth"/></g>
  <g class="bd-face bd-f-worried"><path d="M41 44 l11 4 M79 44 l-11 4" class="bd-mouth"/><rect x="43" y="50" width="9" height="10" rx="4.5" class="bd-eye"/><rect x="68" y="50" width="9" height="10" rx="4.5" class="bd-eye"/><path d="M53 65 q7 -5 14 0" class="bd-mouth"/></g>
  <g class="bd-face bd-f-surprised"><circle cx="47" cy="50" r="6.5" class="bd-eye"/><circle cx="73" cy="50" r="6.5" class="bd-eye"/><ellipse cx="60" cy="63" rx="4" ry="4.5" class="bd-eye"/></g>
  <g class="bd-face bd-f-sleepy"><path d="M41 52 h11 M68 52 h11" class="bd-eye-l"/><path d="M56 62 h8" class="bd-mouth"/></g>
  <g class="bd-cheeks"><ellipse cx="38" cy="61" rx="4" ry="2.4"/><ellipse cx="82" cy="61" rx="4" ry="2.4"/></g>
</svg>`;

function setColor(p) {
  const c = COLORS.find((x) => x.id === p.color) || COLORS[0];
  el.style.setProperty('--bd-a', c.a);
  el.style.setProperty('--bd-b', c.b);
}

export function say({ mood = 'happy', text }, { force = false } = {}) {
  const p = prefs();
  if (!el || !p.on || ctx.state._sealed) return;
  if (p.quiet && !force && !IMPORTANT.has(mood)) return;
  el.dataset.mood = mood;
  el.classList.remove('react');
  void el.offsetWidth;
  el.classList.add('react');
  const bubble = el.querySelector('.bd-bubble');
  bubble.innerHTML = `<b>${esc(p.name)}</b>${esc(text)}`;
  el.classList.add('talking');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    el.classList.remove('talking');
    el.dataset.mood = 'idle';
  }, Math.min(9000, 3500 + text.length * 45));
}

// Called after each render: a record created just now gets a reaction.
export function onTx(t) {
  if (!t || t.id === lastTx || Date.now() - (t.createdAt || 0) > 15000) return;
  lastTx = t.id;
  say(reactToTx(ctx.state, t, todayISO()));
}

function scheduleFlight() {
  clearTimeout(flyTimer);
  flyTimer = setTimeout(() => {
    if (el && prefs().on && !el.classList.contains('talking') && !document.querySelector('.sheet') && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('flying');
      setTimeout(() => el?.classList.remove('flying'), 6200);
    }
    scheduleFlight();
  }, 45000 + Math.random() * 60000);
}

export function apply() {
  const p = prefs();
  if (!el) return;
  el.hidden = !p.on;
  el.setAttribute('aria-label', `${p.name}, your money buddy`);
  setColor(p);
}

export function initBuddy() {
  el = document.createElement('div');
  el.id = 'buddy';
  el.className = 'buddy';
  el.dataset.mood = 'idle';
  el.innerHTML = `<div class="bd-bubble" role="status" aria-live="polite"></div><button type="button" class="bd-body" title="Say hi">${ROBOT}</button>`;
  document.body.appendChild(el);
  apply();
  el.querySelector('.bd-body').addEventListener('click', () => {
    if (el.classList.contains('talking')) { el.classList.remove('talking'); return; }
    say(greeting(ctx.state, todayISO(), new Date().getHours()), { force: true });
  });
  scheduleFlight();
  setTimeout(() => {
    if (greeted) return;
    greeted = true;
    say(greeting(ctx.state, todayISO(), new Date().getHours()));
  }, 2200);
}

// ---------- Settings ----------

export function settingsCard() {
  const p = prefs();
  return `<section class="card" id="buddy-card"><h2>Buddy</h2>
    <p class="muted small" style="margin-top:0">${esc(p.name)} floats in the corner and reacts when you log: cheers you on, warns when you overspend. Click it any time for how your month is going.</p>
    <label class="field check"><input type="checkbox" data-bd="on" ${p.on ? 'checked' : ''}><span>Show ${esc(p.name)}</span></label>
    ${p.on ? `<label class="field"><span>Name</span><input type="text" data-bd="name" value="${esc(p.name)}" maxlength="16"></label>
    <div class="field"><span class="lbl">Color</span><div class="theme-picks">${COLORS.map((c) => `<button type="button" class="theme-pick" data-act="bd-color" data-color="${c.id}" aria-label="${c.name}" aria-pressed="${p.color === c.id}" style="--g1:${c.b};--g2:${c.a}"></button>`).join('')}</div></div>
    <label class="field check"><input type="checkbox" data-bd="quiet" ${p.quiet ? 'checked' : ''}><span>Only speak up about important things (overspending, big expenses, income, streaks)</span></label>` : ''}
  </section>`;
}

const refresh = () => { const c = document.getElementById('buddy-card'); if (c) c.outerHTML = settingsCard(); };
const save = (patch) => {
  ctx.state.meta.buddy = { ...prefs(), ...patch };
  ctx.persist();
  apply();
  refresh();
};

export function onClick(act, btn) {
  if (act !== 'bd-color') return false;
  save({ color: btn.dataset.color });
  say({ mood: 'excited', text: 'New look! How do I look? ✨' }, { force: true });
  return true;
}

export function onChange(input) {
  if (!input.dataset.bd) return false;
  const k = input.dataset.bd;
  save({ [k]: input.type === 'checkbox' ? input.checked : input.value.trim() || 'Bit' });
  if (k === 'on' && input.checked) say({ mood: 'excited', text: 'I\'m back! 👋' }, { force: true });
  return true;
}
