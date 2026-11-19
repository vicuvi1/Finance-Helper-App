// "Export all money" (one click: the transactions CSV and a workbook with
// every table) and the import of that same CSV back, with a preview that
// lists what is new and what is already here (js/moneyexport.js).

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import * as X from '../moneyexport.js';
import { workbook } from '../xlsx.js';
import { formatMoney } from '../money.js';
import { todayISO } from '../dates.js';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function exportAll() {
  const st = ctx.state;
  const day = todayISO();
  const csv = X.csvText(X.txRows(st));
  if (ctx.download(`money-transactions-${day}.csv`, csv, 'text/csv;charset=utf-8') === false) return;
  ctx.download(`money-all-${day}.xlsx`, workbook(X.workbookSheets(st)), XLSX_TYPE);
  ctx.toast(`Exported ${st.tx.length} records (CSV) and every table (Excel)`);
}

const s = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function openImport(rows) {
  const st = ctx.state;
  const p = X.previewImport(rows, st);
  const base = st.settings.currency;
  const sum = (type) => p.add.filter((t) => t.type === type && !t.loan && !t.reconcile).reduce((a, t) => a + (Number.isInteger(t.base) ? t.base : 0), 0);
  const months = [...new Set(p.add.map((t) => t.date.slice(0, 7)))].sort();
  const line = (label, n, testid) => (n ? `<div class="split-row" data-testid="${testid}"><span class="muted">${label}</span><b>${n}</b></div>` : '');
  ctx.openSheet(`<h3>Import money export <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p style="margin-top:0">${months.length ? `${esc(months[0])}${months.length > 1 ? ` – ${esc(months.at(-1))}` : ''}` : 'Nothing new in this file.'}</p>
    <div class="split-row" data-testid="mx-new"><span>New records</span><b>${p.add.length}</b></div>
    ${p.add.length ? `<div class="split-row"><span class="muted">Income in them</span><b class="money income">${esc(formatMoney(sum('income'), base))}</b></div><div class="split-row"><span class="muted">Spending in them</span><b class="money expense">${esc(formatMoney(sum('expense'), base))}</b></div>` : ''}
    ${line('Already here, skipped', p.duplicates.length, 'mx-dup')}
    ${line('Here with other values, kept as they are here', p.changed.length, 'mx-changed')}
    ${line('Deleted on this device, skipped', p.deletedHere.length, 'mx-deleted')}
    ${line('Rows that could not be read', p.invalid.length, 'mx-invalid')}
    ${p.invalid.length ? `<p class="muted small">${p.invalid.slice(0, 5).map((x) => `Row ${x.line}: ${esc(x.reason)}`).join('<br>')}${p.invalid.length > 5 ? '<br>…' : ''}</p>` : ''}
    ${p.newPeople.length ? `<p class="muted small">New people will be added: ${p.newPeople.slice(0, 8).map(esc).join(', ')}${p.newPeople.length > 8 ? '…' : ''}.</p>` : ''}
    <p class="muted small">Nothing here is changed or deleted: only new records are added, each with its own rate and ${esc(base)} value from the file. Undo takes them back out.</p>
    <div class="btns"><button class="btn" data-close>Cancel</button><button class="btn primary" id="mx-go" data-testid="mx-go" ${p.add.length ? '' : 'disabled'}>Import ${s(p.add.length, 'record', 'records')}</button></div>`, (sheet) => {
    sheet.querySelector('#mx-go')?.addEventListener('click', () => {
      if (!p.add.length) return;
      const n = X.applyImport(ctx.state, p, { ensurePerson: M.ensurePerson });
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(`Imported ${s(n, 'record', 'records')}`, 'Undo', () => ctx.undo?.());
    });
  });
}
