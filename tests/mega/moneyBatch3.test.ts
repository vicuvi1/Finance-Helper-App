// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/moneyBatch3.test.ts) by scripts/port-mega-tests.mjs.
// Money batch 3: bulk record changes with one Undo, the weekly cash count, keyboard
// shortcut helpers, and the new settings keys surviving sync. Made-up data; clocks passed in.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS modules from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore
import { createHistory } from '../../js/history.js'
// @ts-ignore
import * as Bulk from '../../js/bulk.js'
// @ts-ignore
import * as CC from '../../js/cashcount.js'
// @ts-ignore
import * as Keys from '../../js/shortcuts.js'
// @ts-ignore
import { backupBefore } from '../../js/dupes.js'
// @ts-ignore
import { mergeStates, toCloud } from '../../js/sync.js'
import { FINANCE as SPEC } from './_life.js'

let n = 0
const tx = (over: any = {}) => {
  const amount = over.amount ?? 10000
  return { id: `t${++n}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date: '2026-11-05', account: 'card', category: 'food', note: '', createdAt: n, updatedAt: n, ...over }
}
const money = (list: any[], accounts?: any[]) =>
  M.normalizeState({
    settings: {
      currency: 'MDL',
      accounts: accounts ?? [
        { id: 'wallet', name: 'Wallet', kind: 'cash', currency: 'MDL', start: 50000 },
        { id: 'card', name: 'Card', kind: 'card', currency: 'MDL', start: 5000000 },
        { id: 'usd', name: 'Dollars', kind: 'card', currency: 'USD', start: 0 }
      ]
    },
    tx: list,
    rates: { usd: { USD: 1, MDL: 17.6, EUR: 0.88 }, crypto: {}, history: {}, fetchedAt: 1 }
  })
const strip = (t: any) => { const { updatedAt, ...rest } = t; return rest }

describe('change many records at once', () => {
  const three = () => [tx({ id: 'a', note: 'one' }), tx({ id: 'b', note: 'two', date: '2026-11-06' }), tx({ id: 'c', note: 'three', date: '2026-11-07' }), tx({ id: 'z', note: 'untouched' })]

  it('set category changes all 3 and one Undo restores each exactly', () => {
    const s = money(three())
    const before = JSON.parse(JSON.stringify(s.tx)).map(strip)
    const h = createHistory()
    h.reset(s)
    expect(Bulk.countApplicable(s, ['a', 'b', 'c'], 'category', 'transport')).toBe(3)
    const r = Bulk.applyBulk(s, ['a', 'b', 'c'], 'category', 'transport', { now: 99 })
    h.record(s)
    expect(r).toEqual({ changed: 3, skipped: 0 })
    expect(s.tx.filter((t: any) => t.category === 'transport').map((t: any) => t.id).sort()).toEqual(['a', 'b', 'c'])
    expect(s.tx.find((t: any) => t.id === 'z').category).toBe('food')
    h.undo(s)
    expect(s.tx.map(strip)).toEqual(before)
  })

  it('a category of the other type is skipped, a bad date changes nothing', () => {
    const s = money([...three(), tx({ id: 'i', type: 'income', category: 'other-in' })])
    expect(Bulk.applyBulk(s, ['a', 'i'], 'category', 'transport')).toEqual({ changed: 1, skipped: 1 })
    expect(Bulk.applyBulk(s, ['a'], 'date', 'nope')).toEqual({ changed: 0, skipped: 0 })
    expect(s.tx.find((t: any) => t.id === 'a').date).toBe('2026-11-05')
  })

  it('set date and set account (other currency re-prices) are one Undo each', () => {
    const s = money(three())
    const before = JSON.parse(JSON.stringify(s.tx)).map(strip)
    const h = createHistory()
    h.reset(s)
    Bulk.applyBulk(s, ['a', 'b'], 'date', '2026-10-31')
    h.record(s)
    expect(s.tx.filter((t: any) => t.date === '2026-10-31')).toHaveLength(2)
    Bulk.applyBulk(s, ['b', 'c'], 'account', 'usd', { rateFor: () => 17.6 })
    h.record(s)
    expect(s.tx.find((t: any) => t.id === 'b')).toMatchObject({ account: 'usd', currency: 'USD', rate: 17.6 })
    h.undo(s)
    h.undo(s)
    expect(s.tx.map(strip)).toEqual(before)
  })

  it('delete many removes all, keeps others, and one Undo brings every record back', () => {
    const s = money(three())
    const before = JSON.parse(JSON.stringify(s.tx)).map(strip)
    const h = createHistory()
    h.reset(s)
    expect(Bulk.deleteMany(s, ['a', 'b', 'c', 'missing'])).toBe(3)
    h.record(s)
    expect(s.tx.map((t: any) => t.id)).toEqual(['z'])
    h.undo(s)
    expect(s.tx.map(strip).sort((x: any, y: any) => x.id.localeCompare(y.id))).toEqual(before.sort((x: any, y: any) => x.id.localeCompare(y.id)))
  })

  it('the backup before a delete: no Life System means go on, a failed backup refuses', async () => {
    expect((await backupBefore('x', { win: null })).skipped).toBe(true)
    const listeners: any[] = []
    const win: any = {
      location: { origin: 'http://x' },
      addEventListener: (_: string, f: any) => listeners.push(f),
      removeEventListener: () => {},
      parent: { postMessage: (m: any) => listeners.forEach((f) => f({ origin: 'http://x', data: { type: 'LIFE_BACKUP_DONE', id: m.payload.id, ok: false, error: 'disk full' } })) }
    }
    expect(await backupBefore('x', { win })).toEqual({ ok: false, error: 'disk full' })
  })
})

describe('weekly cash count', () => {
  const SUN = '2026-11-15' // a Sunday
  const MON = '2026-11-16'
  it('shows on the set day (default Sunday) with a cash account, not on other days', () => {
    const s = money([])
    expect(CC.cashCountDue(s, SUN)?.accounts[0].id).toBe('wallet')
    expect(CC.cashCountDue(s, MON)).toBeNull()
    CC.setCashCount(s, { day: 1 })
    expect(CC.cashCountDue(s, MON)).not.toBeNull()
    expect(CC.cashCountDue(s, SUN)).toBeNull()
  })
  it('is off when switched off, answered today, or there is no cash account', () => {
    const s = money([])
    CC.setCashCount(s, { on: false })
    expect(CC.cashCountDue(s, SUN)).toBeNull()
    const t = money([])
    CC.markCashSame(t, SUN)
    expect(CC.cashCountDue(t, SUN)).toBeNull()
    const none = money([])
    none.settings.accounts.find((a: any) => a.id === 'wallet').archived = true
    expect(CC.cashCountDue(none, SUN)).toBeNull()
  })
  it('a different count adds one "Cash count" record, the balance matches, Undo removes it', () => {
    const s = money([])
    const h = createHistory()
    h.reset(s)
    expect(M.accountBalances(s).wallet).toBe(50000)
    const r = CC.applyCashCount(s, 'wallet', 42000, SUN, { id: 'cc1', now: 5 })
    h.record(s)
    expect(r.diff).toBe(-8000)
    expect(s.tx).toHaveLength(1)
    expect(s.tx[0]).toMatchObject({ id: 'cc1', note: 'Cash count', type: 'expense', amount: 8000, account: 'wallet', cashCount: true })
    expect(M.accountBalances(s).wallet).toBe(42000)
    expect(CC.cashCountDue(s, SUN)).toBeNull()
    h.undo(s)
    expect(s.tx).toHaveLength(0)
    expect(s.settings.cashCountLast).toBeUndefined()
    expect(CC.cashCountDue(s, SUN)).not.toBeNull()
  })
  it('more cash than the app adds income; an equal count adds nothing but the date', () => {
    const s = money([])
    expect(CC.applyCashCount(s, 'wallet', 60000, SUN, { id: 'cc2', now: 5 }).tx).toMatchObject({ type: 'income', amount: 10000, note: 'Cash count' })
    const t = money([])
    expect(CC.applyCashCount(t, 'wallet', 50000, SUN, { id: 'cc3', now: 5 }).tx).toBeNull()
    expect(t.tx).toHaveLength(0)
    expect(t.settings.cashCountLast).toBe(SUN)
  })
  it('the three settings keys survive Finance sync, Life sync and the bot save', () => {
    const a = money([])
    CC.setCashCount(a, { on: false, day: 3 })
    CC.markCashSame(a, '2026-11-11')
    const keys = (s: any) => [s.settings.cashCountOn, s.settings.cashCountDay, s.settings.cashCountLast]
    expect(keys(a)).toEqual([false, 3, '2026-11-11'])
    const shared = JSON.parse(JSON.stringify(SPEC.share!(a)))
    expect(keys(SPEC.fromShared!(shared))).toEqual(keys(a))
    expect(keys(SPEC.merge(JSON.parse(JSON.stringify(money([]))), shared, false))).toEqual(keys(a))
    const cloud = JSON.parse(JSON.stringify(toCloud(M.normalizeState(a), '').data))
    expect(keys(M.normalizeState({ ...cloud, version: M.SCHEMA_VERSION }))).toEqual(keys(a))
    expect(keys(mergeStates(money([]), { app: 'finance-helper', schema: M.SCHEMA_VERSION, savedAt: 0, data: cloud }).state)).toEqual(keys(a))
  })
})

describe('keyboard shortcut helpers', () => {
  const key = (k: string, extra: any = {}) => ({ key: k, preventDefault() {}, ...extra })
  it('G then a letter goes to the screen; a lone G waits; a slow second key does not', () => {
    const seen: string[] = []
    const go = (t: string) => seen.push(t)
    Keys.resetPending()
    expect(Keys.onKey(key('g'), { go, now: 1000 })).toBe(true)
    expect(Keys.onKey(key('l'), { go, now: 1500 })).toBe(true)
    expect(seen).toEqual(['log'])
    Keys.onKey(key('g'), { go, now: 2000 })
    expect(Keys.onKey(key('h'), { go, now: 5000 })).toBe(false) // too slow: H is its own key
    Keys.onKey(key('g'), { go, now: 6000 })
    expect(Keys.onKey(key('g'), { go, now: 6100 })).toBe(true) // G then G = Goals
    expect(seen).toEqual(['log', 'goals'])
  })
  it('ignores Ctrl/Alt combinations and knows what typing is', () => {
    Keys.resetPending()
    expect(Keys.onKey(key('g', { ctrlKey: true }), { go: () => {}, now: 1 })).toBe(false)
    const input = { closest: (sel: string) => (sel.includes('input') ? {} : null) }
    expect(Keys.isTyping(input)).toBe(true)
    expect(Keys.isTyping({ closest: () => null })).toBe(false)
  })
  it('the help list names every shortcut', () => {
    const html = Keys.helpHTML()
    for (const t of ['New record', 'Search', 'Edit', 'Undo', 'Home', 'Log', 'Accounts', 'Goals', 'Plan', 'Reports']) expect(html).toContain(t)
  })
})
