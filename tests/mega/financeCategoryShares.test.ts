// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeCategoryShares.test.ts) by scripts/port-mega-tests.mjs.
// Finance Helper's "Where my money goes": shares per category, what is left
// out, folding small ones into Other, and the comparison with the period before.
// Made-up records only.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS module
import { categoryShares, changeText, spendRange, wholePercents, OTHER_ID } from '../../js/catshare.js'

let n = 0
const tx = (over: any = {}) => ({ id: `t${++n}`, type: 'expense', amount: 1000, base: 1000, date: '2026-10-05', category: 'food', ...over })
const B = (t: any) => t.base
const range = spendRange('month', '2026-10-20')

describe('category shares', () => {
  it('leaves out transfers, income, loans and points-only rewards', () => {
    const list = [
      tx({ category: 'food', base: 5000 }),
      tx({ type: 'transfer', category: undefined, base: 9000 }),
      tx({ type: 'income', category: 'salary', base: 90000 }),
      tx({ category: 'fun', base: 7000, loan: true }),
      tx({ id: 'life-reward-abc', category: 'fun', base: 1500 }),
      tx({ category: 'home', base: 5000 }),
    ]
    const r = categoryShares(list, range, B)
    expect(r.total).toBe(10000)
    expect(r.rows.map((x: any) => x.id).sort()).toEqual(['food', 'home'])
    expect(r.rows.every((x: any) => x.pct === 50)).toBe(true)
  })

  it('sorts biggest first and the whole percents add up to 100', () => {
    const list = [tx({ category: 'a', base: 3333 }), tx({ category: 'b', base: 3333 }), tx({ category: 'c', base: 3334 }), tx({ category: 'd', base: 10000 })]
    const r = categoryShares(list, range, B)
    expect(r.rows[0].id).toBe('d')
    expect(r.rows.map((x: any) => x.amount)).toEqual([10000, 3334, 3333, 3333])
    expect(r.rows.reduce((a: number, x: any) => a + x.pct, 0)).toBe(100)
  })

  it('folds categories under 3% into Other, and keeps a lone small one', () => {
    const big = [tx({ category: 'a', base: 50000 }), tx({ category: 'b', base: 49000 })]
    const two = categoryShares([...big, tx({ category: 'x', base: 500 }), tx({ category: 'y', base: 400 })], range, B)
    const other = two.rows.at(-1)
    expect(other.id).toBe(OTHER_ID)
    expect(other.amount).toBe(900)
    expect(other.items.map((x: any) => x.id)).toEqual(['x', 'y'])
    expect(two.rows.reduce((a: number, x: any) => a + x.pct, 0)).toBe(100)
    const one = categoryShares([...big, tx({ category: 'x', base: 500 })], range, B)
    expect(one.rows.map((x: any) => x.id)).toEqual(['a', 'b', 'x'])
  })

  it('folds past seven segments into Other', () => {
    const list = 'abcdefghij'.split('').map((c, i) => tx({ category: c, base: 10000 - i * 100 }))
    const r = categoryShares(list, range, B)
    expect(r.rows).toHaveLength(7)
    expect(r.rows.at(-1).id).toBe(OTHER_ID)
    expect(r.rows.at(-1).items).toHaveLength(4)
  })

  it('compares with the same days of the month before', () => {
    const list = [
      tx({ category: 'food', base: 11200, date: '2026-10-10' }),
      tx({ category: 'food', base: 10000, date: '2026-09-10' }),
      tx({ category: 'food', base: 99999, date: '2026-09-25' }), // after the 20th: not in the fair comparison
      tx({ category: 'fun', base: 3000, date: '2026-10-11' }),
    ]
    const r = categoryShares(list, range, B)
    const food = r.rows.find((x: any) => x.id === 'food')
    expect(range.prev).toMatchObject({ from: '2026-09-01', to: '2026-09-20' })
    expect(food.prev).toBe(10000)
    expect(changeText(food, 'last month')).toBe('+12% vs last month')
    expect(changeText(r.rows.find((x: any) => x.id === 'fun'), 'last month')).toBe('new vs last month')
  })

  it('knows its periods', () => {
    expect(spendRange('last', '2026-10-20')).toMatchObject({ from: '2026-09-01', to: '2026-09-30', prev: { from: '2026-08-01', to: '2026-08-31' } })
    expect(spendRange('3m', '2026-10-20')).toMatchObject({ from: '2026-08-01', to: '2026-10-20', prev: { from: '2026-05-01', to: '2026-07-20' } })
    expect(spendRange('year', '2026-10-20')).toMatchObject({ from: '2026-01-01', prev: { from: '2025-01-01', to: '2025-10-20' } })
    expect(spendRange('m:2026-02', '2026-10-20')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' })
  })

  it('has no shares for an empty period', () => {
    expect(categoryShares([], range, B)).toEqual({ total: 0, prevTotal: 0, rows: [] })
    expect(wholePercents([0, 0])).toEqual([0, 0])
  })
})
