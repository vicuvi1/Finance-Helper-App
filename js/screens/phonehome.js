// The phone Home: four swipe screens (Today, This month, Safety, What's next), one question each,
// the answer big, one picture, one thing to do. Only on phone widths; "Classic Home" (this device
// only) brings the long Home back. Numbers: js/phonehome.js. Swiping is the browser's own
// scroll-snap: smooth, no animation loop, nothing running in the background.

import { ctx, esc } from '../ctx.js';
import { formatMoney } from '../money.js';
import { monthLabel } from '../dates.js';
import { shortDay } from '../safespend.js';
import { phoneHomeData } from '../phonehome.js';

const KEY = 'finance-helper.phoneHome';
const store = () => { try { return globalThis.localStorage; } catch { return null; } };
const PHONE = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 600px)') : null;

/** Phone width, and you haven't chosen the classic Home on this device. */
export function active() {
  if (!PHONE?.matches) return false;
  try { return store()?.getItem(KEY) !== 'classic'; } catch { return true; }
}
export function setClassic(on) { try { if (on) store()?.setItem(KEY, 'classic'); else store()?.removeItem(KEY); } catch { /* private window */ } }
export const onPhoneChange = (fn) => PHONE?.addEventListener?.('change', fn);

const ring = (used, label, big, warn) => {
  const C = 2 * Math.PI * 80;
  return `<svg class="ph-ring${warn ? ' warn' : ''}" viewBox="0 0 200 200" role="img" aria-label="${esc(label)}">
    <circle cx="100" cy="100" r="80" class="ph-ring-bg"></circle>
    <circle cx="100" cy="100" r="80" class="ph-ring-fg" stroke-dasharray="${(used * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 100 100)"></circle>
    <text x="100" y="92" text-anchor="middle" class="ph-ring-k">left today</text>
    <text x="100" y="126" text-anchor="middle" class="ph-ring-v">${esc(big)}</text></svg>`;
};

function monthChart(m) {
  const W = 340;
  const H = 150;
  const max = Math.max(1, ...m.line, ...(m.usual.length ? m.usual : [0]));
  const x = (i) => 6 + (i / Math.max(1, m.dim - 1)) * (W - 12);
  const y = (v) => 10 + (1 - v / max) * (H - 30);
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const line = path(m.line);
  const last = m.line.length - 1;
  return `<svg class="ph-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spent so far this month, day by day, against a usual month">
    <defs><linearGradient id="ph-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--gold)" stop-opacity="0.3"></stop><stop offset="1" stop-color="var(--gold)" stop-opacity="0"></stop></linearGradient></defs>
    ${m.usual.length ? `<path d="${path(m.usual)}" class="ph-usual"></path>` : ''}
    ${last >= 0 ? `<path d="${line} L${x(last).toFixed(1)} ${y(0).toFixed(1)} L${x(0).toFixed(1)} ${y(0).toFixed(1)} Z" fill="url(#ph-g)"></path><path d="${line}" class="ph-line"></path><circle cx="${x(last).toFixed(1)}" cy="${y(m.line[last]).toFixed(1)}" r="5" class="ph-dot"></circle>` : ''}
    <line x1="6" x2="${W - 6}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="ph-base"></line>
    <text x="6" y="${H - 4}" class="ph-axis">1</text><text x="${W - 6}" y="${H - 4}" text-anchor="end" class="ph-axis">${m.dim}</text></svg>`;
}

const goalRing = (g) => {
  const C = 2 * Math.PI * 30;
  return `<div class="ph-goal"><svg viewBox="0 0 76 76" width="64" height="64" role="img" aria-label="${esc(g.name)} ${Math.round(g.pct * 100)}%"><circle cx="38" cy="38" r="30" class="ph-ring-bg sm"></circle><circle cx="38" cy="38" r="30" class="ph-ring-fg sm" stroke-dasharray="${(g.pct * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 38 38)"></circle><text x="38" y="43" text-anchor="middle" class="ph-goal-p">${Math.round(g.pct * 100)}%</text></svg><span><b>${esc(g.name)}</b><small>${esc(ctx.money(g.current))} of ${esc(ctx.money(g.target, { compact: true }))}</small></span></div>`;
};

/** The phone Home. `parts`: { steps (HTML), quickAdd (HTML), coming (HTML) } from app.js. */
export function view(today, parts) {
  const { state } = ctx;
  const d = phoneHomeData(state, today);
  const t = d.today;
  const m = d.month;
  const sa = d.safety;
  const fm = (c) => ctx.money(Math.round(c / 100) * 100);
  const yes = !t.empty && t.left > 0;
  const answer = !state.tx.length ? 'Log your first record' : t.empty ? `Wait until ${shortDay(t.payday)}` : yes ? `Yes, ${fm(t.left)}` : `Better not, ${fm(-t.left)} over`;
  const monthName = monthLabel(m.key).split(' ')[0];
  const monthAnswer = m.spent === 0 && m.income === 0 ? 'Nothing logged yet.' : m.rate == null ? `${fm(m.spent)} spent so far.` : m.rate >= 0.2 ? `A good month. Kept ${Math.round(m.rate * 100)}%.` : m.rate >= 0 ? `Kept ${Math.round(m.rate * 100)}% so far.` : 'Spending more than came in.';
  const safeAnswer = sa.months == null ? 'Log a month to see it.' : `${String(Math.round(sa.months * 10) / 10).replace('.', ',')} months without income.`;
  const panels = [
    { id: 'today', label: 'Today', html: `
      <p class="ph-q">Can I spend today?</p>
      <h1 class="ph-a ${yes ? '' : 'warn'}">${esc(answer)}</h1>
      ${state.tx.length ? `<p class="ph-sub">${esc(fm(t.spent))} of today's ${esc(fm(t.share))} spent${t.payday ? ` · payday ${esc(shortDay(t.payday))}` : ''}.</p>
      <div class="ph-center">${ring(t.used, `${Math.round(t.used * 100)}% of today's share used`, fm(Math.max(0, t.left)), !yes)}</div>
      ${t.bills.length ? `<div class="ph-box">${t.bills.map((x) => `<div class="ph-row"><span>${esc(x.rule.note || 'Bill')} · ${esc(shortDay(x.date))}</span><b>${esc(formatMoney(x.rule.amount, x.rule.currency))}</b></div>`).join('')}</div>` : ''}` : ''}
      <div class="ph-qa">${parts.quickAdd}</div>` },
    { id: 'month', label: 'This month', html: `
      <p class="ph-q">How is ${esc(monthName)} going?</p>
      <h1 class="ph-a ${m.rate != null && m.rate < 0 ? 'warn' : 'good'}">${esc(monthAnswer)}</h1>
      ${m.vsUsual != null ? `<p class="ph-sub">${Math.abs(m.vsUsual) < 0.05 ? 'About like a usual month.' : `${Math.round(Math.abs(m.vsUsual) * 100)}% ${m.vsUsual > 0 ? 'more' : 'less'} than a usual month by today.`}</p>` : ''}
      <div class="ph-box">${monthChart(m)}<p class="ph-legend"><span><i class="ph-k line"></i>${esc(monthName)}</span> <span><i class="ph-k usual"></i>a usual month</span></p></div>
      <div class="ph-trio"><div><small>In</small><b class="income">${esc(ctx.money(m.income, { compact: true }))}</b></div><div><small>Out</small><b class="expense">${esc(ctx.money(m.spent, { compact: true }))}</b></div><div><small>Kept</small><b>${esc(ctx.money(m.kept, { compact: true }))}</b></div></div>
      ${m.top.length ? `<div class="ph-bar" role="img" aria-label="Where it went">${m.top.map((c, i) => `<i class="c${i}" style="flex:${Math.max(1, Math.round(c.share * 100))}"></i>`).join('')}</div><p class="ph-legend">${m.top.map((c, i) => `<span><i class="ph-k c${i}"></i>${esc(c.name)} ${esc(ctx.money(c.amount, { compact: true }))}</span>`).join(' ')}</p>` : ''}` },
    { id: 'safety', label: 'Safety', html: `
      <p class="ph-q">How safe am I?</p>
      <h1 class="ph-a">${esc(safeAnswer)}</h1>
      ${sa.months != null ? `<p class="ph-sub">${sa.months >= 6 ? 'Past the 6-month safety line.' : sa.months >= 3 ? 'Good. 6 months is the safety line.' : 'Build a few months of cover first.'}</p>
      <div class="ph-box"><div class="ph-ruler" role="img" aria-label="${esc(safeAnswer)} of 12"><i style="width:${Math.min(100, (sa.months / 12) * 100).toFixed(1)}%"></i><span class="ph-line6"></span></div><p class="ph-legend"><span>0</span><span>6 months</span><span>12</span></p></div>` : ''}
      ${sa.goals.length ? `<div class="ph-goals">${sa.goals.map(goalRing).join('')}</div>` : '<p class="ph-sub">Add a goal in Goals to see it here.</p>'}
      <button type="button" class="btn" data-go="goals">Goals</button>` },
    { id: 'next', label: "What's next", html: `
      <p class="ph-q">What should I do next?</p>
      ${parts.steps || '<h1 class="ph-a good">Nothing to do. 👌</h1>'}
      ${parts.coming || ''}` },
  ];
  const start = (() => { try { return Math.max(0, panels.findIndex((p) => p.id === sessionStorage.getItem(`${KEY}.panel`))); } catch { return 0; } })();
  return `<div class="ph" data-testid="phone-home">
    <nav class="ph-tabs" role="tablist" aria-label="Home screens">${panels.map((p, i) => `<button type="button" role="tab" class="ph-tab" aria-selected="${i === start}" data-ph-go="${i}">${esc(p.label)}</button>`).join('')}</nav>
    <div class="ph-track" data-start="${start}">${panels.map((p) => `<section class="ph-panel" data-ph="${p.id}" aria-label="${esc(p.label)}">${p.html}</section>`).join('')}</div>
    <p class="ph-classic"><button type="button" class="linkish" data-act="phone-home-classic">Classic Home</button></p>
  </div>`;
}

/** After the Home is drawn: go to the last screen, keep the tabs in step while swiping. */
export function after(root) {
  const track = root.querySelector('.ph-track');
  if (!track) return;
  const tabs = [...root.querySelectorAll('.ph-tab')];
  const start = Number(track.dataset.start) || 0;
  if (start) track.scrollLeft = start * track.clientWidth;
  let raf = 0;
  track.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      tabs.forEach((b, j) => b.setAttribute('aria-selected', String(i === j)));
      try { sessionStorage.setItem(`${KEY}.panel`, track.children[i]?.dataset.ph || 'today'); } catch { /* private window */ }
    });
  }, { passive: true });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ph-go]');
    if (b) track.scrollTo({ left: Number(b.dataset.phGo) * track.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
}
