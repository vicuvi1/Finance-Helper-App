// A small, made-up example: generic names and invented amounts, about 40
// records over the last two months. It is used ONLY for the demo preview
// (globalThis.FH_DEMO) when this browser has no data yet. It is never saved
// over real data and never written to the Life System database.

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function demoFinanceState(now = Date.now()) {
  const day = (back) => iso(new Date(now - back * 864e5));
  const acc = (id, name, kind, currency, color, extra = {}) => ({ id, name, bank: '', kind, currency, start: 0, last4: '', color, savings: false, archived: false, holdings: [], updatedAt: now, ...extra });
  const tx = [];
  let n = 0;
  const rec = (type, lei, back, category, note, account = 'wallet', extra = {}) => {
    n += 1;
    const amount = Math.round(lei * 100);
    tx.push({ id: `demo-${n}`, createdAt: now - back * 864e5, updatedAt: now - back * 864e5, type, amount, currency: 'MDL', rate: 1, base: amount, date: day(back), category, note, account, ...extra });
  };
  rec('income', 9000, 40, 'work', 'example salary', 'card');
  rec('income', 9000, 10, 'work', 'example salary', 'card');
  rec('income', 600, 25, 'side', 'example side job', 'wallet');
  rec('income', 300, 18, 'gift-in', 'example gift', 'wallet', { person: 'p-friend' });
  for (const back of [66, 36, 6]) rec('expense', 99, back, 'subscriptions', 'music app', 'card');
  rec('expense', 64, 1, 'food', 'lunch with a friend #weekend', 'card');
  rec('expense', 120, 1, 'fun', 'bowling #weekend', 'wallet');
  rec('expense', 35, 0, 'food', 'coffee', 'wallet');
  const spend = [
    [55, 'food', 'groceries'], [38, 'food', 'coffee'], [12, 'transport', 'bus'], [240, 'home', 'internet'],
    [150, 'fun', 'cinema'], [90, 'food', 'lunch'], [12, 'transport', 'bus'], [420, 'clothes', 'shoes'],
    [65, 'hygiene', 'soap'], [48, 'food', 'fruit'], [180, 'learning', 'online course'], [30, 'food', 'snacks'],
    [75, 'transport', 'taxi'], [110, 'health', 'vitamins'], [12, 'transport', 'bus'], [210, 'food', 'groceries'],
    [22, 'food', 'juice'], [60, 'fun', 'board game night'], [45, 'food', 'bakery'], [350, 'sport', 'gym month'],
    [12, 'transport', 'bus'], [140, 'gifts', 'present for a friend'], [80, 'food', 'pizza'], [25, 'other', 'stationery'],
    [190, 'food', 'groceries'], [38, 'food', 'coffee'], [12, 'transport', 'bus'], [55, 'fun', 'museum'],
    [70, 'hygiene', 'toothpaste'], [160, 'food', 'groceries'], [12, 'transport', 'bus'], [45, 'food', 'tea and cake'],
  ];
  spend.forEach(([lei, cat, note], i) => rec('expense', lei, 50 - i * 1.5 | 0, cat, note, i % 3 ? 'card' : 'wallet'));
  rec('expense', 200, 15, 'other', 'lent to a friend', 'wallet', { person: 'p-friend', loan: true });
  tx.push({ id: 'demo-t1', createdAt: now - 9 * 864e5, updatedAt: now - 9 * 864e5, type: 'transfer', amount: 300000, currency: 'MDL', rate: 1, base: 300000, date: day(9), from: 'card', to: 'safe', note: 'to savings' });
  return {
    app: 'finance-helper',
    version: 3,
    settings: {
      currency: 'MDL',
      accounts: [
        acc('wallet', 'Cash', 'cash', 'MDL', 2, { emoji: '💵', start: 50000 }),
        acc('card', 'Main card', 'card', 'MDL', 5, { emoji: '💳', start: 100000 }),
        acc('safe', 'Savings', 'savings', 'MDL', 6, { emoji: '🏦', savings: true, start: 500000 }),
        acc('usd', 'Dollar card', 'card', 'USD', 3, { emoji: '💵' }),
      ],
      savingsAccount: 'safe',
      theme: 'dark',
    },
    tx,
    people: [{ id: 'p-friend', name: 'A friend', note: '', updatedAt: now }],
    recurring: [],
    invoices: [],
    goals: [{ id: 'g-demo', name: 'Example goal', emoji: '🎯', target: 2000000, account: 'savings', saved: 0, history: [], deadline: null, doneAt: null, theme: 'teal', updatedAt: now }],
    goalAllocations: [],
    netWorth: [],
    deleted: {},
    // Made-up rates from a few days ago (the demo has no live download).
    rates: { usd: { USD: 1, MDL: 17.6, EUR: 0.92 }, crypto: {}, history: {}, fetchedAt: now - 3 * 864e5 },
    meta: { demo: true },
  };
}
