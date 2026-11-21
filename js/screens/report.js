// Reports → Report: pick a period, get an Excel file or a printable page (Save as PDF).
// Numbers and files: js/report.js.

import { ctx, esc } from '../ctx.js';
import { todayISO, monthLabel } from '../dates.js';
import { workbook } from '../xlsx.js';
import { isMoneyHidden } from '../money.js';
import { periods, reportData, reportSheets, reportHTML } from '../report.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function pick(sheet) {
  const p = sheet.querySelector('input[name="rep-period"]:checked')?.value;
  if (p === 'month') { const m = sheet.querySelector('#rep-month').value; return m ? { from: m, to: m, label: monthLabel(m) } : null; }
  if (p === 'range') { const a = sheet.querySelector('#rep-from-m').value; const b = sheet.querySelector('#rep-to-m').value; return a && b ? { from: a <= b ? a : b, to: a <= b ? b : a, label: '' } : null; }
  return periods(todayISO()).find((x) => x.id === p) || null;
}

function excel(per) {
  const { state } = ctx;
  const d = reportData(state, per.from, per.to, { title: per.label });
  const name = `finance-helper-report-${per.from}${per.to !== per.from ? `-to-${per.to}` : ''}.xlsx`;
  if (ctx.download(name, workbook(reportSheets(state, d)), XLSX)) ctx.toast(`${d.title}: Excel file saved`);
}

function pdf(per) {
  const d = reportData(ctx.state, per.from, per.to, { title: per.label });
  const root = document.getElementById('print-root');
  root.innerHTML = reportHTML(d, { hidden: isMoneyHidden() });
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  if (ctx.DEMO) { setTimeout(done, 4000); ctx.toast('This is how it prints. In the app, choose "Save as PDF" in the print window.'); return; }
  ctx.toast('In the print window choose "Save as PDF" (or "Microsoft Print to PDF").');
  setTimeout(() => window.print(), 80);
}

export function open() {
  const today = todayISO();
  const ps = periods(today);
  const m = today.slice(0, 7);
  ctx.openSheet(`<h3>Report <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p class="muted" style="margin-top:0">Totals, where the money went, month by month, subscriptions, accounts and every record.</p>
    <div class="rep-periods" role="radiogroup" aria-label="Period">
      ${ps.map((p, i) => `<label class="field check"><input type="radio" name="rep-period" value="${p.id}" ${i === 1 ? 'checked' : ''}><span>${esc(p.label)}</span></label>`).join('')}
      <label class="field check"><input type="radio" name="rep-period" value="month"><span>A month: <input type="month" id="rep-month" value="${m}" max="${m}"></span></label>
      <label class="field check"><input type="radio" name="rep-period" value="range"><span>From <input type="month" id="rep-from-m" value="${m.slice(0, 4)}-01" max="${m}"> to <input type="month" id="rep-to-m" value="${m}" max="${m}"></span></label>
    </div>
    <div class="btns"><button type="button" class="btn" id="rep-pdf" data-testid="rep-pdf">PDF (print)</button><button type="button" class="btn primary" id="rep-xlsx" data-testid="rep-xlsx">Excel</button></div>`, (sheet) => {
    for (const id of ['rep-month', 'rep-from-m', 'rep-to-m']) sheet.querySelector(`#${id}`).addEventListener('focus', (e) => { e.target.closest('label').querySelector('input[type=radio]').checked = true; });
    sheet.querySelector('#rep-xlsx').addEventListener('click', () => { const p = pick(sheet); if (!p) return ctx.toast('Pick the months first'); excel(p); });
    sheet.querySelector('#rep-pdf').addEventListener('click', () => { const p = pick(sheet); if (!p) return ctx.toast('Pick the months first'); ctx.closeSheet(); pdf(p); });
  });
}

let bound = false;
export function init() {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  document.addEventListener('click', (e) => { if (e.target.closest?.('[data-rep-open]')) open(); });
}
