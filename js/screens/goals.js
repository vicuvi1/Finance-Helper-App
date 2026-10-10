// Goals: what you're saving for, each with a ring that fills by itself
// (from all your money, your savings accounts, one account, or what you add
// by hand), milestones, an ETA at your pace, what a deadline needs per
// month, a line of encouragement, and confetti when you pass a milestone.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { todayISO, monthLabel, dayLabel } from '../dates.js';
import { evalAmount, centsToPlain } from '../money.js';
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
const sourceLabel = (g) => (g.account === 'manual' ? 'added by hand' : g.account === 'savings' ? 'your savings accounts' : g.account === 'all' || !g.account ? 'all your money' : M.account(ctx.state, g.account)?.name || 'an account');

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
      <div class="gc-amt"><b>${ctx.money(lei(st.current))}</b><span> of ${ctx.money(st.target)}</span></div>
      <div class="gc-ms">${[25, 50, 75, 100].map((m) => `<span class="${st.milestone >= m ? 'on' : ''}">${m}%</span>`).join('')}</div>
      <p class="gc-msg">${esc(M.goalMessage(st))}</p>
      <p class="muted small" style="margin:0">${when} · counts ${esc(sourceLabel(g))}</p>
      ${dl}
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
  const saved = stats.reduce((a, x) => a + Math.min(x.st.current, x.st.target), 0);
  const target = stats.reduce((a, x) => a + x.st.target, 0);
  const near = stats.filter((x) => x.st.ratio < 1).sort((a, b) => b.st.ratio - a.st.ratio)[0];
  return `<header class="top"><div><h1>Goals</h1><div class="sub">What you're saving for, filling up by itself</div></div>
    <button class="btn primary" data-act="goal-new">+ New goal</button></header>
  <section class="hero">
    <div class="hero-main">
      <div class="label">Saved toward your goals</div>
      <div class="big">${ctx.bigMoney(lei(saved))}</div>
      <p class="muted" style="margin:0">${target ? `of ${ctx.money(target)} · ${Math.round((saved / target) * 100)}% overall` : 'Set your first goal and watch it fill up.'}</p>
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
  ${active.length ? `<div class="goal-grid">${active.map((g) => goalCard(g, today)).join('')}<button type="button" class="goal-add" data-act="goal-new"><span>+</span>New goal</button></div>`
    : `<div class="empty"><b>No goals yet</b>An emergency fund is a great first one: six months of your usual spending, kept in your savings.<div class="btns" style="justify-content:center;margin-top:12px"><button class="btn primary" data-act="goal-new">Set a goal</button></div></div>`}
  ${finished.length ? `<h2 class="section-h">Reached 🎉</h2><div class="goal-grid">${finished.map((g) => goalCard(g, today)).join('')}</div>` : ''}`;
}

// Small version for the Home dashboard.
export function homeCard() {
  const g = M.mainGoal(ctx.state);
  const st = M.goalStatus(ctx.state, todayISO(), g);
  const line = st.ratio >= 1 ? 'Goal reached. Time to set a bigger one.' : st.eta ? `At your pace you get there in <b>${monthLabel(st.eta)}</b>.` : esc(M.goalMessage(st));
  return `<section class="card goal-mini theme-${esc(g.theme || 'gold')}" data-go="goals"><h2>${esc(g.name)} <button class="card-link right" data-go="goals">All goals</button></h2>
    <div class="gm-row"><div class="gc-ring sm">${ring(st, g, 96)}</div>
    <div><div class="gc-amt"><b>${ctx.money(lei(st.current))}</b><span> of ${ctx.money(st.target)}</span></div><p class="gc-msg" style="margin:6px 0 0">${line}</p></div></div></section>`;
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
    } else if (milestone < g.lastMilestone) { g.lastMilestone = milestone; changed = true; }
  }
  if (changed) ctx.persist();
}

// ---------- Add / edit ----------

function goalSheet(existing = null) {
  const { state } = ctx;
  const today = todayISO();
  const g = existing ? { ...existing } : { emoji: '🎯', name: '', target: 0, account: 'all', saved: 0, deadline: null, theme: 'gold', history: [] };
  const accOpts = () => [['all', 'All my money'], ['savings', 'My savings accounts'], ...M.activeAccounts(state).map((a) => [a.id, `${a.name} only`]), ['manual', 'Money I add by hand']]
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

export function onClick(act, el) {
  const find = () => (ctx.state.goals || []).find((g) => g.id === el.dataset.id);
  if (act === 'goal-new') { goalSheet(); return true; }
  if (act === 'goal-money') { const g = find(); if (g) moneySheet(g); return true; }
  if (act === 'goal-open') { const g = find(); if (g) goalSheet(g); return true; }
  return false;
}
