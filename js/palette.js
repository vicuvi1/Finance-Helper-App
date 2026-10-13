// Pro Command Palette (Ctrl+K / Cmd+K): keyboard-first spotlight for fast
// math, currency conversion, navigation and app actions.

import { evalAmount, formatMoney } from './money.js';
import { convert } from './fx.js';
import { sound } from './audio.js';

let paletteEl = null;
let selectedIndex = 0;
let currentItems = [];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function isPaletteOpen() {
  return !!(paletteEl && paletteEl.classList.contains('open'));
}

export function closePalette() {
  if (!paletteEl) return;
  paletteEl.classList.remove('open');
  const inp = paletteEl.querySelector('#cmd-input');
  if (inp) inp.value = '';
}

export function openPalette(ctx) {
  if (!paletteEl) initPalette(ctx);
  paletteEl.classList.add('open');
  selectedIndex = 0;
  const inp = paletteEl.querySelector('#cmd-input');
  if (inp) {
    inp.value = '';
    inp.focus();
  }
  sound.click(ctx.state);
  renderResults(ctx, '');
}

function getCommands(ctx) {
  return [
    { id: 'add', icon: '➕', title: 'New record', shortcut: 'N', desc: 'Log an expense, income, or transfer', run: () => ctx.openNew() },
    { id: 'calc', icon: '🧮', title: 'Calculator', shortcut: '=', desc: 'Open floating desktop calculator', run: () => ctx.openCalc() },
    { id: 'home', icon: '🏠', title: 'Home', shortcut: '1', desc: 'Main dashboard and Safe-to-Spend', run: () => ctx.go('home') },
    { id: 'accounts', icon: '💳', title: 'Accounts & Net Worth', shortcut: '2', desc: 'Cards, cash, balances and crypto', run: () => ctx.go('accounts') },
    { id: 'goals', icon: '🎯', title: 'Goals', shortcut: '3', desc: 'Savings targets and progress', run: () => ctx.go('goals') },
    { id: 'log', icon: '📋', title: 'Log', shortcut: '4', desc: 'All transactions, spreadsheet & table', run: () => ctx.go('log') },
    { id: 'plan', icon: '✨', title: 'Plan & Subscriptions', shortcut: '5', desc: 'Subscriptions, AI tools, What-If simulator, and bills', run: () => ctx.go('plan') },
    { id: 'clients', icon: '👥', title: 'Clients & Invoices', shortcut: '6', desc: 'Client tracking, hours, and invoicing', run: () => ctx.go('clients') },
    { id: 'reports', icon: '📊', title: 'Reports & Year in Review', shortcut: '7', desc: 'Spending breakdown and tax summary', run: () => ctx.go('reports') },
    { id: 'sankey', icon: '🌊', title: 'Cash Flow Flowchart (Sankey)', desc: 'Visual distribution of income into jars and spending', run: () => ctx.go('reports') },
    { id: 'settings', icon: '⚙️', title: 'Settings', shortcut: 'S', desc: 'Themes, sync, backups, and bot settings', run: () => ctx.go('settings') },
    { id: 'export-xlsx', icon: '📥', title: 'Export to Excel', desc: 'Download current data as .xlsx workbook', run: () => ctx.exportExcel() },
    { id: 'export-json', icon: '💾', title: 'Backup JSON', desc: 'Download full encrypted device backup', run: () => ctx.backupJSON() },
    { id: 'lock', icon: '🔒', title: 'Lock application', shortcut: 'L', desc: 'Secure the app with your PIN', run: () => ctx.lock() },
  ];
}

function evaluateInput(query, ctx) {
  const q = query.trim();
  const items = [];
  const cur = ctx.state.settings?.currency || 'MDL';

  // 1. Math Evaluator (e.g., "120+45*2")
  if (/^[\d\s.,+\-*/()]+$/.test(q) && /[\d]/.test(q) && /[+\-*/]/.test(q)) {
    try {
      const val = evalAmount(q);
      if (val && val > 0) {
        items.push({
          id: 'math',
          icon: '🧮',
          title: `= ${formatMoney(val, cur)}`,
          desc: 'Press Enter to log this amount as a new record',
          run: () => ctx.openNew({ amount: val }),
        });
      }
    } catch { /* ignore math eval errors */ }
  }

  // 2. Currency Converter (e.g. "100 usd", "50 eur")
  const fxMatch = q.match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-Z]{3})$/i);
  if (fxMatch && ctx.state.rates) {
    const rawAmt = Math.round(Number(fxMatch[1].replace(',', '.')) * 100);
    const fromCur = fxMatch[2].toUpperCase();
    if (fromCur !== cur) {
      const converted = convert(rawAmt, fromCur, cur, ctx.state.rates);
      if (converted && converted > 0) {
        items.push({
          id: 'fx',
          icon: '💵',
          title: `≈ ${formatMoney(converted, cur)}`,
          desc: `${fxMatch[1]} ${fromCur} at today's rate (Press Enter to log)`,
          run: () => ctx.openNew({ amount: converted }),
        });
      }
    }
  }

  // 3. Command Matches
  const allCmds = getCommands(ctx);
  const matched = q
    ? allCmds.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()) || c.desc.toLowerCase().includes(q.toLowerCase()))
    : allCmds;

  return [...items, ...matched];
}

function renderResults(ctx, query) {
  currentItems = evaluateInput(query, ctx);
  if (selectedIndex >= currentItems.length) selectedIndex = Math.max(0, currentItems.length - 1);
  const listEl = paletteEl.querySelector('#cmd-list');
  if (!listEl) return;

  if (!currentItems.length) {
    listEl.innerHTML = '<div class="cmd-empty muted small">No commands or calculations found.</div>';
    return;
  }

  listEl.innerHTML = currentItems.map((item, idx) => `
    <div class="cmd-item ${idx === selectedIndex ? 'selected' : ''}" data-idx="${idx}">
      <span class="cmd-icon">${item.icon}</span>
      <div class="cmd-text">
        <div class="cmd-title">${esc(item.title)}</div>
        <div class="cmd-desc muted small">${esc(item.desc)}</div>
      </div>
      ${item.shortcut ? `<span class="cmd-kbd">${esc(item.shortcut)}</span>` : ''}
    </div>
  `).join('');
}

function initPalette(ctx) {
  paletteEl = document.createElement('div');
  paletteEl.id = 'command-palette';
  paletteEl.className = 'cmd-palette-backdrop';
  paletteEl.innerHTML = `
    <div class="cmd-palette-dialog" role="dialog" aria-modal="true" aria-label="Command palette">
      <div class="cmd-palette-search">
        <span class="cmd-search-icon">⚡</span>
        <input id="cmd-input" type="text" autocomplete="off" spellcheck="false" placeholder="Type a command, math (120+45), or currency (50 eur)..." />
        <span class="cmd-kbd-esc">ESC</span>
      </div>
      <div id="cmd-list" class="cmd-palette-list"></div>
    </div>
  `;

  document.body.appendChild(paletteEl);

  // Backdrop click to close
  paletteEl.addEventListener('click', (e) => {
    if (e.target === paletteEl) closePalette();
  });

  const inp = paletteEl.querySelector('#cmd-input');

  inp.addEventListener('input', (e) => {
    selectedIndex = 0;
    renderResults(ctx, e.target.value);
  });

  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentItems.length) {
        selectedIndex = (selectedIndex + 1) % currentItems.length;
        renderResults(ctx, inp.value);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentItems.length) {
        selectedIndex = (selectedIndex - 1 + currentItems.length) % currentItems.length;
        renderResults(ctx, inp.value);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = currentItems[selectedIndex];
      if (item && item.run) {
        sound.click(ctx.state);
        closePalette();
        item.run();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    }
  });

  // Click on list item
  paletteEl.querySelector('#cmd-list').addEventListener('click', (e) => {
    const row = e.target.closest('.cmd-item');
    if (!row) return;
    const idx = Number(row.dataset.idx);
    const item = currentItems[idx];
    if (item && item.run) {
      sound.click(ctx.state);
      closePalette();
      item.run();
    }
  });
}
