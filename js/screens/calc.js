// The floating calculator: a small panel above every screen. Open it with
// the 🧮 button or the "=" key, drag it by its top, type or tap. It shows the
// result live (and in USD / MDL at today's rate), keeps a short tape, and
// "Use as record" puts the result into the amount of a new record (or the
// one you are filling in). The math is in js/calc.js.
//
// Where it sits, whether it's open and the tape are this device's own
// convenience (localStorage), never part of your data or sync.

import { ctx, esc } from '../ctx.js';
import { calc, formatCalc, plainAmount } from '../calc.js';
import { sound } from '../audio.js';

const KEY = 'finance-helper.calc';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* private window */ } };
const st = { open: false, x: null, y: null, tape: [], ...load() };

let panel = null;
let fab = null;
const $ = (s) => panel.querySelector(s);
const phone = () => window.matchMedia('(max-width: 719px)').matches;

const KEYS = [
  ['C', 'clear'], ['⌫', 'back'], ['%', '%'], ['÷', '÷'],
  ['7', '7'], ['8', '8'], ['9', '9'], ['×', '×'],
  ['4', '4'], ['5', '5'], ['6', '6'], ['−', '−'],
  ['1', '1'], ['2', '2'], ['3', '3'], ['+', '+'],
  ['( )', 'paren'], ['0', '0'], [',', ','], ['=', 'equals'],
];

function build() {
  fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'calc-fab';
  fab.title = 'Calculator (=)';
  fab.setAttribute('aria-label', 'Open the calculator');
  fab.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2.5" width="14" height="19" rx="3"/><path d="M8.5 7h7M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15h.01M12 15h.01M15.5 15h.01M8.5 18.5h.01M12 18.5h3.5"/></svg>';
  fab.addEventListener('click', () => toggle(true));

  panel = document.createElement('section');
  panel.className = 'calc';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Calculator');
  panel.hidden = true;
  panel.innerHTML = `<header class="calc-head" title="Drag to move"><b>Calculator</b><span class="calc-hint">= to open · Enter to finish</span><button type="button" class="icon-btn" data-c="close" aria-label="Close the calculator">✕</button></header>
    <input id="fc-in" class="calc-in" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="120+45" aria-label="Sum">
    <div class="calc-out"><b id="fc-out" aria-live="polite">0</b><small id="fc-fx"></small></div>
    <div class="calc-keys">${KEYS.map(([l, k]) => `<button type="button" data-k="${k}" class="${/^[÷×−+]$/.test(k) ? 'op' : k === 'equals' ? 'eq' : k === 'clear' || k === 'back' ? 'fn' : ''}">${l}</button>`).join('')}</div>
    <div class="calc-acts"><button type="button" class="btn" data-c="copy">Copy</button><button type="button" class="btn primary" data-c="use">Use as record</button></div>
    <div class="calc-tape" id="fc-tape"></div>`;
  document.body.append(fab, panel);
  // Desktop: a button next to the app's name in the sidebar, always in view.
  const brand = document.querySelector('.tabbar .brand');
  if (brand) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'brand-calc';
    b.title = 'Calculator (=)';
    b.setAttribute('aria-label', 'Calculator');
    b.innerHTML = fab.innerHTML;
    b.addEventListener('click', () => toggle());
    brand.append(b);
  }

  const input = $('#fc-in');
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); equals(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); toggle(false); }
  });
  panel.addEventListener('click', onClick);
  dragFrom($('.calc-head'));
}

const value = () => calc($('#fc-in').value);

function update() {
  const v = value();
  $('#fc-out').textContent = v == null ? ($('#fc-in').value.trim() ? '…' : '0') : formatCalc(v);
  // The same number read as MDL and as USD, at today's rate.
  const base = ctx.state?.settings?.currency || 'MDL';
  const rate = ctx.suggestedRate?.('USD');
  $('#fc-fx').textContent = v != null && v !== 0 && rate && base !== 'USD'
    ? `≈ ${formatCalc(v / rate, 2)} USD · ${formatCalc(v)} USD ≈ ${formatCalc(v * rate, 2)} ${base}` : '';
}

// Typing at the caret, like a real field.
function insert(text) {
  const input = $('#fc-in');
  const a = input.selectionStart ?? input.value.length;
  const b = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, a) + text + input.value.slice(b);
  input.setSelectionRange(a + text.length, a + text.length);
  update();
}

function equals() {
  const input = $('#fc-in');
  const v = value();
  if (v == null) { panel.classList.remove('shake'); void panel.offsetWidth; panel.classList.add('shake'); return; }
  const expr = input.value.trim();
  if (expr && expr !== plainAmount(v)) {
    st.tape = [{ expr, v }, ...st.tape.filter((x) => x.expr !== expr)].slice(0, 8);
    save();
    renderTape();
  }
  input.value = String(v).replace('.', ',');
  update();
  const out = $('#fc-out');
  out.classList.remove('pop');
  void out.offsetWidth;
  out.classList.add('pop');
}

function renderTape() {
  $('#fc-tape').innerHTML = st.tape.map((x, i) => `<button type="button" data-t="${i}" title="Use again"><span>${esc(x.expr)}</span><b>= ${esc(formatCalc(x.v))}</b></button>`).join('');
  // A longer tape makes the panel taller: keep it inside the window.
  if (st.open && st.x != null) place(st.x, st.y);
}

function onClick(e) {
  const k = e.target.closest('[data-k]')?.dataset.k;
  const input = $('#fc-in');
  if (k) {
    sound.click(ctx.state);
    if (k === 'clear') { input.value = ''; update(); }
    else if (k === 'back') {
      const a = input.selectionStart ?? input.value.length;
      const b = input.selectionEnd ?? a;
      const from = a === b ? Math.max(0, a - 1) : a;
      input.value = input.value.slice(0, from) + input.value.slice(b);
      input.setSelectionRange(from, from);
      update();
    } else if (k === 'equals') equals();
    else if (k === 'paren') {
      // "(" when a bracket can open here, ")" when one is open.
      const open = (input.value.match(/\(/g) || []).length - (input.value.match(/\)/g) || []).length;
      insert(open > 0 && /[\d)%]\s*$/.test(input.value.slice(0, input.selectionStart ?? input.value.length)) ? ')' : '(');
    } else insert(k);
    if (!phone()) input.focus();
    return;
  }
  const t = e.target.closest('[data-t]');
  if (t) { const x = st.tape[Number(t.dataset.t)]; if (x) { input.value = x.expr; update(); input.focus(); } return; }
  const c = e.target.closest('[data-c]')?.dataset.c;
  if (c === 'close') toggle(false);
  else if (c === 'copy') {
    const v = value();
    if (v == null) return;
    navigator.clipboard?.writeText(plainAmount(v)).then(() => ctx.toast(`Copied ${formatCalc(v)}`), () => ctx.toast('Could not copy'));
  } else if (c === 'use') use();
}

// Into the record being filled in, or a new record with this amount.
function use() {
  const v = value();
  if (v == null || v <= 0) { ctx.toast('Work out an amount bigger than 0 first'); return; }
  const amount = plainAmount(Math.abs(v));
  const field = document.querySelector('#tx-amount');
  if (field) {
    field.value = amount;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus();
    ctx.toast(`Amount set to ${formatCalc(v)}`);
  } else ctx.openTxSheet(null, { amountText: amount });
  if (phone()) toggle(false);
}

// Drag by the top bar; stays inside the window.
function dragFrom(handle) {
  handle.addEventListener('pointerdown', (e) => {
    if (phone() || e.target.closest('button')) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    panel.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => place(ev.clientX - dx, ev.clientY - dy);
    const up = () => {
      panel.classList.remove('dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      save();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

function place(x, y) {
  if (phone()) { panel.style.left = ''; panel.style.top = ''; return; }
  const w = panel.offsetWidth || 300;
  const h = panel.offsetHeight || 460;
  st.x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
  st.y = Math.max(8, Math.min(window.innerHeight - h - 8, y));
  panel.style.left = `${st.x}px`;
  panel.style.top = `${st.y}px`;
}

export function toggle(open = !st.open) {
  if (!panel) return;
  st.open = open;
  save();
  panel.hidden = !open;
  fab.hidden = open;
  if (open) {
    if (st.x == null) place(window.innerWidth - (panel.offsetWidth || 300) - 140, window.innerHeight - (panel.offsetHeight || 460) - 40);
    else place(st.x, st.y);
    panel.classList.remove('in');
    void panel.offsetWidth;
    panel.classList.add('in');
    update();
    if (!phone()) $('#fc-in').focus();
  } else fab.focus({ preventScroll: true });
}

export function initCalc() {
  build();
  renderTape();
  window.addEventListener('resize', () => { if (st.open) place(st.x ?? 0, st.y ?? 0); });
  if (st.open) toggle(true);
}

// The "=" key anywhere (not while typing in a box) opens or closes it.
export function onKey(e) {
  if (e.key !== '=' || !panel) return false;
  e.preventDefault();
  toggle(!st.open);
  return true;
}
