// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeMoney3.test.ts) by scripts/port-mega-tests.mjs.
// Money: search words ("over 500", "from 1 Oct to 15 Oct") and their chips, favourites ranking and the
// emergency fund meter. Made-up data only.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS module from the embedded app
import { parseQuery, searchTx, searchSummary } from '../../js/search.js'
// @ts-ignore plain JS module from the embedded app
import { queryTerms, withoutTerm, chipsHTML } from '../../js/searchchips.js'
// @ts-ignore plain JS module from the embedded app
import { rankFavorites, togglePin, favTx, favKey } from '../../js/favorites.js'
// @ts-ignore plain JS module from the embedded app
import { emergencyFund, advice, monthsText } from '../../js/emergency.js'

const TODAY = '2026-11-17'
let n = 0
const tx = (over: Record<string, unknown> = {}) => ({ id: `t${++n}`, type: 'expense', amount: 5000, base: 5000, currency: 'MDL', date: '2026-11-05', category: 'food', account: 'card', note: '', createdAt: n, updatedAt: n, ...over })
const mk = (list: any[], extra: Record<string, unknown> = {}): any => ({
  tx: list,
  people: [],
  settings: {
    currency: 'MDL',
    categories: [{ id: 'food', type: 'expense', name: 'Food' }, { id: 'fun', type: 'expense', name: 'Fun' }, { id: 'other-in', type: 'income', name: 'Salary' }],
    accounts: [{ id: 'card', name: 'Card', currency: 'MDL', kind: 'card' }, { id: 'cash', name: 'Cash', currency: 'MDL', kind: 'cash' }, { id: 'save', name: 'Safe jar', currency: 'MDL', savings: true, start: 0 }],
    ...extra,
  },
})

describe('search words', () => {
  it('over and under become amount limits', () => {
    expect(parseQuery('over 500').min).toBe(50001)
    expect(parseQuery('under 100').max).toBe(9999)
    expect(parseQuery('more than 1 000').min).toBe(100001)
    expect(parseQuery('500-1000')).toMatchObject({ min: 50000, max: 100000 })
    expect(parseQuery('sub:coffee').subs).toEqual(['coffee'])
  })
  it('reads a date range in words', () => {
    const q = parseQuery('from 1 Oct to 15 Oct', TODAY)
    expect([q.from, q.to]).toEqual(['2026-10-01', '2026-10-15'])
    const y = parseQuery('from 20 dec to 5 jan 2027', TODAY)
    expect([y.from, y.to]).toEqual(['2026-12-20', '2027-01-05'])
    // A date that would be in the future means last year.
    const f = parseQuery('from 1 dec to 20 dec', TODAY)
    expect([f.from, f.to]).toEqual(['2025-12-01', '2025-12-20'])
  })
  it('combines an amount, an account, a category and a period', () => {
    const list = [
      tx({ amount: 80000, base: 80000, date: '2026-10-10', account: 'cash', category: 'food' }),
      tx({ amount: 80000, base: 80000, date: '2026-09-10', account: 'cash', category: 'food' }),
      tx({ amount: 20000, base: 20000, date: '2026-10-10', account: 'cash', category: 'food' }),
      tx({ amount: 80000, base: 80000, date: '2026-10-10', account: 'card', category: 'food' }),
      tx({ amount: 80000, base: 80000, date: '2026-10-10', account: 'cash', category: 'fun' }),
    ]
    const s = mk(list)
    const r = searchTx(s, 'over 500 cash food from 1 oct to 15 oct', TODAY)
    expect(r.map((t: any) => t.id)).toEqual([list[0].id])
    expect(searchTx(s, 'under 300 cash food', TODAY).map((t: any) => t.id)).toEqual([list[2].id])
    expect(searchTx(s, 'last month over 500', TODAY)).toHaveLength(3)
    expect(searchTx(s, 'this month', TODAY)).toHaveLength(0)
    const sum = searchSummary(searchTx(s, 'over 500 cash', TODAY))
    expect(sum.count).toBe(3)
    expect(sum.spent).toBe(240000)
  })
})

describe('search chips', () => {
  it('a phrase is one chip and removing it keeps the rest', () => {
    const q = 'coffee over 500 from 1 oct to 15 oct cash'
    const t = queryTerms(q, mk([]))
    expect(t.map((x: any) => x.label)).toEqual(['coffee', 'Over 500', 'From 1 Oct To 15 Oct', 'Account: Cash'])
    expect(withoutTerm(q, 1, mk([]))).toBe('coffee from 1 oct to 15 oct cash')
    expect(withoutTerm('over 500', 0)).toBe('')
  })
  it('labels the old forms too, and draws nothing for an empty query', () => {
    expect(queryTerms('>1000 #trip cat:food this month').map((x: any) => x.label)).toEqual(['Over 1000', '#trip', 'Category: food', 'This Month'])
    expect(chipsHTML('  ', (s: string) => s)).toBe('')
    expect(chipsHTML('over 5', (s: string) => s)).toContain('data-act="sq-chip-x"')
  })
})

describe('favourites', () => {
  const rec = (note: string, amount: number, date: string, extra: Record<string, unknown> = {}) => tx({ note, amount, base: amount, date, category: 'food', account: 'card', ...extra })
  it('ranks the most common records of 90 days with the latest amount', () => {
    const list = [
      rec('Coffee', 3000, '2026-11-01'), rec('coffee ', 3500, '2026-11-10'), rec('Coffee', 3200, '2026-10-20'),
      rec('Lunch', 9000, '2026-11-02'), rec('Lunch', 9500, '2026-11-12'),
      rec('Taxi', 7000, '2026-11-12'), // once only: not learned
      rec('Old', 1000, '2026-06-01'), rec('Old', 1000, '2026-06-02'), // outside 90 days
      rec('Fun', 1000, '2026-11-12', { category: 'fun' }), rec('Fun', 1200, '2026-11-13', { category: 'fun' }), rec('Fun', 1200, '2026-11-14', { category: 'fun' }),
      tx({ type: 'transfer', note: 'Move', amount: 1000, date: '2026-11-12' }), tx({ type: 'transfer', note: 'Move', amount: 1000, date: '2026-11-13' }),
    ]
    const r = rankFavorites(mk(list), TODAY)
    expect(r.map((f: any) => f.note.trim().toLowerCase())).toEqual(['fun', 'coffee', 'lunch']) // 3 each: the more recent first
    expect(r[1].amount).toBe(3500)
    expect(r[1].count).toBe(3)
    // The same note on another account is another favourite.
    const two = rankFavorites(mk([...list, rec('Lunch', 9000, '2026-11-14', { account: 'cash' }), rec('Lunch', 9000, '2026-11-15', { account: 'cash' })]), TODAY)
    expect(two.filter((f: any) => f.note === 'Lunch')).toHaveLength(2)
  })
  it('keeps the top 6 and puts a pinned one first even when it is old', () => {
    const list: any[] = []
    for (let i = 0; i < 8; i++) { list.push(rec(`Item ${i}`, 1000, '2026-11-01'), rec(`Item ${i}`, 1000, '2026-11-02')) }
    const s = mk([...list, rec('Rent', 50000, '2026-05-01')])
    expect(rankFavorites(s, TODAY)).toHaveLength(6)
    const old = { key: favKey(rec('Rent', 0, '2026-05-01')), type: 'expense', category: 'food', account: 'card', note: 'Rent', amount: 50000, currency: 'MDL' }
    expect(togglePin(s, old)).toBe(true)
    const r = rankFavorites(s, TODAY)
    expect(r).toHaveLength(6)
    expect(r[0]).toMatchObject({ note: 'Rent', pinned: true, amount: 50000 })
    expect(togglePin(s, old)).toBe(false)
    expect(rankFavorites(s, TODAY).some((f: any) => f.pinned)).toBe(false)
  })
  it('one click makes today\'s record with the latest amount', () => {
    const f = rankFavorites(mk([rec('Coffee', 3000, '2026-11-01'), rec('Coffee', 3500, '2026-11-10')]), TODAY)[0]
    expect(favTx(f, TODAY, { id: 'x', now: 5, rate: 1 })).toMatchObject({ id: 'x', date: TODAY, amount: 3500, base: 3500, note: 'Coffee', account: 'card', category: 'food', type: 'expense' })
  })
})

describe('emergency fund', () => {
  const spend = (cat: string, amount: number, date: string, extra: Record<string, unknown> = {}) => tx({ category: cat, amount, base: amount, date, ...extra })
  const months = ['2026-08-10', '2026-09-10', '2026-10-10']
  const base = () => [...months.flatMap((d) => [spend('food', 30000, d), spend('fun', 30000, d)]), tx({ id: 'dep', type: 'income', category: 'other-in', account: 'save', amount: 102000, base: 102000, date: '2026-08-01' })]
  it('is savings divided by the average essential spending of the last 3 months', () => {
    const s = mk(base(), { emergency: { essential: ['food'] } })
    const r = emergencyFund(s, TODAY)
    expect(r.ok).toBe(true)
    expect(r.monthly).toBe(30000)
    expect(r.months).toBeCloseTo(3.4, 5)
    expect(monthsText(r.months)).toBe('3.4')
    expect(r.basis).toBe('essential')
  })
  it('counts all spending when no category is marked, and ignores refunds, loans and this month', () => {
    const list = [...base(), tx({ type: 'income', refund: true, category: 'food', amount: 20000, base: 20000, date: '2026-10-12' }), spend('food', 99999, '2026-10-12', { loan: true }), spend('fun', 90000, '2026-11-03')]
    const r = emergencyFund(mk(list), TODAY)
    expect(r.basis).toBe('all')
    expect(r.monthly).toBe(60000)
    expect(r.months).toBeCloseTo(1.7, 5)
  })
  it('uses the accounts you chose instead of the savings accounts', () => {
    const list = [...base(), tx({ type: 'income', category: 'other-in', account: 'cash', amount: 60000, base: 60000, date: '2026-08-02' })]
    const r = emergencyFund(mk(list, { emergency: { essential: ['food'], accounts: ['cash', 'save'] } }), TODAY)
    expect(r.savings).toBe(162000)
    expect(r.months).toBeCloseTo(5.4, 5)
  })
  it('says it needs history when there is none, and averages only the months that exist', () => {
    expect(emergencyFund(mk([]), TODAY).ok).toBe(false)
    const r = emergencyFund(mk([spend('food', 40000, '2026-10-05'), tx({ type: 'income', account: 'save', amount: 80000, base: 80000, date: '2026-10-01' })]), TODAY)
    expect(r.counted).toBe(1)
    expect(r.months).toBeCloseTo(2, 5)
  })
  it('gives one line of advice with the 3 and 6 month marks', () => {
    expect(advice(0.5)).toMatch(/one month/)
    expect(advice(2)).toMatch(/3 months/)
    expect(advice(4)).toMatch(/6 months/)
    expect(advice(6)).toMatch(/Fully covered/)
  })
})
