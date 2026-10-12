// Runs electron/relay.gs (the always-on bot's Google Apps Script) in Node with
// small fakes of the Apps Script services, for the tests. `telegram` answers
// the Bot API synchronously: { call(method, params) -> result } or throws.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const SOURCE = readFileSync(fileURLToPath(new URL('../electron/relay.gs', import.meta.url)), 'utf8');

export function loadRelay({ key = 'test-key', telegram, now = () => Date.now() } = {}) {
  const store = new Map();
  const triggers = [];
  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (store.has(k) ? store.get(k) : null),
      setProperty: (k, v) => { store.set(k, String(v)); },
      deleteProperty: (k) => { store.delete(k); },
      getProperties: () => Object.fromEntries(store),
      deleteAllProperties: () => store.clear(),
    }),
  };
  const ContentService = {
    MimeType: { JSON: 'json' },
    createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
  };
  const UrlFetchApp = {
    fetch(url, opts) {
      const method = url.split('/').pop();
      const params = JSON.parse(opts.payload || '{}');
      try {
        const result = telegram.call(method, params, url);
        return { getContentText: () => JSON.stringify({ ok: true, result }), getResponseCode: () => 200 };
      } catch (e) {
        return { getContentText: () => JSON.stringify({ ok: false, error_code: e.code || 400, description: e.message }), getResponseCode: () => e.code || 400 };
      }
    },
  };
  const LockService = { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) };
  const ScriptApp = {
    getProjectTriggers: () => triggers.slice(),
    newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: (n) => ({ create: () => { const t = { fn, n, getHandlerFunction: () => fn }; triggers.push(t); return t; } }) }) }),
    deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
  };
  const DateShim = class extends Date {};
  DateShim.now = now;
  const context = vm.createContext({ PropertiesService, ContentService, UrlFetchApp, LockService, ScriptApp, JSON, Number, String, Object, Math, Date: DateShim });
  vm.runInContext(SOURCE.replace("'__KEY__'", JSON.stringify(key)), context);
  const parse = (o) => JSON.parse(o.text);
  return {
    store, triggers,
    poll: () => vm.runInContext('poll()', context),
    get: (params) => parse(context.doGet({ parameter: params })),
    post: (body, params = {}) => parse(context.doPost({ parameter: params, postData: { contents: JSON.stringify(body) } })),
  };
}

// The script deployed as a web app, on 127.0.0.1 (the desktop test runs the
// app with FH_RELAY_ANY_URL=1). It takes the key the app sends at setup.
export function relayServer({ telegram, now }) {
  let relay = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const params = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
      const b = body ? JSON.parse(body) : {};
      if (!relay && b.a === 'setup') relay = loadRelay({ key: b.k, telegram, now });
      const out = !relay ? { ok: false, error: 'Not set up.' } : req.method === 'POST' ? relay.post(b, params) : relay.get(params);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(out));
    });
  });
  return {
    server,
    relay: () => relay,
    url: () => `http://127.0.0.1:${server.address().port}/macros/s/test/exec`,
  };
}
