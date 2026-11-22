// The desktop tray icon's words: "Safe to spend today: 412 MDL". Shown when you
// hover the icon by the clock and as the first line of its menu, so you can
// check before buying without opening the app. Pure and tested (tests/trayline.test.js).

import { safeToSpend } from './safespend.js';
import { formatMoney } from './money.js';

/** {tip, line}: the hover text and the menu's first line ('' when nothing to say). */
export function trayLine(state, today, { hidden = false } = {}) {
  if (!state || state._sealed) return { tip: 'Finance Helper (locked)', line: '' };
  if (hidden) return { tip: 'Finance Helper', line: '' };
  let s;
  try { s = safeToSpend(state, today); } catch { return { tip: 'Finance Helper', line: '' }; }
  if (!s || !Number.isFinite(s.leftToday)) return { tip: 'Finance Helper', line: '' };
  const cur = state.settings?.currency || 'MDL';
  const line = `Safe to spend today: ${formatMoney(Math.max(0, Math.round(s.leftToday / 100) * 100), cur, { reveal: true })}`;
  return { tip: `Finance Helper\n${line}`, line };
}
