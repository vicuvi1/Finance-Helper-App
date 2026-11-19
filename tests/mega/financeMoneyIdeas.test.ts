// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeMoneyIdeas.test.ts) by scripts/port-mega-tests.mjs.
// Finance Helper "money ideas" (made-up data, the clock pinned by passing
// today): the money calendar with no-spend days, "Can I afford it?" and the
// wishlist with a wait, including that the new settings survive a sync.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS module from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore plain JS module from the embedded app
import { mergeStates, toCloud } from '../../js/sync.js'
// @ts-ignore plain JS module from the embedded app
import { monthCalendar, noSpendDays, moneyLine } from '../../js/moneycal.js'
// @ts-ignore plain JS module from the embedded app
import { affordCheck } from '../../js/afford.js'
// @ts-ignore plain JS module from the embedded app
import * as W from '../../js/wishlist.js'
// @ts-ignore plain JS module from the embedded app
import { load } from '../../js/store.js'

const TODAY = '2026-11-13' // a Friday
let n = 0
const tx = (date: string, amount: number, extra: Record<string, unknown> = {}) => ({ id: `t${++n}`, type: 'expense', amount, date, category: 'food', account: 'card', note: '', createdAt: n, updatedAt: n, ...extra })

function seeded(extra: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) {
  return M.normalizeState({
    settings: { ...settings },
    tx: [
      tx('2026-10-01', 500000, { type: 'income', category: 'work' }),
      tx('2026-10-03', 10000), tx('2026-10-05', 10000), tx('2026-10-07', 10000), tx('2026-10-09', 10000),
      tx('2026-10-04', 50000, { type: 'transfer', from: 'card', to: 'wallet', category: undefined }),
      tx('2026-11-01', 500000, { type: 'income', category: 'work' }),
      tx('2026-11-02', 30000), tx('2026-11-05', 20000),
      tx('2026-11-08', 120000, { category: 'fun', note: 'Headphones' }),
    ],
    recurring: [
      { id: 'r-rent', type: 'expense', amount: 150000, currency: 'MDL', account: 'card', category: 'home', note: 'Rent', every: 'month', start: '2026-10-20', lastDone: '2026-10-20', createdAt: 1, updatedAt: 1 },
      { id: 'r-pay', type: 'income', amount: 400000, currency: 'MDL', account: 'card', category: 'work', note: 'Salary', every: 'month', start: '2026-10-28', lastDone: '2026-10-28', createdAt: 1, updatedAt: 1 },
    ],
    ...extra,
  })
}

describe('money calendar', () => {
  it('shows spent, bills, income, the big buy and the money left line for a seeded month', () => {
    const s = seeded({}, { moneyFloor: 700000 })
    const cal = monthCalendar(s, TODAY, '2026-11')
    const day = (d: number) => cal.days[d - 1]
    expect(day(2).spent).toBe(30000)
    expect(day(8).spent).toBe(120000)
    expect(day(8).big.map((t: any) => t.note)).toEqual(['Headphones'])
    expect(day(20).bills.map((b: any) => [b.label, b.amount])).toEqual([['Rent', 150000]])
    expect(day(28).income.map((b: any) => [b.label, b.amount])).toEqual([['Salary', 400000]])
    // Cards and cash today: 10 000 in, 2 100 spent.
    const line = moneyLine(s, TODAY, '2026-11-30')
    expect(line.get(TODAY).left).toBe(790000)
    expect(day(19).left).toBe(790000)
    expect(day(20).left).toBe(640000)
    expect(day(28).left).toBe(1040000)
    // Under the 7 000 floor from the rent until the salary.
    expect(cal.days.filter((d: any) => d.tight).map((d: any) => Number(d.date.slice(8)))).toEqual([20, 21, 22, 23, 24, 25, 26, 27])
    expect(day(12).left).toBeNull() // past days have no line
    expect(day(13).left).toBeNull() // today either
  })

  it('counts no-spend days the way the spending card does: a transfer is not spending', () => {
    const s = seeded()
    const ns = noSpendDays(s, '2026-11', TODAY)
    expect(ns.counted).toBe(12) // the 1st to the 12th
    expect(ns.count).toBe(9) // 12 days, 3 with spending (the 2nd, 5th and 8th)
    expect(ns.dates).not.toContain('2026-11-08')
    // October, over the same 12 days: the transfer on the 4th is no spending.
    const cal = monthCalendar(s, TODAY, '2026-11')
    expect(cal.noSpend).toBe(9)
    expect(cal.prev).toEqual({ count: 8, counted: 12, upTo: 12 })
    expect(cal.days[3].noSpend).toBe(true)
    expect(cal.days[1].noSpend).toBe(false)
    const oct = monthCalendar(s, TODAY, '2026-10')
    expect(oct.days[3].noSpend).toBe(true) // the 4th: only a transfer
    expect(oct.noSpend).toBe(27) // 31 days, 4 with spending
  })

  it('does not count days before the first record as no-spend', () => {
    const s = M.normalizeState({ settings: {}, tx: [tx('2026-11-10', 1000)] })
    expect(noSpendDays(s, '2026-11', TODAY).counted).toBe(3) // the 10th, 11th and 12th; the 1st to the 9th are before the first record
  })
})

describe('can I afford it', () => {
  it('gives safe to spend before and after, goal delays and a verdict, and creates nothing', () => {
    const goal = { id: 'g1', name: 'Laptop', emoji: '💻', target: 3000000, account: 'manual', saved: 0, history: [{ date: '2026-10-15', amount: 300000 }], deadline: null, doneAt: null, updatedAt: 1 }
    const s = seeded({ goals: [goal] })
    const txCount = s.tx.length
    const snapshot = JSON.stringify(s)
    const r = affordCheck(s, TODAY, { price: 100000 })
    expect(r.after.leftToday).toBe(r.before.leftToday - 100000)
    expect(r.after.perDay).toBe(r.before.perDay)
    // 3 000 a month towards it: 1 000 is about 4 weeks.
    expect(r.goals).toHaveLength(1)
    expect(r.goals[0].weeks).toBe(4)
    expect(s.tx).toHaveLength(txCount)
    expect(JSON.stringify(s)).toBe(snapshot)
  })

  it('says yes comfortably, tight until a day, and not this month', () => {
    const s = seeded({}, { moneyFloor: 700000 })
    // 1 000 now: the rent on the 20th takes the line under the floor until the salary on the 28th.
    const tight = affordCheck(s, TODAY, { price: 100000 })
    expect(tight.verdict).toBe('Yes, but tight until the 28th')
    expect(tight.tightUntil).toBe('2026-11-28')
    expect(tight.tightDays).toBeGreaterThan(0)
    // Nothing in the way: no floor, a small price.
    const easy = affordCheck(seeded(), TODAY, { price: 10000 })
    expect(easy.verdict).toBe('Yes, comfortably')
    expect(easy.tightDays).toBe(0)
    // More than the month can pay.
    const no = affordCheck(seeded(), TODAY, { price: 1200000 })
    expect(no.verdict).toBe('Not this month')
  })
})

describe('wishlist with a wait', () => {
  it('is locked for 7 days, then ready; removing adds to saved by waiting', () => {
    const s = seeded()
    const a = W.addItem(s, { name: 'Bike', price: 320000, note: 'https://example.com/bike' }, '2026-11-13', { now: 1000, id: 'w1' })
    W.addItem(s, { name: 'Lamp', price: 15000 }, '2026-11-06', { now: 900, id: 'w2' })
    expect(W.readyOn(a, 7)).toBe('2026-11-20')
    expect(W.statusOf(a, '2026-11-19', 7)).toBe('locked')
    expect(W.statusOf(a, '2026-11-20', 7)).toBe('ready')
    expect(W.daysLeft(a, '2026-11-13', 7)).toBe(7)
  })

  it('the 7th day counts: added 6 Nov is ready on 13 Nov', () => {
    const s = seeded()
    const lamp = W.addItem(s, { name: 'Lamp', price: 15000 }, '2026-11-06', { now: 900, id: 'w2' })
    expect(W.statusOf(lamp, '2026-11-12', 7)).toBe('locked')
    expect(W.statusOf(lamp, TODAY, 7)).toBe('ready')
  })

  it('totals the waiting items and the money saved from removed ones; the wait is a setting', () => {
    const s = seeded()
    W.addItem(s, { name: 'Bike', price: 320000 }, '2026-11-13', { now: 1, id: 'a' })
    W.addItem(s, { name: 'Lamp', price: 15000 }, '2026-11-01', { now: 2, id: 'b' })
    W.addItem(s, { name: 'Shoes', price: 80000 }, '2026-11-02', { now: 3, id: 'c' })
    W.removeItem(s, 'b', TODAY, 10)
    W.buyItem(s, 'c', TODAY, 11)
    const sum = W.summary(s)
    expect(sum.total).toBe(320000)
    expect(sum.saved).toBe(15000)
    expect(sum.bought.map((x: any) => x.name)).toEqual(['Shoes'])
    expect(W.removeItem(s, 'b', TODAY)).toBeNull() // already removed
    expect(W.waitDays(s)).toBe(7)
    s.settings.wishlistDays = 3
    expect(W.waitDays(s)).toBe(3)
    expect(W.readyOn(s.settings.wishlist[0], W.waitDays(s))).toBe('2026-11-16')
    W.putBack(s, 'c', 12)
    expect(W.summary(s).waiting.map((x: any) => x.id)).toContain('c')
  })
})

describe('new settings survive saving and syncing', () => {
  const withKeys = () => {
    const s = seeded({}, { moneyFloor: 150000, wishlistDays: 10 })
    W.addItem(s, { name: 'Bike', price: 320000, note: 'blue' }, '2026-11-13', { now: 5000, id: 'w1' })
    W.removeItem(s, 'w1', '2026-11-14', 6000)
    s.settings.updatedAt = 6000
    return s
  }

  it('normalizeState keeps them', () => {
    const s = M.normalizeState(JSON.parse(JSON.stringify(withKeys())))
    expect(s.settings.moneyFloor).toBe(150000)
    expect(s.settings.wishlistDays).toBe(10)
    expect(s.settings.wishlist[0]).toMatchObject({ id: 'w1', name: 'Bike', price: 320000, removedAt: '2026-11-14' })
  })

  it('a reload from storage keeps them', () => {
    const store = new Map<string, string>()
    const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    fake.setItem('finance-helper.state', JSON.stringify(withKeys()))
    const s = load(fake as unknown as Storage)
    expect(s.settings.wishlist).toHaveLength(1)
    expect(s.settings.moneyFloor).toBe(150000)
  })

  it('a sync round trip brings them to another device (newer settings win), and keeps ours when newer', () => {
    const cloud = toCloud(withKeys(), 'dev-a', 7000)
    expect(cloud.data.settings.wishlist).toHaveLength(1)
    const other = seeded() // this device never saw them, older settings
    other.settings.updatedAt = 100
    const merged = mergeStates(other, JSON.parse(JSON.stringify(cloud))).state
    expect(merged.settings.wishlist[0].name).toBe('Bike')
    expect(W.summary(merged).saved).toBe(320000)
    expect(merged.settings.moneyFloor).toBe(150000)
    expect(merged.settings.wishlistDays).toBe(10)
    // The other way round: this device is newer.
    const mine = withKeys()
    mine.settings.updatedAt = 9000
    const old = seeded()
    old.settings.updatedAt = 10
    const back = mergeStates(mine, JSON.parse(JSON.stringify(toCloud(old, 'dev-b', 20)))).state
    expect(back.settings.wishlist).toHaveLength(1)
    expect(back.settings.moneyFloor).toBe(150000)
  })
})
