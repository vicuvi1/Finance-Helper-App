// Reality check (js/checkup.js, js/reality.js): the Home card when a check is due
// (or when new records need a look), the sidebar badge and the settings card.
// The check itself happens in the full Reality check window (#reality,
// js/screens/reality.js).

import { ctx, esc } from '../ctx.js';
import * as C from '../checkup.js';
import { guardFlags, setAcctEvery } from '../reality.js';
import { todayISO, dayLabel } from '../dates.js';
import { DAY_NAMES } from '../cashcount.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function card(today = todayISO()) {
  if (ctx.state._sealed) return '';
  const due = C.checkupCard(ctx.state, today);
  const flags = guardFlags(ctx.state, today).length;
  const flagLine = flags ? `<p class="muted small" data-testid="reality-flag-count">${plural(flags, 'new record looks', 'new records look')} unusual. Nothing was changed: check ${flags === 1 ? 'it' : 'them'} in the window.</p>` : '';
  if (due) {
    return `<section class="card rc-home${due.overdue ? ' overdue' : ''}" data-testid="checkup-card"><h2>Reality check${due.overdue ? ' <span class="rc-tag alert" data-testid="reality-overdue">Overdue</span>' : ''}</h2>
    <p style="margin-top:0">Compare ${plural(due.left.length, 'account', 'accounts')} with your bank, so the money in the app is the real money. It takes a few minutes.</p>${flagLine}
    <div class="btns"><button type="button" class="btn primary" data-act="checkup-open" data-testid="checkup-open">Start reality check</button><button type="button" class="btn" data-act="checkup-later">Not today</button></div></section>`;
  }
  if (!flags) return '';
  return `<section class="card rc-home" data-testid="reality-flags-card"><h2>Check these</h2>${flagLine}
    <div class="btns"><button type="button" class="btn" data-act="checkup-open" data-testid="reality-flags-open">Check ${flags === 1 ? 'it' : 'them'}</button></div></section>`;
}

/** The sidebar badge: accounts due ("Overdue" when 2 days late), else the records to check. */
export function badge(today = todayISO()) {
  if (ctx.state._sealed) return { text: '', kind: '' };
  const due = C.checkupDue(ctx.state, today);
  if (due) return { text: due.overdue ? 'Overdue' : String(due.left.length), kind: due.overdue ? 'alert' : 'soft' };
  const flags = guardFlags(ctx.state, today).length;
  return { text: flags ? String(flags) : '', kind: 'soft' };
}

export function settingsCard() {
  const c = C.checkupConfig(ctx.state);
  const days = Array.from({ length: 28 }, (_, i) => i + 1);
  const next = C.nextCheck(ctx.state, todayISO());
  const own = Object.entries(c.acctEvery).map(([id, every]) => {
    const a = ctx.state.settings.accounts.find((x) => x.id === id);
    return a ? `<li>${esc(a.name)}: ${esc(C.EVERY_LABEL[every].toLowerCase())} <button type="button" class="btn sm" data-act="rc-acct-normal" data-id="${esc(id)}">Back to the usual</button></li>` : '';
  }).join('');
  return `<section class="card"><h2>Reality check</h2>
    <p class="muted small" style="margin-top:0">Money asks you to compare each account with your bank. A difference first shows what could explain it; what is left becomes one visible adjustment that doesn't count as income or spending. Life System sends one notification when it is due, and one reminder 2 days later if you skipped it.${next ? ` Next check: ${esc(dayLabel(next))}.` : ''}</p>
    <label class="motion-setting"><span><b>Remind me to check my accounts</b></span><input type="checkbox" data-set="checkupOn" ${c.on ? 'checked' : ''} aria-label="Reality check reminders"></label>
    <div class="rc-set-grid">
      <label class="field"><span>How often</span><select data-set="checkupEvery" aria-label="How often" data-testid="reality-every">${C.EVERY.map((e) => `<option value="${e}"${e === c.every ? ' selected' : ''}>${C.EVERY_LABEL[e]}</option>`).join('')}</select></label>
      <label class="field"${c.every === 'month' ? ' hidden' : ''}><span>Day of the week</span><select data-set="checkupWeekday" aria-label="Reality check day of the week">${DAY_NAMES.map((n, i) => `<option value="${i}"${i === c.weekday ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="field"${c.every === 'month' ? '' : ' hidden'}><span>Day of the month</span><select data-set="checkupDay" aria-label="Check-up day">${days.map((d) => `<option value="${d}"${d === c.day ? ' selected' : ''}>${d}</option>`).join('')}</select></label>
      <label class="field"><span>From</span><input type="time" data-set="checkupTime" value="${esc(c.time)}" aria-label="Reality check time"></label>
    </div>
    ${own ? `<p class="muted small" style="margin:10px 0 4px">Checked more often:</p><ul class="rc-own">${own}</ul>` : ''}
    <div class="btns" style="margin-top:10px"><button type="button" class="btn" data-act="checkup-open">Open reality check</button></div></section>`;
}

export function open() {
  if (location.hash === '#reality') ctx.render(); else location.hash = '#reality';
}

export function onClick(act, el) {
  if (act === 'checkup-open') { open(); return true; }
  if (act === 'rc-acct-normal') {
    setAcctEvery(ctx.state, el.dataset.id, null);
    ctx.commit();
    ctx.toast('Back to the usual interval', 'Undo', () => ctx.undo?.());
    return true;
  }
  if (act === 'checkup-later') {
    C.snoozeCheckup(ctx.state, todayISO());
    ctx.commit();
    ctx.toast('OK, I will ask again tomorrow');
    return true;
  }
  return false;
}
