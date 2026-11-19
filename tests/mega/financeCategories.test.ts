// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeCategories.test.ts) by scripts/port-mega-tests.mjs.
// Finance Helper's two-level categories (public/apps/finance/js/cattree.js):
// the default tree, the one-time migration of older data, the word list
// that suggests a subcategory, learning from your corrections, and the
// numbers the detailed reports use. Made-up records only.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS module
import * as T from '../../js/cattree.js'
// @ts-ignore plain JS module
import * as M from '../../js/model.js'
// @ts-ignore plain JS module
import { mergeStates, toCloud } from '../../js/sync.js'
// @ts-ignore plain JS module
import { exportRows, monthSheet, importRows } from '../../js/importer.js'
// @ts-ignore plain JS module
import { searchTx } from '../../js/search.js'

let n = 0
const tx = (over: any = {}) => ({ id: `t${++n}`, type: 'expense', amount: 5000, currency: 'MDL', rate: 1, base: 5000, date: '2026-10-05', category: 'food', account: 'wallet', note: '', createdAt: n, updatedAt: n, ...over })

// Data saved by the version before subcategories, with a custom category.
function oldData(extraTx: any[] = []) {
  const base = M.defaultState()
  const categories = base.settings.categories.filter((c: any) => c.id !== 'tech' && c.id !== 'bills')
  categories.push({ id: 'c-tech1', type: 'expense', name: 'Tech & gadgets', emoji: '', jar: 'growth' })
  const settings = { ...base.settings, categories }
  delete (settings as any).subcats
  delete (settings as any).subMemory
  return { ...base, settings, tx: [tx({ id: 'old1', note: 'kebab' }), tx({ id: 'old2', category: 'hygiene', note: 'lipstick' }), ...extraTx] }
}

describe('the default tree', () => {
  it('a new data set has categories with icons and subcategories under them', () => {
    const s = M.defaultState()
    const food = T.subsOf(s, 'food').map((x: any) => x.name)
    expect(food).toEqual(['Groceries', 'Restaurants', 'Cafés & coffee', 'Delivery', 'Snacks'])
    expect(T.subsOf(s, 'transport').map((x: any) => x.key)).toEqual(['fuel', 'taxi', 'public', 'car'])
    expect(T.subsOf(s, 'hygiene').map((x: any) => x.key)).toEqual(['cosmetics', 'skincare', 'haircut'])
    expect(T.subsOf(s, 'health').map((x: any) => x.key)).toEqual(['pharmacy', 'doctor'])
    expect(T.subsOf(s, 'sport').map((x: any) => x.key)).toContain('gym')
    expect(T.subsOf(s, 'tech').map((x: any) => x.key)).toEqual(['gadgets', 'software', 'games'])
    expect(T.subsOf(s, 'bills').map((x: any) => x.key)).toEqual(['bankfees', 'taxes'])
    for (const sub of s.settings.subcats) expect(sub.emoji).toBeTruthy()
    // Bills & fees stays inside the jars although its name says "fees".
    expect(M.moveWorkCostsOutOfJars(s)).toEqual([])
  })

  it('every subcategory id is unique and points at a spending category', () => {
    const s = M.defaultState()
    const ids = s.settings.subcats.map((x: any) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const sub of s.settings.subcats) expect(M.category(s, sub.parent)?.type).toBe('expense')
  })
})

describe('moving older data onto the tree', () => {
  it('keeps every record and category, and fits subcategories to what you have', () => {
    const raw = oldData()
    const s = M.normalizeState(JSON.parse(JSON.stringify(raw)))
    expect(s.tx.map((t: any) => [t.id, t.category, t.sub])).toEqual([['old1', 'food', undefined], ['old2', 'hygiene', undefined]])
    for (const c of raw.settings.categories) expect(M.category(s, c.id)?.name).toBe(c.name)
    // "Tech & gadgets" (your own) gets the tech subcategories; no extra Tech is added.
    expect(T.subsOf(s, 'c-tech1').map((x: any) => x.key)).toEqual(['gadgets', 'software', 'games'])
    expect(M.category(s, 'tech')).toBeUndefined()
    // Bills & fees did not exist: it is added, empty.
    expect(M.category(s, 'bills')?.name).toBe('Bills & fees')
    expect(T.needsSub(s, s.tx[0])).toBe(true)
  })

  it('runs once: your later changes are kept on the next load', () => {
    const s = M.normalizeState(oldData())
    T.renameSub(s, 's-cafes', { name: 'Coffee shops' })
    T.removeSub(s, 's-snacks')
    const again = M.normalizeState(JSON.parse(JSON.stringify(s)))
    expect(T.subById(again, 's-cafes').name).toBe('Coffee shops')
    expect(T.subById(again, 's-snacks')).toBeNull()
  })

  it('two devices that move the same old data get the same tree and merge cleanly', () => {
    const a = M.normalizeState(oldData())
    const b = M.normalizeState(oldData())
    expect(a.settings.subcats.map((x: any) => x.id)).toEqual(b.settings.subcats.map((x: any) => x.id))
    T.addSub(b, 'food', 'Bubble tea', '🧋', 100)
    const { state } = mergeStates(a, toCloud(b, 'dev-b'))
    expect(T.subsOf(state, 'food').map((x: any) => x.name)).toContain('Bubble tea')
    expect(state.settings.subcats.length).toBe(a.settings.subcats.length + 1)
  })
})

describe('changing subcategories', () => {
  it('add, rename, move (records follow) and remove (records keep their category)', () => {
    const s = M.defaultState()
    s.tx.push(tx({ id: 'a', note: 'latte', sub: 's-cafes' }))
    const mine = T.addSub(s, 'food', 'Bubble tea', '🧋')
    expect(T.addSub(s, 'food', 'bubble TEA')).toBe(mine)
    T.renameSub(s, mine.id, { name: 'Tea shops', emoji: '🍵' })
    expect(T.subById(s, mine.id)).toMatchObject({ name: 'Tea shops', emoji: '🍵', parent: 'food' })
    expect(T.moveSub(s, 's-cafes', 'fun')).toBe(1)
    expect(s.tx[0]).toMatchObject({ category: 'fun', sub: 's-cafes' })
    expect(T.removeSub(s, 's-cafes')).toBe(1)
    expect(s.tx[0].category).toBe('fun')
    expect(s.tx[0].sub).toBeUndefined()
    expect(s.deleted['s-cafes']).toBeTruthy()
  })

  it('a subcategory only counts while the record stays in its category', () => {
    const s = M.defaultState()
    const t = tx({ sub: 's-taxi' })
    expect(T.subOf(s, t)).toBeNull()
    expect(T.needsSub(s, t)).toBe(true)
    expect(T.catPath(s, { ...t, category: 'transport' }, { icons: true })).toBe('🚌 Transport › 🚕 Taxi')
  })
})

describe('suggesting a subcategory from the note', () => {
  const s = M.defaultState()
  const key = (note: string, category: string | null = null) => T.suggestSub(s, note, { category })?.sub.key ?? null
  it('English, Romanian and Russian words', () => {
    expect(key('kebab')).toBe('restaurants')
    expect(key('Shaorma la colț')).toBe('restaurants')
    expect(key('cadou pentru Ana')).toBe('gifts')
    expect(key('подарок маме')).toBe('gifts')
    expect(key('birthday gift')).toBe('gifts')
    expect(key('Yandex taxi home')).toBe('taxi')
    expect(key('bolt')).toBe('taxi')
    expect(key('bolt food burger')).toBe('delivery')
    expect(key('Farmacie')).toBe('pharmacy')
    expect(key('аптека')).toBe('pharmacy')
    expect(key('latte')).toBe('cafes')
    expect(key('кофе')).toBe('cafes')
    expect(key('linella')).toBe('groceries')
    expect(key('benzina')).toBe('fuel')
    expect(key('ChatGPT Plus')).toBe('software')
    expect(key('rujul nou')).toBe(null) // "ruj$" is a whole word only
    expect(key('ruj')).toBe('cosmetics')
    expect(key('chirie octombrie')).toBe('rent')
    expect(key('netflix')).toBe('streaming')
    expect(key('sneakers')).toBe('shoes')
    expect(key('comision bancar')).toBe('bankfees')
  })
  it('whole words where a stem would be wrong', () => {
    expect(key('barber')).toBe('haircut')
    expect(key('bar with friends')).toBe('goingout')
    expect(key('business lunch')).toBe('restaurants')
    expect(key('taxi')).toBe('taxi')
    expect(key('tax return')).toBe('taxes')
  })
  it('inside a real category only its own subcategories; Other may point anywhere', () => {
    expect(key('kebab', 'other')).toBe('restaurants')
    expect(key('kebab', 'transport')).toBe(null)
    expect(key('pizza', 'food')).toBe('restaurants')
  })
  it('nothing for an empty or unknown note', () => {
    expect(T.suggestSub(s, '', {})).toBeNull()
    expect(T.suggestSub(s, 'zzqx', {})).toBeNull()
  })
  it('suggests the category too when the note was going to Other', () => {
    expect(M.suggestCategory(s, 'shaorma', 'expense')).toBe('food')
    expect(M.suggestCategory(s, 'farmacie', 'expense')).toBe('health')
  })
})

describe('learning from your corrections', () => {
  it('remembers the merchant, and it beats the built-in words', () => {
    const s = M.defaultState()
    const t = tx({ note: 'Tucano coffee', category: 'food' })
    s.tx.push(t)
    expect(T.suggestSub(s, 'Tucano coffee', { category: 'food' }).sub.key).toBe('cafes')
    // You file it as a snack instead.
    T.setSub(s, t, 's-snacks')
    expect(T.merchantKey('Tucano coffee #work')).toBe('tucano coffee')
    expect(s.settings.subMemory['tucano coffee']).toBe('s-snacks')
    expect(T.suggestSub(s, 'tucano coffee', { category: 'food' })).toMatchObject({ source: 'memory' })
    expect(T.suggestSub(s, 'Tucano coffee large', { category: 'food' }).sub.id).toBe('s-snacks')
    // A merchant you put somewhere else moves a new record out of Other too.
    const u = tx({ note: 'Kebab King', category: 'other' })
    s.tx.push(u)
    T.setSub(s, u, 's-goingout')
    expect(u.category).toBe('fun')
    expect(M.suggestCategory(s, 'kebab king', 'expense')).toBe('fun')
  })
  it('your own subcategory is found by its name', () => {
    const s = M.defaultState()
    const lego = T.addSub(s, 'fun', 'Lego', '🧱')
    expect(T.suggestSub(s, 'new lego set', {}).sub.id).toBe(lego.id)
  })
  it('the merchant memory travels between devices', () => {
    const a = M.defaultState()
    const b = M.defaultState()
    T.rememberSub(b, 'Corner bakery', 's-groceries', Date.now() + 1000)
    const { state } = mergeStates(a, toCloud(b, 'b'))
    expect(state.settings.subMemory['corner bakery']).toBe('s-groceries')
  })
})

describe('the "needs a subcategory" helper', () => {
  it('lists spending records without one, with a guess, and skips loans and income', () => {
    const s = M.defaultState()
    s.tx.push(tx({ id: 'x1', note: 'pizza', date: '2026-10-02' }), tx({ id: 'x2', note: 'groceries', sub: 's-groceries', date: '2026-10-03' }),
      tx({ id: 'x3', note: 'lent', loan: true }), tx({ id: 'x4', type: 'income', category: 'work', note: 'salary' }), tx({ id: 'x5', note: 'mystery', date: '2026-10-04' }))
    const list = T.needsSubList(s)
    expect(list.map((x: any) => x.t.id)).toEqual(['x5', 'x1'])
    expect(list[1].guess.key).toBe('restaurants')
    expect(list[0].guess).toBeNull()
  })
})

describe('numbers for the detailed reports', () => {
  const s = M.defaultState()
  s.tx.push(
    tx({ note: 'latte', sub: 's-cafes', base: 3000, amount: 3000 }),
    tx({ note: 'Latte', sub: 's-cafes', base: 4000, amount: 4000 }),
    tx({ note: 'Green market', sub: 's-groceries', base: 20000, amount: 20000 }),
    tx({ note: 'something', base: 1000, amount: 1000 }),
    tx({ note: 'old latte', sub: 's-cafes', base: 6000, amount: 6000, date: '2026-09-10' }),
    tx({ note: 'old shop', sub: 's-groceries', base: 12000, amount: 12000, date: '2026-08-10' }),
  )
  it('totals per subcategory with "no subcategory"', () => {
    const r = T.totalsBySub(s, s.tx.filter((t: any) => t.date >= '2026-10-01'), 'food')
    expect(r.total).toBe(28000)
    expect(r.rows.map((x: any) => [x.id, x.amount, x.count])).toEqual([['s-groceries', 20000, 1], ['s-cafes', 7000, 2], [T.NO_SUB, 1000, 1]])
  })
  it('top merchants group the same words', () => {
    const top = T.topMerchants(s.tx.filter((t: any) => t.date >= '2026-10-01'))
    expect(top[0]).toMatchObject({ key: 'green market', amount: 20000 })
    expect(top.find((x: any) => x.key === 'latte')).toMatchObject({ amount: 7000, count: 2 })
  })
  it('average month over the months since your first record', () => {
    const { months, avg } = T.monthlyAverage(s, '2026-10-01', (t: any) => t.sub || null)
    expect(months).toBe(2) // August and September
    expect(avg.get('s-cafes')).toBe(3000)
    expect(avg.get('s-groceries')).toBe(6000)
  })
  it('subcategory budgets', () => {
    T.renameSub(s, 's-cafes', { budget: 5000 })
    const [row] = T.subBudgetStatus(s, '2026-10')
    expect(row).toMatchObject({ spent: 7000, left: -2000, level: 'over' })
  })
  it('the treemap fills the box without overlaps', () => {
    const rects = T.treemap([50, 25, 15, 10, 0], 2)
    expect(rects[4]).toBeNull()
    const area = rects.filter(Boolean).reduce((a: number, r: any) => a + r.w * r.h, 0)
    expect(area).toBeCloseTo(10000, 3)
    expect(rects[0].w * rects[0].h).toBeCloseTo(5000, 3)
    for (const r of rects.filter(Boolean)) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9)
      expect(r.x + r.w).toBeLessThanOrEqual(100 + 1e-9)
      expect(r.y + r.h).toBeLessThanOrEqual(100 + 1e-9)
    }
  })
})

describe('export, import and search know subcategories', () => {
  it('the Excel and CSV rows carry the subcategory, and it reads back in', () => {
    const s = M.defaultState()
    s.tx.push(tx({ note: 'latte', sub: 's-cafes' }))
    const rows = exportRows(s)
    expect(rows[0].at(-1)).toBe('Subcategory')
    expect(rows[1].at(-1)).toBe('Cafés & coffee')
    const sheet = monthSheet(s, '2026-10')
    expect(sheet.rows[0].slice(2, 4)).toEqual(['Category', 'Subcategory'])
    expect(sheet.rows[1][3]).toBe('Cafés & coffee')
    const fresh = M.defaultState()
    const res = importRows(rows, fresh)
    expect(res.tx?.[0] ?? res.records?.[0] ?? res.list?.[0]).toMatchObject({ category: 'food', sub: 's-cafes' })
  })
  it('"all coffee this year" finds coffee records by note or subcategory', () => {
    const s = M.defaultState()
    s.tx.push(tx({ id: 'c1', note: 'flat white', sub: 's-cafes', date: '2026-03-01' }), tx({ id: 'c2', note: 'coffee beans', date: '2026-05-01', category: 'food' }),
      tx({ id: 'c3', note: 'coffee', date: '2025-05-01' }), tx({ id: 'c4', note: 'bread', sub: 's-groceries', date: '2026-05-01' }))
    expect(searchTx(s, 'all coffee this year', '2026-11-06').map((t: any) => t.id).sort()).toEqual(['c1', 'c2'])
    expect(searchTx(s, 'sub:groceries', '2026-11-06').map((t: any) => t.id)).toEqual(['c4'])
  })
})
