// Empty states and one-time tips.
//
// emptyState(...): what an empty screen or list is for, one example, and the
// one button to start. Screens call it in one line.
// tipFor / tipHTML: one dismissible tip per screen about a feature people
// miss, shown until it is closed, with a "Tips" switch in Settings.
//
// The tip choices live on this device only (localStorage finance-helper.tips),
// never in the synced data: they are about this person on this screen.

import { esc } from './ctx.js';

export const TIPS_KEY = 'finance-helper.tips';

// One tip per screen. Plain English, about what people tend to miss.
export const TIPS = {
  home: { id: 'space', icon: '👁', title: 'Hide your amounts', text: 'Press Space to hide or show every amount. Handy when someone is next to you.' },
  log: { id: 'search', icon: '🔎', title: 'Search with a few words', text: 'Press / and try: coffee >100 #trip cat:food from:2026-01-01. Save a search you use a lot.' },
  accounts: { id: 'new', icon: '➕', title: 'Add a record from anywhere', text: 'Press N on any screen to add a new record. Type the amount and press Enter.' },
  plan: { id: 'goto', icon: '⌨️', title: 'Jump between screens', text: 'Press G and then H, L, A, G, P or R to go to Home, Log, Accounts, Goals, Plan or Reports. Press ? for all keys.' },
  reports: { id: 'rows', icon: '📊', title: 'Open a category', text: 'Click a category row to see the records behind it, then open them in the Log.' },
};

const read = (store) => {
  try { return JSON.parse(store?.getItem(TIPS_KEY) || '{}') || {}; } catch { return {}; }
};
const write = (data, store) => { try { store?.setItem(TIPS_KEY, JSON.stringify(data)); } catch { /* no storage: tips just come back */ } };
const defStore = () => { try { return globalThis.localStorage; } catch { return null; } };

export const tipsOn = (store = defStore()) => read(store).off !== true;
export function setTipsOn(on, store = defStore()) {
  const d = read(store);
  if (on) { delete d.off; d.seen = {}; } else d.off = true; // turning tips back on shows them again
  write(d, store);
}
export function dismissTip(id, store = defStore()) {
  const d = read(store);
  d.seen = { ...(d.seen || {}), [id]: 1 };
  write(d, store);
}

// The tip for a screen, or null (tips off, unknown screen, already closed).
export function tipFor(screen, store = defStore()) {
  const t = TIPS[screen];
  if (!t) return null;
  const d = read(store);
  if (d.off === true || d.seen?.[t.id]) return null;
  return { ...t, screen };
}

export function tipHTML(screen, store = defStore()) {
  const t = tipFor(screen, store);
  if (!t) return '';
  return `<div class="tip-card tip-in" data-testid="tip-card" data-tip="${esc(t.id)}"><span class="tip-ic" aria-hidden="true">${t.icon}</span>
    <div class="tip-body"><b>${esc(t.title)}</b><span>${esc(t.text)}</span></div>
    <button type="button" class="tip-x" data-tip-x="${esc(t.id)}" aria-label="Close this tip" title="Close this tip">Got it</button></div>`;
}

// The switch in Settings (General).
export function settingsRow(store = defStore()) {
  return `<label class="motion-setting"><span><b>Tips</b><small>A short tip on a few screens about things that are easy to miss. Each one goes away when you close it.</small></span><input type="checkbox" data-tips-toggle ${tipsOn(store) ? 'checked' : ''} aria-label="Tips"></label>`;
}

// What an empty screen or list says: what it is for, one example, one button.
//   { icon, title, text, example, button: { label, act, attrs } }
export function emptyState({ icon = '', title, text = '', example = '', button = null, testid = 'empty-state' }) {
  const attrs = button?.attrs ? Object.entries(button.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('') : '';
  return `<div class="empty-state" data-testid="${esc(testid)}">${icon ? `<span class="es-icon" aria-hidden="true">${icon}</span>` : ''}<b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ''}${example ? `<div class="es-ex">Example: <i>${esc(example)}</i></div>` : ''}${button ? `<div class="btns"><button type="button" class="btn primary" data-act="${esc(button.act)}"${attrs}>${esc(button.label)}</button></div>` : ''}</div>`;
}

// The empty states of the screens (one place, so the wording stays consistent).
export const EMPTY = {
  goals: () => emptyState({ icon: '🎯', title: 'Save for something', text: 'A goal is something you are saving money for. Finance Helper shows how close you are and how long it will take at your pace.', example: 'Emergency fund, 12 000 MDL by June', button: { label: 'Add a goal', act: 'goal-new' }, testid: 'empty-goals' }),
  budgets: (btn) => emptyState({ icon: '🧮', title: 'Keep a category in check', text: 'A budget is a monthly limit for a category. You get a warning at 80% and when you go over.', example: 'Food: 3 000 MDL a month', button: btn || { label: 'Set budgets', act: 'budget-set' }, testid: 'empty-budgets' }),
  wishlist: () => emptyState({ icon: '🛍', title: 'Wait before you buy', text: 'Put what you want on the list and give it a few days. If you still want it, buy it; if not, you saved the money.', example: 'Headphones, 900 MDL', testid: 'empty-wishlist' }),
  log: (q) => (q ? '' : emptyState({ icon: '🧾', title: 'No records this month', text: 'The Log lists every record you add: spending, income and moves between accounts.', example: 'Coffee, 25 MDL, Food', button: { label: 'Add a record', act: 'add' }, testid: 'empty-log' })),
  subscriptions: () => emptyState({ icon: '🔁', title: 'Bills that come back', text: 'Add what you pay every month or year (rent, internet, a streaming plan) and Finance Helper reminds you and adds up the cost per year.', example: 'Internet, 250 MDL on the 5th', button: { label: 'Add a recurring payment', act: 'rec-new' }, testid: 'empty-subscriptions' }),
  rules: () => emptyState({ icon: '📂', title: 'Sort records by themselves', text: 'A rule files a record in a category when its note has a word you choose.', example: 'Linella → Food', testid: 'empty-rules' }),
  longview: () => emptyState({ icon: '📈', title: 'Your long view', text: 'Net worth over the years, how much you keep each month and how long your savings would last. It fills in as you log income and spending.', example: 'Salary 20 000 MDL, rent 5 000 MDL', button: { label: 'Add a record', act: 'add' }, testid: 'empty-longview' }),
  year: (y) => emptyState({ icon: '🗓', title: `Nothing logged in ${y}`, text: 'The year in review tells the story of a year: what you earned, spent and kept. Pick a year that has records.', testid: 'empty-year' }),
};

// ---------- Listeners ----------

let bound = false;
export function init({ doc = document, rerender = () => {} } = {}) {
  if (bound) return;
  bound = true;
  doc.addEventListener('click', (e) => {
    const x = e.target.closest?.('[data-tip-x]');
    if (!x) return;
    dismissTip(x.dataset.tipX);
    x.closest('.tip-card')?.remove();
  });
  doc.addEventListener('change', (e) => {
    const t = e.target.closest?.('[data-tips-toggle]');
    if (!t) return;
    setTipsOn(t.checked);
    rerender();
  });
}
export const _reset = () => { bound = false; };
