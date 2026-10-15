// Plan & Subscriptions: Manage recurring subscriptions, AI tools, scheduled bills,
// and cash flow. Includes interactive What-If simulator, category breakdowns, and quick presets.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import * as R from '../recurring.js';
import { todayISO, dayLabel, daysBetween, addDays, monthKey, monthLabel, daysInMonth } from '../dates.js';
import { evalAmount, formatMoney, centsToPlain } from '../money.js';
import { convert } from '../fx.js';
import { forecast } from '../forecast.js';
import { lineChart } from '../charts.js';

const initial = (name) => esc((String(name).match(/\p{L}|\p{N}/u) || ['•'])[0].toUpperCase());
const catOf = (id) => M.category(ctx.state, id) || { name: 'Other', emoji: '•' };
const titleOf = (r) => r.note || catOf(r.category).name;
const freq = (r) => R.FREQS.find((f) => f.id === r.every) || R.FREQS[2];
const base = () => ctx.state.settings.currency;
const inBase = (r, cents = r.amount) => (r.currency === base() ? cents : (convert(cents, r.currency, base(), ctx.state.rates) ?? cents));
const sum = (items) => items.reduce((a, x) => a + (inBase(x.rule) || 0), 0);
const when = (date, today) => {
  const d = daysBetween(today, date);
  return d === 0 ? 'today' : d === 1 ? 'tomorrow' : d < 0 ? `${-d} day${d === -1 ? '' : 's'} ago` : `in ${d} days`;
};
const ruleMoney = (r) => (r.type === 'income' ? formatMoney(r.amount, r.currency, { sign: true }) : formatMoney(-r.amount, r.currency));
const txId = (rule, date) => `rec-${rule.id}-${date}`;
const shortDay = (iso) => dayLabel(iso).replace(/^\w+, /, '');

export const PRESET_SUBS = [
  { name: 'ChatGPT Plus', amount: 2000, currency: 'USD', every: 'month', emoji: '🤖', group: 'ai', cat: 'work' },
  { name: 'Claude Pro', amount: 2000, currency: 'USD', every: 'month', emoji: '🧠', group: 'ai', cat: 'work' },
  { name: 'Cursor Pro', amount: 2000, currency: 'USD', every: 'month', emoji: '💻', group: 'ai', cat: 'work' },
  { name: 'GitHub Copilot', amount: 1000, currency: 'USD', every: 'month', emoji: '🐙', group: 'ai', cat: 'work' },
  { name: 'Midjourney', amount: 1000, currency: 'USD', every: 'month', emoji: '🎨', group: 'ai', cat: 'work' },
  { name: 'Perplexity Pro', amount: 2000, currency: 'USD', every: 'month', emoji: '🔍', group: 'ai', cat: 'work' },
  { name: 'Netflix', amount: 1199, currency: 'EUR', every: 'month', emoji: '🎬', group: 'media', cat: 'fun' },
  { name: 'Spotify Premium', amount: 999, currency: 'EUR', every: 'month', emoji: '🎵', group: 'media', cat: 'fun' },
  { name: 'YouTube Premium', amount: 1399, currency: 'USD', every: 'month', emoji: '▶️', group: 'media', cat: 'fun' },
  { name: 'Home Fiber Internet', amount: 20000, currency: 'MDL', every: 'month', emoji: '🌐', group: 'utilities', cat: 'home' },
  { name: 'Mobile Carrier', amount: 15000, currency: 'MDL', every: 'month', emoji: '📱', group: 'utilities', cat: 'home' },
  { name: 'Gym Membership', amount: 65000, currency: 'MDL', every: 'month', emoji: '🏋️', group: 'health', cat: 'care' },
  { name: 'iCloud+ Storage', amount: 299, currency: 'USD', every: 'month', emoji: '☁️', group: 'utilities', cat: 'home' },
];

export function getPresetSubs(state) {
  const custom = state?.settings?.presetPrices || {};
  return PRESET_SUBS.map((p) => {
    const c = custom[p.name];
    if (c && (Number.isInteger(c.amount) || c.currency)) {
      return {
        ...p,
        amount: Number.isInteger(c.amount) ? c.amount : p.amount,
        currency: c.currency || p.currency,
        isCustom: true,
      };
    }
    return { ...p, isCustom: false };
  });
}

export function formatPresetPrice(p) {
  if (!p) return '';
  const val = p.currency === 'MDL' ? (p.amount / 100) : centsToPlain(p.amount);
  if (p.currency === 'MDL') return `${val} MDL`;
  if (p.currency === 'EUR') return `€${val}`;
  if (p.currency === 'USD') return `$${val}`;
  return `${val} ${p.currency}`;
}

export function setPresetPrice(state, name, amountInCents, currency, now = Date.now()) {
  if (!state) return;
  if (!state.settings) state.settings = {};
  if (!state.settings.presetPrices) state.settings.presetPrices = {};
  const def = PRESET_SUBS.find((p) => p.name === name);
  const targetCur = currency || def?.currency || 'USD';
  if (def && def.amount === amountInCents && def.currency === targetCur) {
    delete state.settings.presetPrices[name];
  } else {
    state.settings.presetPrices[name] = {
      amount: amountInCents,
      currency: targetCur,
      updatedAt: now,
    };
  }
  state.settings.updatedAt = now;
}

export function resetPresetPrice(state, name = null, now = Date.now()) {
  if (state?.settings?.presetPrices) {
    if (name) {
      delete state.settings.presetPrices[name];
    } else {
      state.settings.presetPrices = {};
    }
    state.settings.updatedAt = now;
  }
}

export function getAvailableCurrencies(state) {
  const set = new Set(['USD', 'EUR', 'MDL', 'RON', 'GBP', 'CHF', 'CAD', 'UAH', 'PLN']);
  if (state?.settings?.currency) set.add(state.settings.currency);
  for (const a of state?.settings?.accounts || []) {
    if (a.currency) set.add(a.currency);
  }
  return [...set];
}

export function openEditPresetPriceSheet(name) {
  const { state } = ctx;
  const presets = getPresetSubs(state);
  const p = presets.find((x) => x.name === name) || PRESET_SUBS.find((x) => x.name === name);
  if (!p) return;
  const def = PRESET_SUBS.find((x) => x.name === name) || p;
  const curOptions = getAvailableCurrencies(state);
  if (!curOptions.includes(p.currency)) curOptions.push(p.currency);

  let cur = p.currency;
  let amtText = centsToPlain(p.amount);

  const html = () => `
    <div class="grab"></div>
    <form id="preset-price-form" novalidate>
      <h3>Edit Preset Price · ${p.emoji} ${esc(p.name)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
      <p class="muted small" style="margin-top:-4px; margin-bottom:12px;">Customize the default price and billing currency when quick-adding this subscription.</p>
      
      <div class="amount-input">
        <input id="preset-sheet-amt" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(amtText)}" aria-label="Price">
        <span class="cur" id="preset-sheet-cur-label">${esc(cur)}</span>
      </div>

      <div class="row2" style="margin-top:12px;">
        <label class="field">
          <span>Billing Currency</span>
          <select id="preset-sheet-cur">
            ${curOptions.map((c) => `<option value="${c}" ${c === cur ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Original Default</span>
          <input type="text" disabled value="${formatPresetPrice(def)}" style="opacity:0.75; cursor:not-allowed;">
        </label>
      </div>

      <p class="lock-msg" id="preset-sheet-msg" role="alert"></p>

      <div class="btns" style="margin-top:16px;">
        ${p.isCustom ? `<button type="button" class="btn" id="preset-sheet-reset-btn" style="color:var(--c-danger, #ef4444);">↺ Reset to default</button>` : ''}
        <button type="submit" class="btn primary">Save Price</button>
      </div>
    </form>
  `;

  ctx.openSheet('', (sheet) => {
    sheet.innerHTML = html();
    const amtInput = sheet.querySelector('#preset-sheet-amt');
    amtInput?.focus();
    amtInput?.select();

    sheet.querySelector('#preset-sheet-cur')?.addEventListener('change', (e) => {
      cur = e.target.value;
      const lbl = sheet.querySelector('#preset-sheet-cur-label');
      if (lbl) lbl.textContent = cur;
    });

    sheet.querySelector('#preset-sheet-reset-btn')?.addEventListener('click', () => {
      resetPresetPrice(state, name);
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(`Reset ${p.name} back to default price`);
      ctx.render();
    });

    sheet.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = sheet.querySelector('#preset-sheet-amt')?.value;
      const amount = evalAmount(val);
      const msg = sheet.querySelector('#preset-sheet-msg');
      if (amount == null || amount < 0) {
        if (msg) msg.textContent = 'Please enter a valid price.';
        return;
      }
      setPresetPrice(state, name, amount, cur);
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(`Updated ${p.name} price to ${formatPresetPrice({ amount, currency: cur })}`);
      ctx.render();
    });
  });
}

export function getSubGroup(rule, categoryName = '') {
  const note = String(rule.note || '').toLowerCase();
  const cat = String(categoryName || '').toLowerCase();
  if (/chatgpt|claude|openai|cursor|copilot|midjourney|perplexity|anthropic|runway|elevenlabs|deepseek|hugging|mistral|suno|kling|ideogram|\bai\b|llm|gpt/i.test(note)) {
    return { id: 'ai', label: 'AI & Tools', emoji: '🤖', color: 'var(--c7)' };
  }
  if (/netflix|spotify|youtube|disney|apple tv|hbo|prime|music|steam|playstation|game|sub|tv|cinema/i.test(note) || /entertain|media|film|movie|distract|fun/i.test(cat)) {
    return { id: 'media', label: 'Media & Streaming', emoji: '🎬', color: 'var(--c5)' };
  }
  if (/internet|phone|fiber|orange|moldtelecom|moldcell|vodafone|wifi|t-mobile|mobile|telecom|server|domain|hosting|cloud|icloud|google one|aws|vps|digitalocean/i.test(note) || /utilit|bill|net|tel/i.test(cat)) {
    return { id: 'utilities', label: 'Utilities & Cloud', emoji: '⚡', color: 'var(--c1)' };
  }
  if (/rent|mortgage|apartment|house|parking|cleaning|maintenance|chirie|gaz|electric|caldura|ap[aă]|intretinere/i.test(note) || /home|house|living|locuint/i.test(cat)) {
    return { id: 'living', label: 'Housing & Living', emoji: '🏠', color: 'var(--c2)' };
  }
  if (/gym|fitness|sport|medical|doctor|supplement|spa|pool|antren|sanatate/i.test(note) || /health|care|sport/i.test(cat)) {
    return { id: 'health', label: 'Health & Fitness', emoji: '🏋️', color: 'var(--c3)' };
  }
  return { id: 'other', label: 'Other Recurring', emoji: '🔁', color: 'var(--c4)' };
}

function itemRow(it, today, { due = false } = {}) {
  const r = it.rule;
  return `<div class="tx rec-row">
    <span class="av" style="--c:${ctx.catColor(r.category)}" aria-hidden="true">${initial(catOf(r.category).name)}</span>
    <button class="t rec-open" data-act="rec-log-edit" data-id="${esc(r.id)}" data-date="${it.date}"><b>${esc(titleOf(r))}${due ? ' <span class="pill pill-out">due</span>' : ''}</b><span>${esc(dayLabel(it.date))} · ${when(it.date, today)} · ${esc(M.account(ctx.state, r.account)?.name || '')}</span></button>
    <span class="amount ${r.type === 'income' ? 'income' : ''}">${ruleMoney(r)}</span>
    ${due ? `<span class="rec-btns"><button class="btn primary sm" data-act="rec-log" data-id="${esc(r.id)}" data-date="${it.date}">${r.type === 'income' ? 'Got it' : 'Paid'}</button><button class="btn sm" data-act="rec-skip" data-id="${esc(r.id)}" data-date="${it.date}">Skip</button></span>` : ''}
  </div>`;
}

function ruleRow(r, today) {
  const dueNow = R.dueItems({ recurring: [r] }, today)[0]?.date;
  const next = R.nextDate(r, r.lastDone && r.lastDone >= today ? r.lastDone : addDays(today, -1));
  const nextLabel = r.every === 'once' ? `${dueNow ? 'due' : 'on'} ${dayLabel(r.start)} · ${when(r.start, today)}` : r.paused ? 'paused' : dueNow ? `due ${dayLabel(dueNow)}` : next ? `next ${dayLabel(next)}` : 'ended';
  return `<button class="tx" data-act="rec-edit" data-id="${esc(r.id)}">
    <span class="av" style="--c:${ctx.catColor(r.category)}" aria-hidden="true">${initial(catOf(r.category).name)}</span>
    <span class="t"><b>${esc(titleOf(r))}${r.auto ? ' <span class="pill pill-gold">auto</span>' : ''}</b><span>${r.every === 'once' ? 'Once' : esc(freq(r).label)} · ${esc(nextLabel)}</span></span>
    <span class="amount ${r.type === 'income' ? 'income' : ''} ${r.paused ? 'muted' : ''}">${ruleMoney(r)}</span>
  </button>`;
}

// Subscriptions & Bills Tab: Interactive selection, What-If simulator, and categorization
function subscriptionsTab(state, today, rules, scheduled) {
  const expenseRules = rules.filter((r) => r.type === 'expense');
  
  if (!ctx.ui.planSelection) {
    ctx.ui.planSelection = new Set();
    for (const r of expenseRules) {
      if (!r.paused) ctx.ui.planSelection.add(r.id);
    }
  }

  const activeRules = expenseRules.filter((r) => !r.paused);
  const pausedRules = expenseRules.filter((r) => r.paused);
  const selectedRules = expenseRules.filter((r) => ctx.ui.planSelection.has(r.id) && !r.paused);
  const unselectedRules = activeRules.filter((r) => !ctx.ui.planSelection.has(r.id));

  const monthlySelected = selectedRules.reduce((sum, r) => sum + (inBase(r, R.perMonth(r)) || 0), 0);
  const annualSelected = monthlySelected * 12;
  const simSavedMonthly = unselectedRules.reduce((sum, r) => sum + (inBase(r, R.perMonth(r)) || 0), 0);
  const simSavedAnnual = simSavedMonthly * 12;

  // Next renewal
  let nextRenewal = null;
  for (const r of activeRules) {
    const next = R.nextDate(r, r.lastDone && r.lastDone >= today ? r.lastDone : addDays(today, -1));
    if (next && (!nextRenewal || next < nextRenewal.date)) {
      nextRenewal = { rule: r, date: next };
    }
  }

  // Category distribution among selected rules
  const groupTotals = new Map();
  for (const r of selectedRules) {
    const grp = getSubGroup(r, catOf(r.category).name);
    const m = inBase(r, R.perMonth(r)) || 0;
    const cur = groupTotals.get(grp.id) || { grp, amount: 0 };
    cur.amount += m;
    groupTotals.set(grp.id, cur);
  }
  const groupList = [...groupTotals.values()].filter((g) => g.amount > 0).sort((a, b) => b.amount - a.amount);
  const totalGroupAmount = groupList.reduce((sum, g) => sum + g.amount, 0) || 1;

  // Group filter
  const filter = ctx.ui.planGroupFilter || 'all';
  let filtered = expenseRules;
  if (filter === 'paused') {
    filtered = pausedRules;
  } else if (filter !== 'all') {
    filtered = expenseRules.filter((r) => getSubGroup(r, catOf(r.category).name).id === filter);
  }

  const aiCount = expenseRules.filter((r) => getSubGroup(r, catOf(r.category).name).id === 'ai').length;
  const mediaCount = expenseRules.filter((r) => getSubGroup(r, catOf(r.category).name).id === 'media').length;
  const utilCount = expenseRules.filter((r) => getSubGroup(r, catOf(r.category).name).id === 'utilities').length;
  const livingCount = expenseRules.filter((r) => getSubGroup(r, catOf(r.category).name).id === 'living').length;

  return `
    <!-- Top KPIs -->
    <div class="sub-kpi-grid">
      <div class="sub-kpi-card">
        <span class="k">Selected Monthly Burn</span>
        <b class="v">${ctx.money(monthlySelected)}</b>
        <span class="sub-sub">${selectedRules.length} of ${activeRules.length} active items selected</span>
      </div>
      <div class="sub-kpi-card">
        <span class="k">Annual Total</span>
        <b class="v">${ctx.money(annualSelected)}</b>
        <span class="sub-sub">${ctx.money(Math.round(annualSelected / 365))}/day average</span>
      </div>
      <div class="sub-kpi-card">
        <span class="k">Active Subscriptions</span>
        <b class="v">${activeRules.length}</b>
        <span class="sub-sub">${pausedRules.length} currently paused</span>
      </div>
      <div class="sub-kpi-card">
        <span class="k">Next Renewal</span>
        <b class="v" style="font-size:18px">${nextRenewal ? esc(titleOf(nextRenewal.rule)) : 'None'}</b>
        <span class="sub-sub">${nextRenewal ? `${dayLabel(nextRenewal.date)} (${when(nextRenewal.date, today)})` : 'All caught up'}</span>
      </div>
    </div>

    <!-- What-If Simulator Alert -->
    ${unselectedRules.length ? `
      <div class="sub-sim-banner">
        <div class="sub-sim-info">
          <span class="sub-sim-icon">💡</span>
          <div>
            <b>What-If Simulator: ${unselectedRules.length} subscription${unselectedRules.length === 1 ? '' : 's'} unselected</b>
            <div class="sub-sim-sub">You would save <b class="income">${ctx.money(simSavedMonthly)}/mo</b> (<b class="income">${ctx.money(simSavedAnnual)}/year</b>) if you pause or cancel these.</div>
          </div>
        </div>
        <div class="sub-sim-btns">
          <button class="btn sm primary" data-act="plan-apply-pause">Apply: Pause in App</button>
          <button class="btn sm" data-act="plan-select-all">Reset (Select all)</button>
        </div>
      </div>
    ` : ''}

    <!-- Category Distribution Bar -->
    ${groupList.length ? `
      <div class="sub-dist-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; font-size:14px; font-weight:600;">Spending by Category</h3>
          <span class="muted small">${ctx.money(monthlySelected)} total</span>
        </div>
        <div class="sub-dist-bar">
          ${groupList.map((g) => `<i style="width:${((g.amount / totalGroupAmount) * 100).toFixed(1)}%; background:${g.grp.color};" title="${esc(g.grp.label)}: ${Math.round((g.amount / totalGroupAmount) * 100)}%"></i>`).join('')}
        </div>
        <div class="sub-dist-legend">
          ${groupList.map((g) => `<span><i style="width:8px;height:8px;border-radius:50%;background:${g.grp.color};display:inline-block;"></i>${g.grp.emoji} ${esc(g.grp.label)}: <b>${Math.round((g.amount / totalGroupAmount) * 100)}%</b> (${ctx.money(g.amount)}/mo)</span>`).join('')}
        </div>
      </div>
    ` : ''}

    <!-- Quick Presets Drawer -->
    ${ctx.ui.showPresets || expenseRules.length === 0 ? `
      <div class="sub-presets-card">
        <div class="sub-presets-header">
          <div>
            <h3 style="margin:0; font-size:14px; font-weight:600; display:flex; align-items:center; gap:6px;">
              <span>⚡ Quick Add Subscriptions &amp; AI Presets</span>
              ${Object.keys(state.settings?.presetPrices || {}).length ? `<span class="pill pill-gold" style="font-size:10px; padding:1px 6px;">Custom prices active</span>` : ''}
            </h3>
            <span class="muted small">${ctx.ui.editingPresets ? 'Change amounts or currencies below — saves automatically' : 'Tap chip to add subscription, or edit prices to match your real billing'}</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <button class="btn sm ${ctx.ui.editingPresets ? 'primary' : ''}" data-act="plan-toggle-edit-presets" title="${ctx.ui.editingPresets ? 'Exit preset editor' : 'Customize prices and currencies for all presets'}">
              ${ctx.ui.editingPresets ? '✓ Done editing' : '✏️ Edit prices'}
            </button>
            ${Object.keys(state.settings?.presetPrices || {}).length ? `<button class="card-link" data-act="plan-reset-presets" title="Reset all custom prices back to original defaults" style="color:var(--c-danger, #ef4444); font-size:12px;">↺ Reset all</button>` : ''}
            <button class="card-link" data-act="plan-toggle-presets">Hide</button>
          </div>
        </div>

        ${ctx.ui.editingPresets ? `
          <div class="sub-presets-edit-banner">
            <span style="font-size:12.5px;">💡 <b>Preset Price Editor:</b> Type your custom monthly price or select billing currency. Changes save instantly.</span>
          </div>
          <div class="sub-presets-edit-grid">
            ${getPresetSubs(state).map((p) => {
              const curOptions = getAvailableCurrencies(state);
              if (!curOptions.includes(p.currency)) curOptions.push(p.currency);
              const def = PRESET_SUBS.find((x) => x.name === p.name);
              return `
                <div class="sub-preset-edit-item ${p.isCustom ? 'is-custom' : ''}">
                  <div class="sub-preset-edit-header">
                    <span class="sub-preset-edit-emoji">${p.emoji}</span>
                    <b class="sub-preset-edit-name" title="${esc(p.name)}">${esc(p.name)}</b>
                    ${p.isCustom ? `<button class="card-link sub-preset-reset-one" data-act="plan-reset-one" data-name="${esc(p.name)}" title="Reset to default (${formatPresetPrice(def)})">↺ Default</button>` : ''}
                  </div>
                  <div class="sub-preset-edit-inputs">
                    <div class="sub-preset-amt-wrap">
                      <input type="text" inputmode="decimal" class="preset-input-amt" data-name="${esc(p.name)}" value="${esc(centsToPlain(p.amount))}" placeholder="0.00" aria-label="Price for ${esc(p.name)}">
                    </div>
                    <select class="preset-input-cur" data-name="${esc(p.name)}" aria-label="Currency for ${esc(p.name)}">
                      ${curOptions.map((c) => `<option value="${c}" ${c === p.currency ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : `
          <div class="sub-presets-grid">
            ${getPresetSubs(state).map((p) => `
              <div class="sub-preset-chip ${p.isCustom ? 'custom-priced' : ''}">
                <button class="sub-preset-btn" data-act="plan-use-preset" data-name="${esc(p.name)}" title="Add ${esc(p.name)} (${formatPresetPrice(p)})">
                  <span>${p.emoji}</span>
                  <b>${esc(p.name)}</b>
                  <span class="badge-price">${formatPresetPrice(p)}</span>
                </button>
                <button class="sub-preset-quick-edit" data-act="plan-edit-price-one" data-name="${esc(p.name)}" title="Edit price for ${esc(p.name)}" aria-label="Edit price for ${esc(p.name)}">✏️</button>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    ` : ''}

    <!-- Toolbar: Filter and Batch Actions -->
    <div class="sub-toolbar">
      <div class="chips" style="margin:0;">
        <button class="chip" data-act="plan-filter-group" data-group="all" aria-pressed="${filter === 'all'}">All (${expenseRules.length})</button>
        ${aiCount ? `<button class="chip" data-act="plan-filter-group" data-group="ai" aria-pressed="${filter === 'ai'}">🤖 AI (${aiCount})</button>` : ''}
        ${mediaCount ? `<button class="chip" data-act="plan-filter-group" data-group="media" aria-pressed="${filter === 'media'}">🎬 Media (${mediaCount})</button>` : ''}
        ${utilCount ? `<button class="chip" data-act="plan-filter-group" data-group="utilities" aria-pressed="${filter === 'utilities'}">⚡ Utilities (${utilCount})</button>` : ''}
        ${livingCount ? `<button class="chip" data-act="plan-filter-group" data-group="living" aria-pressed="${filter === 'living'}">🏠 Living (${livingCount})</button>` : ''}
        ${pausedRules.length ? `<button class="chip" data-act="plan-filter-group" data-group="paused" aria-pressed="${filter === 'paused'}">⏸️ Paused (${pausedRules.length})</button>` : ''}
      </div>
      <div class="sub-batch-actions">
        <button class="card-link" data-act="plan-select-all">Select all</button>
        <button class="card-link" data-act="plan-deselect-all">Deselect all</button>
        ${aiCount ? `<button class="card-link" data-act="plan-select-ai">Only AI</button>` : ''}
      </div>
    </div>

    <!-- Subscriptions List -->
    ${filtered.length ? `
      <div class="sub-list">
        ${filtered.map((r) => {
          const isSelected = ctx.ui.planSelection.has(r.id) && !r.paused;
          const grp = getSubGroup(r, catOf(r.category).name);
          const nextDate = R.nextDate(r, r.lastDone && r.lastDone >= today ? r.lastDone : addDays(today, -1));
          const dueNow = R.dueItems({ recurring: [r] }, today)[0]?.date;
          const nextLabel = r.paused ? 'paused' : dueNow ? `due ${dayLabel(dueNow)}` : nextDate ? `next ${dayLabel(nextDate)} (${when(nextDate, today)})` : 'ended';
          const monthlyInBase = inBase(r, R.perMonth(r));
          return `
            <div class="sub-item-card ${isSelected ? '' : 'unselected'} ${r.paused ? 'paused' : ''}">
              <input type="checkbox" class="sub-checkbox" data-act="plan-toggle-select" data-id="${esc(r.id)}" ${isSelected ? 'checked' : ''} aria-label="Toggle ${esc(titleOf(r))} in simulation">
              <div class="sub-icon" style="color:${grp.color}">${grp.emoji}</div>
              <div class="sub-meta">
                <div class="sub-meta-title">
                  <span>${esc(titleOf(r))}</span>
                  <span class="sub-tag" style="color:${grp.color}; background:color-mix(in srgb, ${grp.color} 14%, transparent)">${grp.label}</span>
                  ${r.auto ? '<span class="pill pill-gold">auto</span>' : ''}
                  ${r.paused ? '<span class="pill pill-out">paused</span>' : ''}
                </div>
                <div class="sub-meta-details">
                  <span>${esc(freq(r).label)}</span> ·
                  <span>${esc(nextLabel)}</span> ·
                  <span>${esc(M.account(state, r.account)?.name || '')}</span>
                </div>
              </div>
              <div class="sub-price-col" data-act="rec-edit" data-id="${esc(r.id)}" title="Click to edit subscription price & details" style="cursor:pointer;">
                <div class="sub-price-primary">${formatMoney(r.amount, r.currency)} <span class="sub-price-pencil" style="font-size:11px; opacity:0.6; margin-left:2px;" title="Edit price">✏️</span></div>
                ${r.currency !== base() ? `<div class="sub-price-secondary">~${ctx.money(monthlyInBase)}/mo</div>` : ''}
              </div>
              <div class="sub-actions-col">
                <button class="icon-btn" data-act="plan-toggle-pause" data-id="${esc(r.id)}" title="${r.paused ? 'Resume subscription' : 'Pause subscription'}" aria-label="${r.paused ? 'Resume' : 'Pause'}">${r.paused ? '▶️' : '⏸️'}</button>
                <button class="icon-btn" data-act="rec-edit" data-id="${esc(r.id)}" title="Edit subscription" aria-label="Edit">✏️</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    ` : `
      <section class="card empty">
        <b>No subscriptions found</b>
        <p class="muted">Add a recurring expense, or pick one from the quick presets above.</p>
        <button class="btn primary" data-act="rec-new">+ Add subscription</button>
      </section>
    `}

    <!-- Scheduled One-Time Bills (if any) -->
    ${scheduled.length ? `
      <section class="card" style="margin-top:18px;">
        <h2>Scheduled one-time payments <span class="right muted">${scheduled.length}</span></h2>
        <div class="list">${scheduled.map((r) => ruleRow(r, today)).join('')}</div>
      </section>
    ` : ''}
  `;
}

// Payment Timeline Tab
function calendarTab(state, today, due, up, sugg) {
  return `
    ${due.length ? `
      <section class="card">
        <h2>Due now <span class="right muted">${due.length}</span></h2>
        <div class="list">${due.map((x) => itemRow(x, today, { due: true })).join('')}</div>
        <p class="muted small" style="margin-bottom:0">"Paid" logs the planned amount on its date. Tap the name to change the amount first.</p>
      </section>
    ` : ''}

    <section class="card">
      <h2>Coming up · 30 days</h2>
      ${up.length ? `<div class="list">${up.map((x) => itemRow(x, today)).join('')}</div>` : '<p class="muted" style="margin:0">Nothing planned in the next 30 days.</p>'}
    </section>

    ${sugg.length ? `
      <section class="card">
        <h2>Looks regular</h2>
        <p class="muted small" style="margin-top:0">These show up every month in your log.</p>
        <div class="list">${sugg.map((s) => `<div class="tx rec-row"><span class="av" style="--c:${ctx.catColor(s.tx.category)}" aria-hidden="true">${initial(catOf(s.tx.category).name)}</span>
          <span class="t"><b>${esc(s.tx.note)}</b><span>${s.months} of the last 4 months · ${formatMoney(s.tx.amount, s.tx.currency || base())}</span></span>
          <button class="btn sm" data-act="rec-from" data-id="${esc(s.tx.id)}">Make recurring</button></div>`).join('')}</div>
      </section>
    ` : ''}
  `;
}

// Cash-Flow Forecast Tab
function forecastCard() {
  const days = ctx.ui.fcDays || 60;
  const f = forecast(ctx.state, todayISO(), { days });
  const lei = (c) => Math.round(c / 100) * 100;
  const chip = (n) => `<button class="chip" aria-pressed="${days === n}" data-act="fc-days" data-n="${n}">${n} days</button>`;
  const short = f.low.value < 0;
  const next = f.events.slice(0, 6);
  return `<section class="card"><h2>Cash-flow forecast <span class="right">${chip(30)}${chip(60)}${chip(90)}</span></h2>
    <div class="fc-stats">
      <div><span class="k">Spending money now</span><b>${ctx.money(lei(f.start))}</b></div>
      <div><span class="k">In ${days} days</span><b class="${f.end < 0 ? 'expense' : ''}">${ctx.money(lei(f.end))}</b></div>
      <div><span class="k">Lowest</span><b class="${short ? 'expense' : ''}">${ctx.money(lei(f.low.value))}</b><span class="muted small">${esc(shortDay(f.low.date))}</span></div>
    </div>
    ${short ? `<p class="fc-warn">Money runs short around <b>${esc(dayLabel(f.low.date))}</b>. Move some from savings before then, or plan smaller spending.</p>` : ''}
    ${lineChart(f.points.map((p) => ({ label: shortDay(p.date), value: lei(p.value) })), (c) => ctx.money(c), { color: short ? 'var(--expense)' : 'var(--gold)' })}
    ${next.length ? `<div class="fc-events">${next.map((e) => `<div class="kv"><span>${esc(shortDay(e.date))} · ${esc(e.label)}${e.late ? ' <span class="pill pill-out">late</span>' : ''}</span><b class="${e.amount > 0 ? 'income' : ''}">${ctx.money(lei(e.amount), { sign: true })}</b></div>`).join('')}</div>` : ''}
    <p class="muted small" style="margin-bottom:0">Cards and cash only (not savings or crypto). Counts your recurring bills and income, unpaid invoices, and about ${ctx.money(lei(f.daily))} a day of everyday spending (your last 90 days).</p>
  </section>`;
}

// Budgets Tab
function budgetCard() {
  const today = todayISO();
  const key = monthKey(today);
  const st = M.budgetStatus(ctx.state, key, today);
  if (!st.rows.length) {
    return `<section class="card"><h2>Budgets</h2>
      <p class="muted" style="margin-top:0">Give the categories you want to keep in check (food, going out, clothes…) a monthly limit. You get a warning at 80%, when you go over, and when your pace would take you over.</p>
      <button class="btn primary block" data-act="budget-set">Set budgets</button></section>`;
  }
  const evenPace = (Number(today.slice(8, 10)) / daysInMonth(key)) * 100;
  const rows = st.rows.map((r) => {
    const c = r.category;
    const w = Math.min(100, r.pct * 100).toFixed(1);
    const foot = r.level === 'over' ? `Over by ${ctx.money(-r.left)}` : r.level === 'pace' ? `${ctx.money(r.left)} left · on pace for ${ctx.money(r.projected)}` : `${ctx.money(r.left)} left`;
    return `<button class="jar budget-row" data-act="cat-open" data-cat="${esc(c.id)}" data-period="month" data-type="expense">
      <span class="row"><span>${ctx.dot(ctx.catColor(c.id))}${esc(c.name)} <span class="muted">${Math.round(r.pct * 100)}%</span></span><span class="money">${ctx.money(r.spent)} <span class="muted">/ ${ctx.money(r.budget, { compact: true })}</span></span></span>
      <span class="bar ${r.level === 'over' ? 'over' : r.level === 'ok' ? '' : 'gold'}"><i style="width:${w}%"></i><span class="mark" style="left:${evenPace.toFixed(1)}%" title="Where an even pace would be today"></span></span>
      <span class="foot ${r.level === 'over' ? 'bad' : ''}">${foot}</span>
    </button>`;
  }).join('');
  return `<section class="card"><h2>Budgets · ${esc(monthLabel(key))} <button class="card-link right" data-act="budget-set">Edit</button></h2>
    <p class="muted small" style="margin-top:0">${ctx.money(st.spent)} of ${ctx.money(st.budget)} · ${st.left >= 0 ? `${ctx.money(st.left)} left` : `<b class="expense">${ctx.money(-st.left)} over</b>`} · ${st.daysLeft} day${st.daysLeft === 1 ? '' : 's'} to go. The line marks an even pace.</p>
    ${rows}</section>`;
}

function budgetSheet() {
  const { state } = ctx;
  const key = monthKey(todayISO());
  const cats = state.settings.categories.filter((c) => c.type === 'expense');
  const avg = Object.fromEntries(cats.map((c) => [c.id, M.averageSpend(state, c.id, key, 3)]));
  const round50 = (x) => Math.ceil(x / 5000) * 5000;
  ctx.openSheet(`<h3>Monthly budgets <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="budget-form" novalidate>
      <p class="muted small" style="margin-top:0">Leave empty for no limit. Amounts in ${esc(base())} per month; "avg" is what you spent on average in the last 3 months (tap it to use it).</p>
      <div class="budget-list">${cats.map((c) => `<label class="budget-edit">
        <span class="n">${ctx.dot(ctx.catColor(c.id))}${esc(c.name)}</span>
        ${avg[c.id] ? `<button type="button" class="card-link" data-fill="${esc(c.id)}" data-v="${round50(avg[c.id])}">avg ${ctx.money(avg[c.id], { compact: true })}</button>` : '<span></span>'}
        <input type="text" inputmode="decimal" id="b-${esc(c.id)}" value="${c.budget ? esc(centsToPlain(c.budget)) : ''}" placeholder="no limit" aria-label="Budget for ${esc(c.name)}">
      </label>`).join('')}</div>
      <div class="btns" style="margin-top:14px"><button type="button" class="btn" data-fill-all>Use my averages for empty ones</button><button type="submit" class="btn primary">Save budgets</button></div>
    </form>`, (sheet) => {
    sheet.addEventListener('click', (e) => {
      const one = e.target.closest('[data-fill]');
      if (one) { sheet.querySelector(`#b-${CSS.escape(one.dataset.fill)}`).value = centsToPlain(Number(one.dataset.v)); return; }
      if (e.target.closest('[data-fill-all]')) {
        for (const b of sheet.querySelectorAll('[data-fill]')) {
          const input = sheet.querySelector(`#b-${CSS.escape(b.dataset.fill)}`);
          if (!input.value.trim()) input.value = centsToPlain(Number(b.dataset.v));
        }
      }
    });
    sheet.querySelector('#budget-form').addEventListener('submit', (e) => {
      e.preventDefault();
      let n = 0;
      for (const c of cats) {
        const v = evalAmount(sheet.querySelector(`#b-${CSS.escape(c.id)}`).value) || 0;
        const next = v > 0 ? v : null;
        if ((c.budget || null) !== next) { c.budget = next; M.touch(c); }
        if (next) n++;
      }
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(n ? `${n} budget${n === 1 ? '' : 's'} set` : 'No budgets set');
    });
  });
}

// Small "Coming up" card for the dashboard.
export function homeCard() {
  const { state } = ctx;
  if (!(state.recurring || []).length) return '';
  const today = todayISO();
  const due = R.dueItems(state, today);
  const up = R.upcomingItems(state, today, 14).slice(0, Math.max(0, 4 - due.length));
  if (!due.length && !up.length) return '';
  return `<section class="card"><h2>Coming up <button class="card-link right" data-go="plan">Plan</button></h2>
    <div class="list">${due.slice(0, 4).map((x) => itemRow(x, today, { due: true })).join('')}${up.map((x) => itemRow(x, today)).join('')}</div>
    ${due.length > 4 ? `<p class="muted small" style="margin-bottom:0">${due.length - 4} more due on the Plan screen.</p>` : ''}</section>`;
}

// ---------- Main View ----------

export function view() {
  const { state } = ctx;
  const today = todayISO();
  const due = R.dueItems(state, today);
  const up = R.upcomingItems(state, today, 30);
  const all = [...(state.recurring || [])];
  const scheduled = all.filter((r) => r.every === 'once' && !r.lastDone).sort((a, b) => a.start.localeCompare(b.start));
  const rules = all.filter((r) => r.every !== 'once').sort((a, b) => Number(a.paused) - Number(b.paused) || a.type.localeCompare(b.type) || b.amount - a.amount);
  const sugg = R.suggestions(state, today).slice(0, 5);

  const tab = ctx.ui.planTab || 'subs';
  const expenseRules = rules.filter((r) => r.type === 'expense');

  let tabContent = '';
  switch (tab) {
    case 'calendar':
      tabContent = calendarTab(state, today, due, up, sugg);
      break;
    case 'forecast':
      tabContent = forecastCard();
      break;
    case 'budgets':
      tabContent = budgetCard();
      break;
    default:
      tabContent = subscriptionsTab(state, today, rules, scheduled);
      break;
  }

  return `
    <header class="top">
      <div>
        <h1>Plan &amp; Subscriptions</h1>
        <div class="sub">Recurring subscriptions, AI tools, scheduled bills, and cash flow</div>
      </div>
      <div class="top-actions">
        <button class="btn" data-act="plan-toggle-presets">⚡ AI &amp; Popular Subs</button>
        <button class="btn" data-act="rec-once">+ Schedule payment</button>
        <button class="btn primary" data-act="rec-new">+ Add recurring</button>
      </div>
    </header>

    <div class="chips plan-tabs">
      <button class="chip" data-act="plan-tab" data-tab="subs" aria-pressed="${tab === 'subs'}">✨ Subscriptions &amp; Bills <span class="tab-badge">${expenseRules.length}</span></button>
      <button class="chip" data-act="plan-tab" data-tab="calendar" aria-pressed="${tab === 'calendar'}">📅 Payment Timeline ${due.length ? `<span class="tab-badge bad">${due.length} due</span>` : ''}</button>
      <button class="chip" data-act="plan-tab" data-tab="forecast" aria-pressed="${tab === 'forecast'}">📈 Cash-Flow Forecast</button>
      <button class="chip" data-act="plan-tab" data-tab="budgets" aria-pressed="${tab === 'budgets'}">🎯 Monthly Budgets</button>
    </div>

    <div class="plan-tab-body">
      ${tabContent}
    </div>
  `;
}

// ---------- Logging ----------

function logNow(rule, date) {
  const { state } = ctx;
  const rate = rule.currency === base() ? 1 : ctx.suggestedRate(rule.currency);
  if (!rate) { logWithSheet(rule, date); return; }
  const id = txId(rule, date);
  if (!state.tx.some((t) => t.id === id)) {
    state.tx.push(R.makeTx(rule, date, { id, rate }));
    delete state.deleted[id];
  }
  R.markDone(rule, date);
  ctx.ui.flashId = id;
  ctx.commit();
  ctx.toast(`Logged ${titleOf(rule)} ${ruleMoney(rule)}`);
}

function logWithSheet(rule, date) {
  ctx.openTxSheet(null, {
    type: rule.type,
    amountText: centsToPlain(rule.amount),
    note: rule.note,
    category: rule.category,
    account: rule.account,
    date,
    personName: M.person(ctx.state, rule.person)?.name || '',
    fromRule: { id: rule.id, date, txId: txId(rule, date) },
  });
}

function skip(rule, date) {
  R.markDone(rule, date);
  ctx.commit();
  ctx.toast(`Skipped ${titleOf(rule)} on ${dayLabel(date)}`);
}

// Rules set to "log by itself": add every due date
export function runAuto() {
  const { state } = ctx;
  if (ctx.DEMO || state._sealed) return 0;
  let n = 0;
  for (const { rule, date } of R.dueItems(state, todayISO())) {
    if (!rule.auto) continue;
    const rate = rule.currency === base() ? 1 : ctx.suggestedRate(rule.currency);
    if (!rate) continue;
    const id = txId(rule, date);
    if (!state.tx.some((t) => t.id === id) && !state.deleted[id]) { state.tx.push(R.makeTx(rule, date, { id, rate })); n++; }
    R.markDone(rule, date);
  }
  if (n) {
    ctx.commit();
    ctx.toast(`Added ${n} recurring record${n === 1 ? '' : 's'}`);
  }
  return n;
}

export function initPlan() {
  setTimeout(runAuto, 1500);
  setInterval(runAuto, 60 * 60000);
}

// ---------- Add / edit ----------

export function editRule(existing = null, preset = {}) {
  const { state } = ctx;
  const accounts = M.activeAccounts(state);
  const matchingAccount = preset.currency ? accounts.find((a) => a.currency === preset.currency) : null;
  const defaultAccount = matchingAccount?.id || accounts[0]?.id;

  const r = existing ? { ...existing } : {
    type: 'expense',
    every: 'month',
    start: todayISO(),
    account: defaultAccount,
    category: null,
    note: '',
    auto: false,
    amount: 0,
    ...preset,
  };
  let amountText = r.amount ? centsToPlain(r.amount) : '';

  const html = () => {
    const cats = state.settings.categories.filter((c) => c.type === r.type);
    if (!cats.some((c) => c.id === r.category)) r.category = cats.find((c) => c.id === (r.type === 'income' ? 'work' : 'home'))?.id || cats[0]?.id;
    const cur = r.currency || M.account(state, r.account)?.currency || base();
    return `<div class="grab"></div><form id="rec-form" novalidate>
      <h3>${r.every === 'once' ? (existing ? 'Edit scheduled payment' : 'Schedule a payment') : existing ? 'Edit subscription / recurring' : 'New subscription / recurring'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
      <div class="seg two" role="group" aria-label="Type"><button type="button" data-type="expense" aria-pressed="${r.type === 'expense'}">I pay (Subscription / Bill)</button><button type="button" data-type="income" aria-pressed="${r.type === 'income'}">I get paid (Income / Retainer)</button></div>
      <div class="amount-input"><input id="rec-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(amountText)}" aria-label="Amount"><span class="cur">${esc(cur)}</span></div>
      <label class="field"><span>Name</span><input id="rec-note" type="text" value="${esc(r.note)}" placeholder="${r.type === 'income' ? 'e.g. salary, US client retainer' : 'e.g. ChatGPT Plus, Claude, Netflix, Rent'}"></label>
      <div class="row2">
        <label class="field"><span>Category</span><select id="rec-cat">${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === r.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="field"><span>${r.type === 'income' ? 'Into' : 'Paid from'}</span><select id="rec-acc">${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === r.account ? 'selected' : ''}>${esc(a.name)} · ${esc(a.currency)}</option>`).join('')}</select></label>
      </div>
      <div class="row2">
        <label class="field"><span>How often</span><select id="rec-every">${R.FREQS.map((f) => `<option value="${f.id}" ${f.id === r.every ? 'selected' : ''}>${f.label}</option>`).join('')}</select></label>
        <label class="field"><span>${r.every === 'once' ? 'On' : existing ? 'Counting from' : 'Next (or first) date'}</span><input id="rec-start" type="date" value="${esc(r.start)}"></label>
      </div>
      ${r.every === 'once' ? '' : `<label class="field"><span>Ends (optional)</span><input id="rec-end" type="date" value="${esc(r.end || '')}"></label>`}
      <label class="field check"><input type="checkbox" id="rec-auto" ${r.auto ? 'checked' : ''}><span>Log it by itself on the day (for fixed amounts)</span></label>
      ${existing ? `<label class="field check"><input type="checkbox" id="rec-paused" ${r.paused ? 'checked' : ''}><span>Paused</span></label>` : ''}
      <p class="lock-msg" id="rec-msg" role="alert"></p>
      <div class="btns">${existing ? '<button type="button" class="btn danger" data-act="rec-delete">Delete</button>' : ''}<button type="submit" class="btn primary">${existing ? 'Save' : 'Add'}</button></div>
    </form>`;
  };

  const read = (sheet) => {
    const v = (id) => sheet.querySelector(id);
    amountText = v('#rec-amount').value;
    r.note = v('#rec-note').value;
    r.category = v('#rec-cat').value;
    r.account = v('#rec-acc').value;
    r.every = v('#rec-every').value;
    r.start = v('#rec-start').value || r.start;
    r.end = v('#rec-end')?.value || null;
    r.auto = v('#rec-auto').checked;
    if (v('#rec-paused')) r.paused = v('#rec-paused').checked;
  };

  ctx.openSheet('', (sheet) => {
    const paint = () => { sheet.innerHTML = html(); };
    paint();
    if (!existing) sheet.querySelector('#rec-amount').focus();
    sheet.addEventListener('change', (e) => { if (e.target.id === 'rec-acc' || e.target.id === 'rec-every') { read(sheet); paint(); } });
    sheet.addEventListener('click', (e) => {
      const seg = e.target.closest('.seg button');
      if (seg && seg.dataset.type !== r.type) { read(sheet); r.type = seg.dataset.type; paint(); return; }
      if (e.target.closest('[data-act="rec-delete"]')) {
        state.recurring = state.recurring.filter((x) => x.id !== existing.id);
        state.deleted[existing.id] = Date.now();
        ctx.commit();
        ctx.closeSheet();
        ctx.toast(`${titleOf(existing)} removed. Records already logged stay.`);
      }
    });
    sheet.addEventListener('submit', (e) => {
      e.preventDefault();
      read(sheet);
      const msg = sheet.querySelector('#rec-msg');
      const amount = evalAmount(amountText);
      if (!amount || amount <= 0) { msg.textContent = 'Enter an amount bigger than 0.'; return; }
      if (r.end && r.end < r.start) { msg.textContent = 'The end date is before the first date.'; return; }
      const now = Date.now();
      const chosenCur = M.account(state, r.account)?.currency || r.currency || base();
      const rule = { ...r, amount, note: r.note.trim(), currency: chosenCur, updatedAt: now };
      if (existing) {
        if (rule.start !== existing.start || rule.every !== existing.every) rule.lastDone = null;
        state.recurring = state.recurring.map((x) => (x.id === existing.id ? rule : x));
      } else {
        rule.id = M.uid();
        rule.createdAt = now;
        rule.lastDone = rule.lastDone || null;
        state.recurring.push(rule);
      }
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(existing ? 'Saved' : rule.every === 'once' ? `${titleOf(rule)} scheduled for ${dayLabel(rule.start)}${rule.auto ? '; it logs itself that day' : ''}` : `${titleOf(rule)} added: ${freq(rule).short}`);
      runAuto();
    });
  });
}

const findRule = (id) => (ctx.state.recurring || []).find((r) => r.id === id);

export function onClick(act, el) {
  if (act === 'plan-tab') {
    ctx.ui.planTab = el.dataset.tab;
    ctx.render();
    return true;
  }
  if (act === 'plan-toggle-presets') {
    ctx.ui.showPresets = !ctx.ui.showPresets;
    ctx.render();
    return true;
  }
  if (act === 'plan-use-preset') {
    const presets = getPresetSubs(ctx.state);
    const p = presets.find((x) => x.name === el.dataset.name) || PRESET_SUBS.find((x) => x.name === el.dataset.name);
    if (p) {
      const cats = ctx.state.settings.categories.filter((c) => c.type === 'expense');
      const matchedCat = cats.find((c) => c.id === p.cat) || cats[0];
      editRule(null, {
        note: p.name,
        amount: p.amount,
        currency: p.currency,
        every: p.every,
        category: matchedCat?.id,
        auto: true,
        start: todayISO(),
      });
    }
    return true;
  }
  if (act === 'plan-toggle-edit-presets') {
    ctx.ui.editingPresets = !ctx.ui.editingPresets;
    ctx.render();
    if (!ctx.ui.editingPresets) {
      ctx.toast('Preset prices saved');
    }
    return true;
  }
  if (act === 'plan-edit-price-one') {
    openEditPresetPriceSheet(el.dataset.name);
    return true;
  }
  if (act === 'plan-reset-presets') {
    resetPresetPrice(ctx.state);
    ctx.commit();
    ctx.toast('All preset prices reset to defaults');
    ctx.render();
    return true;
  }
  if (act === 'plan-reset-one') {
    resetPresetPrice(ctx.state, el.dataset.name);
    ctx.commit();
    ctx.toast(`Reset ${el.dataset.name} to default price`);
    ctx.render();
    return true;
  }
  if (act === 'plan-toggle-select') {
    const id = el.dataset.id;
    if (!ctx.ui.planSelection) ctx.ui.planSelection = new Set();
    if (ctx.ui.planSelection.has(id)) {
      ctx.ui.planSelection.delete(id);
    } else {
      ctx.ui.planSelection.add(id);
    }
    ctx.render();
    return true;
  }
  if (act === 'plan-select-all') {
    const expRules = (ctx.state.recurring || []).filter((r) => r.type === 'expense' && r.every !== 'once');
    ctx.ui.planSelection = new Set(expRules.map((r) => r.id));
    ctx.render();
    return true;
  }
  if (act === 'plan-deselect-all') {
    ctx.ui.planSelection = new Set();
    ctx.render();
    return true;
  }
  if (act === 'plan-select-ai') {
    const aiRules = (ctx.state.recurring || []).filter((r) => r.type === 'expense' && r.every !== 'once' && getSubGroup(r, catOf(r.category).name).id === 'ai');
    ctx.ui.planSelection = new Set(aiRules.map((r) => r.id));
    ctx.render();
    return true;
  }
  if (act === 'plan-filter-group') {
    ctx.ui.planGroupFilter = el.dataset.group;
    ctx.render();
    return true;
  }
  if (act === 'plan-toggle-pause') {
    const r = findRule(el.dataset.id);
    if (r) {
      r.paused = !r.paused;
      r.updatedAt = Date.now();
      ctx.commit();
      ctx.toast(r.paused ? `Paused ${titleOf(r)}` : `Resumed ${titleOf(r)}`);
      ctx.render();
    }
    return true;
  }
  if (act === 'plan-apply-pause') {
    const expRules = (ctx.state.recurring || []).filter((r) => r.type === 'expense' && r.every !== 'once');
    let count = 0;
    for (const r of expRules) {
      if (!ctx.ui.planSelection.has(r.id) && !r.paused) {
        r.paused = true;
        r.updatedAt = Date.now();
        count++;
      }
    }
    if (count > 0) {
      ctx.commit();
      ctx.toast(`Paused ${count} unselected subscription${count === 1 ? '' : 's'}`);
      ctx.render();
    }
    return true;
  }
  if (act === 'budget-set') { budgetSheet(); return true; }
  if (act === 'fc-days') { ctx.ui.fcDays = Number(el.dataset.n); ctx.render(); return true; }
  if (act === 'rec-new') { editRule(); return true; }
  if (act === 'rec-once') { editRule(null, { every: 'once', auto: true }); return true; }
  if (act === 'rec-edit') { const r = findRule(el.dataset.id); if (r) editRule(r); return true; }
  if (act === 'rec-log') { const r = findRule(el.dataset.id); if (r) logNow(r, el.dataset.date); return true; }
  if (act === 'rec-log-edit') { const r = findRule(el.dataset.id); if (r) logWithSheet(r, el.dataset.date); return true; }
  if (act === 'rec-skip') { const r = findRule(el.dataset.id); if (r) skip(r, el.dataset.date); return true; }
  if (act === 'rec-from') {
    const t = ctx.state.tx.find((x) => x.id === el.dataset.id);
    if (t) editRule(null, { type: t.type, amount: t.amount, note: t.note, category: t.category, account: t.account, person: t.person, start: R.nextDate({ every: 'month', start: t.date }, todayISO()) || todayISO(), lastDone: null });
    return true;
  }
  return false;
}

export function onInput(target) {
  if (target?.classList?.contains('preset-input-amt')) {
    const name = target.dataset.name;
    const item = target.closest('.sub-preset-edit-item');
    const curEl = item?.querySelector('.preset-input-cur');
    const cur = curEl ? curEl.value : null;
    const amount = evalAmount(target.value);
    if (amount != null && amount >= 0) {
      setPresetPrice(ctx.state, name, amount, cur);
      ctx.commit({ quiet: true });
    }
    return true;
  }
  return false;
}

export function onChange(target) {
  if (target?.classList?.contains('preset-input-amt') || target?.classList?.contains('preset-input-cur')) {
    const name = target.dataset.name;
    const item = target.closest('.sub-preset-edit-item');
    const amtEl = item?.querySelector('.preset-input-amt');
    const curEl = item?.querySelector('.preset-input-cur');
    if (amtEl && curEl) {
      const amount = evalAmount(amtEl.value);
      if (amount != null && amount >= 0) {
        setPresetPrice(ctx.state, name, amount, curEl.value);
        ctx.commit({ quiet: true });
        ctx.render();
      }
    }
    return true;
  }
  return false;
}

