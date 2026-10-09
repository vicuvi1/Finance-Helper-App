// Shared handles for the screen modules in js/screens/. app.js fills this in
// at start-up (state, ui, commit, render, sheets, toast and the small HTML
// helpers), so screens stay plain functions without importing app.js.

export const ctx = {};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
