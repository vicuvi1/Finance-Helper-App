// Telegram bot in the app: logs what you send ("coffee 35"), answers
// /today, /balance and /undo, and sends reminders (evening "time to log",
// bills due) to your own bot. The desktop main process moves the messages
// (electron/telegram.cjs); text parsing lives in js/telegram.js.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import * as T from '../telegram.js';
import { todayISO } from '../dates.js';

const bot = () => window.desktop?.telegram;
const bg = () => window.desktop?.background;
const st = { status: null, pair: null, busy: false, error: '', bg: null };
const prefs = () => ({ daily: true, at: '21:00', bills: true, ...(ctx.state.meta.tg || {}) });

function refresh() {
  const el = document.getElementById('tg-card');
  if (el) el.outerHTML = settingsCard();
}

async function loadStatus() {
  st.status = await bot()?.status().catch(() => null);
  st.bg = await bg()?.get().catch(() => null);
  refresh();
}

const send = (text, extra) => bot()?.send(text, extra).catch((e) => console.warn('Telegram send failed', e));
const keyboard = () => ({ reply_markup: T.quickKeyboard(ctx.state, todayISO()) });
const localDay = (unix) => todayISO(new Date(unix * 1000));

function undo(id) {
  const t = id ? ctx.state.tx.find((x) => x.id === id) : M.sortTx(ctx.state.tx).filter((x) => x.source === 'telegram').sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!t) return null;
  M.removeTx(ctx.state, t.id);
  return t;
}

// Handles messages in order; confirms only what was handled.
async function handle(updates) {
  const { state } = ctx;
  if (ctx.DEMO || state._sealed) return; // locked: they wait (Telegram keeps them)
  const done = [];
  let changed = false;
  for (const u of updates) {
    try {
      if (u.callback_query) {
        const cq = u.callback_query;
        const [what, id] = String(cq.data || '').split(':');
        if (what === 'undo') {
          const t = undo(id);
          changed ||= !!t;
          bot().answer(cq.id, t ? 'Removed' : 'Already removed');
          if (t) bot().edit(cq.message.message_id, `↩️ <s>${esc(t.note || '')} ${esc((t.amount / 100).toString())}</s> removed`).catch(() => {});
        }
        done.push(u.update_id);
        continue;
      }
      const text = (u.message?.text || '').trim();
      const cmd = text.toLowerCase();
      if (!text) { done.push(u.update_id); continue; }
      if (cmd.startsWith('/start') || cmd === '/help') send(`👋 Ready.\n\n${T.HELP}`, keyboard());
      else if (cmd === '/today' || text === '📊 Today') send(T.todayText(state, todayISO()), keyboard());
      else if (cmd === '/balance' || text === '💰 Balance') send(T.balanceText(state));
      else if (cmd === '/undo' || text === '↩️ Undo') {
        const t = undo();
        changed ||= !!t;
        send(t ? `↩️ Removed ${esc(t.note || '')} ${esc((t.amount / 100).toString())}` : 'Nothing from Telegram to undo.');
      } else {
        const id = `tg-${u.update_id}`;
        if (state.tx.some((t) => t.id === id) || state.deleted[id]) { done.push(u.update_id); continue; } // seen before
        const f = T.parseQuick(text, state);
        if (!f) send('I didn\'t catch an amount. Try <code>coffee 35</code> or <code>+500 salary</code>.');
        else {
          const cur = M.account(state, f.account)?.currency || state.settings.currency;
          const rate = cur === state.settings.currency ? 1 : ctx.suggestedRate(cur) || 1;
          const t = T.recordFromMessage(f, { updateId: u.update_id, date: localDay(u.message.date), rate, currency: cur });
          state.tx.push(t);
          changed = true;
          ctx.ui.flashId = t.id;
          send(T.loggedText(state, t), { reply_markup: { inline_keyboard: [[{ text: '↩️ Undo', callback_data: `undo:${t.id}` }]] } });
        }
      }
      done.push(u.update_id);
    } catch (e) {
      console.warn('Telegram message failed', e);
      done.push(u.update_id); // don't get stuck on one bad message
    }
  }
  if (changed) {
    ctx.commit();
    ctx.toast('Logged from Telegram');
  }
  if (done.length) bot().ack(done);
}

// Once a minute: the evening reminder and the morning bills note.
function tick() {
  const { state } = ctx;
  if (ctx.DEMO || state._sealed || !st.status?.linked) return;
  const p = prefs();
  const today = todayISO();
  const hm = new Date().toTimeString().slice(0, 5);
  const m = state.meta;
  if (p.daily && hm >= p.at && m.tgLastDaily !== today) {
    m.tgLastDaily = today;
    ctx.persist();
    send(T.reminderText(state, today), keyboard());
  }
  if (p.bills && hm >= '09:00' && m.tgLastBills !== today) {
    m.tgLastBills = today;
    ctx.persist();
    const text = T.billsText(state, today);
    if (text) send(text);
  }
}

export function initTelegram() {
  if (!bot() || ctx.DEMO) return;
  bot().onUpdates(handle);
  bot().onEvent((ev) => {
    if (ev.type === 'linked') {
      ctx.toast(`Telegram linked${ev.name ? ` with ${ev.name}` : ''}`);
      st.pair = null;
      loadStatus().then(() => send(`👋 Hi${ev.name ? ` ${esc(ev.name)}` : ''}! Finance Helper is linked.\n\n${T.HELP}`, keyboard()));
    } else if (ev.type === 'error') { st.error = ev.message; refresh(); }
  });
  loadStatus();
  setInterval(tick, 60000);
  setTimeout(tick, 8000);
}

// After unlocking encrypted data: handle what waited.
export const resume = () => loadStatus();

// ---------- Settings ----------

const steps = `<ol class="steps small">
  <li>In Telegram, open <b>@BotFather</b> and send <code>/newbot</code>. Pick any name, e.g. "My money".</li>
  <li>BotFather replies with a <b>token</b> (looks like <code>123456789:AA…</code>). Paste it below.</li>
</ol>`;

export function settingsCard() {
  if (ctx.DEMO || !bot()) {
    return `<section class="card" id="tg-card"><h2>Telegram bot</h2><p class="muted small" style="margin:0">Log from Telegram (<code>coffee 35</code>, one-tap buttons) and get reminders there. Works with the desktop app: it talks to your own bot, no server in between.</p></section>`;
  }
  const s = st.status;
  const p = prefs();
  const b = st.bg || { background: true, atLogin: false };
  if (!s?.connected) {
    return `<section class="card" id="tg-card"><h2>Telegram bot</h2>
      <p class="muted small" style="margin-top:0">Log spending from Telegram in a second (<code>coffee 35</code> or a tap on a button), and get a reminder in the evening. Your own private bot, about 2 minutes to set up:</p>
      ${steps}
      <form id="tg-form" autocomplete="off"><label class="field"><span>Bot token</span><input id="tg-token" type="password" placeholder="123456789:AA…" spellcheck="false"></label>
      ${st.error ? `<p class="lock-msg">${esc(st.error)}</p>` : ''}
      <button class="btn primary block" type="submit" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Checking…' : 'Connect bot'}</button></form></section>`;
  }
  if (!s.linked) {
    return `<section class="card" id="tg-card"><h2>Telegram bot <span class="right muted">@${esc(s.botName)}</span></h2>
      <p style="margin-top:0">Last step: link your Telegram account, so the bot listens only to you.</p>
      ${st.error ? `<p class="lock-msg">${esc(st.error)}</p>` : ''}
      ${st.pair ? `<p class="tg-code">${esc(st.pair.code)}</p><p class="muted small">Tap below to open the bot and press <b>Start</b>, or send it this code.</p>
        <div class="btns"><button class="btn primary" data-act="tg-open">Open @${esc(s.botName)} in Telegram</button><button class="btn" data-act="tg-pair">New code</button></div>`
        : '<button class="btn primary block" data-act="tg-pair">Show my link code</button>'}
      <div class="btns" style="margin-top:8px"><button class="btn danger" data-act="tg-off">Disconnect</button></div></section>`;
  }
  return `<section class="card" id="tg-card"><h2>Telegram bot <span class="right income">● linked</span></h2>
    <div class="kv"><span>Bot</span><b>@${esc(s.botName)}</b></div>
    ${s.userName ? `<div class="kv"><span>Listens to</span><b>${esc(s.userName)}</b></div>` : ''}
    ${s.error || st.error ? `<p class="lock-msg">${esc(s.error || st.error)}</p>` : ''}
    <p class="muted small">Send <code>coffee 35</code>, <code>taxi 45 cash</code>, <code>+500 salary</code>, or tap a button. /today, /balance, /undo.</p>
    <label class="field check"><input type="checkbox" data-tg="daily" ${p.daily ? 'checked' : ''}><span>Evening reminder to log</span></label>
    ${p.daily ? `<label class="field"><span>Remind me at</span><input type="time" data-tg="at" value="${esc(p.at)}"></label>` : ''}
    <label class="field check"><input type="checkbox" data-tg="bills" ${p.bills ? 'checked' : ''}><span>Morning note when a bill is due today or tomorrow</span></label>
    <label class="field check"><input type="checkbox" data-bg="background" ${b.background ? 'checked' : ''}><span>Keep running in the tray when I close the window (so reminders and the bot keep working)</span></label>
    <label class="field check"><input type="checkbox" data-bg="atLogin" ${b.atLogin ? 'checked' : ''}><span>Start with the computer (in the tray)</span></label>
    <div class="btns" style="margin-top:10px"><button class="btn" data-act="tg-test">Send a test</button><button class="btn danger" data-act="tg-off">Disconnect</button></div>
  </section>`;
}

export async function onSubmit(form) {
  if (form.id !== 'tg-form') return false;
  st.busy = true;
  st.error = '';
  refresh();
  try {
    await bot().connect(form.querySelector('#tg-token').value);
    form.querySelector('#tg-token').value = '';
    st.pair = await bot().pair();
  } catch (e) {
    st.error = String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }
  st.busy = false;
  await loadStatus();
  return true;
}

export function onClick(act) {
  if (act === 'tg-pair') { bot().pair().then((p) => { st.pair = p; refresh(); }); return true; }
  if (act === 'tg-open') { if (st.pair?.link) bot().openLink(st.pair.link); return true; }
  if (act === 'tg-test') { send(T.reminderText(ctx.state, todayISO()), keyboard()).then(() => ctx.toast('Sent. Check Telegram.')); return true; }
  if (act === 'tg-off') { bot().disconnect().then(() => { st.pair = null; st.error = ''; loadStatus(); ctx.toast('Telegram disconnected'); }); return true; }
  return false;
}

export function onChange(el) {
  if (el.dataset.tg) {
    const p = prefs();
    p[el.dataset.tg] = el.type === 'checkbox' ? el.checked : el.value;
    ctx.state.meta.tg = p;
    ctx.persist();
    refresh();
    return true;
  }
  if (el.dataset.bg) {
    bg()?.set({ [el.dataset.bg]: el.checked }).then((b) => { st.bg = b; refresh(); });
    return true;
  }
  return false;
}
