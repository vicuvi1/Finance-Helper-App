// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeArchive.test.ts) by scripts/port-mega-tests.mjs.
// Finance Helper: archive old years (js/archive.js). Made-up data only.
// Archiving 2024 must keep every balance and the 2024 year summary identical,
// Unarchive must put the same records back, and two devices must agree.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS module
import { archiveBefore, unarchiveAll, withArchive, archivedTx, archiveInfo, archiveChoices, settleArchive } from '../../js/archive.js'
// @ts-ignore plain JS module
import { normalizeState, accountBalances, totalBalance, netWorthSeries, rebuiltTotal, yearOverview, report } from '../../js/model.js'
// @ts-ignore plain JS module
import { mergeStates, toCloud } from '../../js/sync.js'
// @ts-ignore plain JS module
import { yearReview, taxSummary } from '../../js/yearreview.js'

let n = 0
const rec = (over: any = {}) => ({ id: `t${++n}`, type: 'expense', amount: 5000, currency: 'MDL', rate: 1, base: 5000, date: '2025-03-01', category: 'food', account: 'wallet', createdAt: 1, updatedAt: 1, ...over })

function sample() {
  return normalizeState({
    version: 3,
    settings: { currency: 'MDL', updatedAt: 1, accounts: [{ id: 'wallet', name: 'Wallet', kind: 'cash', start: 100000 }, { id: 'card', name: 'Card', kind: 'card', start: 5000 }] },
    tx: [
      rec({ date: '2023-12-20', amount: 700 }),
      rec({ date: '2024-01-05', type: 'income', category: 'work', amount: 900000, base: 900000, account: 'card' }),
      rec({ date: '2024-02-10', amount: 12345, base: 12345 }),
      rec({ date: '2024-06-30', type: 'transfer', from: 'card', to: 'wallet', amount: 300000, base: 300000, category: undefined }),
      rec({ date: '2024-11-11', amount: 4000, base: 4000, account: 'card' }),
      rec({ date: '2025-01-02', type: 'income', category: 'work', amount: 800000, base: 800000, account: 'card' }),
      rec({ date: '2025-02-02', amount: 25000, base: 25000 })
    ],
    people: [],
    deleted: {},
    meta: {}
  })
}
const clone = (s: any) => JSON.parse(JSON.stringify(s))

describe('archive old years', () => {
  it('keeps every balance, today and on past days, and the year summary', () => {
    const s = sample()
    const before = { bal: accountBalances(s), total: totalBalance(s).total, past: accountBalances(s, '2024-07-01'), y24: yearReview(s, 2024, '2026-01-01'), ov: yearOverview(s, 2024), series: netWorthSeries(s, '2026-01-15', 24), rep: report(s, '2024-01-01', '2024-12-31'), tax: taxSummary(s, 2024), reb: rebuiltTotal(s, '2024-12-31') }
    const moved = archiveBefore(s, 2025, 1000)
    expect(moved).toBe(5)
    expect(s.tx).toHaveLength(2)
    expect(accountBalances(s)).toEqual(before.bal)
    expect(totalBalance(s).total).toBe(before.total)
    expect(accountBalances(s, '2024-07-01')).toEqual(before.past)
    expect(rebuiltTotal(s, '2024-12-31')).toBe(before.reb)
    const all = withArchive(s)
    expect(yearReview(all, 2024, '2026-01-01')).toEqual(before.y24)
    expect(yearOverview(all, 2024)).toEqual(before.ov)
    expect(report(all, '2024-01-01', '2024-12-31')).toEqual(before.rep)
    expect(taxSummary(all, 2024)).toEqual(before.tax)
    expect(netWorthSeries(s, '2026-01-15', 24)).toEqual(before.series)
  })

  it('unarchive restores the same records and balances', () => {
    const s = sample()
    const original = clone(s.tx).sort((a: any, b: any) => a.id.localeCompare(b.id))
    const bal = accountBalances(s)
    archiveBefore(s, 2025, 1000)
    expect(archiveInfo(s)).toMatchObject({ archived: true, count: 5 })
    expect(unarchiveAll(s, 2000)).toBe(5)
    expect(clone(s.tx).sort((a: any, b: any) => a.id.localeCompare(b.id))).toEqual(original)
    expect(accountBalances(s)).toEqual(bal)
    expect(archiveInfo(s).archived).toBe(false)
    expect(archivedTx(s)).toEqual([])
  })

  it('archiving twice with a later year adds to it; an earlier year is refused', () => {
    const s = sample()
    archiveBefore(s, 2024, 1)
    expect(archiveInfo(s).count).toBe(1)
    expect(archiveBefore(s, 2025, 2)).toBe(4)
    expect(archiveBefore(s, 2024, 3)).toBe(0)
    expect(archiveInfo(s).years.map((y: any) => y.year)).toEqual([2023, 2024])
  })

  it('leaves records that a goal allocation points at, so balances still add up', () => {
    const s = sample()
    const keep = s.tx[1]
    s.goalAllocations = [{ id: 'a1', goalId: 'g', incomeId: keep.id, amount: 1, updatedAt: 1 }]
    const bal = accountBalances(s)
    archiveBefore(s, 2025, 1)
    expect(s.tx.some((t: any) => t.id === keep.id)).toBe(true)
    expect(accountBalances(s)).toEqual(bal)
  })

  it('offers years from the second oldest up to this year', () => {
    expect(archiveChoices(sample(), '2026-05-01')).toEqual([2026, 2025, 2024])
  })

  it('does nothing without records to move', () => {
    const s = sample()
    expect(archiveBefore(s, 2023, 1)).toBe(0)
    expect(s.settings.archive).toBeUndefined()
  })
})

describe('archive and sync', () => {
  const remoteOf = (s: any) => toCloud(s, 'dev')

  it('travels in the settings of the shared copy and survives a normalize (the bots)', () => {
    const s = sample()
    archiveBefore(s, 2025, 1000)
    const cloud = remoteOf(s)
    expect(Object.keys(cloud.data)).not.toContain('archive')
    expect(cloud.data.settings.archive.years['2024']).toHaveLength(4)
    const again = normalizeState({ ...cloud.data, version: 3 })
    expect(archivedTx(again)).toHaveLength(5)
    expect(accountBalances(again)).toEqual(accountBalances(s))
  })

  it('a device that never archived takes the archive and ends with the same balances', () => {
    const a = sample()
    const b = clone(a)
    const bal = accountBalances(a)
    archiveBefore(a, 2025, 5000)
    const merged = mergeStates(b, remoteOf(a)).state
    expect(merged.tx).toHaveLength(2)
    expect(archivedTx(merged)).toHaveLength(5)
    expect(accountBalances(merged)).toEqual(bal)
  })

  it('the other device still holding old records does not undo the archive, and nothing is lost', () => {
    const a = sample()
    const b = clone(a)
    const bal = accountBalances(a)
    archiveBefore(a, 2025, 5000)
    // b has not synced: it still has every record, and logs an old one late.
    const late = rec({ date: '2024-09-09', amount: 1000, base: 1000 })
    b.tx.push(late)
    const bAfter = mergeStates(b, remoteOf(a)).state
    const aAfter = mergeStates(a, remoteOf(bAfter)).state
    for (const s of [aAfter, bAfter]) {
      expect(s.tx.every((t: any) => t.date >= '2025-01-01')).toBe(true)
      expect(archivedTx(s)).toHaveLength(6)
    }
    expect(accountBalances(aAfter)).toEqual(accountBalances(bAfter))
    // The late record is one more expense of 10 on the wallet.
    expect(accountBalances(aAfter).wallet).toBe(bal.wallet - 1000)
  })

  it('unarchive on one device is not archived again by the other', () => {
    const a = sample()
    archiveBefore(a, 2025, 1000)
    const b = clone(a)
    unarchiveAll(a, 9000)
    const bAfter = mergeStates(b, remoteOf(a)).state
    expect(bAfter.tx).toHaveLength(7)
    expect(archiveInfo(bAfter).archived).toBe(false)
    const aAfter = mergeStates(a, remoteOf(bAfter)).state
    expect(aAfter.tx).toHaveLength(7)
  })

  it('a record deleted elsewhere stays deleted when it was waiting on the other side', () => {
    const a = sample()
    const gone = a.tx[2].id
    archiveBefore(a, 2025, 1000)
    const out = settleArchive([], a, { settings: {} }, { [gone]: 99 })
    expect(out.archive.years['2024'].some((t: any) => t.id === gone)).toBe(false)
  })

  it('with no archive on either side nothing changes', () => {
    const a = sample()
    const b = clone(a)
    const m = mergeStates(a, remoteOf(b)).state
    expect(m.tx).toHaveLength(7)
    expect(m.settings.archive).toBeUndefined()
  })
})
