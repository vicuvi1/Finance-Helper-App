// "Shops written several ways": tick and Tidy, so each shop has one name (logic: js/shopnames.js).

import { ctx, esc } from '../ctx.js';
import { nameGroups, tidyGroup, keepGroup } from '../shopnames.js';

export function open() {
  const groups = nameGroups(ctx.state);
  if (!groups.length) { ctx.toast('Every shop has one name ✓'); if (document.querySelector('.sheet')) ctx.closeSheet(); return; }
  const row = (g) => `<div class="sn-row" data-key="${esc(g.key)}">
    <label class="sn-head"><input type="checkbox" data-sn-tick checked><span>Call it</span><input type="text" class="sn-name" value="${esc(g.canonical)}" aria-label="One name for this shop"></label>
    <div class="muted small">${g.variants.map((v) => `${esc(v.note)} <b>×${v.count}</b>`).join(' · ')}</div>
    <button type="button" class="linkish small" data-sn-keep>Keep them as they are</button></div>`;
  if (document.querySelector('.sheet')) ctx.closeSheet();
  ctx.openSheet(`<h3>One name for each shop <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p class="muted" style="margin-top:0">The same shop written several ways (often by the bank: "LINELLA SRL 123"). One name means reports and categories group it right. Only the note changes; amounts, dates and categories stay. Undo works.</p>
    <div class="sn-list" data-testid="shopnames">${groups.map(row).join('')}</div>
    <div class="btns"><button type="button" class="btn" data-close>Later</button><button type="button" class="btn primary" data-sn-go data-testid="shopnames-go">Tidy the ticked ones</button></div>`, (sheet) => {
    sheet.addEventListener('click', (e) => {
      const keep = e.target.closest('[data-sn-keep]');
      if (keep) {
        const r = keep.closest('.sn-row');
        keepGroup(ctx.state, r.dataset.key);
        ctx.commit();
        r.remove();
        if (!sheet.querySelector('.sn-row')) ctx.closeSheet();
        return;
      }
      if (!e.target.closest('[data-sn-go]')) return;
      let changed = 0;
      let shops = 0;
      for (const r of sheet.querySelectorAll('.sn-row')) {
        if (!r.querySelector('[data-sn-tick]').checked) continue;
        const g = groups.find((x) => x.key === r.dataset.key);
        const name = r.querySelector('.sn-name').value.trim();
        if (!g || !name) continue;
        const n = tidyGroup(ctx.state, g, name);
        if (n) { changed += n; shops++; }
      }
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(changed ? `${shops} shop${shops === 1 ? '' : 's'} tidied (${changed} record${changed === 1 ? '' : 's'})` : 'Nothing to change');
    });
  });
}
