// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeChanges.test.ts) by scripts/port-mega-tests.mjs.
// Money change history (#15): logging, the cap, Put back (edits, deletes, adds), and Put back
// surviving the sync merge (newer edit wins, tombstones respected). Made-up data; clocks passed in.
import { beforeEach, describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS modules from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore
import { createHistory } from '../../js/history.js'
// @ts-ignore
import * as CL from '../../js/changelog.js'
// @ts-ignore
import * as Store from '../../js/changestore.js'
import { FINANCE as SPEC } from './_life.js'

let n = 0
const tx = (over: any = {}) => {
  const amount = over.amount ?? 10000
  return { id: `t${++n}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date: '2026-11-05', account: 'card', category: 'food', note: 'Lunch', createdAt: 1000, updatedAt: 1000, ...over }
}
const money = (list: any[]) =>
  M.normalizeState({
    settings: { currency: 'MDL', accounts: [{ id: 'card', name: 'Card', kind: 'card', currency: 'MDL', start: 5000000 }] },
    tx: list,
  })
const clone = (x: any) => JSON.parse(JSON.stringify(x))
const T0 = Date.parse('2026-11-17T10:00:00Z')

describe('logging changes', () => {
  it('an edit becomes one entry with field: old -> new, the device, and the record stamped', () => {
    const s = money([tx({ id: 'a', amount: 12000, base: 12000 })])
    let now = T0
    const tr = CL.createTracker({ dev: 'desktop', now: () => now })
    tr.reset(s)
    s.tx[0] = { ...s.tx[0], amount: 15000, base: 15000, note: 'Lunch with team', updatedAt: T0 }
    now = T0 + 5
    const out = tr.observe(s, 'local')
    expect(out).toHaveLength(1)
    const e = out[0]
    expect(e).toMatchObject({ act: 'edit', dev: 'desktop', list: 'tx', rid: 'a', at: T0 + 5 })
    expect(CL.changesOf(e)).toEqual([
      { f: 'amount', from: 12000, to: 15000 },
      { f: 'base', from: 12000, to: 15000 },
      { f: 'note', from: 'Lunch', to: 'Lunch with team' },
    ])
    expect(e.before.amount).toBe(12000)
    expect(s.tx[0].editedOn).toBe('desktop')
    // Saving again without a change logs nothing.
    expect(tr.observe(s, 'local')).toEqual([])
  })

  it('add, delete and a bulk change are logged; one save with several records is one group', () => {
    const s = money([tx({ id: 'a' }), tx({ id: 'b' }), tx({ id: 'c' })])
    const tr = CL.createTracker({ dev: 'web', now: () => T0 })
    tr.reset(s)
    s.tx.push(tx({ id: 'd', amount: 500, base: 500 }))
    expect(tr.observe(s, 'local').map((e: any) => [e.act, e.rid])).toEqual([['add', 'd']])
    s.tx = s.tx.filter((t: any) => t.id !== 'b')
    const del = tr.observe(s, 'local')
    expect(del).toMatchObject([{ act: 'delete', rid: 'b', gone: true }])
    expect(del[0].before.id).toBe('b')
    for (const t of s.tx) { t.category = 'transport'; t.updatedAt = T0 }
    const bulk = tr.observe(s, 'local')
    expect(bulk).toHaveLength(3)
    expect(new Set(bulk.map((e: any) => e.grp)).size).toBe(1)
    expect(bulk.every((e: any) => e.n === 3 && e.act === 'edit')).toBe(true)
  })

  it('changes that arrive by sync carry the device that made them; bot records say Telegram bot', () => {
    const s = money([tx({ id: 'a' })])
    const tr = CL.createTracker({ dev: 'desktop', now: () => T0 })
    tr.reset(s)
    s.tx[0] = { ...s.tx[0], amount: 999, base: 999, updatedAt: T0, editedOn: 'web' }
    s.tx.push(tx({ id: 'tg1', source: 'telegram' }))
    s.tx.push(tx({ id: 'old' })) // from an older app version: no stamp
    const out = tr.observe(s, 'sync')
    const by = Object.fromEntries(out.map((e: any) => [e.rid, e.dev]))
    expect(by).toEqual({ a: 'web', tg1: 'bot', old: 'other' })
    // Incoming records are never stamped by this device.
    expect(s.tx[0].editedOn).toBe('web')
    expect(s.tx.find((t: any) => t.id === 'old').editedOn).toBeUndefined()
  })

  it('a first sync with hundreds of records is one summary line, not hundreds', () => {
    const s = money([])
    const tr = CL.createTracker({ dev: 'desktop', now: () => T0 })
    tr.reset(s)
    for (let i = 0; i < 300; i++) s.tx.push(tx({ id: `s${i}` }))
    const out = tr.observe(s, 'sync')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ act: 'many', n: 300 })
  })

  it('undo is logged as an undo', () => {
    const s = money([tx({ id: 'a', amount: 100, base: 100 })])
    const h = createHistory()
    const tr = CL.createTracker({ dev: 'desktop', now: () => T0 })
    h.reset(s); tr.reset(s)
    s.tx[0] = { ...s.tx[0], amount: 200, base: 200, updatedAt: T0 }
    tr.observe(s, 'local'); h.record(s)
    h.undo(s, T0 + 1)
    const out = tr.observe(s, 'undo')
    expect(out).toMatchObject([{ act: 'undo', rid: 'a' }])
    expect(CL.changesOf(out[0]).find((c: any) => c.f === 'amount')).toEqual({ f: 'amount', from: 200, to: 100 })
  })
})

describe('the cap', () => {
  it('keeps 90 days and at most 2,000 entries, newest first', () => {
    const now = T0
    const day = 86400000
    const list = [
      { id: 'old', at: now - 91 * day },
      { id: 'edge', at: now - 89 * day },
      ...Array.from({ length: 2100 }, (_, i) => ({ id: `e${i}`, at: now - i * 1000 })),
    ]
    const out = CL.prune(list, now)
    expect(out).toHaveLength(CL.MAX_ENTRIES)
    expect(out[0].id).toBe('e0')
    expect(out.some((e: any) => e.id === 'old')).toBe(false)
    expect(CL.prune([{ id: 'edge', at: now - 89 * day }, { id: 'old', at: now - 91 * day }], now).map((e: any) => e.id)).toEqual(['edge'])
    expect(CL.mergeLogs([{ id: 'x', at: now }], [{ id: 'x', at: now }, { id: 'y', at: now - 1 }], now).map((e: any) => e.id)).toEqual(['x', 'y'])
  })
})

describe('Put back', () => {
  it('puts an edited record back as it was, stamped newer, and the merge keeps the put back version', () => {
    const s = money([tx({ id: 'a', amount: 12000, base: 12000 })])
    const tr = CL.createTracker({ dev: 'desktop', now: () => T0 })
    tr.reset(s)
    s.tx[0] = { ...s.tx[0], amount: 15000, base: 15000, updatedAt: T0 }
    const [e] = tr.observe(s, 'local')
    // The other device still has the edited copy (the edit synced there).
    const theirs = SPEC.share!(clone(s))
    expect(CL.putBack(s, [e], T0 + 60000)).toBe(1)
    expect(s.tx[0].amount).toBe(12000)
    expect(s.tx[0].updatedAt).toBe(T0 + 60000)
    const back = tr.observe(s, 'putback')
    expect(back).toMatchObject([{ act: 'putback', rid: 'a' }])
    expect(CL.alreadyBack(s, e)).toBe(true)
    // Both directions of the merge end with the put back amount: nothing lost, nothing doubled.
    const merged = SPEC.merge(clone(s), theirs, false)
    expect(merged.tx.filter((t: any) => t.id === 'a').map((t: any) => t.amount)).toEqual([12000])
    const there = SPEC.merge(SPEC.fromShared!(clone(theirs)), SPEC.share!(clone(s)), false)
    expect(there.tx.find((t: any) => t.id === 'a').amount).toBe(12000)
  })

  it('brings a deleted record back, and the old tombstone on another device does not hide it', () => {
    const s = money([tx({ id: 'a', amount: 7000, base: 7000 }), tx({ id: 'b' })])
    const tr = CL.createTracker({ dev: 'desktop', now: () => T0 })
    tr.reset(s)
    s.tx = s.tx.filter((t: any) => t.id !== 'a')
    s.deleted.a = T0
    const [e] = tr.observe(s, 'local')
    expect(e).toMatchObject({ act: 'delete', rid: 'a' })
    const theirs = SPEC.share!(clone(s)) // the deletion reached the other device
    expect(theirs.deleted.a).toBe(T0)
    expect(CL.putBack(s, [e], T0 + 1000)).toBe(1)
    expect(s.tx.find((t: any) => t.id === 'a')).toMatchObject({ amount: 7000, updatedAt: T0 + 1000 })
    expect(s.deleted.a).toBeUndefined()
    const merged = SPEC.merge(clone(s), theirs, false)
    expect(merged.tx.find((t: any) => t.id === 'a')?.amount).toBe(7000)
    const there = SPEC.merge(SPEC.fromShared!(clone(theirs)), SPEC.share!(clone(s)), false)
    expect(there.tx.find((t: any) => t.id === 'a')?.amount).toBe(7000)
    expect(there.tx).toHaveLength(2)
  })

  it('putting back an add removes the record with a tombstone that syncs; Put back of that brings it back', () => {
    const s = money([tx({ id: 'a' })])
    const tr = CL.createTracker({ dev: 'web', now: () => T0 })
    tr.reset(s)
    s.tx.push(tx({ id: 'new', amount: 4200, base: 4200, updatedAt: T0 }))
    const [add] = tr.observe(s, 'local')
    const theirs = SPEC.share!(clone(s))
    CL.putBack(s, [add], T0 + 10)
    expect(s.tx.some((t: any) => t.id === 'new')).toBe(false)
    expect(s.deleted.new).toBe(T0 + 10)
    const [removed] = tr.observe(s, 'putback')
    expect(removed).toMatchObject({ act: 'putback', gone: true, rid: 'new' })
    expect(SPEC.merge(SPEC.fromShared!(clone(theirs)), SPEC.share!(clone(s)), false).tx.some((t: any) => t.id === 'new')).toBe(false)
    // Changed your mind: Put back the Put back.
    CL.putBack(s, [removed], T0 + 20)
    expect(s.tx.find((t: any) => t.id === 'new')?.amount).toBe(4200)
  })

  it('"Put back all" on a bulk change restores every record exactly; categories and budgets too', () => {
    const s = money([tx({ id: 'a', category: 'food' }), tx({ id: 'b', category: 'food' })])
    const food = s.settings.categories.find((c: any) => c.id === 'food')
    food.budget = 200000
    const tr = CL.createTracker({ dev: 'desktop', now: () => T0 })
    tr.reset(s)
    const before = clone(s.tx)
    for (const t of s.tx) { t.category = 'transport'; t.updatedAt = T0 }
    food.budget = 300000; food.updatedAt = T0
    const step = tr.observe(s, 'local')
    expect(step.map((e: any) => e.list).sort()).toEqual(['settings.categories', 'tx', 'tx'])
    CL.putBack(s, step, T0 + 5)
    const strip = (t: any) => { const { updatedAt, editedOn, ...rest } = t; return rest }
    expect(s.tx.map(strip)).toEqual(before.map(strip))
    expect(s.settings.categories.find((c: any) => c.id === 'food').budget).toBe(200000)
  })
})

describe('the stored log (this device)', () => {
  let saved: any = null
  const backend = { get: async () => saved, set: async (v: any) => { saved = v }, clear: async () => { saved = null } }
  beforeEach(() => { saved = null; Store._setBackend(backend) })

  it('survives a restart and merges with what another window stored', async () => {
    const s = money([tx({ id: 'a', amount: 100, base: 100 })])
    Store.reset(s)
    await Store.ensureLoaded()
    s.tx[0] = { ...s.tx[0], amount: 300, base: 300, updatedAt: Date.now() }
    expect(Store.track(s, 'local')).toHaveLength(1)
    await Store.flushChanges()
    expect(JSON.parse(saved)).toHaveLength(1)
    // Another window wrote an entry meanwhile.
    saved = JSON.stringify([...JSON.parse(saved), { id: 'ch-other', at: Date.now() - 5, dev: 'web', act: 'add', list: 'tx', rid: 'z', grp: 'g', after: { id: 'z' } }])
    // Restart: a fresh memory reads the stored copy back.
    Store._setBackend(backend)
    await Store.ensureLoaded()
    expect(Store.entries().map((e: any) => e.act).sort()).toEqual(['add', 'edit'])
  })

  it('the demo preview keeps nothing', async () => {
    Store._setBackend(backend, { demo: true })
    const s = money([tx({ id: 'a' })])
    Store.reset(s)
    s.tx.push(tx({ id: 'b' }))
    Store.track(s, 'local')
    await Store.flushChanges()
    expect(saved).toBeNull()
  })
})

describe('device label', () => {
  it('desktop, phone or web from the browser', () => {
    expect(CL.deviceLabel('Mozilla/5.0 (Windows NT 10.0) Electron/33.0 Chrome/130')).toBe('desktop')
    expect(CL.deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17) Mobile Safari')).toBe('phone')
    expect(CL.deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537')).toBe('web')
  })
})
