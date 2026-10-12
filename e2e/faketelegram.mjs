// A tiny fake Telegram Bot API for the desktop test: queue messages and
// button taps, see what the bot sends, and make a token stop working.
import http from 'node:http';
export function fakeTelegram() {
  const queue = [];
  const sent = [];
  const calls = [];
  let nextId = 1;
  let waiting = [];
  const revoked = new Set(); // tokens Telegram no longer accepts
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const method = req.url.split('/').pop();
      const token = req.url.split('/')[1].replace(/^bot/, '');
      const p = body ? JSON.parse(body) : {};
      calls.push(method);
      const reply = (result) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, result })); };
      if (revoked.has(token)) { res.statusCode = 401; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' })); return; }
      if (method === 'getMe') return reply({ id: 1, is_bot: true, username: 'test_money_bot' });
      if (method === 'getUpdates') {
        const offset = p.offset || 0;
        for (let i = queue.length - 1; i >= 0; i--) if (queue[i].update_id < offset) queue.splice(i, 1);
        if (queue.length || !p.timeout) return reply(queue.slice());
        const t = setTimeout(() => { waiting = waiting.filter((w) => w !== go); reply(queue.slice()); }, Math.min(p.timeout, 3) * 1000);
        const go = () => { clearTimeout(t); reply(queue.slice()); };
        waiting.push(go);
        return;
      }
      if (method === 'sendMessage') { sent.push(p); return reply({ message_id: sent.length }); }
      if (method === 'editMessageText') { sent.push({ ...p, edited: true }); return reply(true); }
      return reply(true);
    });
  });
  return {
    server,
    sent, calls,
    url: () => `http://127.0.0.1:${server.address().port}`,
    revoke(token) { revoked.add(token); },
    // The same bot, answered right away: for the Google script (always on).
    direct(method, p = {}) {
      calls.push(method);
      if (method === 'getMe') return { id: 1, is_bot: true, username: 'test_money_bot' };
      if (method === 'getUpdates') {
        for (let i = queue.length - 1; i >= 0; i--) if (queue[i].update_id < (p.offset || 0)) queue.splice(i, 1);
        return queue.slice(0, p.limit || 100);
      }
      if (method === 'sendMessage') { sent.push(p); return { message_id: sent.length }; }
      return true;
    },
    // Tap an inline button under one of the bot's messages.
    tap(data, chat = 4242) {
      const id = nextId++;
      queue.push({ update_id: id, callback_query: { id: `cq${id}`, data, message: { message_id: 1, chat: { id: chat, type: 'private' } } } });
      const w = waiting; waiting = []; w.forEach((f) => f());
      return id;
    },
    say(text, chat = 4242) {
      const id = nextId++;
      queue.push({ update_id: id, message: { message_id: id, chat: { id: chat, type: 'private' }, from: { first_name: 'Owner' }, text, date: Math.floor(Date.now() / 1000) } });
      const w = waiting; waiting = []; w.forEach((f) => f());
      return id;
    },
  };
}
