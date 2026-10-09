// Rates & converter: live exchange rates, coin prices and a converter that
// works between any currency and coin.

import { ctx, esc } from '../ctx.js';
import { FIAT, CRYPTO, convertAny, pairRate, coinUsd, formatRate, formatQty } from '../fx.js';
import { formatMoney } from '../money.js';

const conv = { amount: '100', from: 'USD', to: 'MDL' };

function ago(ts) {
  if (!ts) return 'never';
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString();
}

function fmtNum(v, code) {
  if (v == null) return '–';
  if (CRYPTO.includes(code) && !['USDT', 'USDC'].includes(code)) return formatQty(v);
  return formatMoney(Math.round(v * 100), '');
}

function result() {
  const { state } = ctx;
  const amount = Number(String(conv.amount).replace(/\s/g, '').replace(',', '.'));
  const out = convertAny(amount, conv.from, conv.to, state.rates);
  const one = convertAny(1, conv.from, conv.to, state.rates);
  return {
    text: out == null ? 'No rate yet' : `${fmtNum(out, conv.to)} ${conv.to}`,
    line: one == null ? '' : `1 ${conv.from} = ${CRYPTO.includes(conv.to) ? formatQty(one) : formatRate(one)} ${conv.to}`,
  };
}

const options = (sel) => `<optgroup label="Currencies">${FIAT.map((c) => `<option value="${c.code}" ${sel === c.code ? 'selected' : ''}>${c.code} · ${esc(c.name)}</option>`).join('')}</optgroup>
  <optgroup label="Crypto">${CRYPTO.map((c) => `<option value="${c}" ${sel === c ? 'selected' : ''}>${c}</option>`).join('')}</optgroup>`;

export function view() {
  const { state } = ctx;
  const base = state.settings.currency;
  const r = state.rates;
  const res = result();
  const fiatRows = FIAT.filter((c) => c.code !== base).map((c) => {
    const rate = pairRate(c.code, base, r);
    return `<tr><td>${dotCode(c.code)} ${esc(c.name)}</td><td>${rate == null ? '–' : formatRate(rate)}</td><td>${rate == null ? '–' : formatRate(1 / rate)}</td></tr>`;
  }).join('');
  const held = new Map();
  for (const a of state.settings.accounts) for (const h of a.holdings || []) held.set(h.asset, (held.get(h.asset) || 0) + Number(h.qty || 0));
  const coinRows = CRYPTO.filter((c) => !['USDC'].includes(c)).map((c) => {
    const usd = coinUsd(r, c);
    const inBase = usd == null ? null : convertAny(usd, 'USD', base, r);
    const qty = held.get(c);
    return `<tr><td><b>${c}</b>${qty ? ` <span class="muted small">you hold ${formatQty(qty)}</span>` : ''}</td><td>${usd == null ? '–' : `$${formatMoney(Math.round(usd * 100), '')}`}</td><td>${inBase == null ? '–' : formatMoney(Math.round(inBase * 100), '')}</td></tr>`;
  }).join('');
  const src = r?.sources || {};
  return `<header class="top"><div><h1>Rates</h1><div class="sub">Updated ${esc(ago(r?.fetchedAt))}${ctx.DEMO ? ' · example rates in this preview' : ''}</div></div>
    <button class="btn" data-act="rates-refresh" ${ctx.ui.ratesBusy ? 'disabled' : ''}>${ctx.ui.ratesBusy ? 'Updating…' : 'Update now'}</button></header>
  <section class="card conv">
    <h2>Converter</h2>
    <div class="conv-row">
      <input type="text" inputmode="decimal" id="conv-amount" value="${esc(conv.amount)}" aria-label="Amount">
      <select id="conv-from" aria-label="From">${options(conv.from)}</select>
      <button type="button" class="icon-btn" data-act="conv-swap" aria-label="Swap">⇄</button>
      <select id="conv-to" aria-label="To">${options(conv.to)}</select>
    </div>
    <div class="conv-out"><span class="fig" id="conv-result">${esc(res.text)}</span></div>
    <p class="muted small" id="conv-line" style="margin:6px 0 0">${esc(res.line)}</p>
  </section>
  <section class="card"><h2>Currencies <span class="right muted">in ${esc(base)}</span></h2>
    <div class="table-wrap"><table><thead><tr><th>Currency</th><th>1 unit = ${esc(base)}</th><th>1 ${esc(base)} =</th></tr></thead><tbody>${fiatRows}</tbody></table></div>
    <p class="muted small" style="margin-bottom:0">${src.mdl ? `MDL: official rate of the ${esc(src.mdl.name)}${src.mdl.date ? ` (${esc(src.mdl.date)})` : ''}. ` : ''}${src.fiat ? `Others: ${esc(src.fiat.name)}.` : 'No rates downloaded yet.'}</p>
  </section>
  <section class="card"><h2>Crypto <span class="right muted">${src.crypto ? esc(src.crypto.name) : ''}</span></h2>
    <div class="table-wrap"><table><thead><tr><th>Coin</th><th>USD</th><th>${esc(base)}</th></tr></thead><tbody>${coinRows}</tbody></table></div>
  </section>`;
}

const dotCode = (code) => `<span class="code-tag">${code}</span>`;

function updateResult() {
  const res = result();
  const out = document.getElementById('conv-result');
  if (out) out.textContent = res.text;
  const line = document.getElementById('conv-line');
  if (line) line.textContent = res.line;
}

export function onInput(el) {
  if (el.id === 'conv-amount') { conv.amount = el.value; updateResult(); return true; }
  return false;
}

export function onChange(el) {
  if (el.id === 'conv-from' || el.id === 'conv-to') {
    conv[el.id === 'conv-from' ? 'from' : 'to'] = el.value;
    updateResult();
    return true;
  }
  return false;
}

export function onClick(act) {
  if (act === 'conv-swap') {
    [conv.from, conv.to] = [conv.to, conv.from];
    ctx.render();
    return true;
  }
  if (act === 'rates-refresh') {
    ctx.updateRates({ force: true, announce: true });
    return true;
  }
  return false;
}
