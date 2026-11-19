// Two levels of spending categories: every category can hold subcategories
// ("Food › Cafés & coffee"). A record keeps its category in `category` (so
// jars, budgets and everything else work as before) and the subcategory in
// `sub`. Pure functions over the state, tested in Node.
//
//   settings.subcats    [{ id, parent, key?, name, emoji, color?, budget?, updatedAt }]
//   settings.subMemory  { "<merchant words>": subId }  learned from your own choices
import { countsAsSpending, signed, isRefund } from './catshare.js';

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ---------- The default tree ----------
// Each subcategory goes under the first of its `homes` that you have, so an
// older category list (Hygiene & cosmetics, Health, Clothes…) gets the
// subcategories that fit it without renaming or moving anything.
export const SUB_DEFAULTS = [
  { key: 'groceries', name: 'Groceries', emoji: '🛒', homes: ['food'] },
  { key: 'restaurants', name: 'Restaurants', emoji: '🍽️', homes: ['food'] },
  { key: 'cafes', name: 'Cafés & coffee', emoji: '☕', homes: ['food'] },
  { key: 'delivery', name: 'Delivery', emoji: '🛵', homes: ['food'] },
  { key: 'snacks', name: 'Snacks', emoji: '🍫', homes: ['food'] },

  { key: 'fuel', name: 'Fuel', emoji: '⛽', homes: ['transport'] },
  { key: 'taxi', name: 'Taxi', emoji: '🚕', homes: ['transport'] },
  { key: 'public', name: 'Public transport', emoji: '🚌', homes: ['transport'] },
  { key: 'car', name: 'Car repairs', emoji: '🔧', homes: ['transport'] },

  { key: 'rent', name: 'Rent', emoji: '🔑', homes: ['home'] },
  { key: 'utilities', name: 'Utilities', emoji: '💡', homes: ['home', 'bills'] },
  { key: 'internet', name: 'Internet & phone', emoji: '📶', homes: ['home', 'bills'] },
  { key: 'furniture', name: 'Furniture', emoji: '🛋️', homes: ['home'] },
  { key: 'cleaning', name: 'Cleaning', emoji: '🧽', homes: ['home'] },

  { key: 'cosmetics', name: 'Cosmetics', emoji: '💄', homes: ['beauty', 'health'] },
  { key: 'skincare', name: 'Skincare', emoji: '🧴', homes: ['beauty', 'health'] },
  { key: 'haircut', name: 'Haircut', emoji: '💇', homes: ['beauty', 'health'] },
  { key: 'pharmacy', name: 'Pharmacy', emoji: '💊', homes: ['health', 'beauty'] },
  { key: 'doctor', name: 'Doctor', emoji: '🩺', homes: ['health', 'beauty'] },
  { key: 'gym', name: 'Gym', emoji: '🏋️', homes: ['sport', 'health', 'beauty'] },
  { key: 'competitions', name: 'Competitions', emoji: '🏆', homes: ['sport'] },
  { key: 'gear', name: 'Sports gear', emoji: '🎽', homes: ['sport'] },

  { key: 'gadgets', name: 'Gadgets', emoji: '📱', homes: ['tech'] },
  { key: 'software', name: 'Software & AI', emoji: '🤖', homes: ['tech', 'subscriptions'] },
  { key: 'games', name: 'Games', emoji: '🎮', homes: ['tech', 'fun'] },
  { key: 'streaming', name: 'Streaming & music', emoji: '📺', homes: ['subscriptions', 'fun'] },
  { key: 'apps', name: 'Apps & cloud', emoji: '☁️', homes: ['subscriptions', 'tech'] },

  { key: 'clothes', name: 'Clothes', emoji: '👕', homes: ['shopping'] },
  { key: 'shoes', name: 'Shoes', emoji: '👟', homes: ['shopping'] },
  { key: 'accessories', name: 'Accessories', emoji: '👜', homes: ['shopping'] },

  { key: 'gifts', name: 'Gifts', emoji: '🎁', homes: ['gifts', 'family'] },
  { key: 'support', name: 'Family support', emoji: '💞', homes: ['family', 'gifts'] },
  { key: 'celebrations', name: 'Celebrations', emoji: '🎂', homes: ['gifts', 'family'] },

  { key: 'goingout', name: 'Going out', emoji: '🍻', homes: ['fun'] },
  { key: 'cinema', name: 'Cinema', emoji: '🎬', homes: ['fun'] },
  { key: 'events', name: 'Events', emoji: '🎟️', homes: ['fun'] },
  { key: 'hobbies', name: 'Hobbies', emoji: '🎨', homes: ['fun'] },
  { key: 'travel', name: 'Travel', emoji: '✈️', homes: ['fun'] },

  { key: 'courses', name: 'Courses', emoji: '🎓', homes: ['learning'] },
  { key: 'books', name: 'Books', emoji: '📚', homes: ['learning'] },
  { key: 'certifications', name: 'Certifications', emoji: '📜', homes: ['learning'] },

  { key: 'stocks', name: 'Stocks & funds', emoji: '📈', homes: ['investing'] },
  { key: 'crypto', name: 'Crypto', emoji: '🪙', homes: ['investing'] },

  { key: 'bankfees', name: 'Bank fees', emoji: '🏦', homes: ['bills'] },
  { key: 'taxes', name: 'Taxes', emoji: '🧾', homes: ['bills'] },
];

// Which group of the tree a category is: by its built-in id, else its name.
const PARENT_IDS = {
  food: 'food', transport: 'transport', home: 'home', hygiene: 'beauty', health: 'health',
  clothes: 'shopping', shopping: 'shopping', gifts: 'gifts', 'family-out': 'family', fun: 'fun',
  learning: 'learning', subscriptions: 'subscriptions', sport: 'sport', investing: 'investing',
  tech: 'tech', bills: 'bills', other: 'other',
};
const PARENT_NAMES = [
  ['food', /food|grocer|eat|mancare|продукт|еда/],
  ['transport', /transport|car\b|auto|masina|travel to|транспорт/],
  ['home', /home|house|rent|casa|locuin|chirie|дом|кварт/],
  ['tech', /tech|gadget|electron|computer|laptop|техник|гаджет/],
  ['beauty', /beauty|cosmet|hygien|igien|frumus|красот|космет|гигиен/],
  ['health', /health|medic|sanat|pharm|здоров|медиц/],
  ['shopping', /shop|cloth|haine|fashion|одежд|покупк/],
  ['gifts', /gift|cadou|подар/],
  ['family', /family|famil|parent|kids|copii|семь|дет/],
  ['fun', /fun|going out|entertain|leisure|distract|развлеч|досуг/],
  ['learning', /learn|study|course|educ|school|invat|учеб|образов/],
  ['subscriptions', /subscri|abonam|подпис/],
  ['sport', /sport|gym|fitness|спорт/],
  ['investing', /invest|инвест/],
  ['bills', /bill|fee|tax|bank|impozit|comision|налог|комисс/],
];
export function parentKeyOf(c) {
  if (!c || c.type !== 'expense') return null;
  if (PARENT_IDS[c.id]) return PARENT_IDS[c.id];
  const n = fold(c.name);
  return PARENT_NAMES.find(([, re]) => re.test(n))?.[0] || null;
}

// Groups that are added as new categories when nothing you have fits them.
const ADD_IF_MISSING = {
  tech: { id: 'tech', name: 'Tech', emoji: '💻', jar: 'growth' },
  bills: { id: 'bills', name: 'Bills & fees', emoji: '🧾', jar: 'living' },
};

// Once per data set: builds the subcategory list from your categories.
// Nothing about your records changes; they simply have no subcategory yet.
// Returns true when it changed `settings`.
export function ensureTree(settings) {
  if (Array.isArray(settings.subcats)) {
    if (!settings.subMemory || typeof settings.subMemory !== 'object') settings.subMemory = {};
    return false;
  }
  settings.categories = [...(settings.categories || [])];
  const jars = settings.jars || [];
  const home = {};
  for (const c of settings.categories) {
    if (c.archived) continue;
    const k = parentKeyOf(c);
    if (k && !home[k]) home[k] = c.id;
  }
  for (const [k, def] of Object.entries(ADD_IF_MISSING)) {
    if (home[k] || settings.categories.some((c) => c.id === def.id)) continue;
    const jar = jars.some((j) => j.id === def.jar) ? def.jar : jars.find((j) => !j.savings)?.id;
    // jarChosen: "fees" in the name must not move it outside the jars.
    settings.categories.push({ id: def.id, type: 'expense', name: def.name, emoji: def.emoji, ...(jar ? { jar } : {}), jarChosen: true, updatedAt: 0 });
    home[k] = def.id;
  }
  settings.subcats = [];
  for (const d of SUB_DEFAULTS) {
    const h = d.homes.find((x) => home[x]);
    if (!h) continue;
    settings.subcats.push({ id: `s-${d.key}`, parent: home[h], key: d.key, name: d.name, emoji: d.emoji, updatedAt: 0 });
  }
  if (!settings.subMemory || typeof settings.subMemory !== 'object') settings.subMemory = {};
  return true;
}

// ---------- Looking things up ----------

const subList = (state) => (Array.isArray(state.settings.subcats) ? state.settings.subcats : []);
export const subById = (state, id) => (id ? subList(state).find((s) => s.id === id) || null : null);
export const subsOf = (state, catId) => subList(state).filter((s) => s.parent === catId && !s.archived);
// A record's subcategory, only while it still belongs to the record's category.
export function subOf(state, t) {
  const s = t && t.sub ? subById(state, t.sub) : null;
  return s && s.parent === t.category ? s : null;
}
export const isOther = (catId) => !catId || catId === 'other' || catId === 'other-in';

// A spending record that could be filed one level deeper.
export function needsSub(state, t) {
  if (!t || t.type !== 'expense' || t.loan) return false;
  if (subOf(state, t)) return false;
  return isOther(t.category) || subsOf(state, t.category).length > 0;
}

// "Food › Cafés & coffee", with icons when asked.
export function catPath(state, t, { icons = false } = {}) {
  const c = state.settings.categories.find((x) => x.id === t.category);
  const s = subOf(state, t);
  const part = (x) => (icons && x.emoji ? `${x.emoji} ${x.name}` : x.name);
  return [c ? part(c) : 'Other', s ? part(s) : null].filter(Boolean).join(' › ');
}

// ---------- Changing the tree ----------

const newId = () => `s-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const touch = (o, now) => Object.assign(o, { updatedAt: now });

export function addSub(state, parent, name, emoji = '', now = Date.now()) {
  const n = String(name || '').trim();
  const c = state.settings.categories.find((x) => x.id === parent);
  if (!n || !c) return null;
  const found = subsOf(state, parent).find((s) => fold(s.name) === fold(n));
  if (found) return found;
  const s = { id: newId(), parent, name: n, emoji: String(emoji || '').trim(), updatedAt: now };
  state.settings.subcats = [...subList(state), s];
  return s;
}

export function renameSub(state, id, patch, now = Date.now()) {
  const s = subById(state, id);
  if (!s) return null;
  if (patch.name != null) s.name = String(patch.name).trim() || s.name;
  if (patch.emoji != null) s.emoji = String(patch.emoji).trim();
  if (patch.color !== undefined) s.color = patch.color || undefined;
  if (patch.budget !== undefined) s.budget = patch.budget > 0 ? patch.budget : null;
  return touch(s, now);
}

// Moves a subcategory under another category. Its records go along (their
// category changes to the new one), so nothing is left behind.
export function moveSub(state, id, parent, now = Date.now()) {
  const s = subById(state, id);
  const c = state.settings.categories.find((x) => x.id === parent);
  if (!s || !c || c.type !== 'expense' || s.parent === parent) return 0;
  const from = s.parent;
  s.parent = parent;
  touch(s, now);
  let n = 0;
  for (const t of state.tx) {
    if (t.sub === id && t.category === from) { t.category = parent; touch(t, now); n++; }
  }
  return n;
}

// Removes a subcategory. Its records stay in their category, without one.
export function removeSub(state, id, now = Date.now()) {
  const s = subById(state, id);
  if (!s) return 0;
  state.settings.subcats = subList(state).filter((x) => x.id !== id);
  if (state.deleted) state.deleted[id] = now;
  let n = 0;
  for (const t of state.tx) if (t.sub === id) { delete t.sub; touch(t, now); n++; }
  for (const [k, v] of Object.entries(state.settings.subMemory || {})) if (v === id) delete state.settings.subMemory[k];
  return n;
}

// Files a record under a subcategory (and its category) and remembers the
// merchant, so the next one like it is filed right away.
export function setSub(state, t, id, { learn = true, now = Date.now() } = {}) {
  const s = subById(state, id);
  if (!s) return false;
  t.sub = s.id;
  t.category = s.parent;
  touch(t, now);
  if (learn) rememberSub(state, t.note, s.id, now);
  return true;
}

// ---------- Learning merchants ----------

// Words that say nothing about where the money went.
const STOP = new Set(('plata platii pentru from with the and for card pos srl sa ii md mda chisinau chisinaului moldova str nr via transfer payment '
  + 'purchase achitare cumparare comision operatiune tranzactie оплата покупка перевод платеж для www com shop store at in on of la de si cu pe '
  + 'some a an my lei mdl usd eur today yesterday azi ieri').split(' '));
const noteWords = (note) => (fold(String(note || '').replace(/#[\p{L}\p{N}_-]+/gu, ' ')).match(/[\p{L}]{2,}/gu) || []).filter((w) => !STOP.has(w));

// The words that name a merchant or a thing: "Coffee at Tucano #work" -> "coffee tucano".
export function merchantKey(note) {
  return [...new Set(noteWords(note))].slice(0, 3).join(' ');
}

const MEMORY_MAX = 600;
export function rememberSub(state, note, id, now = Date.now()) {
  const k = merchantKey(note);
  if (!k || !subById(state, id)) return false;
  const mem = { ...(state.settings.subMemory || {}) };
  delete mem[k];
  mem[k] = id;
  const keys = Object.keys(mem);
  for (const old of keys.slice(0, Math.max(0, keys.length - MEMORY_MAX))) delete mem[old];
  state.settings.subMemory = mem;
  state.settings.updatedAt = now;
  return true;
}

// What you chose before for a note like this one: the same words, else the
// longest remembered set of words that all appear in it.
export function memorySub(state, note) {
  const mem = state.settings.subMemory || {};
  const k = merchantKey(note);
  if (!k) return null;
  if (mem[k] && subById(state, mem[k])) return subById(state, mem[k]);
  const have = new Set(noteWords(note));
  let best = null;
  for (const [key, id] of Object.entries(mem)) {
    const ws = key.split(' ');
    if (!ws.every((w) => have.has(w))) continue;
    const s = subById(state, id);
    if (s && (!best || ws.length > best.n)) best = { s, n: ws.length };
  }
  return best?.s || null;
}

// ---------- Built-in words (English, Romanian, Russian) ----------
// Comma-separated: a stem matches the start of a word ("kebab" also finds
// "kebabs"), "bar$" only the whole word, and "bolt food" that phrase. More
// specific lines come first: the first line that matches wins.
const RAW_KEYWORDS = [
  ['delivery', 'glovo, wolt, straus, bolt food, yandex eda, livrare, deliver, доставк'],
  ['bankfees', 'comision, commission, комисси, bank fee, card fee, deservire, обслуживание счета, maintenance fee, taxa card'],
  ['taxes', 'tax$, taxes$, taxa$, impozit, налог, fisc, amenda, штраф, fine$'],
  ['software', 'chatgpt, openai, claude, anthropic, cursor, copilot, github, midjourney, notion, figma, adobe, jetbrains, software, licen, gpt$, ai subscription'],
  ['streaming', 'netflix, spotify, youtube premium, apple music, hbo, disney, deezer, okko, кинопоиск, yandex plus, music app'],
  ['apps', 'icloud, google one, google storage, dropbox, cloud$, app store, google play'],
  ['games', 'steam$, playstation, xbox, nintendo, epic games, game$, games$, joc$, jocuri, игр'],
  ['gadgets', 'gadget, laptop, headphone, casti, charger, incarcator, mouse$, keyboard, monitor, usb$, cable, cablu, наушник, ноутбук, зарядк, smartphone, iphone, samsung, xiaomi, airpods, tablet, phone case, darwin, enter$'],
  ['taxi', 'taxi, такси, yandex$, bolt$, uber$, itaxi'],
  ['fuel', 'fuel, petrol, benzin, motorin, diesel, бензин, топлив, lukoil, rompetrol, petrom, tirex, gas station, азс$'],
  ['public', 'bus$, autobuz, troleibuz, microbuz, metro$, tram$, train$, tren$, автобус, троллейбус, маршрутк, трамва, поезд, метро'],
  ['car', 'car repair, service auto, mecanic, vulcaniz, шиномонтаж, автосервис, car wash, spalatorie, parking, parcare, парковк'],
  ['rent', 'rent$, chirie, аренд, квартплат'],
  ['utilities', 'electric, lumina, gaz$, apa$, water bill, utilit, comunal, коммун, свет$, газ$, вода$, termoelectrica, premier energy, heating, incalzire'],
  ['internet', 'internet, telefon, phone bill, orange$, moldcell, starnet, unite$, mobile top, интернет, связь, телефон'],
  ['furniture', 'furniture, mobila, sofa$, ikea, jysk, мебел, desk$, chair, scaun, canapea'],
  ['cleaning', 'cleaning, curatenie, detergent, уборк, моющ, bleach, burete, clor$'],
  ['haircut', 'haircut, hair$, frizer, tuns$, barber, стрижк, парикмах, nails$, manichiur, маникюр'],
  ['cosmetics', 'cosmetic, makeup, machiaj, lipstick, ruj$, perfume, parfum, косметик, духи, помад, mascara, rimel'],
  ['skincare', 'skincare, cream, crema, крем, serum, lotion, shampoo, sampon, soap$, sapun, шампун, мыло, toothpaste, pasta de dinti, deodorant, hygiene, igien, гигиен, уход'],
  ['pharmacy', 'pharm, farmac, аптек, vitamin, medicament, лекарств, pills, pastile, таблетк'],
  ['doctor', 'doctor, medic$, dentist, stomatolog, clinic, analize, hospital, spital, врач, клиник, стоматолог, анализ'],
  ['gym', 'gym$, fitness, фитнес, спортзал, sala de forta, yoga, йога'],
  ['competitions', 'competi, turneu, tournament, соревнов, турнир'],
  ['gear', 'kimono, echipament, экипиров, sports gear, sport gear'],
  ['groceries', 'grocer, supermarket, market$, lidl, kaufland, linella, fidesco, nr1$, green hills, produse, alimente, продукт, супермаркет, fruit, fructe, legume, vegetables, овощ, фрукт, bread, paine, хлеб, milk$, lapte, молок'],
  ['restaurants', 'restaurant, kebab, shaorma, shawarma, шаурм, pizza, burger, sushi, lunch, dinner, pranz, cina$, ресторан, обед, ужин, mcdonald, kfc$, andy$, bistro, grill'],
  ['cafes', 'coffee, cafe$, cafea, кофе, кафе, latte, cappuccino, espresso, starbucks, tea$, ceai, чай$, cofetarie'],
  ['snacks', 'snack, chips, chocolate, ciocolat, шоколад, juice, suc$, сок$, ice cream, inghetata, мороженое, bakery, patiserie, covrig, sweets, dulciuri, конфет'],
  ['gifts', 'gift, cadou, подар, present$, flowers, flori, цвет'],
  ['celebrations', 'birthday, zi de nastere, aniversar, wedding, nunta, cumatrie, день рождения, свадьб, christmas, craciun, new year, revelion'],
  ['support', 'mama$, mom$, mother, tata$, dad$, father, brother, frate, sister, sora$, parents, parinti, мама, папа, брат, сестр, родител, family, familie'],
  ['goingout', 'bar$, club$, pub$, party, petrecere, drinks, beer, bere$, cocktail, бар$, клуб, пиво'],
  ['cinema', 'cinema, movie, film$, кино$, cineplex'],
  ['events', 'concert, ticket, bilet, theatre, theater, teatru, festival, show$, концерт, театр, museum, muzeu, музей, bowling, escape room'],
  ['hobbies', 'hobby, paint, culori, guitar, chitara, lego$, craft, board game, joc de masa'],
  ['travel', 'travel, trip$, hotel, airbnb, flight, avion, zbor$, booking, vacation, vacanta, excursie, путешеств, отель, wizz, ryanair'],
  ['courses', 'course, curs$, cursuri, udemy, coursera, training, tutor$, репетитор, курс, school, scoala, universit, lesson, lectie'],
  ['books', 'book$, books$, carte$, carti$, книг, kindle, librarie'],
  ['certifications', 'certif, exam$, examen, экзамен, сертиф, ielts, toefl'],
  ['shoes', 'shoe, pantofi, sneaker, adidasi, ghete, обув, кроссовк, boots, cizme'],
  ['accessories', 'bag$, geanta, watch$, ceas$, belt$, curea, sunglasses, ochelari, jewel, bijuter, сумк, часы, рюкзак, backpack, rucsac'],
  ['clothes', 'cloth, haine, shirt, tricou, jeans, blugi, jacket, geaca, dress$, rochie, одежд, футболк, куртк, zara$, lcw$, sweater, pulover, hoodie'],
  ['stocks', 'stock$, stocks$, actiuni, etf$, broker, акци'],
  ['crypto', 'crypto, bitcoin, btc$, binance, крипт, usdt$'],
];
const KEYWORDS = RAW_KEYWORDS.map(([key, text]) => {
  const items = text.split(',').map((x) => fold(x.trim())).filter(Boolean);
  return {
    key,
    phrases: items.filter((x) => x.includes(' ')),
    exact: items.filter((x) => !x.includes(' ') && x.endsWith('$')).map((x) => x.slice(0, -1)),
    stems: items.filter((x) => !x.includes(' ') && !x.endsWith('$')),
  };
});

function keywordKeys(note) {
  const text = ` ${fold(note).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  const words = text.trim().split(' ').filter(Boolean);
  const out = [];
  for (const k of KEYWORDS) {
    const hit = k.phrases.some((p) => text.includes(` ${p} `))
      || k.exact.some((x) => words.includes(x))
      || k.stems.some((x) => words.some((w) => w.startsWith(x)));
    if (hit) out.push(k.key);
  }
  return out;
}

// The subcategory keys the built-in words point at, best first.
export const keywordMatches = (note) => keywordKeys(note);

// A subcategory you made yourself whose name is in the note ("Lego" -> Lego).
function nameSub(state, note, ok) {
  const words = new Set(noteWords(note));
  return subList(state).filter((s) => !s.key && !s.archived && ok(s)).find((s) => {
    const n = noteWords(s.name);
    return n.length && n.every((w) => w.length >= 3 && words.has(w));
  }) || null;
}

// Folded note -> the newest record with that note and a subcategory, built
// once per version of your records (the helper asks for hundreds of notes).
const pastCache = new WeakMap();
function pastIndex(state) {
  let last = 0;
  let filed = 0;
  for (const t of state.tx) { if ((t.updatedAt || 0) > last) last = t.updatedAt || 0; if (t.sub) filed++; }
  const key = `${state.tx.length}|${last}|${filed}|${subList(state).length}`;
  const hit = pastCache.get(state.tx);
  if (hit && hit.key === key) return hit.map;
  const map = new Map();
  for (const t of state.tx) {
    if (t.type !== 'expense' || !t.sub) continue;
    const s = subOf(state, t);
    if (!s) continue;
    const k = fold(t.note).trim();
    const prev = map.get(k);
    if (!prev || (t.updatedAt || 0) > (prev.t.updatedAt || 0)) map.set(k, { t, s });
  }
  pastCache.set(state.tx, { key, map });
  return map;
}

// The best subcategory for a spending note, or null: { sub, source }.
// With a real category given, only its subcategories; with Other (or none),
// any, so "kebab" in Other suggests Food › Restaurants.
export function suggestSub(state, note, { category = null } = {}) {
  if (!String(note || '').trim()) return null;
  const free = isOther(category);
  const ok = (s) => s && !s.archived && (free || s.parent === category)
    && state.settings.categories.some((c) => c.id === s.parent && c.type === 'expense');
  const mem = memorySub(state, note);
  if (ok(mem)) return { sub: mem, source: 'memory' };
  const past = pastIndex(state).get(fold(note).trim());
  if (past && ok(past.s)) return { sub: past.s, source: 'past' };
  const named = nameSub(state, note, ok);
  if (named) return { sub: named, source: 'name' };
  for (const key of keywordKeys(note)) {
    const s = subList(state).find((x) => x.key === key && ok(x));
    if (s) return { sub: s, source: 'words' };
  }
  return null;
}

// Records still waiting for a subcategory, each with a guess when there is one.
export function needsSubList(state, list = state.tx) {
  const out = [];
  for (const t of list) {
    if (!needsSub(state, t)) continue;
    out.push({ t, guess: suggestSub(state, t.note, { category: t.category })?.sub || null });
  }
  return out.sort((a, b) => (b.t.date < a.t.date ? -1 : b.t.date > a.t.date ? 1 : 0));
}

// ---------- Reports one level deeper ----------

const B = (t) => (Number.isInteger(t.base) ? t.base : t.amount);
export const NO_SUB = '__none';

// Spending in one category per subcategory (plus "no subcategory"), biggest first.
export function totalsBySub(state, list, catId) {
  const rows = new Map();
  let total = 0;
  for (const t of list) {
    if ((t.type !== 'expense' && !isRefund(t)) || t.loan || t.category !== catId) continue;
    const s = subOf(state, t);
    const id = s ? s.id : NO_SUB;
    const r = rows.get(id) || { id, amount: 0, count: 0 };
    r.amount += signed(t, B(t));
    r.count++;
    total += signed(t, B(t));
    rows.set(id, r);
  }
  const out = [...rows.values()].sort((a, b) => b.amount - a.amount);
  for (const r of out) r.share = total ? r.amount / total : 0;
  return { total, rows: out };
}

// Spending per subcategory across all categories ("Food › Groceries"…), for
// the detailed flow chart.
export function totalsAllSubs(state, list) {
  const rows = new Map();
  for (const t of list) {
    if ((t.type !== 'expense' && !isRefund(t)) || t.loan) continue;
    const s = subOf(state, t);
    const id = s ? s.id : `${NO_SUB}:${t.category}`;
    const r = rows.get(id) || { id, parent: t.category, sub: s, amount: 0, count: 0 };
    r.amount += signed(t, B(t));
    r.count++;
    rows.set(id, r);
  }
  return [...rows.values()].sort((a, b) => b.amount - a.amount);
}

// Where the money went by merchant (or note): same merchant words together.
export function topMerchants(list, n = 8) {
  const m = new Map();
  for (const t of list) {
    if (t.type !== 'expense' || t.loan || t.notSpending) continue;
    const k = merchantKey(t.note) || '';
    if (!k) continue;
    const r = m.get(k) || { key: k, label: String(t.note || '').replace(/#[\p{L}\p{N}_-]+/gu, '').trim(), amount: 0, count: 0, labels: new Map() };
    r.amount += B(t);
    r.count++;
    const lbl = String(t.note || '').replace(/#[\p{L}\p{N}_-]+/gu, '').trim();
    r.labels.set(lbl, (r.labels.get(lbl) || 0) + 1);
    m.set(k, r);
  }
  return [...m.values()].map((r) => ({ key: r.key, label: [...r.labels.entries()].sort((a, b) => b[1] - a[1])[0][0] || r.key, amount: r.amount, count: r.count }))
    .sort((a, b) => b.amount - a.amount).slice(0, n);
}

// Average spent per month in the `months` full months before `from`, per
// group (`key(t)` gives the group), counting only months since your first record.
export function monthlyAverage(state, from, key, months = 6) {
  const first = state.tx.reduce((a, t) => (t.date < a ? t.date : a), from);
  const end = from.slice(0, 7);
  const keys = [];
  let [y, m] = end.split('-').map(Number);
  for (let i = 0; i < months; i++) {
    m -= 1; if (m < 1) { m = 12; y -= 1; }
    const k = `${y}-${String(m).padStart(2, '0')}`;
    if (k >= first.slice(0, 7)) keys.push(k);
  }
  const want = new Set(keys);
  const sums = new Map();
  for (const t of state.tx) {
    if (t.type !== 'expense' || t.loan || t.notSpending || !want.has(t.date.slice(0, 7))) continue;
    const k = key(t);
    if (k == null) continue;
    sums.set(k, (sums.get(k) || 0) + B(t));
  }
  const out = new Map();
  for (const [k, v] of sums) out.set(k, Math.round(v / keys.length));
  return { months: keys.length, avg: out };
}

// ---------- Budgets for subcategories ----------

export function subBudgetStatus(state, key) {
  return subList(state).filter((s) => s.budget > 0 && !s.archived).map((s) => {
    const spent = state.tx.filter((t) => countsAsSpending(t) && t.date.startsWith(key) && t.sub === s.id && t.category === s.parent).reduce((a, t) => a + signed(t, B(t)), 0);
    const pct = spent / s.budget;
    return { sub: s, budget: s.budget, spent, left: s.budget - spent, pct, level: pct > 1 ? 'over' : pct >= 0.8 ? 'near' : 'ok' };
  }).sort((a, b) => b.pct - a.pct);
}

// ---------- Squarified treemap layout ----------
// Rectangles (in % of the box) for values, biggest first, as square as
// possible. `ratio` is the box's width / height.
export function treemap(values, ratio = 2) {
  const items = values.map((v, i) => ({ i, v: Math.max(0, v) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  const total = items.reduce((a, x) => a + x.v, 0);
  const out = new Array(values.length).fill(null);
  if (!total) return out;
  // Work in a W x H box with area = total, then scale to percent.
  const W = Math.sqrt(total * ratio);
  const H = total / W;
  let x = 0;
  let y = 0;
  let w = W;
  let h = H;
  const worst = (row, side) => {
    const s = row.reduce((a, r) => a + r.v, 0);
    const max = Math.max(...row.map((r) => r.v));
    const min = Math.min(...row.map((r) => r.v));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  let rest = items.slice();
  while (rest.length) {
    const side = Math.min(w, h);
    const row = [rest[0]];
    let k = 1;
    while (k < rest.length && worst([...row, rest[k]], side) <= worst(row, side)) { row.push(rest[k]); k++; }
    rest = rest.slice(k);
    const s = row.reduce((a, r) => a + r.v, 0);
    if (w >= h) {
      const rw = s / h;
      let yy = y;
      for (const r of row) { const rh = r.v / rw; out[r.i] = { x, y: yy, w: rw, h: rh }; yy += rh; }
      x += rw; w -= rw;
    } else {
      const rh = s / w;
      let xx = x;
      for (const r of row) { const rw = r.v / rh; out[r.i] = { x: xx, y, w: rw, h: rh }; xx += rw; }
      y += rh; h -= rh;
    }
  }
  return out.map((r) => (r ? { x: (r.x / W) * 100, y: (r.y / H) * 100, w: (r.w / W) * 100, h: (r.h / H) * 100 } : null));
}
