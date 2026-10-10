// Rates & converter: live exchange rates, coin prices and a converter that
// works between any currency and coin.

import { ctx, esc } from '../ctx.js';
import { FIAT, CRYPTO, convertAny, pairRate, coinUsd, formatRate, formatQty } from '../fx.js';
import { formatMoney } from '../money.js';
import { rateAdvice, adviceText, heldIn } from '../fxsmart.js';
import { accountBalances } from '../model.js';
import { todayISO } from '../dates.js';

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
  <div class="rates-col">
  ${adviceCards()}
  <section class="card"><h2>Currencies <span class="right muted">in ${esc(base)}</span></h2>
    <div class="table-wrap"><table><thead><tr><th>Currency</th><th>1 unit = ${esc(base)}</th><th>1 ${esc(base)} =</th></tr></thead><tbody>${fiatRows}</tbody></table></div>
    <p class="muted small" style="margin-bottom:0">${src.mdl ? `MDL: official rate of the ${esc(src.mdl.name)}${src.mdl.date ? ` (${esc(src.mdl.date)})` : ''}. ` : ''}${src.fiat ? `Others: ${esc(src.fiat.name)}.` : 'No rates downloaded yet.'}</p>
  </section>
  </div>
  <div class="rates-col">
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
  <section class="card"><h2>Crypto <span class="right muted">${src.crypto ? esc(src.crypto.name) : ''}</span></h2>
    <div class="table-wrap"><table><thead><tr><th>Coin</th><th>USD</th><th>${esc(base)}</th></tr></thead><tbody>${coinRows}</tbody></table></div>
  </section>
  </div>`;
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

// ---------- Convert now? ----------

// 90 days of the rate as a line, with the average dashed; hover a day for
// its rate.
function rateChart(a, cur, base) {
  const pts = a.series;
  if (pts.length < 2) return '';
  const w = 560;
  const h = 120;
  const vals = pts.map((p) => p.rate);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const x = (i) => 4 + (i / (pts.length - 1)) * (w - 8);
  const y = (v) => 10 + (1 - (v - lo) / span) * (h - 22);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.rate).toFixed(1)}`).join(' ');
  const avgY = y(a.avg).toFixed(1);
  const last = pts.length - 1;
  return `<svg class="fx-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${cur} in ${base} over 90 days, from ${lo.toFixed(2)} to ${hi.toFixed(2)}">
    <line x1="0" x2="${w}" y1="${avgY}" y2="${avgY}" class="fx-avg"/>
    <path d="${line}" class="fx-line"/>
    ${pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.rate).toFixed(1)}" r="${i === last ? 4.5 : 9}" class="${i === last ? 'fx-now' : 'fx-hit'}"><title>${p.date}: 1 ${cur} = ${p.rate.toFixed(4)} ${base}</title></circle>`).join('')}
  </svg>
  <div class="fx-axis"><span>${pts[0].date.slice(5).split('-').reverse().join('.')}</span><span class="fx-avg-l">average ${a.avg.toFixed(2)}</span><span>today</span></div>`;
}

const PILL = { high: ['pill-in', 'Good day to convert'], low: ['pill-out', 'Low today'], normal: ['pill-gold', 'Ordinary day'], unknown: ['pill-gold', 'Learning'] };

function adviceCard(cur) {
  const { state } = ctx;
  const base = state.settings.currency;
  const a = rateAdvice(state, cur, todayISO());
  if (!a) return '';
  const held = heldIn(state, cur, accountBalances(state));
  const [cls, label] = PILL[a.verdict];
  const worth = held && a.avg ? Math.round((held * a.rate - held * a.avg) / 100) * 100 : 0;
  return `<section class="card fx-card"><h2>Convert ${esc(cur)} now? <span class="pill ${cls} right">${label}</span></h2>
    <p class="fx-text">${esc(adviceText(a, cur, base))}</p>
    ${a.verdict !== 'unknown' ? rateChart(a, cur, base) : ''}
    ${held ? `<p class="muted small">You hold <b>${formatMoney(held, cur)}</b> = ${formatMoney(Math.round(held * a.rate), base)} today${worth ? `, ${formatMoney(Math.abs(worth), base)} ${worth > 0 ? 'more' : 'less'} than at the average rate` : ''}.</p>` : ''}
    <p class="muted small" style="margin-bottom:0">${a.verdict === 'unknown' ? 'The app saves the rate every day; ' : `Based on ${a.points} days of rates${a.min ? ` (${a.min.toFixed(2)}–${a.max.toFixed(2)})` : ''}. `}Rates move unpredictably; this shows where today sits, not where it's going.</p>
  </section>`;
}

// USD always (clients pay in it), plus any other currency you hold.
function adviceCards() {
  const { state } = ctx;
  const base = state.settings.currency;
  const curs = new Set(['USD']);
  for (const a of state.settings.accounts) if (!a.archived && a.currency && a.currency !== base && !CRYPTO.includes(a.currency)) curs.add(a.currency);
  curs.delete(base);
  return [...curs].map(adviceCard).join('');
}
