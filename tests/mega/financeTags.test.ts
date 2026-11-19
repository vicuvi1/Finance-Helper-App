// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeTags.test.ts) by scripts/port-mega-tests.mjs.
// Colour tags (#5): tags stay #words in notes; colours and archive in the
// settings key `tagStyles`; merge, bulk add/remove, Reports → Tags. Made-up data only.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS modules from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore
import * as G from '../../js/tags.js'
// @ts-ignore
import { createHistory } from '../../js/history.js'
// @ts-ignore
import { createTracker } from '../../js/changelog.js'

let n = 0
const tx = (over: any = {}) => {
  const amount = over.amount ?? 100000
  return { id: `g${++n}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date: '2026-11-05', account: 'card', category: 'food', note: '', createdAt: n, updatedAt: n, ...over }
}
const money = (list: any[]) => M.normalizeState({ settings: { currency: 'MDL', accounts: [{ id: 'card', name: 'Card', kind: 'card', currency: 'MDL', start: 0 }] }, tx: list })
const NOW = 1_800_000_000_000

describe('notes', () => {
  it('normTag, add, remove, rename', () => {
    expect(G.normTag(' #Trip ')).toBe('trip')
    expect(G.normTag('two words')).toBe('')
    expect(G.addTag('Dinner', '#Trip')).toBe('Dinner #trip')
    expect(G.addTag('Dinner #trip', 'trip')).toBe('Dinner #trip')
    expect(G.removeTag('Dinner #trip with #friends', 'trip')).toBe('Dinner with #friends')
    expect(G.removeTag('#trippy #trip', 'trip')).toBe('#trippy')
    expect(G.renameTag('Hotel #vacation', 'vacation', 'trip')).toBe('Hotel #trip')
    expect(G.renameTag('Hotel #vacation #trip', 'vacation', 'trip')).toBe('Hotel #trip')
  })

  it('a record\'s tags include its split lines\' notes', () => {
    expect(G.recordTags({ note: 'Shop #weekly', splits: [{ category: 'food', amount: 1, note: '#gift' }, { category: 'home', amount: 1 }] })).toEqual(['weekly', 'gift'])
  })
})

describe('styles', () => {
  it('a steady colour until you pick one; archive; the settings are stamped', () => {
    const s = money([tx({ note: '#trip' })])
    const c = G.tagStyle(s, 'trip').color
    expect(c).toBeGreaterThanOrEqual(1)
    expect(c).toBeLessThanOrEqual(8)
    expect(G.tagStyle(s, 'trip').color).toBe(c)
    G.setTagStyle(s, 'trip', { color: 3 }, NOW)
    expect(s.settings.tagStyles.trip).toEqual({ color: 3 })
    expect(s.settings.updatedAt).toBe(NOW)
    G.setTagStyle(s, 'trip', { archived: true }, NOW)
    expect(G.tagList(s).map((g: any) => g.tag)).toEqual([])
    expect(G.tagList(s, { archived: true })[0]).toMatchObject({ tag: 'trip', color: 3, archived: true, count: 1 })
  })

  it('a styled tag nobody uses yet is listed with 0 records', () => {
    const s = money([])
    G.setTagStyle(s, 'gift', { color: 5 })
    expect(G.tagList(s)).toEqual([{ tag: 'gift', count: 0, color: 5, archived: false }])
  })
})

describe('merge', () => {
  it('rewrites the notes (lines too), drops the old look, touches each record', () => {
    const s = money([
      tx({ id: 'a', note: 'Hotel #vacation' }),
      tx({ id: 'b', note: 'Taxi #vacation #trip' }),
      tx({ id: 'c', note: 'Shop', splits: [{ category: 'food', amount: 50000, note: 'snacks #vacation' }, { category: 'home', amount: 50000 }] }),
      tx({ id: 'd', note: 'Lunch' }),
    ])
    G.setTagStyle(s, 'vacation', { color: 2 })
    const changed = G.mergeTags(s, 'vacation', 'trip', NOW)
    expect(changed).toBe(3)
    expect(s.tx.map((t: any) => t.note)).toEqual(['Hotel #trip', 'Taxi #trip', 'Shop', 'Lunch'])
    expect(s.tx[2].splits[0].note).toBe('snacks #trip')
    expect(s.tx.filter((t: any) => t.updatedAt === NOW).map((t: any) => t.id)).toEqual(['a', 'b', 'c'])
    expect(s.settings.tagStyles.vacation).toBeUndefined()
    expect(G.mergeTags(s, 'trip', 'trip')).toBe(0)
  })

  it('is one undo step and shows in Change history', () => {
    const s = money([tx({ id: 'a', note: 'Hotel #vacation' }), tx({ id: 'b', note: 'Taxi #vacation' })])
    const h = createHistory()
    h.reset(s)
    const tr = createTracker({ dev: 'desktop', now: () => NOW })
    tr.reset(s)
    G.mergeTags(s, 'vacation', 'trip', NOW)
    h.record(s, 'Merge tags')
    const entries = tr.observe(s, 'local')
    expect(entries).toHaveLength(2)
    expect(entries[0].set.note).toMatch(/#trip/)
    h.undo(s)
    expect(s.tx.map((t: any) => t.note)).toEqual(['Hotel #vacation', 'Taxi #vacation'])
  })
})

describe('bulk', () => {
  it('adds to the record note; removes from notes and lines', () => {
    const s = money([tx({ id: 'a', note: 'Dinner' }), tx({ id: 'b', note: 'Taxi #trip' }), tx({ id: 'c', note: 'x', splits: [{ category: 'food', amount: 50000, note: '#trip' }, { category: 'home', amount: 50000 }] })])
    expect(G.bulkTag(s, ['a', 'b'], 'trip', true, NOW)).toEqual({ changed: 1, skipped: 1 })
    expect(s.tx[0].note).toBe('Dinner #trip')
    expect(G.bulkTag(s, ['a', 'b', 'c'], '#trip', false, NOW)).toEqual({ changed: 3, skipped: 0 })
    expect(s.tx.map((t: any) => t.note)).toEqual(['Dinner', 'Taxi', 'x'])
    expect(s.tx[2].splits[0].note).toBeUndefined()
    expect(G.bulkTag(s, ['a'], 'two words', true)).toEqual({ changed: 0, skipped: 1 })
  })
})

describe('Reports → Tags', () => {
  it('totals per tag over time, a line\'s own tag counts only its part, refunds lower it', () => {
    const s = money([
      tx({ id: 'h', note: 'Hotel #trip', amount: 300000, date: '2026-10-10' }),
      tx({ id: 's', note: 'Shop', amount: 60000, date: '2026-11-03', splits: [{ category: 'food', amount: 40000, note: '#trip' }, { category: 'home', amount: 20000 }] }),
      tx({ id: 'r', type: 'income', refund: true, category: 'food', note: 'Refund #trip', amount: 10000, date: '2026-11-04' }),
      tx({ id: 'p', type: 'income', category: 'work', note: 'Guide fee #trip', amount: 50000, date: '2026-11-05' }),
      tx({ id: 'n', note: 'not counted #trip', amount: 99900, notSpending: true }),
      tx({ id: 'o', note: 'Gift #gift', amount: 20000, date: '2026-11-06' }),
    ])
    const rows = G.tagTotals(s, '2026-10-01', '2026-11-30')
    const trip = rows.find((r: any) => r.tag === 'trip')
    expect(trip).toMatchObject({ spent: 300000 + 40000 - 10000, earned: 50000, count: 4 })
    expect(trip.months).toEqual({ '2026-10': 300000, '2026-11': 30000 })
    expect(rows[0].tag).toBe('trip')
    expect(G.tagRecords(s, 'trip', '2026-11-01', '2026-11-30').map((t: any) => [t.id, t.amount])).toEqual([['p', 50000], ['r', 10000], ['s', 40000]])
  })
})
