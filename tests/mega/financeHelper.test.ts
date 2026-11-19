// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeHelper.test.ts) by scripts/port-mega-tests.mjs. 1 test(s) that need Life System code (./financeRates) are left out.
// Finance Helper's money logic used inside Life System (made-up data):
// default account, rates that travel with the data, tags, split receipts,
// search filters and the subscription finder.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS module from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore plain JS module from the embedded app
import { mergeStates, toCloud } from '../../js/sync.js'
// @ts-ignore plain JS module from the embedded app
import { searchTx, parseQuery } from '../../js/search.js'
// @ts-ignore plain JS module from the embedded app
import { findSubscriptions, payeeKey } from '../../js/subs.js'

const acc = (id: string, kind: string, currency = 'MDL', extra = {}) => ({ id, name: id, kind, currency, ...extra })
let n = 0
const tx = (date: string, amount: number, extra: Record<string, unknown> = {}) => ({ id: `t${++n}`, type: 'expense', amount, date, category: 'food', account: 'wallet', note: '', createdAt: n, updatedAt: n, ...extra })

function state(extra: Record<string, unknown> = {}) {
  return M.normalizeState({
    settings: { accounts: [acc('biz', 'business', 'USD'), acc('usdcard', 'card', 'USD'), acc('wallet', 'cash'), acc('card', 'card')] },
    tx: [],
    ...extra
  })
}

describe('new records default to a lei account', () => {
  it('never a business or dollar account; the main wallet first', () => {
    expect(M.defaultAccount(state())).toBe('wallet')
  })
  it('the lei account last used for that category', () => {
    const s = state({ tx: [tx('2026-01-02', 1000, { category: 'fun', account: 'card' }), tx('2026-01-03', 1000, { category: 'fun', account: 'usdcard', currency: 'USD', rate: 17 })] })
    expect(M.defaultAccount(s, 'expense', 'fun')).toBe('card')
    expect(M.defaultAccount(s, 'expense', 'food')).toBe('wallet')
  })
  it('reads $ and € from the amount', () => {
    expect(M.currencyInText('$12')).toEqual({ text: '12', currency: 'USD' })
    expect(M.currencyInText('12 €')).toEqual({ text: '12', currency: 'EUR' })
    expect(M.currencyInText('5 eur')).toEqual({ text: '5', currency: 'EUR' })
    expect(M.currencyInText('120+45')).toEqual({ text: '120+45', currency: null })
  })
})

describe('exchange rates', () => {
  const live = { usd: { USD: 1, MDL: 17.5, EUR: 0.9 }, crypto: {}, history: {}, fetchedAt: Date.parse('2026-03-10T09:00:00') }

  it('travel with the data and fill in a device without rates', () => {
    const a = state({ rates: live, tx: [tx('2026-03-01', 1000)] })
    const shared = toCloud(a, '').data
    expect(shared.lastRates).toEqual({ date: '2026-03-10', usd: { MDL: 17.5, USD: 1, EUR: 0.9 } })
    const b = state()
    const merged = mergeStates(b, { app: 'finance-helper', schema: 3, data: shared }).state
    expect(merged.rates.usd.MDL).toBe(17.5)
    // A brand-new device starting from the synced copy.
    expect(M.normalizeState(shared).rates.usd.EUR).toBe(0.9)
  })

  it('newer local rates are kept', () => {
    const newer = { ...live, usd: { ...live.usd, MDL: 18 }, fetchedAt: Date.parse('2026-03-12T09:00:00') }
    const merged = mergeStates(state({ rates: newer }), { app: 'finance-helper', schema: 3, data: toCloud(state({ rates: live }), '').data }).state
    expect(merged.rates.usd.MDL).toBe(18)
  })

  it('dollar accounts still count without live rates (rate of the last record)', () => {
    const s = state({ tx: [tx('2026-03-01', 10000, { type: 'income', account: 'usdcard', currency: 'USD', rate: 17.5, base: 175000 })] })
    const { total, missing } = M.totalBalance(s)
    expect(missing.map((v: any) => v.account.id)).not.toContain('usdcard')
    expect(total).toBe(175000)
  })

  it('stale rates are flagged', () => {
    expect(M.ratesAge(state({ rates: live }), Date.parse('2026-03-10T20:00:00')).stale).toBe(false)
    expect(M.ratesAge(state({ rates: live }), Date.parse('2026-03-13T20:00:00'))).toMatchObject({ stale: true, date: '2026-03-10' })
  })

  // (left out here: needs Life System code)
})

describe('tags, split and search', () => {
  it('reads tags from notes', () => {
    expect(M.tagsOf('dinner #Trip #friends x#no')).toEqual(['trip', 'friends'])
  })

  it('splits one receipt into records that add up', () => {
    const t = tx('2026-02-01', 30000, { note: 'market', base: 30000 })
    const out = M.splitRecord(t, [{ amount: 20000, category: 'food' }, { amount: 10000, category: 'home', person: 'p1' }], 99)
    expect(out.map((x: any) => x.amount)).toEqual([20000, 10000])
    expect(out.reduce((a: number, x: any) => a + x.base, 0)).toBe(30000)
    expect(out[0].id).toBe(t.id)
    expect(out[1]).toMatchObject({ category: 'home', person: 'p1', date: '2026-02-01', splitOf: t.id })
    expect(M.splitRecord(t, [{ amount: 100 }, { amount: 100 }])).toBeNull()
  })

  it('filters by tag, category, account, amount and dates', () => {
    const s = state({
      tx: [
        tx('2026-01-05', 15000, { note: 'pizza #trip' }),
        tx('2026-01-20', 5000, { note: 'bus', category: 'transport', account: 'card' }),
        tx('2026-02-02', 25000, { note: 'hotel #trip', category: 'home' })
      ]
    })
    const ids = (q: string) => searchTx(s, q, '2026-03-01').map((t: any) => t.note)
    expect(ids('#trip')).toEqual(['pizza #trip', 'hotel #trip'])
    expect(ids('cat:transport')).toEqual(['bus'])
    expect(ids('acc:card')).toEqual(['bus'])
    expect(ids('>100')).toEqual(['pizza #trip', 'hotel #trip'])
    expect(ids('from:2026-01-10 to:2026-01-31')).toEqual(['bus'])
    expect(ids('2026-01-01..2026-01-31 #trip')).toEqual(['pizza #trip'])
    expect(parseQuery('#Trip cat:Food').tags).toEqual(['trip'])
  })
})

describe('subscription finder', () => {
  it('finds a monthly payee with a similar amount, with the yearly cost', () => {
    const s = state({
      tx: [
        tx('2026-01-03', 9900, { note: 'Music app 1234', category: 'subscriptions' }),
        tx('2026-02-02', 9900, { note: 'music app', category: 'subscriptions' }),
        tx('2026-03-04', 10500, { note: 'MUSIC APP', category: 'subscriptions' }),
        tx('2026-01-10', 5000, { note: 'coffee' }),
        tx('2026-01-12', 5000, { note: 'coffee' }),
        tx('2026-01-14', 5000, { note: 'coffee' })
      ]
    })
    const found = findSubscriptions(s, '2026-03-20')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ name: 'MUSIC APP', count: 3, yearly: 9900 * 12, cancelled: false })
    expect(payeeKey('Music app 1234')).toBe('music app')
    s.settings.subsCancelled = { [found[0].key]: '2026-03-10' }
    expect(findSubscriptions(s, '2026-03-20')[0].cancelled).toBe(true)
  })
})
