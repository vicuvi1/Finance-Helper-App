// "Show on Home": you choose which cards Home shows (Settings → General → Show on Home,
// or "Choose what Home shows" at the bottom of Home). Safe to spend and "Do this next"
// always stay. settings.homeHidden = { cardId: true } (synced: same Home on every device).
// Pure and tested (tests/homecards.test.js).

export const HOME_CARDS = [
  { id: 'afford', label: 'Can I afford it? · Money calendar · Wishlist (the row under Safe to spend)' },
  { id: 'ask', label: 'Ask about your money' },
  { id: 'pay', label: 'Pay yourself (when it\'s on)' },
  { id: 'cash', label: 'Count your cash' },
  { id: 'strip', label: 'This month: in, out, kept' },
  { id: 'spending', label: 'Where your money goes' },
  { id: 'goal', label: 'Your main goal' },
  { id: 'emergency', label: 'Emergency fund' },
  { id: 'compare', label: 'This month against last month' },
  { id: 'favs', label: 'Favourites' },
  { id: 'recent', label: 'Recent records' },
  { id: 'goals', label: 'Other goals' },
  { id: 'plan', label: 'To confirm and Coming up' },
  { id: 'networth', label: 'Net worth' },
  { id: 'tips', label: 'Heads up' },
  { id: 'jars', label: 'Jars' },
];

/** A calm Home: the three questions (spend today, my month, how safe) and what to confirm. */
export const CALM = new Set(['strip', 'emergency', 'recent', 'plan']);

export const homeHidden = (state) => (state.settings?.homeHidden && typeof state.settings.homeHidden === 'object' ? state.settings.homeHidden : {});
export const showOnHome = (state, id) => !homeHidden(state)[id];

export function setShown(state, id, on, now = Date.now()) {
  const h = { ...homeHidden(state) };
  if (on) delete h[id]; else h[id] = true;
  state.settings.homeHidden = h;
  state.settings.updatedAt = now;
}

/** 'calm' keeps only CALM; 'all' shows everything. */
export function applyPreset(state, preset, now = Date.now()) {
  const h = {};
  if (preset === 'calm') for (const c of HOME_CARDS) if (!CALM.has(c.id)) h[c.id] = true;
  state.settings.homeHidden = h;
  state.settings.updatedAt = now;
}

export function pickerHTML(state, esc) {
  return `<section class="card" id="home-pick" data-testid="home-pick"><h2>Show on Home</h2>
    <p class="muted small" style="margin-top:0">Safe to spend and "Do this next" always stay. Everything you hide is still in its own screen.</p>
    <div class="btns" style="margin:0 0 10px"><button type="button" class="btn sm" data-act="home-preset" data-preset="calm" data-testid="home-calm">Calm Home</button><button type="button" class="btn sm" data-act="home-preset" data-preset="all">Show everything</button></div>
    <div class="hp-list">${HOME_CARDS.map((c) => `<label class="hp-row"><input type="checkbox" data-home-card="${c.id}" ${showOnHome(state, c.id) ? 'checked' : ''}><span>${esc(c.label)}</span></label>`).join('')}</div>
  </section>`;
}
