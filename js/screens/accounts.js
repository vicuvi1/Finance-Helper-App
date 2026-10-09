// Accounts & savings: every wallet, card, bank and crypto account, grouped,
// with balances in their own currency and in MDL, plus savings over time.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { FIAT, CRYPTO, formatQty, coinValue } from '../fx.js';
import { formatMoney, evalAmount, centsToPlain } from '../money.js';
import { monthKey, addMonths, daysInMonth, monthLabel, todayISO } from '../dates.js';
import { lineChart } from '../charts.js';

export const BANKS = ['Cash', 'maib', 'Victoriabank', 'Moldindconbank', 'OTP Bank', 'MICB', 'FinComBank', 'Eximbank', 'Energbank', 'ProCredit Bank', 'Paynet', 'Revolut', 'Wise', 'Paysera', 'PayPal', 'Binance'];

const KIND = Object.fromEntries(M.ACCOUNT_KINDS.map((k) => [k.id, k.name]));
const swatch = (a) => `var(--c${a.color || 1})`;
const isSaving = (a) => a.savings || a.kind === 'savings';

function bankMark(a) {
  const src = a.bank && a.bank !== 'Cash' ? a.bank : a.name;
  const letter = esc((src || '?').trim()[0]?.toUpperCase() || '?');
  return `<span class="av" style="--c:${swatch(a)}" aria-hidden="true">${letter}</span>`;
}

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

function accountRow(v) {
  const { state } = ctx;
  const a = v.account;
  const base = state.settings.currency;
  const own = a.kind === 'crypto' && (a.holdings || []).length
    ? `${(a.holdings || []).length} coin${a.holdings.length === 1 ? '' : 's'}`
    : formatMoney(v.own, a.currency);
  const sub = [a.bank, KIND[a.kind], a.last4 ? `•• ${esc(a.last4)}` : null, a.currency !== base ? a.currency : null].filter(Boolean).join(' · ');
  return `<button class="tx acc-row" data-act="acc-open" data-id="${esc(a.id)}">
    ${bankMark(a)}
    <span class="t"><b>${esc(a.name)}${isSaving(a) ? ' <span class="pill pill-gold">savings</span>' : ''}</b><span>${sub}</span></span>
    <span class="amount ${v.own < 0 ? 'expense' : ''}">${own}${(a.currency !== base || a.holdings?.length) && v.inBase != null ? `<span class="sub-amt">≈ ${ctx.money(Math.round(v.inBase / 100) * 100)}</span>` : v.inBase == null ? '<span class="sub-amt">no rate yet</span>' : ''}</span>
  </button>`;
}

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
  <div class="dash">
    <div class="dash-main">
      ${groups.map((g) => `<section class="card"><h2>${esc(g.kind.name)} <span class="right muted">${ctx.money(Math.round(g.items.reduce((a, v) => a + (v.inBase || 0), 0) / 100) * 100)}</span></h2>
        <div class="list">${g.items.map(accountRow).join('')}</div></section>`).join('')}
      ${archived.length ? `<details class="card"><summary>Archived (${archived.length})</summary><div class="list">${archived.map(accountRow).join('')}</div></details>` : ''}
    </div>
    <div class="dash-side">
      <section class="card"><h2>Savings over 12 months</h2>${lineChart(hist, (c) => ctx.money(c))}</section>
    </div>
  </div>`;
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
  ctx.openSheet(`<h3>${esc(a.name)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p class="muted" style="margin-top:-8px">${[a.bank, KIND[a.kind], a.last4 ? `•• ${esc(a.last4)}` : null, a.currency].filter(Boolean).join(' · ')}</p>
    <div class="big" style="display:flex;align-items:baseline;gap:8px;margin:6px 0 14px"><span class="fig" style="font-size:36px">${formatMoney(v.own, '')}</span><span class="cur-sm">${esc(a.currency)}</span></div>
    ${coins ? `<div class="card" style="padding:6px 14px;margin-bottom:12px">${coins}</div>` : ''}
    <div class="btns" style="margin-bottom:14px">
      <button class="btn primary" id="acc-add-rec">Add record</button>
      <button class="btn" id="acc-move">Move money</button>
      <button class="btn" id="acc-edit">Edit</button>
    </div>
    ${recent.length ? `<div class="list">${recent.map((t) => ctx.txRow(t, { showDate: true })).join('')}</div>` : '<p class="muted">No records in this account yet.</p>'}`, (sheet) => {
    sheet.querySelector('#acc-add-rec').addEventListener('click', () => { ctx.closeSheet(); ctx.openTxSheet(null, { account: id, from: id }); });
    sheet.querySelector('#acc-move').addEventListener('click', () => { ctx.closeSheet(); ctx.openTransferSheet(id); });
    sheet.querySelector('#acc-edit').addEventListener('click', () => editAccount(id));
    sheet.addEventListener('click', (e) => {
      const row = e.target.closest('[data-act="edit"]');
      if (row) { ctx.closeSheet(); ctx.openTxSheet(ctx.state.tx.find((t) => t.id === row.dataset.id)); }
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

  const html = () => `<h3>${existing ? 'Edit account' : 'New account'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
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
      <div class="field"><span class="lbl">Color</span><div class="swatches">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<button type="button" class="sw" data-color="${n}" style="--c:var(--c${n})" aria-label="Color ${n}" aria-pressed="${a.color === n}"></button>`).join('')}</div></div>
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

  const paint = (sheet) => {
    sheet.innerHTML = `<div class="grab"></div>${html()}`;
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
      const sw = e.target.closest('.sw');
      if (sw) {
        a.color = Number(sw.dataset.color);
        for (const b of sheet.querySelectorAll('.sw')) b.setAttribute('aria-pressed', String(b === sw));
        return;
      }
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
  return false;
}

export { editAccount, openAccount };
