// Accounts & savings: every wallet, card, bank and crypto account, grouped,
// with balances in their own currency and in MDL, plus savings over time.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { FIAT, CRYPTO, formatQty, coinValue } from '../fx.js';
import { formatMoney, evalAmount, centsToPlain } from '../money.js';
import { monthKey, addMonths, daysInMonth, monthLabel, todayISO } from '../dates.js';
import { lineChart } from '../charts.js';
import { cardHTML, CARD_THEMES, themeOf, readLogo } from '../cards.js';
import { cashCheck } from '../review.js';

export const BANKS = ['Cash', 'maib', 'Victoriabank', 'Moldindconbank', 'OTP Bank', 'MICB', 'FinComBank', 'Eximbank', 'Energbank', 'ProCredit Bank', 'Paynet', 'Revolut', 'Wise', 'Paysera', 'PayPal', 'Binance'];

// Dot color (used in lists and charts) that goes with each card theme.
const THEME_DOT = { ocean: 1, midnight: 1, sunset: 2, emerald: 3, teal: 3, gold: 4, rose: 5, forest: 6, plum: 7, crimson: 8 };

const KIND = Object.fromEntries(M.ACCOUNT_KINDS.map((k) => [k.id, k.name]));
const isSaving = (a) => a.savings || a.kind === 'savings';


// Savings in MDL at the end of each of the last 12 months.
function savingsHistory(state) {
  const now = monthKey(todayISO());
  const ids = new Set(state.settings.accounts.filter((a) => isSaving(a) && !a.archived).map((a) => a.id));
  const out = [];
  for (let i = 11; i >= 0; i--) {
    const k = addMonths(now, -i);
    const end = i === 0 ? todayISO() : `${k}-${String(daysInMonth(k)).padStart(2, '0')}`;
    const v = M.accountValues(state, end).filter((x) => ids.has(x.account.id)).reduce((a, x) => a + (x.inBase || 0), 0);
    out.push({ label: monthLabel(k, true).slice(0, 3), value: v });
  }
  return out;
}

// Net worth: month ends from your records, daily snapshots where taken.
function netWorthCard(state) {
  const range = ctx.ui.nwRange || 12;
  const today = todayISO();
  const pts = M.netWorthSeries(state, today, range).map((p) => ({ ...p, value: Math.round(p.value / 100) * 100 })); // whole lei
  if (pts.length < 2) return '';
  const last = pts.at(-1).value;
  const delta = (i) => (pts.length > i ? last - pts.at(-1 - i).value : null);
  const sign = (c) => (c == null ? '–' : `<b class="${c >= 0 ? 'income' : 'expense'}">${ctx.money(c, { sign: true })}</b>`);
  const firstSnap = pts.slice(0, -1).find((p) => p.snap);
  const chip = (n, label) => `<button class="chip" aria-pressed="${range === n}" data-act="nw-range" data-n="${n}">${label}</button>`;
  return `<section class="card"><h2>Net worth <span class="right">${chip(12, '1 year')}${chip(120, 'All')}</span></h2>
    <div class="kv"><span>Since last month</span>${sign(delta(1))}</div>
    <div class="kv"><span>Since ${esc(monthLabel(pts[0].key, true))}</span>${sign(last - pts[0].value)}</div>
    ${lineChart(pts.map((p) => ({ label: monthLabel(p.key, true).slice(0, 3) + (range > 12 && p.key.endsWith('-01') ? ` ${p.key.slice(2, 4)}` : ''), value: p.value })), (c) => ctx.money(c))}
    <p class="muted small" style="margin:6px 0 0">${firstSnap && firstSnap === pts[0] ? 'From daily snapshots.' : `Earlier months are rebuilt from your records at today's rates, without crypto${firstSnap ? `; daily snapshots from ${esc(monthLabel(firstSnap.key))}` : '. A snapshot is saved every day from now on'}.`}</p>
  </section>`;
}

const card = (v, opts = {}) => cardHTML(v, { money: ctx.money, base: ctx.state.settings.currency, ...opts });


export function view() {
  const { state } = ctx;
  const vals = M.accountValues(state);
  const active = vals.filter((v) => !v.account.archived);
  const archived = vals.filter((v) => v.account.archived);
  const { total, missing } = M.totalBalance(state);
  const saving = active.filter((v) => isSaving(v.account));
  const savingTotal = saving.reduce((a, v) => a + (v.inBase || 0), 0);
  const byCur = new Map();
  for (const v of active) if (!(v.account.kind === 'crypto' && v.account.holdings?.length)) byCur.set(v.account.currency, (byCur.get(v.account.currency) || 0) + v.own);
  const groups = M.ACCOUNT_KINDS.map((k) => ({ kind: k, items: active.filter((v) => v.account.kind === k.id) })).filter((g) => g.items.length);
  const hist = savingsHistory(state);

  return `<header class="top"><div><h1>Accounts</h1><div class="sub">${active.length} account${active.length === 1 ? '' : 's'} · ${[...byCur.keys()].join(', ')}</div></div>
    <button class="btn primary" data-act="acc-new">+ Add account</button></header>
  <section class="hero">
    <div class="hero-main">
      <div class="label">All my money</div>
      <div class="big">${ctx.bigMoney(total)}</div>
      <div class="accounts">${[...byCur.entries()].map(([c, v]) => `<span class="acc static"><span class="n">${esc(c)}</span><b class="money">${formatMoney(v, '')}</b></span>`).join('')}</div>
      ${missing.length ? `<p class="muted small" style="margin:10px 0 0">Not counted yet (no rate): ${missing.map((v) => esc(v.account.name)).join(', ')}.</p>` : ''}
    </div>
    <div class="hero-month">
      <div class="label">Savings</div>
      <div class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <div class="stat"><span class="k">In savings</span><b class="gold">${ctx.countUp(savingTotal, 'sav-total')}</b></div>
        <div class="stat"><span class="k">Share of all money</span><b>${total > 0 ? Math.round((savingTotal / total) * 100) : 0}%</b></div>
      </div>
      <p class="muted small" style="margin:12px 0 0">${saving.length ? `Counted: ${saving.map((v) => esc(v.account.name)).join(', ')}.` : 'Mark an account as savings to track it here.'}</p>
    </div>
  </section>
  <div class="bcards">
    ${groups.flatMap((g) => g.items).map((v) => card(v)).join('')}
    <button type="button" class="bcard-add" data-act="acc-new"><span>+</span>Add a card or account</button>
  </div>
  ${archived.length ? `<details class="card"><summary>Archived (${archived.length})</summary><div class="bcards" style="margin:14px 0 0">${archived.map((v) => card(v)).join('')}</div></details>` : ''}
  <div class="acc-charts">
    ${netWorthCard(state) || ''}
    <section class="card"><h2>Savings over 12 months</h2>${lineChart(hist, (c) => ctx.money(c))}</section>  </div>`;
}

// ---------- Account detail and editor ----------

function openAccount(id) {
  const { state } = ctx;
  const a = M.account(state, id);
  if (!a) return;
  const v = M.accountValues(state).find((x) => x.account.id === id);
  const recent = M.sortTx(state.tx.filter((t) => t.account === id || t.from === id || t.to === id)).slice(0, 8);
  const coins = (a.holdings || []).map((h) => {
    const val = coinValue(Number(h.qty), h.asset, state.settings.currency, state.rates);
    return `<div class="split-row"><span><b>${esc(h.asset)}</b> <span class="muted">${formatQty(Number(h.qty))}</span></span><b class="money">${val == null ? 'no price' : ctx.money(val)}</b></div>`;
  }).join('');
  const month = monthKey(todayISO());
  const mine = state.tx.filter((t) => t.date.startsWith(month));
  const inM = mine.reduce((x, t) => x + (t.type === 'income' && t.account === id ? t.amount : t.type === 'transfer' && t.to === id ? (Number.isInteger(t.toAmount) ? t.toAmount : t.amount) : 0), 0);
  const outM = mine.reduce((x, t) => x + (t.type === 'expense' && t.account === id ? t.amount : t.type === 'transfer' && t.from === id ? t.amount : 0), 0);
  const count = state.tx.filter((t) => t.account === id || t.from === id || t.to === id).length;
  ctx.openSheet(`<h3>${esc(a.name)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    ${card(v, { act: null, big: true })}
    <div class="acc-stats">
      <div><span>In this month</span><b class="income">${formatMoney(inM, a.currency)}</b></div>
      <div><span>Out this month</span><b>${formatMoney(outM, a.currency)}</b></div>
      <div><span>Records</span><b>${count}</b></div>
    </div>
    <p class="muted small" style="margin:-4px 0 12px">${[a.bank, KIND[a.kind], a.last4 ? `•••• ${esc(a.last4)}` : null, a.currency, a.start ? `started with ${formatMoney(a.start, a.currency)}` : null].filter(Boolean).map(esc).join(' · ')}</p>
    ${coins ? `<div class="card" style="padding:6px 14px;margin-bottom:12px">${coins}</div>` : ''}
    <div class="btns" style="margin-bottom:14px">
      <button class="btn primary" id="acc-add-rec">Add record</button>
      <button class="btn" id="acc-move">Move money</button>
      ${a.kind === 'cash' ? '<button class="btn" id="acc-count">Count cash</button>' : ''}
      <button class="btn" id="acc-edit">Edit</button>
    </div>
    ${recent.length ? `<div class="list">${recent.map((t) => ctx.txRow(t, { showDate: true })).join('')}</div>` : '<p class="muted">No records in this account yet.</p>'}`, (sheet) => {
    sheet.querySelector('#acc-add-rec').addEventListener('click', () => { ctx.closeSheet(); ctx.openTxSheet(null, { account: id, from: id }); });
    sheet.querySelector('#acc-move').addEventListener('click', () => { ctx.closeSheet(); ctx.openTransferSheet(id); });
    sheet.querySelector('#acc-count')?.addEventListener('click', () => countCash(id));
    sheet.querySelector('#acc-edit').addEventListener('click', () => editAccount(id));
    sheet.addEventListener('click', (e) => {
      const row = e.target.closest('[data-act="edit"]');
      if (row) { ctx.closeSheet(); ctx.openTxSheet(ctx.state.tx.find((t) => t.id === row.dataset.id)); }
    });
  });
}

// Count the real cash; the difference becomes one "untracked cash" record.
function countCash(id) {
  const { state } = ctx;
  const a = M.account(state, id);
  const expected = M.accountBalances(state)[id] || 0;
  ctx.openSheet(`<h3>Count ${esc(a.name)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="cash-form" novalidate>
      <p class="muted" style="margin-top:0">The app thinks there's <b>${formatMoney(expected, a.currency)}</b>. Count what's really there:</p>
      <div class="amount-input"><input id="cash-amt" type="text" inputmode="decimal" placeholder="0" aria-label="Cash counted"><span class="cur">${esc(a.currency)}</span></div>
      <p class="muted small">Any difference is logged as "untracked cash" (or "found cash"), so your numbers stay true.</p>
      <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Done</button></div>
    </form>`, (sheet) => {
    sheet.querySelector('#cash-amt').focus();
    sheet.querySelector('#cash-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const counted = evalAmount(sheet.querySelector('#cash-amt').value);
      if (counted == null) return;
      const r = cashCheck(state, id, counted, { date: todayISO(), id: M.uid(), rate: a.currency === state.settings.currency ? 1 : ctx.suggestedRate(a.currency) || 1 });
      if (r.tx) state.tx.push(r.tx);
      state.meta.lastCashCheck = todayISO();
      ctx.commit();
      ctx.closeSheet();
      if (!r.diff) ctx.buddy?.({ mood: 'proud', text: `${a.name} matches to the last ban. Perfect tracking! 🏆` });
      else ctx.buddy?.({ mood: r.diff < 0 ? 'thinking' : 'happy', text: r.diff < 0 ? `${formatMoney(-r.diff, a.currency)} went untracked. Logged it. Let's log cash right away this week 😉` : `Found ${formatMoney(r.diff, a.currency)}! Added it.` });
      ctx.toast(r.diff ? `Difference of ${formatMoney(Math.abs(r.diff), a.currency)} logged` : 'Matches exactly ✓');
    });
  });
}

function editAccount(id) {
  const { state } = ctx;
  const existing = id ? M.account(state, id) : null;
  const a = existing ? { ...existing, holdings: (existing.holdings || []).map((h) => ({ ...h })) } : {
    id: `a-${M.uid()}`, name: '', bank: '', kind: 'card', currency: state.settings.currency, start: 0, last4: '', color: (state.settings.accounts.length % 8) + 1, savings: false, archived: false, holdings: [],
  };
  const used = existing && state.tx.some((t) => t.account === id || t.from === id || t.to === id);

  const balance = existing ? M.accountBalances(state)[id] || 0 : 0;
  const preview = () => card({ account: a, own: existing ? balance - (existing.start || 0) + (a.start || 0) : a.start || 0, inBase: null }, { act: null, big: true });
  const html = () => `<h3>${existing ? 'Edit account' : 'New account'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <div id="acc-preview">${preview()}</div>
    <form id="acc-form" novalidate>
      <div class="row2">
        <label class="field"><span>Name</span><input id="a-name" type="text" value="${esc(a.name)}" placeholder="e.g. maib Visa, Victoriabank USD" required></label>
        <label class="field"><span>Bank or place</span><input id="a-bank" type="text" list="bank-list" value="${esc(a.bank)}" placeholder="e.g. maib"></label>
      </div>
      <datalist id="bank-list">${BANKS.map((b) => `<option value="${esc(b)}">`).join('')}</datalist>
      <div class="row2">
        <label class="field"><span>Type</span><select id="a-kind">${M.ACCOUNT_KINDS.map((k) => `<option value="${k.id}" ${a.kind === k.id ? 'selected' : ''}>${k.name}</option>`).join('')}</select></label>
        <label class="field"><span>Currency</span><select id="a-currency" ${used && existing.currency ? 'disabled title="Has records in this currency"' : ''}>${FIAT.map((c) => `<option value="${c.code}" ${a.currency === c.code ? 'selected' : ''}>${c.code} · ${esc(c.name)}</option>`).join('')}</select></label>
      </div>
      <div class="row2">
        <label class="field"><span>Card's last 4 digits (optional)</span><input id="a-last4" type="text" inputmode="numeric" maxlength="4" value="${esc(a.last4)}" placeholder="1234"></label>
        <label class="field"><span>Balance before you started logging</span><input id="a-start" type="text" inputmode="decimal" value="${centsToPlain(a.start || 0)}"></label>
      </div>
      <div class="field"><span class="lbl">Card color</span><div class="theme-picks">${CARD_THEMES.map((t) => `<button type="button" class="theme-pick theme-${t.id}" data-theme="${t.id}" title="${t.name}" aria-label="${t.name}" aria-pressed="${(a.cardTheme || themeOf(a).id) === t.id}"></button>`).join('')}<label class="theme-pick custom-pick" title="Your own color" aria-pressed="${a.cardTheme === 'custom'}" ${a.cardTheme === 'custom' ? `style="background:${esc(a.cardColor)}"` : ''}>+<input type="color" id="a-color" value="${esc(a.cardColor || '#2a6fd1')}" aria-label="Your own color"></label></div></div>
      <div class="field"><span class="lbl">Bank logo (optional)</span><div class="logo-row">${a.logo ? `<img src="${esc(a.logo)}" alt="Logo">` : ''}<label class="btn">${a.logo ? 'Change logo' : 'Upload logo'}<input type="file" id="a-logo" accept="image/*" hidden></label>${a.logo ? '<button type="button" class="btn" id="a-logo-del">Remove</button>' : ''}</div>
        <p class="muted small" style="margin:6px 0 0">Any image, e.g. your bank's logo saved from its website. It stays in your own data.</p></div>
      <label class="field check"><input id="a-savings" type="checkbox" ${a.savings || a.kind === 'savings' ? 'checked' : ''}><span>Counts as savings (shown in Savings and the goal)</span></label>
      ${existing ? `<label class="field check"><input id="a-archived" type="checkbox" ${a.archived ? 'checked' : ''}><span>Archived (closed card or account: hidden, history kept)</span></label>` : ''}
      <div id="coins" ${a.kind === 'crypto' ? '' : 'hidden'}>
        <div class="field"><span class="lbl">Coins held</span>
          ${a.holdings.map((h, i) => `<div class="coin-row"><select data-coin="${i}" data-f="asset">${[...new Set([...CRYPTO, h.asset])].map((c) => `<option ${c === h.asset ? 'selected' : ''}>${c}</option>`).join('')}</select><input type="text" inputmode="decimal" data-coin="${i}" data-f="qty" value="${esc(h.qty)}" placeholder="0.00"><button type="button" class="icon-btn" data-coin-del="${i}" aria-label="Remove">✕</button></div>`).join('')}
          <button type="button" class="btn" id="coin-add">+ Add coin</button>
          <p class="muted small">Type what you hold. Binance accounts can fill this automatically (Settings → Binance).</p>
        </div>
      </div>
      <p class="muted small" id="acc-error" style="color:var(--expense)"></p>
      <div class="btns">
        ${existing && !used ? '<button type="button" class="btn danger" id="acc-delete">Delete</button>' : ''}
        <button type="submit" class="btn primary">${existing ? 'Save' : 'Add account'}</button>
      </div>
    </form>`;

  const read = (sheet) => {
    const v = (s) => sheet.querySelector(s);
    a.name = v('#a-name').value.trim();
    a.bank = v('#a-bank').value.trim();
    a.kind = v('#a-kind').value;
    if (!v('#a-currency').disabled) a.currency = v('#a-currency').value;
    a.last4 = v('#a-last4').value.replace(/\D/g, '').slice(0, 4);
    a.start = evalAmount(v('#a-start').value) || 0;
    a.savings = v('#a-savings').checked;
    if (v('#a-archived')) a.archived = v('#a-archived').checked;
    for (const el of sheet.querySelectorAll('[data-coin]')) {
      const h = a.holdings[Number(el.dataset.coin)];
      if (h) h[el.dataset.f] = el.dataset.f === 'qty' ? el.value.replace(',', '.') : el.value;
    }
  };

  const refreshPreview = (sheet) => { sheet.querySelector('#acc-preview').innerHTML = preview(); };
  const paint = (sheet) => {
    sheet.innerHTML = `<div class="grab"></div>${html()}`;
    sheet.querySelector('#acc-form').addEventListener('input', (e) => {
      if (e.target.id === 'a-color') {
        a.cardTheme = 'custom';
        a.cardColor = e.target.value;
        const lbl = e.target.closest('.custom-pick');
        lbl.style.background = a.cardColor;
        for (const b of sheet.querySelectorAll('.theme-pick')) b.setAttribute('aria-pressed', String(b === lbl));
      }
      read(sheet);
      refreshPreview(sheet);
    });
    sheet.querySelector('#a-logo').addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      read(sheet);
      try { a.logo = await readLogo(f); } catch (err) { ctx.toast(err.message); return; }
      paint(sheet);
    });
    sheet.querySelector('#a-kind').addEventListener('change', (e) => {
      read(sheet);
      if (e.target.value === 'savings') a.savings = true;
      paint(sheet);
    });
    sheet.querySelector('#acc-form').addEventListener('submit', (e) => {
      e.preventDefault();
      read(sheet);
      if (!a.name) { sheet.querySelector('#acc-error').textContent = 'Give the account a name.'; sheet.querySelector('#a-name').focus(); return; }
      a.holdings = a.holdings.filter((h) => h.asset && Number(h.qty) > 0).map((h) => ({ asset: h.asset, qty: Number(h.qty) }));
      M.touch(a);
      if (existing) Object.assign(existing, a);
      else ctx.state.settings.accounts.push(a);
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(existing ? 'Account saved' : `${a.name} added`);
    });
  };

  ctx.openSheet('', (sheet) => {
    sheet.addEventListener('click', (e) => {
      const pick = e.target.closest('.theme-pick[data-theme]');
      if (pick) {
        read(sheet);
        a.cardTheme = pick.dataset.theme;
        a.color = THEME_DOT[a.cardTheme] || a.color;
        for (const b of sheet.querySelectorAll('.theme-pick')) b.setAttribute('aria-pressed', String(b === pick));
        refreshPreview(sheet);
        return;
      }
      if (e.target.closest('#a-logo-del')) { read(sheet); a.logo = null; paint(sheet); return; }
      if (e.target.closest('#coin-add')) { read(sheet); a.holdings.push({ asset: 'BTC', qty: '' }); paint(sheet); return; }
      const del = e.target.closest('[data-coin-del]');
      if (del) { read(sheet); a.holdings.splice(Number(del.dataset.coinDel), 1); paint(sheet); return; }
      if (e.target.closest('#acc-delete')) {
        const st = ctx.state;
        st.settings.accounts = st.settings.accounts.filter((x) => x.id !== id);
        st.deleted[id] = Date.now();
        ctx.commit();
        ctx.closeSheet();
        ctx.toast('Account deleted');
      }
    });
    paint(sheet);
    sheet.querySelector('#a-name').focus();
  });
}

export function onClick(act, el) {
  if (act === 'acc-new') { editAccount(null); return true; }
  if (act === 'acc-open') { openAccount(el.dataset.id); return true; }
  if (act === 'nw-range') { ctx.ui.nwRange = Number(el.dataset.n); ctx.render(); return true; }
  return false;
}

export { editAccount, openAccount };
