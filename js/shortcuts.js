// Keyboard shortcuts for the desktop app: the list (shown by "?" and in
// Settings), and the two keys this file owns: "G then a letter" (go to a
// screen) and "?" (the help sheet). N, /, E and Ctrl+Z are wired in app.js.
// Nothing fires while you type in a box, or while a sheet is open (Esc closes it).

import { ctx, esc } from './ctx.js';

export const GO = { h: 'home', l: 'log', a: 'accounts', g: 'goals', p: 'plan', r: 'reports' };

export const LIST = [
  ['Space', 'Show or hide all amounts (H does the same)'],
  ['N', 'New record'],
  ['/', 'Search the log'],
  ['E', 'Edit the selected record (tick one in the Table first)'],
  ['Ctrl+Z', 'Undo the last change on any screen (Ctrl+Shift+Z or Ctrl+Y redoes it; in a text box it undoes the text)'],
  ['U', 'Recent actions: the last 10 changes, each with Undo this'],
  ['Arrows', 'Log Sheet and Table: move the active cell (press ArrowDown once to start)'],
  ['Enter/F2', 'Log cell: edit it (on a dropdown: open it, then type to filter); Enter saves and moves down'],
  ['Tab', 'Log cell: save and move right (Shift+Tab left)'],
  ['Esc', 'Log cell: cancel the edit, clear the range, leave the grid'],
  ['Shift+arrows', 'Log cells: select a range (Shift+click too)'],
  ['Ctrl+C/X/V', 'Log cells: copy, cut or paste cells and columns (also from Excel)'],
  ['Delete', 'Log cell: clear it (Shift+Delete deletes the record)'],
  ['Ctrl+D', 'Log cells: fill down'],
  ['G then H', 'Go to Home'],
  ['G then L', 'Go to Log'],
  ['G then A', 'Go to Accounts'],
  ['G then G', 'Go to Goals'],
  ['G then P', 'Go to Plan'],
  ['G then R', 'Go to Reports'],
  ['?', 'Show this list'],
  ['Esc', 'Close a sheet or clear the ticked records'],
];

export const isTyping = (el) => !!el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');

export function helpHTML() {
  return `<h3>Keyboard shortcuts <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <div class="kbd-list" data-testid="shortcuts-list">${LIST.map(([k, t]) => `<div class="kbd-row"><span class="kbd-keys">${k.split(' ').map((p) => (p === 'then' ? '<span class="muted">then</span>' : `<kbd>${esc(p)}</kbd>`)).join(' ')}</span><span>${esc(t)}</span></div>`).join('')}</div>
    <p class="muted small">Shortcuts never fire while you are typing in a box.</p>`;
}

export function openHelp() { ctx.openSheet(helpHTML()); }

export function settingsCard() {
  return `<section class="card"><h2>Keyboard shortcuts</h2>
    <p class="muted small" style="margin-top:0">Space show or hide amounts, N new record, / search, E edit, Ctrl+Z undo, U recent actions, G then a letter to go to a screen.</p>
    <button type="button" class="btn" data-act="shortcuts-help" data-testid="shortcuts-open">Keyboard shortcuts</button></section>`;
}

let pendingG = 0;
export const resetPending = () => { pendingG = 0; };

// Called for a plain key press with no sheet open and no box focused.
// Returns true when the key was used. `now` is passed in for tests.
export function onKey(e, { go, now = Date.now() } = {}) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key === '?') { e.preventDefault(); pendingG = 0; openHelp(); return true; }
  const k = String(e.key).toLowerCase();
  if (pendingG && now - pendingG < 1500) {
    pendingG = 0;
    if (GO[k]) { e.preventDefault(); go(GO[k]); return true; }
    return false;
  }
  pendingG = 0;
  if (k === 'g') { e.preventDefault(); pendingG = now; return true; }
  return false;
}
