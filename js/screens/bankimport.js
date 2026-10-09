// Import a bank statement (CSV or Excel from maib, Victoriabank or any bank):
// pick or confirm which column is what, the account it belongs to, check
// the preview and totals, import. The choices are remembered for the next
// statement with the same layout (settings.bankPresets, synced).

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { FIELDS, guessMapping, parseStatement, signature } from '../bank.js';
import { parseCSV } from '../csv.js';
import { readWorkbook } from '../xlsx-read.js';
import { formatMoney } from '../money.js';
import { dayLabel, monthLabel } from '../dates.js';

// Bank CSVs are often not UTF-8 (Windows Cyrillic or Central European).
export function decodeText(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    for (const enc of ['windows-1251', 'windows-1250']) {
      const text = new TextDecoder(enc).decode(buf);
      if (guessMapping(parseCSV(text))) return text;
    }
    return new TextDecoder('windows-1251').decode(buf);
  }
}

export async function rowsFromFile(file) {
  if (/\.xlsx$/i.test(file.name)) {
    const sheets = await readWorkbook(await file.arrayBuffer());
    const withData = sheets.filter((s) => guessMapping(s.rows));
    return (withData[0] || sheets[0])?.rows || [];
  }
  return parseCSV(decodeText(await file.arrayBuffer()));
}

function findPreset(rows) {
  const presets = ctx.state.settings.bankPresets || {};
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const p = presets[signature(rows, r)];
    if (p) return { ...p, headerRow: r };
  }
  return null;
}

export function openBankImport(rows, { fileName = '' } = {}) {
  const { state } = ctx;
  const accounts = M.activeAccounts(state);
  const preset = findPreset(rows);
  const guess = guessMapping(rows);
  const cfg = {
    headerRow: preset?.headerRow ?? guess?.headerRow ?? 0,
    map: { ...(preset?.map || guess?.map || {}) },
    flip: !!preset?.flip,
    account: accounts.some((a) => a.id === preset?.account) ? preset.account : accounts.find((a) => a.kind === 'card')?.id || accounts[0]?.id,
  };
  let res = null;

  const header = () => (rows[cfg.headerRow] || []).map((h, i) => ({ i, name: String(h ?? '').trim() || `Column ${i + 1}` }));
  const colSelect = (f) => `<label class="field"><span>${esc(f.label)}</span><select data-map="${f.id}">
    <option value="">—</option>${header().map((h) => `<option value="${h.i}" ${cfg.map[f.id] === h.i ? 'selected' : ''}>${esc(h.name)}</option>`).join('')}</select></label>`;

  const preview = () => {
    const ok = cfg.map.date != null && (cfg.map.amount != null || cfg.map.debit != null || cfg.map.credit != null);
    res = ok ? parseStatement(rows, cfg, state, cfg) : null;
    if (!ok) return '<p class="lock-msg">Pick the date column and either the amount column or the money in / out columns.</p>';
    if (!res.tx.length) return `<p class="muted">${res.duplicates ? `All ${res.duplicates} records are already in the app.` : 'No rows with a date and an amount under these headings. Check the heading row and the columns.'}</p>`;
    const cur = (t) => formatMoney(t.type === 'income' ? t.amount : -t.amount, t.currency, { sign: t.type === 'income' });
    return `<div class="split-row"><span>${res.tx.filter((t) => t.type === 'income').length} in</span><b class="money income">${ctx.money(res.income)}</b></div>
      <div class="split-row"><span>${res.tx.filter((t) => t.type === 'expense').length} out</span><b class="money expense">${ctx.money(res.expense)}</b></div>
      ${res.duplicates ? `<div class="split-row"><span class="muted">Already in the app, skipped</span><b>${res.duplicates}</b></div>` : ''}
      ${res.skipped ? `<div class="split-row"><span class="muted">Rows without a date or amount (totals, notes)</span><b>${res.skipped}</b></div>` : ''}
      <p class="muted small">${res.months.map((m) => monthLabel(m)).join(', ')}. Check the totals against the statement.</p>
      <div class="bank-prev">${res.tx.slice(0, 8).map((t) => `<div class="bp-row"><span class="muted">${esc(dayLabel(t.date))}</span><span class="bp-note">${esc(t.note || '—')}</span><span class="bp-cat">${esc(M.category(state, t.category)?.name || '')}</span><b class="${t.type === 'income' ? 'income' : ''}">${cur(t)}</b></div>`).join('')}
      ${res.tx.length > 8 ? `<p class="muted small" style="margin:6px 0 0">…and ${res.tx.length - 8} more</p>` : ''}</div>`;
  };

  const html = () => `<div class="grab"></div><h3>Import bank statement <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    ${fileName ? `<p class="muted small" style="margin-top:0">${esc(fileName)}${preset ? ' · same layout as last time, settings remembered' : ''}</p>` : ''}
    <div class="row2">
      <label class="field"><span>Account</span><select id="bk-acc">${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === cfg.account ? 'selected' : ''}>${esc(a.name)} · ${esc(a.currency)}</option>`).join('')}</select></label>
      <label class="field"><span>Headings are on row</span><input id="bk-head" type="number" min="1" max="${rows.length}" value="${cfg.headerRow + 1}"></label>
    </div>
    <details class="bank-map" ${guess || preset ? '' : 'open'}><summary>Columns: ${FIELDS.filter((f) => cfg.map[f.id] != null).map((f) => esc(f.label.replace(/ \(.*/, ''))).join(', ') || 'not set'}</summary>
      <div class="bank-cols">${FIELDS.map(colSelect).join('')}</div>
      ${cfg.map.amount != null ? `<label class="field check"><input type="checkbox" id="bk-flip" ${cfg.flip ? 'checked' : ''}><span>Money out shows as positive numbers</span></label>` : ''}
    </details>
    <div id="bk-preview">${preview()}</div>
    <div class="btns" style="margin-top:12px"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="button" id="bk-go" ${res?.tx.length ? '' : 'disabled'}>Import ${res?.tx.length || ''}</button></div>`;

  ctx.openSheet('', (sheet) => {
    const paint = () => {
      const open = sheet.querySelector('.bank-map')?.open;
      sheet.innerHTML = html();
      if (open) sheet.querySelector('.bank-map').open = true;
    };
    paint();
    sheet.addEventListener('change', (e) => {
      const el = e.target;
      if (el.dataset.map) {
        const v = el.value === '' ? null : Number(el.value);
        if (v == null) delete cfg.map[el.dataset.map];
        else {
          for (const k of Object.keys(cfg.map)) if (cfg.map[k] === v) delete cfg.map[k];
          cfg.map[el.dataset.map] = v;
        }
      } else if (el.id === 'bk-head') {
        cfg.headerRow = Math.max(0, Math.min(rows.length - 1, Number(el.value) - 1 || 0));
        const g = guessMapping(rows.slice(cfg.headerRow, cfg.headerRow + 1));
        cfg.map = g ? g.map : {};
      } else if (el.id === 'bk-flip') cfg.flip = el.checked;
      else if (el.id === 'bk-acc') cfg.account = el.value;
      paint();
    });
    sheet.addEventListener('click', (e) => {
      if (!e.target.closest('#bk-go') || !res?.tx.length) return;
      const st = ctx.state;
      st.settings.bankPresets = { ...(st.settings.bankPresets || {}), [signature(rows, cfg.headerRow)]: { map: cfg.map, flip: cfg.flip, account: cfg.account } };
      st.settings.updatedAt = Date.now();
      st.tx.push(...res.tx);
      ctx.commit();
      ctx.closeSheet();
      if (res.months.length) ctx.ui.month = res.months.at(-1);
      location.hash = '#log';
      ctx.toast(`Imported ${res.tx.length} records from the statement. Categories are guessed; fix any in the Log.`);
    });
  });
}
