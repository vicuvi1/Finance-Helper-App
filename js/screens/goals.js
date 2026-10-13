// Goals: what you're saving for, each with a ring that fills by itself
// (from all your money, your savings accounts, one account, or what you add
// by hand), milestones, an ETA at your pace, what a deadline needs per
// month, a line of encouragement, and confetti when you pass a milestone.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { todayISO, monthLabel, dayLabel } from '../dates.js';
import { evalAmount, centsToPlain, formatMoney } from '../money.js';
import { CARD_THEMES } from '../cards.js';

const TEMPLATES = [
  { emoji: '🛟', name: 'Emergency fund', account: 'savings', theme: 'teal', emergency: true },
  { emoji: '🚗', name: 'Car', theme: 'ocean' },
  { emoji: '✈️', name: 'Trip', theme: 'sunset' },
  { emoji: '💻', name: 'Laptop', theme: 'graphite' },
  { emoji: '🏠', name: 'Home', theme: 'emerald' },
  { emoji: '🎓', name: 'Learning', theme: 'plum' },
  { emoji: '💍', name: 'Wedding', theme: 'rose' },
  { emoji: '🎯', name: '', theme: 'gold' },
];

const lei = (c) => Math.round(c / 100) * 100;
const sourceLabel = (g) => (g.account === 'allocated' ? 'money reserved for this goal' : g.account === 'manual' ? 'added by hand' : g.account === 'savings' ? 'your savings accounts' : g.account === 'all' || !g.account ? 'all your money' : M.account(ctx.state, g.account)?.name || 'an account');

function ring(st, g, size = 132) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.round(st.ratio * 100);
  return `<svg class="g-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <defs><linearGradient id="gr-${esc(g.id)}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--g2)"/><stop offset="1" style="stop-color:var(--g1-ring, var(--g1))"/></linearGradient></defs>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="g-track"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="g-prog" stroke="url(#gr-${esc(g.id)})" style="--c:${c.toFixed(1)};--off:${(c * (1 - st.ratio)).toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    ${[25, 50, 75].map((m) => { const a = (m / 100) * 2 * Math.PI - Math.PI / 2; return `<circle cx="${(size / 2 + r * Math.cos(a)).toFixed(1)}" cy="${(size / 2 + r * Math.sin(a)).toFixed(1)}" r="2.6" class="g-tick${p >= m ? ' on' : ''}"/>`; }).join('')}
  </svg><span class="g-center"><b>${p}%</b><span>${esc(g.emoji || '🎯')}</span></span>`;
}

function goalCard(g, today) {
  const st = M.goalStatus(ctx.state, today, g);
  const done = st.ratio >= 1;
  const when = done ? 'Reached!' : st.eta ? `At your pace: <b>${monthLabel(st.eta)}</b> (${st.monthsLeft} month${st.monthsLeft === 1 ? '' : 's'})` : st.pace != null && st.pace < 0 ? `Went down ${ctx.money(lei(-st.pace))}/month lately` : 'Keep logging and I\'ll predict when you get there';
  const dl = g.deadline && !done ? `<p class="g-dl ${st.onTrack === false ? 'warn' : st.onTrack ? 'ok' : ''}">By ${esc(dayLabel(g.deadline))} ${g.deadline.slice(0, 4)}: put away <b>${ctx.money(st.perMonth)}</b>/month${st.onTrack ? ' · on track ✓' : st.onTrack === false ? ' · behind pace' : ''}</p>` : '';
  return `<article class="goal-card theme-${esc(g.theme || 'gold')}${done ? ' done' : ''}" data-act="goal-open" data-id="${esc(g.id)}" tabindex="0" role="button" aria-label="${esc(g.name)}: ${Math.round(st.ratio * 100)}%">
    <div class="gc-ring">${ring(st, g)}</div>
    <div class="gc-body">
      <h3>${esc(g.name)}</h3>
      <div class="gc-amt"><b>${ctx.money(g.account === 'allocated' ? st.current : lei(st.current))}</b><span> of ${ctx.money(st.target)}</span></div>
      <div class="gc-ms">${[25, 50, 75, 100].map((m) => `<span class="${st.milestone >= m ? 'on' : ''}">${m}%</span>`).join('')}</div>
      <p class="gc-msg">${esc(M.goalMessage(st))}</p>
      <p class="muted small" style="margin:0">${when} · counts ${esc(sourceLabel(g))}</p>
      ${dl}
      ${!g.doneAt ? `<button type="button" class="btn sm gc-add" data-act="goal-allocate" data-id="${esc(g.id)}">Reserve money</button>` : ''}
      ${g.account === 'manual' && !done ? `<button type="button" class="btn sm gc-add" data-act="goal-money" data-id="${esc(g.id)}">+ Add money</button>` : ''}
    </div>
  </article>`;
}

export function view() {
  const { state } = ctx;
  const today = todayISO();
  const goals = state.goals || [];
  const active = goals.filter((g) => !g.doneAt);
  const finished = goals.filter((g) => g.doneAt);
  const stats = active.map((g) => ({ g, st: M.goalStatus(state, today, g) }));
  const allocation = M.goalAllocationSummary(state);
  const saved = allocation.reserved;
  const near = stats.filter((x) => x.st.ratio < 1).sort((a, b) => b.st.ratio - a.st.ratio)[0];
  return `<header class="top"><div><h1>Goals</h1><div class="sub">What you're saving for, filling up by itself</div></div>
    <div class="btns top-btns"><button class="btn" data-act="goal-allocate">Allocate money</button><button class="btn primary" data-act="goal-new">+ New goal</button></div></header>
  <section class="hero">
    <div class="hero-main">
      <div class="label">Reserved for goals</div>
      <div class="big">${ctx.bigMoney(saved)}</div>
      <p class="muted" style="margin:0">${ctx.money(allocation.unallocated)} unallocated · cash and bank balances</p>
      <p class="muted small">Balance-tracking and manual goals are shown below; their balances are not added to reserved money.</p>
    </div>
    <div class="hero-month">
      <div class="label">Next up</div>
      ${near ? `<p class="g-next"><span>${esc(near.g.emoji || '🎯')}</span><b>${esc(near.g.name)}</b> is ${Math.round(near.st.ratio * 100)}% there. ${ctx.money(lei(near.st.remaining))} to go.</p>` : '<p class="muted">No open goals.</p>'}
      <div class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <div class="stat"><span class="k">Goals</span><b>${active.length}</b></div>
        <div class="stat"><span class="k">Reached</span><b class="gold">${finished.length + stats.filter((x) => x.st.ratio >= 1).length}</b></div>
      </div>
    </div>
  </section>
  ${allocationCard()}
  ${active.length ? `<div class="goal-grid">${active.map((g) => goalCard(g, today)).join('')}<button type="button" class="goal-add" data-act="goal-new"><span>+</span>New goal</button></div>`
    : `<div class="empty"><b>No goals yet</b>An emergency fund is a great first one: six months of your usual spending, kept in your savings.<div class="btns" style="justify-content:center;margin-top:12px"><button class="btn primary" data-act="goal-new">Set a goal</button></div></div>`}
  ${finished.length ? `<h2 class="section-h">Reached 🎉</h2><div class="goal-grid">${finished.map((g) => goalCard(g, today)).join('')}</div>` : ''}`;
}

// Small version for the Home dashboard.
export function homeCard({ featured = false } = {}) {
  const g = M.mainGoal(ctx.state);
  const st = M.goalStatus(ctx.state, todayISO(), g);
  const line = st.ratio >= 1 ? 'Goal reached. Time to set a bigger one.' : st.eta ? `At your pace you get there in <b>${monthLabel(st.eta)}</b>.` : esc(M.goalMessage(st));
  if (featured) return `<section class="card goal-feature theme-${esc(g.theme || 'gold')}" aria-label="Main goal">
    <div class="gc-ring">${ring(st, g)}</div><div class="goal-feature-body"><span class="label">Your main goal</span>
    <h2>${esc(g.name)}</h2><div class="gc-amt"><b>${ctx.money(g.account === 'allocated' ? st.current : lei(st.current))}</b><span> of ${ctx.money(st.target)}</span></div>
    <p>${st.target ? `${ctx.money(g.account === 'allocated' ? st.remaining : lei(st.remaining))} remaining · ${Math.round(st.ratio * 100)}% complete` : 'Set a target to start tracking your progress.'}</p>
    <span class="muted small">Tracks ${esc(sourceLabel(g))}</span></div>
    <div class="goal-feature-action"><button class="btn" data-go="goals">View goals →</button><p class="muted small">${st.eta && st.ratio < 1 ? `Estimated finish: ${monthLabel(st.eta)}` : esc(M.goalMessage(st))}</p></div></section>`;
  return `<section class="card goal-mini theme-${esc(g.theme || 'gold')}" data-go="goals"><h2>${esc(g.name)} <button class="card-link right" data-go="goals">All goals</button></h2>
    <div class="gm-row"><div class="gc-ring sm">${ring(st, g, 96)}</div>
    <div><div class="gc-amt"><b>${ctx.money(g.account === 'allocated' ? st.current : lei(st.current))}</b><span> of ${ctx.money(st.target)}</span></div><p class="gc-msg" style="margin:6px 0 0">${line}</p></div></div></section>`;
}

export function otherGoalsCard() {
  const main = M.mainGoal(ctx.state);
  const others = (ctx.state.goals || []).filter((g) => g.id !== main.id && !g.doneAt && !g.archived);
  if (!others.length) return '';
  return `<section class="card"><h2>Other goals <button class="card-link right" data-go="goals">All goals</button></h2>${others.map((g) => {
    const st = M.goalStatus(ctx.state, todayISO(), g);
    return `<button class="other-goal" data-act="goal-open" data-id="${esc(g.id)}"><span><b>${esc(g.name)}</b><small>${ctx.money(g.account === 'allocated' ? st.remaining : lei(st.remaining))} remaining</small></span><b>${Math.round(st.ratio * 100)}%</b></button>`;
  }).join('')}</section>`;
}

// ---------- Celebrations ----------

export function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  box.setAttribute('aria-hidden', 'true');
  const colors = ['var(--gold)', 'var(--c1)', 'var(--c3)', 'var(--c5)', 'var(--c7)', 'var(--c2)'];
  box.innerHTML = Array.from({ length: 70 }, (_, i) => `<i style="--x:${(Math.random() * 100).toFixed(1)}vw;--d:${(Math.random() * 0.6).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg;--s:${(0.8 + Math.random() * 0.8).toFixed(2)};background:${colors[i % colors.length]}"></i>`).join('');
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 3200);
}

// Called after each render: passing 25/50/75/100% gets a celebration once.
export function checkMilestones() {
  const { state } = ctx;
  if (ctx.DEMO || state._sealed) return;
  const today = todayISO();
  let changed = false;
  for (const g of state.goals || []) {
    if (g.doneAt || !g.target) continue;
    const { milestone } = M.goalStatus(state, today, g);
    if (g.lastMilestone == null) { g.lastMilestone = milestone; changed = true; continue; }
    if (milestone > g.lastMilestone) {
      g.lastMilestone = milestone;
      changed = true;
      confetti();
      ctx.toast(milestone === 100 ? `🎉 ${g.name}: goal reached!` : `🎉 ${g.name}: ${milestone}% there!`);
      ctx.buddy?.({ mood: 'proud', text: milestone === 100 ? `You reached ${g.name}! I'm so proud 🏆` : `${g.name} is ${milestone}% there! Keep going 🚀` });
    } else if (milestone < g.lastMilestone) { g.lastMilestone = milestone; changed = true; }
  }
  if (changed) ctx.persist();
}

// ---------- Add / edit ----------

function goalSheet(existing = null) {
  const { state } = ctx;
  const today = todayISO();
  const g = existing ? { ...existing } : { emoji: '🎯', name: '', target: 0, account: 'allocated', saved: 0, deadline: null, theme: 'gold', history: [] };
  const accOpts = () => [['allocated', 'Money reserved for this goal'], ['all', 'Track all my money'], ['savings', 'Track my savings accounts'], ...M.activeAccounts(state).map((a) => [a.id, `${a.name} only`]), ['manual', 'Money I add by hand']]
    .map(([v, l]) => `<option value="${esc(v)}" ${g.account === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const html = () => `<div class="grab"></div><h3>${existing ? 'Edit goal' : 'New goal'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="goal-form" novalidate>
      ${existing ? '' : `<div class="picks" role="group" aria-label="Ideas">${TEMPLATES.map((t, i) => `<button type="button" class="pick" data-tpl="${i}">${t.emoji} ${esc(t.name || 'Custom')}</button>`).join('')}</div>`}
      <div class="row2" style="grid-template-columns:72px minmax(0,1fr)">
        <label class="field"><span>Icon</span><input id="g-emoji" type="text" value="${esc(g.emoji)}" maxlength="4" style="text-align:center;font-size:20px"></label>
        <label class="field"><span>Name</span><input id="g-name" type="text" value="${esc(g.name)}" placeholder="e.g. Car, Trip to Italy"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Target (${esc(state.settings.currency)})</span><input id="g-target" type="text" inputmode="decimal" value="${g.target ? esc(centsToPlain(g.target)) : ''}" placeholder="e.g. 50000"></label>
        <label class="field"><span>Deadline (optional)</span><input id="g-deadline" type="date" value="${esc(g.deadline || '')}"></label>
      </div>
      <label class="field"><span>Counts</span><select id="g-account">${accOpts()}</select></label>
      ${g.account === 'manual' ? `<label class="field"><span>Already saved</span><input id="g-saved" type="text" inputmode="decimal" value="${esc(centsToPlain(g.saved || 0))}"></label>` : ''}
      <div class="field"><span class="lbl">Color</span><div class="theme-picks">${CARD_THEMES.filter((t) => !['silver'].includes(t.id)).map((t) => `<button type="button" class="theme-pick theme-${t.id}" data-theme="${t.id}" aria-label="${t.name}" aria-pressed="${g.theme === t.id}"></button>`).join('')}</div></div>
      <p class="lock-msg" id="g-msg" role="alert"></p>
      <div class="btns">
        ${existing ? '<button type="button" class="btn danger" data-g="delete">Delete</button>' : ''}
        ${existing && !existing.doneAt ? '<button type="button" class="btn" data-g="done">Mark as reached</button>' : ''}
        ${existing?.doneAt ? '<button type="button" class="btn" data-g="reopen">Open again</button>' : ''}
        <button type="submit" class="btn primary">${existing ? 'Save' : 'Create goal'}</button>
      </div>
    </form>`;
  const read = (sheet) => {
    const v = (id) => sheet.querySelector(id)?.value;
    g.emoji = (v('#g-emoji') || '🎯').trim() || '🎯';
    g.name = (v('#g-name') || '').trim();
    g.target = evalAmount(v('#g-target')) || 0;
    g.deadline = v('#g-deadline') || null;
    g.account = v('#g-account');
    if (sheet.querySelector('#g-saved')) g.saved = evalAmount(v('#g-saved')) || 0;
  };
  ctx.openSheet('', (sheet) => {
    const paint = () => { sheet.innerHTML = html(); };
    paint();
    if (!existing) sheet.querySelector('#g-name').focus();
    sheet.addEventListener('change', (e) => { if (e.target.id === 'g-account') { read(sheet); paint(); } });
    sheet.addEventListener('click', (e) => {
      const tpl = e.target.closest('[data-tpl]');
      if (tpl) {
        read(sheet);
        const t = TEMPLATES[tpl.dataset.tpl];
        Object.assign(g, { emoji: t.emoji, name: t.name, theme: t.theme, ...(t.account ? { account: t.account } : {}) });
        if (t.emergency) g.target = M.emergencyTarget(state, today);
        paint();
        sheet.querySelector(t.name ? '#g-target' : '#g-name').focus();
        return;
      }
      const th = e.target.closest('.theme-pick[data-theme]');
      if (th) { g.theme = th.dataset.theme; for (const b of sheet.querySelectorAll('.theme-pick')) b.setAttribute('aria-pressed', String(b === th)); return; }
      const b = e.target.closest('[data-g]');
      if (!b) return;
      const live = state.goals.find((x) => x.id === existing.id);
      if (b.dataset.g === 'delete') {
        for (const a of (state.goalAllocations || []).filter((a) => a.goalId === existing.id)) M.releaseGoalAllocation(state, a.id, a.amount);
        state.goals = state.goals.filter((x) => x.id !== existing.id);
        state.deleted[existing.id] = Date.now();
        ctx.commit();
        ctx.closeSheet();
        ctx.toast(`${existing.name} deleted`);
      } else if (b.dataset.g === 'done') {
        Object.assign(live, { doneAt: Date.now(), updatedAt: Date.now() });
        ctx.commit();
        ctx.closeSheet();
        confetti();
        ctx.toast(`🎉 ${existing.name} reached. Well done!`);
      } else if (b.dataset.g === 'reopen') {
        Object.assign(live, { doneAt: null, updatedAt: Date.now() });
        ctx.commit();
        ctx.closeSheet();
      }
    });
    sheet.addEventListener('submit', (e) => {
      e.preventDefault();
      read(sheet);
      const msg = sheet.querySelector('#g-msg');
      if (!g.name) { msg.textContent = 'Give the goal a name.'; return; }
      if (!(g.target > 0)) { msg.textContent = 'Set a target bigger than 0.'; return; }
      if (existing && g.account !== 'allocated' && (state.goalAllocations || []).some((a) => a.goalId === existing.id)) { msg.textContent = 'Release this goal’s reservations before changing how it is tracked.'; return; }
      const now = Date.now();
      const list = state.goals || (state.goals = []);
      if (existing) Object.assign(list.find((x) => x.id === existing.id), g, { updatedAt: now });
      else list.push({ ...g, id: `g-${M.uid()}`, createdAt: now, updatedAt: now, doneAt: null });
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(existing ? 'Goal saved' : `${g.emoji} ${g.name}: let's go!`);
    });
  });
}

function moneySheet(goal) {
  ctx.openSheet(`<h3>${esc(goal.emoji)} ${esc(goal.name)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="gm-form" novalidate>
      <div class="amount-input"><input id="gm-amt" type="text" inputmode="decimal" placeholder="0" aria-label="Amount"><span class="cur">${esc(ctx.state.settings.currency)}</span></div>
      <p class="muted small">Put money aside for this goal. Use a minus (e.g. -500) if you took some out.</p>
      <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Add</button></div>
    </form>`, (sheet) => {
    sheet.querySelector('#gm-amt').focus();
    sheet.querySelector('#gm-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = sheet.querySelector('#gm-amt').value.trim();
      const v = (raw.startsWith('-') ? -1 : 1) * (evalAmount(raw.replace(/^-/, '')) || 0);
      if (!v) return;
      const live = ctx.state.goals.find((x) => x.id === goal.id);
      live.saved = Math.max(0, (live.saved || 0) + v);
      live.history = [...(live.history || []), { date: todayISO(), amount: v }].slice(-200);
      live.updatedAt = Date.now();
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(v > 0 ? `+${ctx.money(v)} for ${goal.name}` : `${ctx.money(v)} from ${goal.name}`);
    });
  });
}

function allocationCard() {
  const s = M.goalAllocationSummary(ctx.state);
  const rows = ctx.state.goalAllocations || [];
  return `<section class="card goal-reservations"><h2>Your reservations</h2>
    ${s.unfunded ? `<p class="allocation-warning" role="status">${ctx.money(s.unfunded)} of requested reservations cannot be funded. Balances or income may have changed, or another device may have allocated the same funds. Review and release the affected reservations below.</p>` : ''}
    ${s.unpriced.length ? '<p class="allocation-warning" role="status">Some reservations need an exchange rate. Update Rates or release those reservations before allocating more.</p>' : ''}
    <p class="muted small">Reserving money labels part of your cash and bank balances. It does not create an expense or transfer. Crypto and accounts without exchange rates are excluded. Reached goals keep their reservations until you release them.</p>
    ${rows.length ? `<details><summary>Manage ${rows.length} reservations</summary>${rows.map((a) => {
      const goal = (ctx.state.goals || []).find((g) => g.id === a.goalId);
      const income = a.incomeId && ctx.state.tx.find((t) => t.id === a.incomeId);
      return `<div class="reservation-row"><span><b>${esc(goal?.name || 'Deleted goal')}</b><small>${esc(a.date)} · ${a.incomeId ? esc(income?.note || (income ? 'Income' : 'Deleted income')) : 'Existing funds'}</small><small>Funded: ${ctx.money(s.effectiveById[a.id] || 0)}</small></span><span class="money">${formatAllocation(a)}</span><button class="btn sm" data-act="goal-release" data-id="${esc(a.id)}">Release</button></div>`;
    }).join('')}</details>` : '<p class="muted small">No money reserved yet. Allocate existing funds or part of an income to your goals.</p>'}</section>`;
}

function formatAllocation(a) { return formatMoney(a.amount, a.currency || ctx.state.settings.currency); }

export function openAllocationSheet(incomeId = null, goalId = null) {
  const { state } = ctx;
  const goals = (state.goals || []).filter((g) => !g.doneAt && !g.archived);
  if (!goals.length) { ctx.toast('Create a goal first.'); return; }
  const summary = M.goalAllocationSummary(state);
  const incomes = M.sortTx(state.tx.filter((t) => t.type === 'income' && !t.loan));
  ctx.openSheet(`<h3>Allocate money to goals <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="goal-allocation-form" novalidate><label class="field"><span>Allocate from</span><select id="allocation-source"><option value="">Existing unallocated funds</option>${incomes.map((t) => `<option value="${esc(t.id)}" ${incomeId === t.id ? 'selected' : ''}>${esc(t.date)} · ${esc(t.note || 'Income')} · ${ctx.money(Math.max(0, M.B(t) - (summary.byIncome[t.id] || 0)))} left</option>`).join('')}</select></label>
    <p class="muted small">All amounts are in ${esc(state.settings.currency)}. Foreign income uses its recorded exchange rate. Allocating to a balance-tracking goal switches its progress to reserved money; existing balances are not automatically reserved.</p>
    ${goals.map((g) => `<label class="allocation-input"><span><b>${esc(g.emoji || '🎯')} ${esc(g.name)}</b><small>${g.account === 'allocated' ? `${ctx.money(summary.byGoal[g.id] || 0)} reserved` : `Currently tracks ${esc(sourceLabel(g))}`}</small></span><input type="text" inputmode="decimal" data-allocation-goal="${esc(g.id)}" placeholder="0" aria-label="Amount for ${esc(g.name)}"></label>`).join('')}
    <div id="allocation-totals" class="allocation-totals" aria-live="polite"></div><p id="allocation-error" class="lock-msg" role="alert"></p><div class="btns"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary" id="allocation-save">Reserve money</button></div></form>`, (sheet) => {
      const read = () => [...sheet.querySelectorAll('[data-allocation-goal]')].filter((el) => el.value.trim()).map((el) => ({ goalId: el.dataset.allocationGoal, amount: evalAmount(el.value) }));
      const update = () => {
        const s = M.goalAllocationSummary(ctx.state);
        const id = sheet.querySelector('#allocation-source').value;
        const income = id && ctx.state.tx.find((t) => t.id === id && t.type === 'income' && !t.loan);
        const limit = Math.min(s.unallocated, id ? Math.max(0, (income ? M.B(income) : 0) - (s.byIncome[id] || 0)) : s.unallocated);
        const entries = read(), valid = entries.every((e) => Number.isSafeInteger(e.amount) && e.amount > 0);
        const total = entries.reduce((sum, e) => sum + (e.amount || 0), 0);
        sheet.querySelector('#allocation-totals').textContent = `Available: ${ctx.money(limit)} · Reserving: ${ctx.money(total)} · Remaining: ${ctx.money(Math.max(0, limit - total))}`;
        sheet.querySelector('#allocation-save').disabled = !entries.length || !valid || total > limit || s.unfunded > 0 || s.unpriced.length > 0;
        sheet.querySelector('#allocation-error').textContent = s.unpriced.length ? 'Update exchange rates for existing reservations first.' : s.unfunded ? 'Review unfunded reservations on Goals before allocating more.' : !valid ? 'Enter positive amounts.' : total > limit ? 'The total exceeds the available amount.' : '';
      };
      sheet.addEventListener('input', update); sheet.addEventListener('change', update);
      sheet.querySelector('#goal-allocation-form').addEventListener('submit', (e) => {
        e.preventDefault();
        try { M.allocateToGoals(ctx.state, read(), { incomeId: sheet.querySelector('#allocation-source').value || null, date: todayISO() }); ctx.commit(); ctx.closeSheet(); ctx.toast('Money reserved for your goals'); }
        catch (err) { sheet.querySelector('#allocation-error').textContent = err.message; }
      });
      update();
      (goalId ? [...sheet.querySelectorAll('[data-allocation-goal]')].find((el) => el.dataset.allocationGoal === goalId) : sheet.querySelector('[data-allocation-goal]'))?.focus();
    });
}

function releaseSheet(id) {
  const a = (ctx.state.goalAllocations || []).find((a) => a.id === id);
  if (!a) return;
  ctx.openSheet(`<h3>Release reserved money <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3><form id="release-allocation-form"><label class="field"><span>Amount (${esc(a.currency || ctx.state.settings.currency)})</span><input id="release-allocation-amount" type="text" inputmode="decimal" value="${esc(centsToPlain(a.amount))}"></label><p class="muted small">This money becomes unallocated again. Your account balances stay the same.</p><p id="release-allocation-error" class="lock-msg" role="alert"></p><div class="btns"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Release</button></div></form>`, (sheet) => {
    sheet.querySelector('#release-allocation-form').addEventListener('submit', (e) => {
      e.preventDefault();
      try { M.releaseGoalAllocation(ctx.state, id, evalAmount(sheet.querySelector('#release-allocation-amount').value)); ctx.commit(); ctx.closeSheet(); ctx.toast('Reservation released'); }
      catch (err) { sheet.querySelector('#release-allocation-error').textContent = err.message; }
    });
    sheet.querySelector('#release-allocation-amount').focus();
  });
}

export function onClick(act, el) {
  const find = () => (ctx.state.goals || []).find((g) => g.id === el.dataset.id);
  if (act === 'goal-new') { goalSheet(); return true; }
  if (act === 'goal-allocate') { openAllocationSheet(null, el.dataset.id); return true; }
  if (act === 'goal-release') { releaseSheet(el.dataset.id); return true; }
  if (act === 'goal-money') { const g = find(); if (g) moneySheet(g); return true; }
  if (act === 'goal-open') { const g = find(); if (g) goalSheet(g); return true; }
  return false;
}
