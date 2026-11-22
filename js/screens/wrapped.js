// "Money wrapped": the month's recap as one picture to keep or share (amounts left
// out unless you tick them). Drawn on a canvas; nothing leaves the device unless you share it.
import { ctx, esc } from '../ctx.js';
import { formatMoney } from '../money.js';
import { todayISO } from '../dates.js';
import { monthRecap } from '../recap.js';
import { streaks } from '../streaks.js';

function draw(canvas, r, s, withAmounts) {
  const W = 1080; const H = 1350;
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const grd = g.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, '#14161d'); grd.addColorStop(1, '#2a2416');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  const gold = '#e3b95f'; const light = '#f2efe8'; const muted = '#a7a39a';
  const cur = ctx.state.settings.currency;
  const fm = (c) => formatMoney(Math.round(c / 100) * 100, cur, { reveal: true });
  g.fillStyle = gold; g.font = '600 40px Georgia, serif'; g.fillText('Money wrapped', 80, 120);
  g.fillStyle = light; g.font = '500 96px Georgia, serif'; g.fillText(r.label, 80, 240);
  const rows = [];
  if (r.rate != null) rows.push(['You kept', `${Math.round(r.rate * 100)}%${withAmounts ? ` · ${fm(r.kept)}` : ''}`]);
  if (r.top?.[0]) rows.push(['Most went to', `${r.top[0].emoji ? `${r.top[0].emoji} ` : ''}${r.top[0].name} · ${Math.round(r.top[0].share * 100)}%`]);
  if (withAmounts) rows.push(['Spent', fm(r.spent)]);
  rows.push(['No-spend days', String(r.noSpend ?? 0)]);
  if (r.busiest) rows.push(['Busiest day', r.busiest]);
  if (s.logging >= 3) rows.push(['Logging streak', `🔥 ${s.logging} days`]);
  if (r.toSavings > 0) rows.push(['Moved to savings', withAmounts ? fm(r.toSavings) : 'yes ✓']);
  let y = 380;
  for (const [k, v] of rows) {
    g.fillStyle = muted; g.font = '400 34px system-ui, sans-serif'; g.fillText(k, 80, y);
    g.fillStyle = light; g.font = '600 58px system-ui, sans-serif'; g.fillText(v, 80, y + 66);
    y += 140;
  }
  g.fillStyle = muted; g.font = '400 28px system-ui, sans-serif'; g.fillText('Finance Helper', 80, H - 70);
}

export function open(key) {
  const r = monthRecap(ctx.state, key);
  const s = streaks(ctx.state, todayISO());
  if (document.querySelector('.sheet')) ctx.closeSheet();
  ctx.openSheet(`<h3>${esc(r.label)} wrapped <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <canvas id="wr-canvas" class="wr-canvas" data-testid="wrapped-canvas" aria-label="Your month as a picture"></canvas>
    <label class="field check"><input type="checkbox" id="wr-amounts"><span>Show amounts on the picture</span></label>
    <div class="btns"><button type="button" class="btn" id="wr-save" data-testid="wrapped-save">Save picture</button>${navigator.canShare ? '<button type="button" class="btn primary" id="wr-share">Share…</button>' : ''}</div>`, (sheet) => {
    const canvas = sheet.querySelector('#wr-canvas');
    const paint = () => draw(canvas, r, s, sheet.querySelector('#wr-amounts').checked);
    paint();
    sheet.querySelector('#wr-amounts').addEventListener('change', paint);
    const blob = () => new Promise((res) => canvas.toBlob(res, 'image/png'));
    sheet.querySelector('#wr-save').addEventListener('click', async () => { if (ctx.download(`money-wrapped-${key}.png`, await blob(), 'image/png')) ctx.toast('Picture saved'); });
    sheet.querySelector('#wr-share')?.addEventListener('click', async () => {
      const file = new File([await blob()], `money-wrapped-${key}.png`, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: `${r.label} wrapped` }).catch(() => {});
      else ctx.toast('Sharing isn\'t available here: use Save picture.');
    });
  });
}

let bound = false;
export function init() {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-wrapped]');
    if (!b) return;
    // The recap closes itself (data-recap-close); the picture opens right after.
    setTimeout(() => open(b.dataset.wrapped), 80);
  }, true);
}
