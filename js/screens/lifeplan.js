// Plan → 🧭 Life planner (numbers: js/lifeplan.js). The sliders update the answer, the chart and
// each goal live while you drag; letting go saves them (synced).

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { evalAmount, formatMoney } from '../money.js';
import { todayISO, monthLabel, addMonths, monthKey } from '../dates.js';
import { lifeGoals, planInputs, project, addGoal, updateGoal, removeGoal, setInput } from '../lifeplan.js';

const live = {}; // slider values while dragging (not saved yet)
const draft = { name: '', amount: '', month: '' };

const SLIDERS = [
  { key: 'income', label: 'Comes in a month', unit: 'money', min: 0, step: 50000 },
  { key: 'spending', label: 'You spend a month', unit: 'money', min: 0, step: 50000 },
  { key: 'prices', label: 'Prices rise a year', unit: '%', min: 0, max: 15, step: 0.5 },
  { key: 'raise', label: 'Your income grows a year', unit: '%', min: 0, max: 20, step: 0.5 },
  { key: 'ret', label: 'Your savings earn a year', unit: '%', min: 0, max: 12, step: 0.5 },
  { key: 'keep', label: 'Always keep aside', unit: 'months', min: 0, max: 12, step: 1 },
];

function inputs() {
  const base = planInputs(ctx.state, todayISO());
  return { ...base, ...live };
}

const cur = () => ctx.state.settings.currency || 'MDL';
const fm = (c, o) => formatMoney(Math.round(c / 100) * 100, cur(), o);
const fc = (c) => formatMoney(Math.round(c / 10000) * 10000, cur(), { compact: true });
const mon = (k) => monthLabel(k);

function chart(p) {
  const W = 1000;
  const H = 300;
  const L = 92;
  const T = 24;
  const B = 34;
  const ms = p.months;
  const vals = ms.flatMap((m) => [m.money, m.keep]);
  const max = Math.max(1, ...vals);
  const min = Math.min(0, ...vals);
  const x = (i) => L + (i / Math.max(1, ms.length - 1)) * (W - L - 12);
  const y = (v) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
  const line = ms.map((m, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(m.money).toFixed(1)}`).join(' ');
  const area = `${line} L${x(ms.length - 1).toFixed(1)} ${y(min).toFixed(1)} L${x(0).toFixed(1)} ${y(min).toFixed(1)} Z`;
  const keep = ms.map((m, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(m.keep).toFixed(1)}`).join(' ');
  const years = ms.map((m, i) => ({ m, i })).filter(({ m }) => m.key.endsWith('-01'));
  const step = Math.ceil(years.length / 10) || 1;
  const ticks = years.filter((_, j) => j % step === 0).map(({ m, i }) => `<text x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle">${m.key.slice(0, 4)}</text><line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${T}" y2="${H - B}" class="lp-grid"></line>`).join('');
  const marks = p.goals.map((g) => {
    const i = ms.findIndex((m) => m.key === g.month);
    if (i < 0) return '';
    const cy = y(g.before);
    return `<g class="lp-mark ${g.fits ? 'ok' : 'bad'}"><title>${esc(g.name)}, ${esc(mon(g.month))}: ${esc(fm(g.cost))}${g.fits ? ' — fits' : ` — short by ${esc(fm(g.short))}`}</title>
      <line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${cy.toFixed(1)}" y2="${y(g.after).toFixed(1)}" class="lp-drop"></line>
      <circle cx="${x(i).toFixed(1)}" cy="${cy.toFixed(1)}" r="8"></circle>
      <text x="${x(i).toFixed(1)}" y="${(cy - 14).toFixed(1)}" text-anchor="middle">${esc(g.name)}</text></g>`;
  }).join('');
  const zero = min < 0 ? `<line x1="${L}" x2="${W - 12}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="lp-zero"></line>` : '';
  return `<svg class="lp-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Your money month by month until ${esc(mon(ms.at(-1).key))}, with your goals marked">
    <defs><linearGradient id="lp-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--gold)" stop-opacity="0.25"></stop><stop offset="1" stop-color="var(--gold)" stop-opacity="0"></stop></linearGradient></defs>
    ${ticks}${zero}
    <text x="${L - 8}" y="${(y(max) + 4).toFixed(1)}" text-anchor="end">${esc(fc(max))}</text>
    <text x="${L - 8}" y="${(y(Math.max(0, min)) + 4).toFixed(1)}" text-anchor="end">${esc(fc(Math.max(0, min)))}</text>
    <path d="${area}" fill="url(#lp-g)"></path>
    <path d="${keep}" class="lp-keep"></path>
    <path d="${line}" class="lp-line"></path>
    ${marks}
  </svg>`;
}

function resultHTML() {
  const today = todayISO();
  const p = project(ctx.state, today, inputs());
  const goals = p.goals;
  const bad = goals.filter((g) => !g.fits);
  const answer = !goals.length
    ? '<h2 class="lp-answer">Add a big goal below to see if the money will be there.</h2>'
    : !bad.length
      ? `<h2 class="lp-answer ok">${goals.length === 1 ? 'It fits.' : goals.length === 2 ? 'Both fit.' : `All ${goals.length} fit.`}</h2><p class="lp-sub">The money is there for each, and you still keep ${esc(String(p.inputs.keep))} month${p.inputs.keep === 1 ? '' : 's'} of spending aside. Lowest point: ${esc(fm(p.lowest.money))} in ${esc(mon(p.lowest.key))}.</p>`
      : `<h2 class="lp-answer">${goals.length - bad.length} of ${goals.length} fit${goals.length - bad.length === 1 ? 's' : ''}.</h2><p class="lp-sub"><b>${esc(bad[0].name)}</b> is short by ${esc(fm(bad[0].short))} in ${esc(mon(bad[0].month))}: put aside about <b>${esc(fm(bad[0].extra))} more a month</b>${bad[0].earliest ? `, or move it to <b>${esc(mon(bad[0].earliest))}</b>` : ''}.${bad.length > 1 ? ` ${bad.length - 1} more below.` : ''}${!bad[0].fitsAlone ? '' : ' On its own it would fit: it clashes with the goals before it.'}</p>`;
  const rows = goals.map((g) => `<tr data-id="${esc(g.id)}" data-testid="lp-row">
      <td><input class="st-in" data-lp-edit="name" value="${esc(g.name)}" aria-label="Goal"></td>
      <td><input class="st-in st-num" data-lp-edit="amount" value="${esc(String(Math.round(g.amount / 100)))}" inputmode="decimal" aria-label="Cost in today's money"></td>
      <td><input class="st-in" type="month" data-lp-edit="month" value="${esc(g.month)}" aria-label="When"></td>
      <td class="lp-status ${g.fits ? 'ok' : 'bad'}">${g.fits ? `✓ Fits · ${esc(fc(g.after))} left after` : `Short by ${esc(fm(g.short))}<br><small>${esc(fm(g.extra))} more a month${g.earliest ? ` · or ${esc(mon(g.earliest))}` : ''}</small>`}<br><small class="muted">costs ${esc(fm(g.cost))} by then</small></td>
      <td class="num"><button type="button" class="icon-btn" data-lp-act="delete" aria-label="Remove ${esc(g.name)}" title="Remove">🗑️</button></td></tr>`).join('');
  const next = addMonths(monthKey(today), 24);
  return `${answer}
    ${goals.length ? `<section class="card lp-card">${chart(p)}<p class="muted small lp-legend"><span class="lp-key line"></span> your money, month by month · <span class="lp-key keep"></span> kept aside (${esc(String(p.inputs.keep))} months of spending) · <span class="lp-key dot ok"></span> fits · <span class="lp-key dot bad"></span> not yet</p></section>` : ''}
    <section class="card lp-card"><h3 class="lp-h3">Your big goals <span class="muted small">(in today's money)</span></h3>
      <div class="st-wrap"><table class="st-table lp-table"><colgroup><col style="width:28%"><col style="width:15%"><col style="width:19%"><col><col style="width:48px"></colgroup><thead><tr><th>Goal</th><th>Costs today</th><th>When</th><th>Will the money be there?</th><th></th></tr></thead><tbody>
      ${rows}
      <tr class="st-new"><td><input class="st-in" data-lp="name" value="${esc(draft.name)}" placeholder="e.g. Apartment down payment" aria-label="New goal"></td>
        <td><input class="st-in st-num" data-lp="amount" value="${esc(draft.amount)}" placeholder="0" inputmode="decimal" aria-label="Cost in today's money"></td>
        <td><input class="st-in" type="month" data-lp="month" value="${esc(draft.month || next)}" min="${esc(monthKey(today))}" aria-label="When"></td>
        <td colspan="2"><button type="button" class="btn primary sm" data-lp-act="add" data-testid="lp-add">Add goal</button></td></tr>
      </tbody></table></div></section>`;
}

function sliderHTML(s, inp) {
  const v = inp[s.key];
  const b = inp.baseline;
  const max = s.unit === 'money' ? Math.max(100000, Math.ceil((Math.max(b.income, b.spending, v) * 2.5) / 100000) * 100000) : s.max;
  const shown = s.unit === 'money' ? fm(v) : s.unit === '%' ? `${String(v).replace('.', ',')}%` : `${v} month${v === 1 ? '' : 's'}`;
  const fromRecords = s.unit === 'money' && b.months ? `<button type="button" class="linkish small" data-lp-reset="${s.key}">from your records: ${esc(fm(s.key === 'income' ? b.income : b.spending))}</button>` : '';
  return `<label class="lp-slider"><span class="lp-sl-top"><span>${esc(s.label)}</span><b data-lp-val="${s.key}">${esc(shown)}</b></span>
    <input type="range" data-lp-slider="${s.key}" min="${s.min}" max="${max}" step="${s.step}" value="${v}" aria-label="${esc(s.label)}">${fromRecords}</label>`;
}

export function tab() {
  const inp = inputs();
  return `<div class="lp" data-testid="life-planner">
    <div class="lp-main" id="lp-result">${resultHTML()}</div>
    <aside class="card lp-side"><h3 class="lp-h3">What if…</h3>
      <p class="muted small" style="margin-top:0">Starts from your last ${inp.baseline.months || 'few'} months and the ${esc(fm(inp.money))} you have now (cards, cash, savings; not crypto). Move them to try another future.</p>
      ${SLIDERS.map((s) => sliderHTML(s, inp)).join('')}
      <p class="muted small" style="margin-bottom:0">A guide, not a promise: real months go up and down.</p>
    </aside>
  </div>`;
}

function label(key, v) {
  const s = SLIDERS.find((x) => x.key === key);
  const el = document.querySelector(`[data-lp-val="${key}"]`);
  if (el) el.textContent = s.unit === 'money' ? fm(v) : s.unit === '%' ? `${String(v).replace('.', ',')}%` : `${v} month${v === 1 ? '' : 's'}`;
}

function add() {
  const amount = evalAmount(draft.amount);
  if (!draft.name.trim()) { ctx.toast('What is the goal? e.g. Apartment down payment'); return; }
  if (!(amount > 0)) { ctx.toast('How much would it cost today?'); return; }
  const month = draft.month || addMonths(monthKey(todayISO()), 24);
  addGoal(ctx.state, { name: draft.name, amount, month }, { id: M.uid() });
  Object.assign(draft, { name: '', amount: '', month: '' });
  ctx.commit();
  ctx.toast('Goal added', 'Undo', () => ctx.undo());
}

let bound = false;
export function init() {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t?.dataset?.lp) { draft[t.dataset.lp] = t.value; return; }
    const key = t?.dataset?.lpSlider;
    if (!key) return;
    live[key] = Number(t.value);
    label(key, live[key]);
    const box = document.getElementById('lp-result');
    if (box) box.innerHTML = resultHTML();
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t?.dataset?.lp) { draft[t.dataset.lp] = t.value; return; }
    const key = t?.dataset?.lpSlider;
    if (key) {
      setInput(ctx.state, key, Number(t.value));
      delete live[key];
      ctx.commit();
      return;
    }
    const field = t?.dataset?.lpEdit;
    if (field) {
      const id = t.closest('tr')?.dataset.id;
      const v = field === 'amount' ? evalAmount(t.value) : t.value.trim();
      if (!id || (field === 'amount' && !(v > 0)) || !v) return;
      updateGoal(ctx.state, id, { [field]: v });
      ctx.commit();
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target?.dataset?.lp) { e.preventDefault(); draft[e.target.dataset.lp] = e.target.value; add(); } });
  document.addEventListener('click', (e) => {
    const r = e.target.closest?.('[data-lp-reset]');
    if (r) { setInput(ctx.state, r.dataset.lpReset, null); ctx.commit(); return; }
    const b = e.target.closest?.('[data-lp-act]');
    if (!b) return;
    if (b.dataset.lpAct === 'add') add();
    else if (b.dataset.lpAct === 'delete') {
      const id = b.closest('tr')?.dataset.id;
      if (id && removeGoal(ctx.state, id)) { ctx.commit(); ctx.toast('Removed', 'Undo', () => ctx.undo()); }
    }
  });
}
