// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeStore.test.ts) by scripts/port-mega-tests.mjs.
// Finance Helper's store (public/apps/finance/js/store.js): what this device
// starts from. Real data must never be replaced by the example data, and
// nothing is written to the Life System database from here.
import { afterEach, describe, expect, it, vi } from './_vitest.js'
// @ts-ignore plain JS module from the embedded app
import { initialSource, load, save } from '../../js/store.js'
// @ts-ignore plain JS module from the embedded app
import { demoFinanceState } from '../../js/seedFinance.js'

function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    _m: m
  }
}

const oneRecord = {
  settings: { accounts: [{ id: 'wallet', name: 'Cash', kind: 'cash', currency: 'MDL' }] },
  tx: [{ id: 'x1', type: 'expense', amount: 1000, date: '2026-01-02', category: 'food', account: 'wallet', createdAt: 1, updatedAt: 1 }]
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete (globalThis as any).FH_DEMO
})

describe('finance store start-up', () => {
  it('keeps what is saved, even a short list or an empty one', () => {
    expect(initialSource(JSON.stringify(oneRecord))).toBe('stored')
    expect(initialSource(JSON.stringify({ ...oneRecord, tx: [] }))).toBe('stored')
    expect(initialSource(JSON.stringify(oneRecord), { demo: true })).toBe('stored')
  })

  it('uses the example data only for the demo on an empty device', () => {
    expect(initialSource(null)).toBe('fresh')
    expect(initialSource(null, { demo: true })).toBe('demo')
  })

  it('a device with one record loads that record and writes nothing', () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}')))
    vi.stubGlobal('fetch', fetchSpy)
    const store = memStore({ 'finance-helper.state': JSON.stringify(oneRecord) })
    const s = load(store)
    expect(s.tx.map((t: any) => t.id)).toEqual(['x1'])
    expect(store.getItem('finance-helper.state')).toBe(JSON.stringify(oneRecord))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('an empty device starts empty and saving sends nothing to the server', () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}')))
    vi.stubGlobal('fetch', fetchSpy)
    const store = memStore()
    const s = load(store)
    expect(s.tx).toEqual([])
    expect(store.getItem('finance-helper.state')).toBeNull()
    save(s, store)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the demo shows example data but does not save it', () => {
    ;(globalThis as any).FH_DEMO = true
    const store = memStore()
    const s = load(store)
    expect(s.tx.length).toBeGreaterThan(20)
    expect(store.getItem('finance-helper.state')).toBeNull()
  })

  it('the example data is small and made up', () => {
    const d = demoFinanceState(Date.parse('2026-03-15T12:00:00Z'))
    expect(d.tx.length).toBeGreaterThanOrEqual(30)
    expect(d.tx.length).toBeLessThanOrEqual(50)
    expect(d.tx.every((t: any) => t.id.startsWith('demo-'))).toBe(true)
  })
})
