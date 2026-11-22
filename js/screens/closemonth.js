// "Close the month": the checklist sheet, clean-up suggestions, and "Mark as checked".
// Logic: js/closemonth.js. Opened from Home's "Do this next" and the Log (past months).
import { ctx, esc } from '../ctx.js';
import { monthLabel, todayISO } from '../dates.js';
import { closeSteps, cleanupSuggestions, closeMonth, reopenMonth, isClosed } from '../closemonth.js';
import { editSubscription } from '../subtable.js';

const attrs = (x) => (x.go ? `data-go="${esc(x.go)}"` : `data-act="${esc(x.act)}"${Object.entries(x.data || {}).map(([k, v]) => ` data-${k}="${esc(String(v))}"`).join('')}`);

export function open(key) {
  const { state } = ctx;
  const today = todayISO();
  const steps = closeSteps(state, key, today);
  const clean = cleanupSuggestions(state, today).slice(0, 6);
  const done = steps.filter((s) => s.done).length;
  const closed = isClosed(state, key);
  if (document.querySelector('.sheet')) ctx.closeSheet();
  ctx.openSheet(`<h3>Close ${esc(monthLabel(key))} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p class="muted" style="margin-top:0">${closed ? '✓ This month is checked. You can still change it.' : `About 5 minutes. ${done} of ${steps.length} done.`}</p>
    <ol class="cm-steps" data-testid="cm-steps">${steps.map((s) => `<li class="${s.done ? 'done' : ''}"><span class="cm-dot" aria-hidden="true">${s.done ? '✓' : ''}</span><div><b>${esc(s.title)}</b><p>${esc(s.text)}</p></div><button type="button" class="btn sm" ${attrs(s)}>${esc(s.btn)}</button></li>`).join('')}</ol>
    ${clean.length ? `<h4 class="cm-h">Clean-up suggestions</h4><ul class="cm-clean" data-testid="cm-clean">${clean.map((c) => `<li><div><b>${esc(c.title)}</b><p>${esc(c.text)}</p></div><span><button type="button" class="btn sm" ${attrs(c)}>${esc(c.btn)}</button><button type="button" class="btn sm" data-act="cm-keep" data-id="${esc(c.id)}">Keep it</button></span></li>`).join('')}</ul>` : ''}
    <div class="btns">${closed ? `<button type="button" class="btn" data-act="cm-reopen" data-key="${key}">Not checked after all</button>` : `<button type="button" class="btn primary" data-act="cm-close" data-key="${key}" data-testid="cm-close">Mark ${esc(monthLabel(key).split(' ')[0])} as checked ✓</button>`}</div>`);
}

function act(el) {
  const { state } = ctx;
  const a = el.dataset.act;
  const key = el.dataset.key;
  const now = Date.now();
  if (a === 'cm-open') { open(key); return; }
  if (a === 'cm-other') { ctx.closeSheet(); ctx.ui.month = key; ctx.ui.search = 'cat:other'; ctx.ui.tab = 'log'; if (location.hash === '#log') ctx.render(); else location.hash = '#log'; return; }
  if (a === 'cm-subs') { state.meta.subsReviewed = { ...(state.meta.subsReviewed || {}), [key]: 1 }; ctx.persist(); ctx.closeSheet(); ctx.ui.planTab = 'subtable'; if (location.hash === '#plan') ctx.render(); else location.hash = '#plan'; return; }
  if (a === 'cm-close') { closeMonth(state, key, now); ctx.commit(); ctx.closeSheet(); ctx.toast(`${monthLabel(key)} is checked ✓`, 'Undo', () => ctx.undo()); return; }
  if (a === 'cm-reopen') { reopenMonth(state, key, now); ctx.commit(); ctx.closeSheet(); ctx.toast(`${monthLabel(key)}: not checked`, 'Undo', () => ctx.undo()); return; }
  const id = el.dataset.id;
  const back = () => { ctx.commit(); const k = document.querySelector('[data-testid="cm-steps"]') ? document.querySelector('[data-act="cm-close"], [data-act="cm-reopen"]')?.dataset.key : null; if (k) open(k); };
  if (a === 'cm-keep') { state.settings.cleanupHidden = { ...(state.settings.cleanupHidden || {}), [id]: now }; state.settings.updatedAt = now; back(); ctx.toast('Kept: it won\'t be suggested again', 'Undo', () => ctx.undo()); return; }
  if (a === 'cm-archive-cat') { const c = state.settings.categories.find((x) => x.id === id); if (c) { c.archived = true; c.updatedAt = now; state.settings.updatedAt = now; back(); ctx.toast(`${c.name} archived`, 'Undo', () => ctx.undo()); } return; }
  if (a === 'cm-archive-acc') { const x = state.settings.accounts.find((y) => y.id === id); if (x) { x.archived = true; x.updatedAt = now; state.settings.updatedAt = now; back(); ctx.toast(`${x.name} archived`, 'Undo', () => ctx.undo()); } return; }
  if (a === 'cm-pause-sub') { if (editSubscription(state, id, 'paused', true, { now })) { back(); ctx.toast('Paused', 'Undo', () => ctx.undo()); } }
}

let bound = false;
export function init() {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-act^="cm-"]');
    if (!el) return;
    e.stopPropagation();
    act(el);
  }, true);
}
