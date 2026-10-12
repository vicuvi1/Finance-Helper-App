// Finance Helper: always-on Telegram bot (Google Apps Script).
//
// Runs in YOUR Google account (script.google.com), free. While the Finance
// Helper app is closed or the PC is off, Google runs poll() every minute: it
// reads your bot's new messages, answers them ("saved, it will be logged
// when the app opens") and keeps them here until the app collects them.
// While the app is open it reads Telegram itself and this script stays quiet.
//
// Your bot token and chat are stored in this project's Script Properties
// (only you can see them). Every call from the app needs KEY, which only
// your app knows. Don't share the web app link.
//
// Set up from the app: Settings → Telegram → Always on.

const KEY = '__KEY__';
const API = 'https://api.telegram.org';
const APP_ALIVE_MS = 90 * 1000; // the app collected messages this recently: it's open
const MAX_KEEP = 800; // messages kept at most (the oldest go first)

function props_() { return PropertiesService.getScriptProperties(); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function cfg_() { const p = props_(); return { token: p.getProperty('token'), chat: Number(p.getProperty('chat') || 0) }; }

function tg_(method, params) {
  const r = UrlFetchApp.fetch(API + '/bot' + cfg_().token + '/' + method, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(params || {}), muteHttpExceptions: true,
  });
  let j = null;
  try { j = JSON.parse(r.getContentText()); } catch (e) { /* not JSON */ }
  if (!j || !j.ok) throw new Error((j && j.description) || ('Telegram HTTP ' + r.getResponseCode()));
  return j.result;
}

// Messages waiting for the app, one property each (u_<update id>).
function inbox_() {
  const all = props_().getProperties();
  return Object.keys(all).filter(function (k) { return k.indexOf('u_') === 0; })
    .map(function (k) { try { return JSON.parse(all[k]); } catch (e) { return null; } })
    .filter(Boolean).sort(function (a, b) { return a.update_id - b.update_id; });
}

// Only what the app needs from an update.
function slim_(u) {
  const out = { update_id: u.update_id };
  if (u.message) {
    const m = u.message;
    out.message = { message_id: m.message_id, date: m.date, text: m.text || '', chat: { id: m.chat.id, type: m.chat.type }, from: { first_name: (m.from && m.from.first_name) || '' } };
  }
  if (u.callback_query) {
    const q = u.callback_query;
    out.callback_query = { id: q.id, data: q.data, message: q.message ? { message_id: q.message.message_id, chat: { id: q.message.chat.id } } : null };
  }
  return out;
}

const ASKS_ = /^(\/|📊|📅|💰|🧾|❓)/;
function offlineText_(text) {
  if (ASKS_.test(text)) return '📴 Your PC is off, so I can\'t see your numbers right now. Ask again when Finance Helper is open. Records you send are saved.';
  return '📝 Saved: <b>' + String(text).replace(/[<>&]/g, '') + '</b>. Your PC is off; it will be logged on today\'s date as soon as Finance Helper opens.';
}

// Every minute (time trigger): read the bot while the app is closed.
function poll() {
  const c = cfg_();
  if (!c.token || !c.chat) return;
  const p = props_();
  p.setProperty('lastTick', String(Date.now())); // shows the app that Google is checking
  if (Date.now() - Number(p.getProperty('lastPull') || 0) < APP_ALIVE_MS) return; // the app reads Telegram itself
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    const offset = Number(p.getProperty('offset') || 0);
    const updates = tg_('getUpdates', { offset: offset, timeout: 0, allowed_updates: ['message', 'callback_query'] });
    let next = offset;
    updates.forEach(function (u) {
      next = Math.max(next, u.update_id + 1);
      const m = u.message || (u.callback_query && u.callback_query.message);
      if (!m || m.chat.id !== c.chat) return; // only your chat
      const item = slim_(u);
      try {
        if (u.callback_query) tg_('answerCallbackQuery', { callback_query_id: u.callback_query.id, text: 'Saved. It is applied when Finance Helper opens.' });
        else {
          const r = tg_('sendMessage', { chat_id: c.chat, text: offlineText_(u.message.text || ''), parse_mode: 'HTML', reply_to_message_id: u.message.message_id });
          item.relayReply = r.message_id;
        }
      } catch (e) { /* the message is kept even if the reply fails */ }
      p.setProperty('u_' + u.update_id, JSON.stringify(item));
    });
    if (next !== offset) {
      p.setProperty('offset', String(next));
      tg_('getUpdates', { offset: next, timeout: 0, limit: 1 }); // confirms them to Telegram
    }
    const waiting = inbox_();
    for (let i = 0; i < waiting.length - MAX_KEEP; i++) p.deleteProperty('u_' + waiting[i].update_id);
    p.setProperty('lastRun', String(Date.now()));
    p.deleteProperty('lastError');
  } catch (e) {
    p.setProperty('lastError', String(e && e.message ? e.message : e));
    p.setProperty('lastRun', String(Date.now()));
  } finally {
    lock.releaseLock();
  }
}

// Run this once from the editor if the app says Google isn't checking.
function install() {
  const has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'poll'; });
  if (!has) ScriptApp.newTrigger('poll').timeBased().everyMinutes(1).create();
}

function status_() {
  const p = props_();
  return {
    version: 1,
    configured: !!p.getProperty('token'),
    trigger: ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'poll'; }),
    lastTick: Number(p.getProperty('lastTick') || 0),
    lastRun: Number(p.getProperty('lastRun') || 0),
    lastError: p.getProperty('lastError') || '',
    waiting: inbox_().length,
  };
}

function api_(q) {
  if (q.k !== KEY) return out_({ ok: false, error: 'Wrong key: copy the script again from the app.' });
  const p = props_();
  // The app already handled everything below "from": never answer those again.
  if (/^\d+$/.test(String(q.from || '')) && Number(q.from) > Number(p.getProperty('offset') || 0)) p.setProperty('offset', String(q.from));
  if (q.a === 'setup') {
    if (!q.token || !q.chat) return out_({ ok: false, error: 'Missing bot token or chat.' });
    p.setProperty('token', String(q.token));
    p.setProperty('chat', String(q.chat));
    p.setProperty('lastPull', String(Date.now()));
    let triggerError = '';
    try { install(); } catch (e) { triggerError = String(e && e.message ? e.message : e); }
    try { tg_('getMe', {}); } catch (e) { return out_({ ok: false, error: 'Telegram: ' + e.message }); }
    const s = status_();
    s.triggerError = triggerError;
    s.ok = true;
    return out_(s);
  }
  if (q.a === 'pull') {
    p.setProperty('lastPull', String(Date.now()));
    const s = status_();
    s.ok = true;
    s.updates = inbox_();
    return out_(s);
  }
  if (q.a === 'ack') {
    String(q.ids || '').split(',').forEach(function (id) { if (/^\d+$/.test(id)) p.deleteProperty('u_' + id); });
    return out_({ ok: true });
  }
  if (q.a === 'status') { const s = status_(); s.ok = true; return out_(s); }
  if (q.a === 'off') {
    ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'poll') ScriptApp.deleteTrigger(t); });
    p.deleteAllProperties();
    return out_({ ok: true });
  }
  return out_({ ok: false, error: 'Unknown action.' });
}

function doGet(e) { return api_((e && e.parameter) || {}); }
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) { /* not JSON */ }
  const q = {};
  Object.keys((e && e.parameter) || {}).forEach(function (k) { q[k] = e.parameter[k]; });
  Object.keys(body).forEach(function (k) { q[k] = body[k]; });
  return api_(q);
}
