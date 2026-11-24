// The phone setup check (Android app): everything payments need to be caught reliably, each with
// a one-tap fix. `status` comes from the app (window.FHAndroid.setupStatus()). Pure and tested.

import { activeAccounts } from './model.js';

/** [{id, ok, title, text, fix}] — `fix`: what FHAndroid.fix() opens, or a web action. */
export function setupItems(status = {}, state) {
  const cards = activeAccounts(state).filter((a) => (a.kind === 'card' || a.kind === 'virtual') && !a.savings);
  const noDigits = cards.filter((a) => !/^\d{4}$/.test(String(a.last4 || '')));
  const items = [
    { id: 'listener', ok: !!status.listener, title: 'Read payment notifications', text: status.listener ? 'Allowed.' : 'Android has to allow the app to read notifications (it only acts on the bank apps you tick).', fix: 'listener' },
    { id: 'banks', ok: status.banks > 0, title: 'Your bank app is ticked', text: status.banks > 0 ? `${status.banks} bank app${status.banks === 1 ? '' : 's'} ticked.` : 'Pay once by card: your bank app shows up below, then tick it.', fix: null },
    { id: 'battery', ok: !!status.battery, title: 'Battery: Unrestricted', text: status.battery ? 'Set: the phone won\'t put the payment reader to sleep.' : 'Samsung puts apps to sleep to save battery, and then payments are missed. Unrestricted doesn\'t make the app use more: it only keeps the reader allowed.', fix: 'battery' },
    { id: 'notify', ok: !!status.notify, title: 'Show notifications', text: status.notify ? 'Allowed.' : 'Needed for the "save it?" question and the alerts.', fix: 'notify' },
    { id: 'cards', ok: !noDigits.length, title: 'Card digits', text: noDigits.length ? `Type the last 4 digits for ${noDigits.map((a) => a.name).join(', ')} below, so payments land on the right card.` : 'Every card has its last 4 digits.', fix: null },
  ];
  if (status.promoted === false) items.push({ id: 'promoted', ok: false, title: 'Live updates (Now Bar)', text: 'Android 16 lets the payment question sit in the status bar and the Now Bar: turn on "Live notifications" for Finance Helper.', fix: 'promoted' });
  if (status.capture === false) items.push({ id: 'capture', ok: false, title: 'Linked to your server', text: 'Open this screen once while signed in: the app gets its private link.', fix: null });
  return items;
}

export const problems = (status, state) => setupItems(status, state).filter((x) => !x.ok);
