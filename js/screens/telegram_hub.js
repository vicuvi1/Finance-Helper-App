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
limit - Your monthly spending limit (/limit 8000 sets it)
recap - Last month's recap
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
  if (lower === '/limit' || lower === 'limit') {
    return T.limitText(state, today);
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
  const broken = isLinked && status.errorCode;
  return `
    <header class="top tg-hub-top">
      <div>
        <h1>Telegram bot</h1>
        <div class="sub">Log money from your phone. The bot answers right away; this app picks it up.</div>
      </div>
      <div class="tg-hub-header-actions">
        ${isLinked ? `<span class="set-badge ${broken ? 'expense' : 'income'}">● ${broken ? 'Not working' : `@${esc(status.botName)}`}</span>` : '<span class="set-badge">Not set up yet</span>'}
        <button type="button" class="btn primary" data-act="tg-load" title="Get what you sent from your phone">
          📥 Get messages now
        </button>
      </div>
    </header>
  `;
}

function renderTabs() {
  const blocks = B.blocks(ctx.state);
  const tab = (id, label) => `<button type="button" class="chip" data-act="tg-hub-tab" data-tab="${id}" aria-pressed="${hubTab === id}">${label}</button>`;
  return `
    <div class="seg seg-tg-tabs" role="group" aria-label="Telegram sections">
      ${tab('sync', 'From your phone')}
      ${tab('buttons', `Buttons <span class="muted">${blocks.length}</span>`)}
      ${tab('commands', 'Try a command')}
      ${tab('settings', 'Setup &amp; reminders')}
    </div>
  `;
}

// Who answers your messages while this PC is off.
function offlineLine(status) {
  if (status?.server?.on) return { k: 'Your server', v: 'Answers right away, always on' };
  if (status?.relay?.on) return { k: 'Google script', v: 'Answers within a minute' };
  return { k: 'Waits for the PC', v: 'Telegram keeps messages for 24 h' };
}

const EXAMPLES = [
  ['coffee 35', 'Spent 35 on coffee, from your usual card'],
  ['groceries 140 card', 'Say which card or cash it came from'],
  ['taxi 55 yesterday', 'For a day that already passed'],
  ['+5000 salary', 'A plus sign means money came in'],
  ['20+35+15 lunch', 'It adds up for you: 70'],
  ['/today', 'How today looks (also /month, /safe)'],
];

function renderSyncTab(status) {
  const state = ctx.state;
  const isLinked = !!status?.linked;
  const tgTx = state.tx.filter((t) => t.source === 'telegram' || (t.id && String(t.id).startsWith('tg-')));
  const recent = M.sortTx(tgTx).slice(0, 20);

  const totalSpent = tgTx.filter((t) => t.type === 'expense').reduce((s, t) => s + M.B(t), 0);
  const totalEarned = tgTx.filter((t) => t.type === 'income').reduce((s, t) => s + M.B(t), 0);
  const cur = state.settings.currency;
  const off = offlineLine(status);

  return `
    <div class="tg-strip">
      <div class="tg-strip-cell">
        <span class="k">Your bot</span>
        <b>${isLinked ? `@${esc(status.botName)}` : 'Not set up yet'}</b>
        ${isLinked
          ? `<small>${status.userName ? `Listens only to ${esc(status.userName)}` : 'Linked to your chat'}</small>`
          : '<button type="button" class="card-link" data-act="tg-hub-tab" data-tab="settings">Set it up in 2 minutes →</button>'}
      </div>
      <div class="tg-strip-cell">
        <span class="k">Logged from your phone</span>
        <b>${tgTx.length} record${tgTx.length === 1 ? '' : 's'}</b>
        <small>${esc(formatMoney(totalSpent, cur))} spent · ${esc(formatMoney(totalEarned, cur))} came in</small>
      </div>
      <div class="tg-strip-cell">
        <span class="k">When this PC is off</span>
        <b>${off.k}</b>
        <small>${off.v}</small>
      </div>
    </div>

    <div class="tg-grid-2">
      <section class="card tg-feed-card">
        <h2>Latest from your phone <span class="right">${tgTx.length ? `${tgTx.length} in total` : ''}</span></h2>
        ${recent.length ? `
          <div class="tg-recent-feed">
            ${recent.map((t) => {
              const c = M.category(state, t.category);
              const a = M.account(state, t.account);
              const sign = t.type === 'income' ? '+' : '−';
              return `
                <div class="tg-feed-item">
                  <div class="tg-feed-icon" aria-hidden="true">${c?.emoji || (t.type === 'income' ? '💵' : '💸')}</div>
                  <div class="t">
                    <b>${esc(t.note || c?.name || 'Expense')}</b>
                    <small class="muted">${esc(dayLabel(t.date))} · ${esc(c?.name || 'Category')} · ${esc(a?.name || 'Account')}</small>
                  </div>
                  <b class="amt ${t.type === 'income' ? 'income' : 'expense'}">${sign}${esc(formatMoney(t.amount, t.currency || cur))}</b>
                </div>
              `;
            }).join('')}
          </div>
        ` : `
          <div class="tg-empty-feed">
            <div class="tg-empty-bubble" aria-hidden="true"><span>coffee 35</span><span class="in">✓ Coffee · 35 MDL</span></div>
            <b>Nothing from your phone yet</b>
            <p class="muted">Send your bot a message like <code>coffee 35</code>, or tap one of your buttons. It shows up here.</p>
          </div>
        `}
      </section>

      <section class="card tg-howto">
        <h2>How to write to your bot</h2>
        <ul class="tg-examples">
          ${EXAMPLES.map(([code, text]) => `<li><code>${esc(code)}</code><span>${esc(text)}</span></li>`).join('')}
        </ul>
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
          <h2>On your phone</h2>
          <p class="muted small" style="margin-top:0">How your buttons look under the chat in Telegram:</p>

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
            Your phone gets the new buttons as soon as you change them.
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
    { label: '/limit', cmd: '/limit' },
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
        <h2>Try it here</h2>
        <p class="muted small" style="margin-top:0">
          Type what you would send the bot and see its answer. Nothing is saved.
        </p>

        <div class="tg-quick-chips">
          <span class="muted small" style="align-self:center;">Try:</span>
          ${chips.map((c) => `
            <button type="button" class="lq-chip" data-act="tg-hub-chip" data-cmd="${esc(c.cmd)}">${esc(c.label)}</button>
          `).join('')}
        </div>

        <div class="tg-console-input-row" style="margin-top:12px">
          <input type="text" id="tg-console-input" class="input" value="${esc(consoleCmd)}" placeholder="e.g. /today, /safe or coffee 35" autocomplete="off">
          <button type="button" class="btn primary" data-act="tg-hub-run">▶ Show the answer</button>
          <button type="button" class="btn" data-act="tg-hub-send-phone" title="Send this response directly to your phone's Telegram chat">📱 Send to my phone</button>
        </div>

        <div class="tg-console-output-box">
          <div class="tg-console-bubble">${consoleOutput}</div>
        </div>
      </section>

      <section class="card">
        <div class="card-head-pill">
          <h2>What the bot understands</h2>
          <button type="button" class="btn small" data-act="tg-hub-copy-cmds">📋 Copy for @BotFather</button>
        </div>
        <p class="muted small" style="margin-top:0">
          Add these to @BotFather and your phone suggests them when you type <code>/</code>.
        </p>

        <ul class="tg-examples tg-cmds">
          <li><code>/today</code><span>Today's spending, budget remainder &amp; recent records</span></li>
          <li><code>/month</code><span>Month-to-date breakdown, top categories &amp; jar status</span></li>
          <li><code>/balance</code><span>All accounts, liquid cash, cards &amp; safe balances</span></li>
          <li><code>/safe</code><span>Daily safe-to-spend allowance &amp; pool until payday</span></li>
          <li><code>/limit</code><span>Your monthly spending limit; <code>/limit 8000</code> sets it, <code>/limit off</code> turns it off</span></li>
          <li><code>/goals</code><span>Visual progress bars and completion ETAs for goals</span></li>
          <li><code>/rates</code><span>Live official exchange rates &amp; crypto prices</span></li>
          <li><code>/last</code><span>List of last 10 recorded transactions</span></li>
          <li><code>/undo</code><span>Instantly undo the last transaction logged via Telegram</span></li>
          <li><code>/blocks</code><span>Display your custom reply keyboard buttons</span></li>
          <li><code>/help</code><span>Syntax cheatsheet &amp; quick logging help</span></li>
        </ul>

        <div class="tg-botfather-help">
          <b>How to add them:</b>
          <ol class="small muted" style="margin:6px 0 0; padding-left:18px;">
            <li>In Telegram, message <b>@BotFather</b> and send <code>/setcommands</code>.</li>
            <li>Select your bot from the list.</li>
            <li>Click <b>Copy for @BotFather</b> above, then paste and send it.</li>
            <li>Your phone now suggests them when you type <code>/</code>.</li>
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
