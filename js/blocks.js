// Quick blocks: the buttons under the Telegram bot's message box
// ("☕ Coffee 20", "🥙 Kebab 70"). One tap logs the record for that day.
// You edit them in Settings → Telegram buttons. The list is one setting
// (settings.tgBlocks): it syncs whole, the newest edit wins. Pure, tested.

import { suggestCategory, sortTx, account } from './model.js';
import { evalAmount } from './money.js';

// A big sticker palette in groups, each emoji with words to find it by
// (English, Romanian, Russian). Typing a button's name suggests one.
const G = (name, list) => ({ name, items: list.split('|').map((x) => { const i = x.indexOf(' '); return { e: x.slice(0, i), k: x.slice(i + 1) }; }) });
export const EMOJI_GROUPS = [
  G('Food & drinks', '☕ coffee cafea кофе espresso latte|🍵 tea ceai чай|🧋 bubble tea|🥤 soda cola drink suc|🧃 juice suc|💧 water apa вода|🥛 milk lapte|🍺 beer bere пиво bar|🍷 wine vin вино|🥂 champagne party|🍸 cocktail|🥃 whisky|🍾 bottle|🥙 kebab shaorma shawarma doner|🌯 wrap burrito|🌮 taco|🍔 burger lunch pranz|🍟 fries cartofi|🍕 pizza|🌭 hot dog|🥪 sandwich|🥗 salad salata|🍣 sushi|🍜 ramen soup supa|🍲 soup stew zeama|🍝 pasta|🍛 curry|🍚 rice orez|🥟 dumplings coltunasi pelmeni|🍗 chicken pui|🍖 meat carne|🥩 steak|🥓 bacon|🍳 eggs breakfast oua|🥞 pancakes clatite|🧇 waffle|🥐 croissant bakery|🥖 bread paine хлеб|🥨 pretzel covrig|🧀 cheese branza|🍰 cake tort|🎂 birthday cake|🧁 cupcake|🍩 donut gogosi|🍪 cookie biscuit|🍫 chocolate snack ciocolata|🍬 candy bomboane|🍦 ice cream inghetata|🍎 apple fruit mar|🍌 banana|🍓 strawberry|🍉 watermelon|🍇 grapes struguri|🥑 avocado|🥕 vegetables legume|🥔 potato cartofi|🍅 tomato rosii|🥜 nuts|🍿 popcorn movie snack|🛒 groceries market magazin supermarket|🧺 basket market piata'),
  G('Internet & tech', '🌐 internet web online|📶 internet mobile data signal|🛜 wifi wireless internet|📡 satellite tv internet antenna|💻 laptop computer pc|🖥️ desktop computer pc monitor|⌨️ keyboard|🖱️ mouse|🖨️ printer|📱 phone mobile telefon|📲 top up phone credit recharge|☎️ phone landline|📞 call|🔋 battery charger|🔌 plug charger electricity|💾 storage|💿 disk|📀 dvd|🎧 headphones music|🎮 games gaming playstation|🕹️ games arcade|📺 tv television netflix|📹 camera video|📷 camera photo|🤖 ai bot chatgpt claude|🧠 ai learning|☁️ cloud drive icloud storage|🔐 vpn security password|🔑 key license|🛡️ antivirus security|⚙️ software tools|🧩 plugin app|🌍 domain hosting website|🖋️ design|🎨 design figma|🎵 music spotify|🎬 streaming movie youtube|📧 email mail|💬 chat telegram|🔔 subscription notification|📦 order delivery package colet|🛍️ online shopping aliexpress temu|🪙 crypto coin bitcoin|📈 trading stocks investing'),
  G('Transport', '🚌 bus autobuz troleibuz|🚎 trolleybus troleibuz|🚐 minibus rutiera maxi taxi|🚕 taxi yandex bolt uber|🚗 car masina|🚙 suv car|🏎️ fast car|🏍️ motorbike|🛵 scooter|🚲 bike bicycle bicicleta|🛴 kick scooter|🚇 metro subway|🚆 train tren|🚄 fast train|✈️ flight plane avion|🛫 trip airport|🚢 ship ferry|⛽ fuel gas benzina petrol|🔋 ev charging|🅿️ parking parcare|🛞 tires anvelope|🔧 repair service car|🧽 car wash spalatorie|🚦 traffic fine amenda|🛣️ road toll vigneta|🗺️ trip travel'),
  G('Home & bills', '🏠 home rent chirie casa|🏡 house|🏢 apartment office|💡 electricity light lumina|🔥 gas heating gaz|💧 water bill apa|🚿 shower water|🛁 bath|🧻 toilet paper|🧹 cleaning curatenie|🧼 soap sapun|🧺 laundry|🪣 bucket|🛋️ furniture mobila|🛏️ bed|🪑 chair|🔨 repair tools|🪛 tools|🧰 toolbox|🪴 plants flori|🔑 keys rent|📬 mail post|🧾 bill receipt factura|🗑️ trash gunoi|🪟 window|🚪 door'),
  G('Shopping & clothes', '👕 tshirt clothes haine|👖 jeans|👗 dress rochie|🧥 coat jacket|👟 sneakers shoes|👞 shoes pantofi|👠 heels|🧦 socks|🧢 cap|🎒 backpack rucsac|👜 bag geanta|👛 wallet|💍 ring jewelry|⌚ watch ceas|🕶️ sunglasses|👓 glasses ochelari|🛍️ shopping cumparaturi|🎁 gift cadou present|🧸 toy jucarie|🖊️ stationery pen|📒 notebook'),
  G('Health & care', '💊 medicine pills farmacie|🏥 hospital doctor|🩺 doctor checkup|🦷 dentist stomatolog|👁️ eyes optician|💉 vaccine injection|🩹 bandage|🧴 cosmetics lotion|🪥 toothbrush|💈 barber frizer|💇 haircut|💅 nails manichiura|💆 massage spa|🧘 yoga|🛀 spa|🧪 lab tests analize'),
  G('Sport & fun', '🥋 martial arts karate judo|🏋️ gym sala fitness|🤸 gymnastics|🏃 running|⚽ football fotbal|🏀 basketball|🎾 tennis|🏊 swimming|🚴 cycling|🥊 boxing|🏆 competition trophy|🎟️ tickets bilete|🎫 ticket|🎬 cinema movie film|🎭 theatre|🎤 karaoke concert|🎸 guitar|🎳 bowling|🎱 billiards|🎯 darts goal|🎲 board games|🃏 cards|🎉 party petrecere|🍻 drinks friends|🏖️ vacation beach|⛰️ mountains hiking|🏕️ camping|🎡 park|📸 photos'),
  G('Learning & work', '📚 books carti|📖 reading|🎓 course university|✏️ school|🧑\u200d💻 freelance coding|💼 work job lucru|🗂️ documents|📊 business report|📝 taxes forms|🏛️ taxes state|🖇️ office supplies|🧑\u200d🏫 tutor lessons|🌐 online course'),
  G('Money', '💰 money salary bani|💵 cash dollars|💶 euro|💷 pound|💴 yen|💳 card bank|🏦 bank safe deposit|🪙 coin crypto|💸 spending money out|🤑 bonus|📈 investing growth|📉 loss|🧾 receipt|💹 exchange|🎰 gambling|🤝 loan debt'),
  G('Family & pets', '👪 family familie|👶 baby kids copil|🧒 child|👵 grandma bunica|👴 grandpa|❤️ love partner|💐 flowers flori|🐶 dog caine|🐱 cat pisica|🐾 pet food|🐟 fish|🐦 bird|🦜 parrot|🐴 horse'),
  G('Symbols', '⭐ star favorite|🔥 hot fire|✅ done|❗ important|❓ other unknown|🔴 red|🟠 orange|🟡 yellow|🟢 green|🔵 blue|🟣 purple|⚫ black|⚪ white|💜 heart|💙 heart|💚 heart|💛 heart|🧡 heart|🖤 heart|🍀 luck|🌙 night|☀️ day|⚡ quick|📌 pin|🔁 repeat|➕ plus|➖ minus'),
];
export const EMOJIS = [...new Set(EMOJI_GROUPS.flatMap((g) => g.items.map((x) => x.e)))];

const foldK = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Emoji groups that match a search ("internet", "taxi", "cafea"); all when empty.
export function searchEmojis(q) {
  const words = foldK(q).split(/\s+/).filter(Boolean);
  if (!words.length) return EMOJI_GROUPS;
  return EMOJI_GROUPS.map((g) => ({ ...g, items: g.items.filter((x) => words.every((w) => foldK(`${x.k} ${g.name}`).split(/[\s&]+/).some((k) => k.startsWith(w)))) }))
    .filter((g) => g.items.length);
}

// What a name suggests: "Internet" -> 🌐 in "Internet & tech" (null if nothing).
function guess(name) {
  const words = foldK(name).split(/[^a-z0-9а-я]+/).filter((w) => w.length >= 3);
  for (const exact of [true, false]) {
    for (const w of words) {
      for (const g of EMOJI_GROUPS) {
        for (const x of g.items) {
          const keys = foldK(x.k).split(' ');
          if (exact ? keys.includes(w) : keys.some((k) => k.startsWith(w))) return { e: x.e, group: g.name, keys };
        }
      }
    }
  }
  return null;
}

export const emojiFor = (name) => guess(name)?.e || null;

// The category a name suggests: what you used for it before, else by its
// sticker group (only categories you have).
const GROUP_CATEGORY = { 'Food & drinks': ['food'], Transport: ['transport'], 'Home & bills': ['home'], 'Shopping & clothes': ['clothes', 'gifts'], 'Health & care': ['health', 'hygiene'], 'Sport & fun': ['sport', 'fun'], 'Learning & work': ['learning'], 'Family & pets': ['family-out'], 'Internet & tech': ['subscriptions', 'home'] };
const BILLS = /internet|wifi|electricity|water|gas|rent|phone|mobile|chirie|lumina/;
export function categoryFor(state, name, type = 'expense') {
  const learned = suggestCategory(state, name, type);
  if (learned) return learned;
  const g = guess(name);
  if (!g || type !== 'expense') return null;
  const has = (id) => state.settings.categories.some((c) => c.id === id && c.type === 'expense');
  // Internet, phone, light: a bill. Netflix, Spotify, AI: a subscription.
  const order = g.group === 'Internet & tech' && g.keys.some((k) => BILLS.test(k)) ? ['home', 'subscriptions'] : GROUP_CATEGORY[g.group] || [];
  return order.find(has) || null;
}

// Starters until you make your own (fixed ids, so two devices agree).
const STARTERS = [
  ['coffee', '☕', 'Coffee', 20, 'food'],
  ['kebab', '🥙', 'Kebab', 70, 'food'],
  ['lunch', '🍔', 'Lunch', 100, 'food'],
  ['snack', '🍫', 'Snack', 15, 'food'],
  ['water', '💧', 'Water', 10, 'food'],
  ['groceries', '🛒', 'Groceries', 200, 'food'],
  ['bus', '🚌', 'Bus', 6, 'transport'],
  ['taxi', '🚕', 'Taxi', 50, 'transport'],
  ['fuel', '⛽', 'Fuel', 300, 'transport'],
];

export function starterBlocks(state) {
  const has = (id) => state.settings.categories.some((c) => c.id === id && c.type === 'expense');
  return STARTERS.map(([id, emoji, name, lei, cat]) => ({
    id: `b-${id}`, emoji, name, amount: lei * 100, type: 'expense', category: has(cat) ? cat : 'other', account: null, updatedAt: 0,
  }));
}

// Your blocks in their order.
export const blocks = (state) => (Array.isArray(state.settings.tgBlocks) ? state.settings.tgBlocks : starterBlocks(state));

const plain = (cents) => String(cents / 100).replace('.', ',');
export const blockLabel = (b) => `${b.emoji ? `${b.emoji} ` : ''}${b.type === 'income' ? '+' : ''}${b.name} ${plain(b.amount)}`;

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();

// The block a message is: its button text, or just its name ("coffee").
export function matchBlock(state, text) {
  const t = fold(text);
  if (!t) return null;
  const list = blocks(state);
  return list.find((b) => fold(blockLabel(b)) === t) || list.find((b) => fold(b.name) === t) || null;
}

// The record a block makes. No fixed account: the one you used last for it.
export function blockFields(state, b) {
  const usable = (id) => id && account(state, id) && !account(state, id).archived;
  let acc = usable(b.account) ? b.account : null;
  if (!acc) {
    const recent = sortTx(state.tx).filter((x) => x.type !== 'transfer');
    acc = recent.find((x) => fold(x.note) === fold(b.name) && usable(x.account))?.account
      || recent.find((x) => usable(x.account))?.account
      || state.settings.accounts.find((a) => !a.archived)?.id;
  }
  return { type: b.type, amount: b.amount, note: b.name, account: acc, category: b.category };
}

// "/addblock 🍕 Pizza 120" or "🍕 pizza 120" -> a new block (or null).
export function blockFromText(state, text, now = Date.now()) {
  let t = String(text || '').replace(/^\/(addblock|block|add)(@\w+)?\s*/i, '').trim();
  const emoji = (t.match(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}]+/u) || [''])[0];
  t = t.slice(emoji.length).trim();
  let type = 'expense';
  if (t.startsWith('+')) { type = 'income'; t = t.slice(1).trim(); }
  const m = t.match(/(\d[\d.,]*)\s*(lei|mdl)?\s*$/i);
  if (!m) return null;
  const amount = evalAmount(m[1]);
  const name = t.slice(0, m.index).trim();
  if (!amount || amount <= 0 || !name) return null;
  const category = suggestCategory(state, name, type) || (type === 'income' ? 'other-in' : 'other');
  return { id: `b-${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, emoji, name: name[0].toUpperCase() + name.slice(1), amount, type, category, account: null, updatedAt: now };
}

// Writes the list (the first edit turns the starters into your own list).
export function setBlocks(state, list, now = Date.now()) {
  state.settings.tgBlocks = list;
  state.settings.updatedAt = now;
  return list;
}

export function upsertBlock(state, b, now = Date.now()) {
  const list = [...blocks(state)];
  const i = list.findIndex((x) => x.id === b.id);
  const next = { ...b, updatedAt: now };
  if (i >= 0) list[i] = next; else list.push(next);
  return setBlocks(state, list, now);
}

export function removeBlock(state, id, now = Date.now()) {
  return setBlocks(state, blocks(state).filter((b) => b.id !== id), now);
}

export function moveBlock(state, id, dir, now = Date.now()) {
  const list = [...blocks(state)];
  const i = list.findIndex((b) => b.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  return setBlocks(state, list, now);
}

// Telegram reply keyboard: blocks three per row, then the helpers.
export const HELPER_ROWS = [['📊 Today', '📅 Month', '💰 Balance'], ['🧾 Last', '↩️ Undo', '❓ Help']];

export function blockKeyboard(state, perRow = 3) {
  const list = blocks(state).filter((b) => b.amount > 0 && b.name);
  const rows = [];
  for (let i = 0; i < list.length; i += perRow) rows.push(list.slice(i, i + perRow).map((b) => ({ text: blockLabel(b) })));
  for (const r of HELPER_ROWS) rows.push(r.map((text) => ({ text })));
  return { keyboard: rows, resize_keyboard: true, is_persistent: true, input_field_placeholder: 'Tap a block or type e.g. coffee 35' };
}
