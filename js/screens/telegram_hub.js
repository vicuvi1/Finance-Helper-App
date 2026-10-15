// Telegram Bot Screen: dedicated hub for mobile phone sync, custom keyboard buttons,
// interactive command center, and bot settings.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import * as B from '../blocks.js';
import * as T from '../telegram.js';
import { formatMoney, centsToPlain } from '../money.js';
import { todayISO, dayLabel, monthLabel } from '../dates.js';
import * as Telegram from './telegram.js';
import * as TgBlocks from './tgblocks.js';

let hubTab = 'sync'; // 'sync' | 'buttons' | 'commands' | 'settings'
let consoleCmd = '/today';
let consoleOutput = '';
let consoleIsError = false;

const BOTFATHER_COMMANDS = `today - Today's spending & budget summary
month - Month-to-date breakdown & jars
balance - Net worth & balances per account
safe - Daily safe-to-spend allowance
goals - Goal progress & completion ETAs
rates - Live fiat & crypto exchange rates
last - Last 10 recorded transactions
undo - Undo the last transaction
blocks - Show quick-tap buttons keyboard
help - Quick logging syntax & instructions`;

export function simulateCommand(cmd, state) {
  const trimmed = (cmd || '').trim();
  const lower = trimmed.toLowerCase();
  const today = todayISO();

  if (lower === '/today' || lower === 'today' || lower === '📊 today') {
    return T.todayText(state, today);
  }
  if (lower === '/month' || lower === 'month' || lower === '📅 month') {
    return T.monthText(state, today);
  }
  if (lower === '/balance' || lower === 'balance' || lower === '💰 balance') {
    return T.balanceText(state);
  }
  if (lower === '/safe' || lower === 'safe' || lower === '🟢 safe') {
    return T.safeDetailsText(state, today);
  }
  if (lower === '/goals' || lower === 'goals' || lower === '🎯 goals') {
    return T.goalsText(state, today);
  }
  if (lower === '/rates' || lower === 'rates' || lower === '💵 rates') {
    return T.ratesText(state);
  }
  if (lower === '/last' || lower === 'last' || lower === '🧾 last') {
    return T.lastText(state, 10);
  }
  if (lower === '/blocks' || lower === 'blocks' || lower === '🧱 blocks') {
    return `🧱 <b>Your buttons</b>\n${B.blocks(state).map((b) => esc(B.blockLabel(b))).join('\n')}\n\nAdd: <code>/addblock 🍕 Pizza 120</code> · remove: <code>/delblock pizza</code>`;
  }
  if (lower === '/help' || lower === 'help' || lower === '❓ help') {
    return `👋 <b>Finance Bot Help</b>\n\nLog expenses simply by texting:\n• <code>coffee 35</code> (uses cash/last card)\n• <code>groceries 140 card</code> (specific account)\n• <code>taxi 50 yesterday</code> (for yesterday)\n• <code>+5000 salary</code> (income)\n• <code>20+35 lunch</code> (math)\n\nCommands: /today, /month, /balance, /safe, /goals, /rates, /last, /undo`;
  }
  if (lower === '/undo' || lower === 'undo' || lower === '↩️ undo') {
    return '↩️ <b>Simulated Undo</b>: Removes the last transaction recorded from Telegram.';
  }

  // Quick transaction parsing
  const parsed = T.parseQuick(trimmed, state);
  if (parsed) {
    const acc = M.account(state, parsed.account);
    const mockTx = {
      type: parsed.type,
      amount: parsed.amount,
      note: parsed.note,
      category: parsed.category,
      account: parsed.account,
      currency: acc?.currency || state.settings.currency,
      date: today,
    };
    return `<b>✅ Parsed transaction simulation:</b>\n${T.loggedText(state, mockTx, today)}\n\n<i>(This is an interactive simulation — nothing was added to your records)</i>`;
  }

  return `❓ Command or message not recognized.\nTry commands like <code>/today</code>, <code>/month</code>, <code>/balance</code>, <code>/safe</code>, <code>/goals</code>, or expense syntax like <code>coffee 35</code>, <code>+5000 salary</code>.`;
}

function renderHeader(status) {
  const isLinked = !!status?.linked;
  return `
    <header class="top tg-hub-top">
      <div>
        <h1>Telegram Bot</h1>
        <div class="sub">Phone sync, custom keyboard buttons, command center &amp; mobile automations</div>
      </div>
      <div class="tg-hub-header-actions">
        ${isLinked ? `<span class="set-badge income">● Linked @${esc(status.botName)}</span>` : '<span class="set-badge expense">● Disconnected</span>'}
        <button type="button" class="btn primary" data-act="tg-load" title="Pull all spending sent from your phone">
          📥 Sync from phone now
        </button>
      </div>
    </header>
  `;
}

function renderTabs() {
  const blocks = B.blocks(ctx.state);
  return `
    <div class="seg seg-tg-tabs" role="group" aria-label="Telegram sections">
      <button type="button" class="chip" data-act="tg-hub-tab" data-tab="sync" aria-pressed="${hubTab === 'sync'}">📱 Phone Sync &amp; Feed</button>
      <button type="button" class="chip" data-act="tg-hub-tab" data-tab="buttons" aria-pressed="${hubTab === 'buttons'}">🧱 Custom Buttons (${blocks.length})</button>
      <button type="button" class="chip" data-act="tg-hub-tab" data-tab="commands" aria-pressed="${hubTab === 'commands'}">⚡ Commands &amp; Console</button>
      <button type="button" class="chip" data-act="tg-hub-tab" data-tab="settings" aria-pressed="${hubTab === 'settings'}">⚙️ Setup &amp; Alerts</button>
    </div>
  `;
}

function renderSyncTab(status) {
  const state = ctx.state;
  const isLinked = !!status?.linked;
  const tgTx = state.tx.filter((t) => t.source === 'telegram' || (t.id && String(t.id).startsWith('tg-')));
  const recent = M.sortTx(tgTx).slice(0, 20);

  const totalSpent = tgTx.filter((t) => t.type === 'expense').reduce((s, t) => s + M.B(t), 0);
  const totalEarned = tgTx.filter((t) => t.type === 'income').reduce((s, t) => s + M.B(t), 0);
  const cur = state.settings.currency;

  return `
    <div class="tg-kpi-grid">
      <div class="tg-kpi-card">
        <span class="tg-kpi-label">Bot Connection</span>
        <div class="tg-kpi-val">${isLinked ? `@${esc(status.botName)}` : 'Not linked'}</div>
        <small class="muted">${isLinked && status.userName ? `Listens to ${esc(status.userName)}` : 'Set up token to connect'}</small>
      </div>
      <div class="tg-kpi-card">
        <span class="tg-kpi-label">From Phone</span>
        <div class="tg-kpi-val">${tgTx.length} <span style="font-size:14px; font-weight:normal;">records</span></div>
        <small class="muted">−${esc(formatMoney(totalSpent, cur))} spent · +${esc(formatMoney(totalEarned, cur))} in</small>
      </div>
      <div class="tg-kpi-card">
        <span class="tg-kpi-label">PC-Off Queue</span>
        <div class="tg-kpi-val" style="color:var(--income)">24h Safe</div>
        <small class="muted">Messages wait on Telegram &amp; auto-pull on launch</small>
      </div>
    </div>

    <section class="card tg-sync-hero-card">
      <div class="tg-sync-hero-body">
        <div>
          <h2 style="margin:0 0 4px">Instant Mobile Sync</h2>
          <p class="muted small" style="margin:0">
            Log your daily expenses on your phone via Telegram while out and about. Click below to pull all new records right into your ledger.
          </p>
        </div>
        <button type="button" class="btn primary tg-big-sync-btn" data-act="tg-load">
          📥 Pull updates from phone now
        </button>
      </div>
    </section>

    <div class="tg-grid-2">
      <section class="card">
        <div class="card-head-pill">
          <h2>📱 Mobile Feed</h2>
          <span class="set-badge accent">${tgTx.length} from Telegram</span>
        </div>
        <p class="muted small" style="margin-top:0">Recent records submitted from your phone via Telegram bot:</p>

        ${recent.length ? `
          <div class="list tg-recent-feed">
            ${recent.map((t) => {
              const c = M.category(state, t.category);
              const a = M.account(state, t.account);
              const sign = t.type === 'income' ? '+' : '−';
              return `
                <div class="tx tg-feed-item">
                  <div class="tg-feed-icon">${c?.emoji || (t.type === 'income' ? '💵' : '💸')}</div>
                  <div class="t">
                    <b>${esc(t.note || c?.name || 'Expense')}</b>
                    <small class="muted">${esc(dayLabel(t.date))} · ${esc(c?.name || 'Category')} · ${esc(a?.name || 'Account')}</small>
                  </div>
                  <div class="amt ${t.type === 'income' ? 'income' : 'expense'}" style="text-align:right">
                    <b>${sign}${esc(formatMoney(t.amount, t.currency || cur))}</b>
                    <span class="tg-feed-source-pill">Telegram</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : `
          <div class="tg-empty-feed">
            <div style="font-size:32px; margin-bottom:8px;">💬</div>
            <b>No records logged from Telegram yet</b>
            <p class="muted small" style="max-width:320px; margin:6px auto 0;">
              Open your bot on your phone and send e.g. <code>coffee 35</code> or tap a button. Then click "Sync from phone" to view it here!
            </p>
          </div>
        `}
      </section>

      <section class="card">
        <h2>⚡ Phone Fast-Log Cheatsheet</h2>
        <p class="muted small" style="margin-top:0">Send any of these formats directly in your Telegram chat:</p>
        
        <div class="tg-cheatsheet-grid">
          <div class="tg-cheat-card">
            <code>coffee 35</code>
            <span>Logs 35 in Food &amp; Dining using your last active card.</span>
          </div>
          <div class="tg-cheat-card">
            <code>groceries 140 card</code>
            <span>Specify which card or cash wallet to deduct from.</span>
          </div>
          <div class="tg-cheat-card">
            <code>taxi 55 yesterday</code>
            <span>Logs transaction dated yesterday instead of today.</span>
          </div>
          <div class="tg-cheat-card">
            <code>+5000 salary</code>
            <span>Prefix with <code>+</code> to log income into your main account.</span>
          </div>
          <div class="tg-cheat-card">
            <code>20+35+15 lunch</code>
            <span>Automatic math: calculates 70 and files in Food.</span>
          </div>
          <div class="tg-cheat-card">
            <code>/today · /month · /safe</code>
            <span>Query your current balances, spending, and safe daily allowance.</span>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderButtonsTab() {
  const blocks = B.blocks(ctx.state);
  return `
    <div class="tg-buttons-layout">
      <div class="tg-buttons-main">
        ${TgBlocks.settingsCard()}
      </div>

      <div class="tg-buttons-phone-preview">
        <section class="card">
          <h2>📱 Live Phone Keyboard Preview</h2>
          <p class="muted small" style="margin-top:0">How your buttons appear under your chat on Telegram on your phone:</p>

          <div class="tg-phone-frame">
            <div class="tg-phone-screen">
              <div class="tg-phone-chat">
                <div class="tg-bubble-in">
                  👋 <b>Finance Helper</b><br>
                  Tap any button below to log with one tap:
                </div>
              </div>

              <div class="tg-phone-input-bar">
                <span>Message...</span>
                <span>📎 🎤</span>
              </div>

              <div class="tg-phone-kb-grid">
                ${blocks.slice(0, 9).map((b) => `
                  <div class="tg-mock-key">
                    <span>${esc(b.emoji || '•')}</span>
                    <b>${esc(b.name)}</b>
                    ${b.amount ? `<small>${esc(centsToPlain(b.amount))}</small>` : ''}
                  </div>
                `).join('')}
                <div class="tg-mock-key helper"><span>📊</span> Today</div>
                <div class="tg-mock-key helper"><span>💰</span> Balance</div>
                <div class="tg-mock-key helper"><span>⚡</span> Safe</div>
              </div>
            </div>
          </div>
          <small class="muted" style="display:block; text-align:center; margin-top:8px;">
            Keyboard automatically syncs to Telegram whenever you make edits.
          </small>
        </section>
      </div>
    </div>
  `;
}

function renderCommandsTab() {
  if (!consoleOutput) {
    consoleOutput = simulateCommand(consoleCmd, ctx.state);
  }

  const chips = [
    { label: '/today', cmd: '/today' },
    { label: '/month', cmd: '/month' },
    { label: '/balance', cmd: '/balance' },
    { label: '/safe', cmd: '/safe' },
    { label: '/goals', cmd: '/goals' },
    { label: '/rates', cmd: '/rates' },
    { label: '/last', cmd: '/last' },
    { label: '/blocks', cmd: '/blocks' },
    { label: 'coffee 35', cmd: 'coffee 35' },
    { label: '+5000 salary', cmd: '+5000 salary' },
  ];

  return `
    <div class="tg-commands-grid">
      <section class="card tg-console-card">
        <div class="card-head-pill">
          <h2>⚡ Interactive Command Console</h2>
          <span class="set-badge gold">Simulator &amp; Test</span>
        </div>
        <p class="muted small" style="margin-top:0">
          Test any command or transaction input right in the app to see the exact reply the bot generates:
        </p>

        <div class="tg-quick-chips">
          <span class="muted small" style="align-self:center;">Quick test:</span>
          ${chips.map((c) => `
            <button type="button" class="lq-chip" data-act="tg-hub-chip" data-cmd="${esc(c.cmd)}">${esc(c.label)}</button>
          `).join('')}
        </div>

        <div class="tg-console-input-row" style="margin-top:12px">
          <input type="text" id="tg-console-input" class="input" value="${esc(consoleCmd)}" placeholder="Type a command (e.g. /today, /balance, /safe, or coffee 35)..." autocomplete="off">
          <button type="button" class="btn primary" data-act="tg-hub-run">▶ Test command</button>
          <button type="button" class="btn" data-act="tg-hub-send-phone" title="Send this response directly to your phone's Telegram chat">📱 Send to my phone</button>
        </div>

        <div class="tg-console-output-box">
          <div class="tg-console-bubble">
            ${consoleOutput}
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head-pill">
          <h2>📋 Bot Commands Catalog</h2>
          <button type="button" class="btn small" data-act="tg-hub-copy-cmds">📋 Copy for @BotFather</button>
        </div>
        <p class="muted small" style="margin-top:0">
          List of commands your bot understands. You can register them in @BotFather to enable native autocomplete on your phone:
        </p>

        <table class="grid tg-cmd-table">
          <thead>
            <tr><th>Command</th><th>Description</th></tr>
          </thead>
          <tbody>
            <tr><td><code>/today</code></td><td>Today's spending, budget remainder &amp; recent records</td></tr>
            <tr><td><code>/month</code></td><td>Month-to-date breakdown, top categories &amp; jar status</td></tr>
            <tr><td><code>/balance</code></td><td>All accounts, liquid cash, cards &amp; safe balances</td></tr>
            <tr><td><code>/safe</code></td><td>Daily safe-to-spend allowance &amp; pool until payday</td></tr>
            <tr><td><code>/goals</code></td><td>Visual progress bars and completion ETAs for goals</td></tr>
            <tr><td><code>/rates</code></td><td>Live official exchange rates &amp; crypto prices</td></tr>
            <tr><td><code>/last</code></td><td>List of last 10 recorded transactions</td></tr>
            <tr><td><code>/undo</code></td><td>Instantly undo the last transaction logged via Telegram</td></tr>
            <tr><td><code>/blocks</code></td><td>Display your custom reply keyboard buttons</td></tr>
            <tr><td><code>/help</code></td><td>Syntax cheatsheet &amp; quick logging help</td></tr>
          </tbody>
        </table>

        <div class="tg-botfather-help">
          <b>How to register commands in Telegram:</b>
          <ol class="small muted" style="margin:6px 0 0; padding-left:18px;">
            <li>In Telegram, message <b>@BotFather</b> and send <code>/setcommands</code>.</li>
            <li>Select your bot from the list.</li>
            <li>Click <b>"Copy for @BotFather"</b> above, then paste and send the list.</li>
            <li>Now your phone will auto-suggest all commands when you type <code>/</code>!</li>
          </ol>
        </div>
      </section>
    </div>
  `;
}

function renderSettingsTab() {
  return `
    <div class="tg-settings-wrap">
      ${Telegram.settingsCard()}
    </div>
  `;
}

export function view() {
  const status = Telegram.getStatus()?.status;
  return `
    <div class="view-telegram-hub">
      ${renderHeader(status)}
      ${renderTabs()}
      <div class="tg-hub-content">
        ${hubTab === 'sync' ? renderSyncTab(status) : ''}
        ${hubTab === 'buttons' ? renderButtonsTab() : ''}
        ${hubTab === 'commands' ? renderCommandsTab() : ''}
        ${hubTab === 'settings' ? renderSettingsTab() : ''}
      </div>
    </div>
  `;
}

export function onClick(act, el) {
  if (act === 'tg-hub-tab') {
    hubTab = el.dataset.tab;
    ctx.render();
    return true;
  }

  if (act === 'tg-hub-chip') {
    consoleCmd = el.dataset.cmd;
    const input = document.getElementById('tg-console-input');
    if (input) input.value = consoleCmd;
    consoleOutput = simulateCommand(consoleCmd, ctx.state);
    ctx.render();
    return true;
  }

  if (act === 'tg-hub-run') {
    const input = document.getElementById('tg-console-input');
    if (input) consoleCmd = input.value;
    consoleOutput = simulateCommand(consoleCmd, ctx.state);
    ctx.render();
    return true;
  }

  if (act === 'tg-hub-send-phone') {
    const input = document.getElementById('tg-console-input');
    if (input) consoleCmd = input.value;
    const text = simulateCommand(consoleCmd, ctx.state);
    if (!Telegram.isLinked()) {
      ctx.toast('Connect your Telegram bot first in Bot Settings.');
      return true;
    }
    Telegram.sendDirect(text).then(() => {
      ctx.toast('Sent to your Telegram phone ✓');
    }).catch((e) => {
      ctx.toast(`Failed: ${e.message || e}`);
    });
    return true;
  }

  if (act === 'tg-hub-copy-cmds') {
    navigator.clipboard.writeText(BOTFATHER_COMMANDS).then(() => {
      ctx.toast('Commands copied! Send /setcommands to @BotFather and paste.');
    }).catch(() => {
      ctx.toast('Copied to clipboard');
    });
    return true;
  }

  // Delegate button actions
  if (act.startsWith('tgb-')) {
    return TgBlocks.onClick(act, el);
  }

  // Delegate telegram actions
  if (act.startsWith('tg-')) {
    return Telegram.onClick(act);
  }

  return false;
}

export function onChange(el) {
  if (hubTab === 'settings') {
    return Telegram.onChange(el);
  }
  return false;
}

export function onInput(el) {
  if (el.id === 'tg-console-input') {
    consoleCmd = el.value;
    return true;
  }
  return false;
}
