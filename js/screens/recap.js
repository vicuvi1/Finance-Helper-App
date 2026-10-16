// The month recap as a story: full screen, a few slides that move on by
// themselves (hold to pause), arrows or a tap on either side
// to go back and forth, Esc to close. Numbers come from js/recap.js.

import { ctx, esc } from '../ctx.js';
import { monthRecap } from '../recap.js';
import { formatMoney } from '../money.js';
import { addMonths, monthLabel } from '../dates.js';

const SLIDE_MS = 7000;
let root = null;
let at = 0;
let count = 0;
let paused = false;
let keyHandler = null;

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const dayMonth = (iso) => `${Number(iso.slice(8))} ${monthLabel(iso.slice(0, 7)).split(' ')[0].slice(0, 3)}`;

function slides(r) {
  const cur = ctx.state.settings.currency;
  const m = (c) => esc(formatMoney(c, cur));
  const big = (c) => `${esc(formatMoney(Math.abs(c), ''))}<small>${esc(cur)}</small>`;
  const next = monthLabel(addMonths(r.key, 1)).split(' ')[0];
  const out = [];

  out.push(`<div class="rc-cover">
    <span class="rc-k">Your month in review</span>
    <h2 class="rc-month">${esc(r.name)}</h2>
    <p class="rc-sub">${esc(r.key.slice(0, 4))} · ${r.count} record${r.count === 1 ? '' : 's'}</p>
    <p class="rc-hint">Tap the right side or press → to go on</p>
  </div>`);

  const maxBar = Math.max(r.income, r.spent, 1);
  out.push(`<div class="rc-money">
    <span class="rc-k">${r.kept >= 0 ? 'This month you kept' : 'This month you spent more than came in'}</span>
    <b class="rc-big ${r.kept >= 0 ? 'pos' : 'neg'}">${r.kept < 0 ? '−' : ''}${big(r.kept)}</b>
    ${r.rate != null && r.kept >= 0 ? `<p class="rc-sub">${Math.round(r.rate * 100)}% of what came in${r.goalPct != null ? ` · your plan is ${r.goalPct}%` : ''}</p>` : ''}
    <div class="rc-bars2">
      <div><span>Came in</span><i style="--w:${((r.income / maxBar) * 100).toFixed(1)}%" class="in"></i><b>${m(r.income)}</b></div>
      <div><span>You spent</span><i style="--w:${((r.spent / maxBar) * 100).toFixed(1)}%" class="out"></i><b>${m(r.spent)}</b></div>
    </div>
    ${r.prevSpent != null ? `<p class="rc-note">${r.spent <= r.prevSpent ? `${m(r.prevSpent - r.spent)} less spent than the month before` : `${m(r.spent - r.prevSpent)} more spent than the month before`}</p>` : ''}
    ${r.work.income > 0 ? `<p class="rc-note">Work: ${m(r.work.income)} earned, ${m(r.work.costs)} costs, ${m(r.work.profit)} profit.</p>` : ''}
  </div>`);

  if (r.top.length) {
    out.push(`<div class="rc-where">
      <span class="rc-k">Where it went</span>
      <h3 class="rc-h">${esc(r.top[0].name)} took ${Math.round(r.top[0].share * 100)}%</h3>
      <ol class="rc-cats">${r.top.map((c, i) => `<li style="--i:${i}"><span class="rc-cn">${esc(c.emoji || '')} ${esc(c.name)}</span><span class="rc-cb"><i style="--w:${(c.share * 100).toFixed(1)}%"></i></span><b>${m(c.amount)}</b><em>${Math.round(c.share * 100)}%</em></li>`).join('')}</ol>
    </div>`);
  }

  const tiles = [];
  if (r.biggest) tiles.push(`<div class="rc-tile"><span>Biggest spend</span><b>${m(r.biggest.amount)}</b><small>${esc(r.biggest.note)} · ${esc(dayMonth(r.biggest.date))}</small></div>`);
  tiles.push(`<div class="rc-tile"><span>No-spend days</span><b>${r.noSpend}<small> of ${r.days}</small></b><small>Days without everyday spending</small></div>`);
  if (r.busiest) tiles.push(`<div class="rc-tile"><span>You spend most on</span><b>${esc(r.busiest)}s</b><small>The day of the week with the most everyday spending</small></div>`);
  if (r.down) tiles.push(`<div class="rc-tile good"><span>Went down</span><b>${esc(r.down.name)}</b><small>${m(-r.down.diff)} less than the month before</small></div>`);
  if (r.up) tiles.push(`<div class="rc-tile warn"><span>Went up</span><b>${esc(r.up.name)}</b><small>${m(r.up.diff)} more than the month before</small></div>`);
  out.push(`<div class="rc-high"><span class="rc-k">Highlights</span><div class="rc-tiles">${tiles.slice(0, 4).join('')}</div></div>`);

  const ratePct = r.rate != null ? Math.max(0, Math.min(100, Math.round(r.rate * 100))) : null;
  out.push(`<div class="rc-save">
    <span class="rc-k">Saving</span>
    ${ratePct != null ? `<div class="rc-ring" style="--p:${ratePct}" role="img" aria-label="Kept ${ratePct}%"><b>${ratePct}%</b><small>kept</small></div>` : ''}
    <h3 class="rc-h">${r.toSavings > 0 ? `You moved ${m(r.toSavings)} to savings` : 'Nothing moved to savings this month'}</h3>
    ${r.goalPct != null && ratePct != null ? `<p class="rc-sub">${ratePct >= r.goalPct ? `Above your ${r.goalPct}% plan. Well done.` : `Your plan is ${r.goalPct}%. ${r.goalPct - ratePct} points to go.`}</p>` : ''}
    ${r.limit ? `<p class="rc-note">Spending limit: ${m(r.everyday)} of ${m(r.limit)} ${r.everyday <= r.limit ? '✓ kept to it' : `· ${m(r.everyday - r.limit)} over`}</p>` : ''}
  </div>`);

  out.push(`<div class="rc-next">
    <span class="rc-k">For ${esc(next)}</span>
    <h3 class="rc-h">One thing to try</h3>
    <p class="rc-tip">${esc(r.tip.text)}</p>
    <div class="rc-btns">${r.tip.act ? `<button type="button" class="btn primary" data-act="${esc(r.tip.act)}" data-recap-close>${esc(r.tip.btn)}</button>` : ''}<button type="button" class="btn ${r.tip.act ? '' : 'primary'}" data-recap-close>Done</button></div>
  </div>`);
  return out;
}

function show(i) {
  if (!root) return;
  at = Math.max(0, Math.min(count - 1, i));
  root.querySelectorAll('.rc-slide').forEach((s, n) => { s.classList.toggle('on', n === at); s.setAttribute('aria-hidden', String(n !== at)); });
  root.querySelectorAll('.rc-prog i').forEach((b, n) => {
    b.className = n < at ? 'done' : n === at ? 'now' : '';
    void b.offsetWidth; // restart the fill animation
  });
  root.dataset.slide = String(at);
}

export function closeRecap() {
  if (!root) return;
  root.classList.add('out');
  const r = root;
  root = null;
  setTimeout(() => r.remove(), 220);
  if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
  keyHandler = null;
}

export function openRecap(key) {
  const { state } = ctx;
  if (!key || state._sealed) return;
  closeRecap();
  const r = monthRecap(state, key);
  if (!r.count) { ctx.toast(`Nothing logged in ${r.label}.`); return; }
  state.meta.recapSeen = { ...(state.meta.recapSeen || {}), [key]: 1 };
  ctx.persist({ quiet: true });
  const list = slides(r);
  count = list.length;
  paused = false;
  root = document.createElement('div');
  root.className = `recap${reduced() ? ' still' : ''}`;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', `Your ${r.label} recap`);
  root.style.setProperty('--slide-ms', `${SLIDE_MS}ms`);
  root.innerHTML = `<div class="rc-frame">
    <div class="rc-prog" aria-hidden="true">${list.map(() => '<i><b></b></i>').join('')}</div>
    <button type="button" class="rc-x" data-recap-close aria-label="Close">✕</button>
    <div class="rc-stage">${list.map((h, n) => `<section class="rc-slide rc-s${n}" aria-hidden="true">${h}</section>`).join('')}</div>
    <button type="button" class="rc-tap prev" aria-label="Previous"></button>
    <button type="button" class="rc-tap next" aria-label="Next"></button>
  </div>`;
  document.body.appendChild(root);
  show(0);

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-recap-close]')) { closeRecap(); return; }
    if (e.target.closest('.rc-tap.prev')) show(at - 1);
    else if (e.target.closest('.rc-tap.next')) { if (at === count - 1) closeRecap(); else show(at + 1); }
    else if (e.target === root) closeRecap();
  });
  // The fill on the progress bar sets the pace.
  root.addEventListener('animationend', (e) => {
    if (e.target.matches('.rc-prog i.now b') && !paused && at < count - 1) show(at + 1);
  });
  const pause = (on) => { paused = on; root?.classList.toggle('paused', on); };
  const frame = root.querySelector('.rc-frame');
  // Hold to pause (mouse or finger), like any story; Space too.
  frame.addEventListener('pointerdown', () => pause(true));
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) frame.addEventListener(ev, () => { if (paused) pause(false); });
  // Swipe on phones.
  let x0 = null;
  root.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  root.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) show(at + (dx < 0 ? 1 : -1));
  });
  keyHandler = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRecap(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); show(at + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); show(at - 1); }
    else if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); pause(!paused); }
  };
  document.addEventListener('keydown', keyHandler, true);
  root.querySelector('.rc-tap.next').focus();
}
