// Category rules: "description contains … -> category". Made in Settings,
// or offered right after you change a record's category, so the app files
// it right next time (bank imports included). Rules sync with settings.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';

const catName = (id) => M.category(ctx.state, id)?.name || id;
const catOptions = (type, selected) => ctx.state.settings.categories
  .filter((c) => type === 'any' || c.type === type)
  .map((c) => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}${type === 'any' ? ` (${c.type})` : ''}</option>`).join('');

export function settingsCard() {
  const rules = [...(ctx.state.settings.rules || [])].sort((a, b) => a.match.localeCompare(b.match));
  const inOther = ctx.state.tx.filter((t) => t.type !== 'transfer' && (t.category === 'other' || t.category === 'other-in') && M.matchRule(ctx.state, t.note, t.type));
  return `<section class="card" id="rules-card"><h2>Category rules <button class="card-link right" data-act="rule-new">+ Rule</button></h2>
    <p class="muted small" style="margin-top:0">When a description contains the text, the record goes to that category, for new records and bank imports. The app also learns from your records, and offers a rule when you change a category.</p>
    ${rules.length ? `<div class="rule-list">${rules.map((r) => `<div class="kv rule-row"><span><b>"${esc(r.match)}"</b> → ${esc(catName(r.category))}<span class="muted small"> · ${r.type === 'income' ? 'income' : r.type === 'any' ? 'any' : 'spending'}</span></span><button class="icon-btn" data-act="rule-del" data-id="${esc(r.id)}" aria-label="Delete rule">✕</button></div>`).join('')}</div>` : '<p class="muted small">No rules yet.</p>'}
    ${inOther.length ? `<div class="btns" style="margin-top:10px"><button class="btn" data-act="rule-apply">File ${inOther.length} record${inOther.length === 1 ? '' : 's'} from Other by these rules</button></div>` : ''}
  </section>`;
}

const refresh = () => { const el = document.getElementById('rules-card'); if (el) el.outerHTML = settingsCard(); };

// New rule, or the "always?" question after a correction (`from` given).
export function ruleSheet({ note = '', type = 'expense', category = null, from = null } = {}) {
  const st = ctx.state;
  const word = M.ruleWord(note);
  let match = word;
  let ruleType = type;
  let cat = category || st.settings.categories.find((c) => c.type === type)?.id;
  const similar = () => {
    const rule = { match, type: ruleType, category: cat };
    return match.trim().length >= 3 ? M.ruleTargets(st, rule, { onlyOther: false }).filter((t) => !from || t.category === from || t.category === 'other' || t.category === 'other-in') : [];
  };
  const html = () => {
    const n = similar().length;
    return `<div class="grab"></div><h3>${from ? `Always file it as ${esc(catName(cat))}?` : 'New category rule'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="rule-form" novalidate>
      ${from ? `<p class="muted small" style="margin-top:0">You moved "${esc(note)}" from ${esc(catName(from))} to ${esc(catName(cat))}. A rule files the next ones like it there by itself.</p>` : ''}
      <label class="field"><span>When the description contains</span><input id="rule-match" type="text" value="${esc(match)}" placeholder="e.g. linella"></label>
      <div class="row2">
        <label class="field"><span>For</span><select id="rule-type"><option value="expense" ${ruleType === 'expense' ? 'selected' : ''}>Spending</option><option value="income" ${ruleType === 'income' ? 'selected' : ''}>Income</option></select></label>
        <label class="field"><span>File it as</span><select id="rule-cat">${catOptions(ruleType, cat)}</select></label>
      </div>
      <label class="field check"><input type="checkbox" id="rule-also" ${n ? 'checked' : 'disabled'}><span id="rule-also-text">${n ? `Also move ${n} record${n === 1 ? '' : 's'} like this${from ? ` from ${esc(catName(from))} or Other` : ''}` : 'No other records match yet'}</span></label>
      <p class="lock-msg" id="rule-msg" role="alert"></p>
      <div class="btns"><button type="button" class="btn" data-close>${from ? 'Not now' : 'Cancel'}</button><button type="submit" class="btn primary">Make the rule</button></div>
    </form>`;
  };
  ctx.openSheet('', (sheet) => {
    const paint = () => { sheet.innerHTML = html(); };
    paint();
    const sync = () => {
      match = sheet.querySelector('#rule-match').value;
      const n = similar().length;
      const box = sheet.querySelector('#rule-also');
      box.disabled = !n;
      box.checked = !!n;
      sheet.querySelector('#rule-also-text').textContent = n ? `Also move ${n} record${n === 1 ? '' : 's'} like this` : 'No other records match yet';
    };
    sheet.addEventListener('input', (e) => { if (e.target.id === 'rule-match') sync(); });
    sheet.addEventListener('change', (e) => {
      if (e.target.id === 'rule-type') {
        match = sheet.querySelector('#rule-match').value;
        ruleType = e.target.value;
        cat = st.settings.categories.find((c) => c.type === ruleType)?.id;
        paint();
      } else if (e.target.id === 'rule-cat') { cat = e.target.value; sync(); }
    });
    sheet.addEventListener('submit', (e) => {
      e.preventDefault();
      match = sheet.querySelector('#rule-match').value.trim();
      if (match.length < 3) { sheet.querySelector('#rule-msg').textContent = 'Use at least 3 letters, e.g. a shop name.'; return; }
      const list = sheet.querySelector('#rule-also').checked ? similar() : [];
      const rule = M.addRule(st, { match, type: ruleType, category: cat });
      const moved = M.applyRule(st, rule, list);
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(`Rule saved: "${rule.match}" → ${catName(cat)}${moved ? `. ${moved} record${moved === 1 ? '' : 's'} moved.` : ''}`);
    });
  });
}

// After you change a record's category: offer a rule, unless one already says so.
export function afterCorrection(before, after) {
  if (after.type === 'transfer' || !after.note || before.category === after.category) return false;
  const rule = M.matchRule(ctx.state, after.note, after.type);
  if (rule?.category === after.category) return false;
  if (M.ruleWord(after.note).length < 3) return false;
  ruleSheet({ note: after.note, type: after.type, category: after.category, from: before.category });
  return true;
}

export function onClick(act, el) {
  if (act === 'rule-new') { ruleSheet(); return true; }
  if (act === 'rule-del') {
    const r = (ctx.state.settings.rules || []).find((x) => x.id === el.dataset.id);
    M.removeRule(ctx.state, el.dataset.id);
    ctx.commit();
    ctx.toast(r ? `Rule "${r.match}" deleted` : 'Deleted');
    return true;
  }
  if (act === 'rule-apply') {
    let n = 0;
    for (const t of ctx.state.tx) {
      if (t.type === 'transfer' || (t.category !== 'other' && t.category !== 'other-in')) continue;
      const r = M.matchRule(ctx.state, t.note, t.type);
      if (r && M.category(ctx.state, r.category)?.type === t.type) { t.category = r.category; t.updatedAt = Date.now(); n++; }
    }
    ctx.commit();
    refresh();
    ctx.toast(`${n} record${n === 1 ? '' : 's'} filed by your rules`);
    return true;
  }
  return false;
}
