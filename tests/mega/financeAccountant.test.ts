// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeAccountant.test.ts) by scripts/port-mega-tests.mjs.
// Money v2 phase 3: the accountant export. One Excel file for one year, only
// tax-tagged records, each receipt a link to its file in Drive, and a Totals
// sheet that says it is not tax advice. Made-up data only.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS modules from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore
import { accountantColumns, accountantRows, accountantSheets, receiptLink, driveLink, NOT_ADVICE } from '../../js/accountant.js'
// @ts-ignore
import { workbook } from '../../js/xlsx.js'

let n = 0
const tx = (date: string, amount: number, extra: Record<string, unknown> = {}) => ({ id: `a${++n}`, type: 'expense', amount, date, category: 'food', account: 'wallet', note: '', currency: 'MDL', rate: 1, base: amount, createdAt: n, updatedAt: n, ...extra })

function fixture() {
  return M.normalizeState({
    tx: [
      tx('2026-01-05', 900000, { type: 'income', category: 'work', tax: 'taxable', note: 'Made-up client project', currency: 'USD', rate: 17.5, base: 15750000 }),
      tx('2026-02-01', 24500, { category: 'learning', tax: 'deductible', note: 'Printer paper', receipts: ['r-paper01', 'r-paper02'] }),
      tx('2026-02-02', 5000, { note: 'Lunch, not tagged' }),
      tx('2025-12-30', 1000, { tax: 'deductible' }),
    ],
    invoices: [{ id: 'inv1', number: 'INV-2026-001', date: '2026-01-01', paidTx: 'a1', items: [] }],
  })
}

describe('accountant export', () => {
  it('has the agreed columns, in your currency', () => {
    expect(accountantColumns('MDL')).toEqual(['Date', 'Book', 'Type', 'Amount', 'Currency', 'Rate', 'MDL', 'Category', 'Tax tag', 'Client/Person', 'Invoice', 'Note', 'Receipt link', 'More receipts'])
  })

  it('one row per tax-tagged record of the year; the MDL column is the record\'s own value', () => {
    const { header, body } = accountantRows(fixture(), 2026, {})
    expect(header).toHaveLength(14)
    expect(body).toHaveLength(2)
    const [first, second] = body.map((b: any) => b.cells)
    expect(first).toEqual(['2026-01-05', 'Personal', 'Income', 900000, 'USD', 17.5, 15750000, 'Work', 'Taxable income', '', 'INV-2026-001', 'Made-up client project'])
    expect(second.slice(0, 9)).toEqual(['2026-02-01', 'Personal', 'Cost', 24500, 'MDL', 1, 24500, 'Learning & tools', 'Deductible cost'])
  })

  it('a receipt in Drive is a link; one still on the device says so', () => {
    const ix = { 'r-paper01': { name: 'paper.jpg', driveId: 'drv_1' }, 'r-paper02': { name: 'paper2.pdf' } }
    expect(receiptLink(ix, 'r-paper01')).toEqual({ url: 'https://drive.google.com/file/d/drv_1/view', name: 'paper.jpg' })
    expect(receiptLink(ix, 'r-paper02').text).toMatch(/not in Google Drive yet/)
    expect(driveLink('a b')).toBe('https://drive.google.com/file/d/a%20b/view')
    const sheets = accountantSheets(fixture(), 2026, ix)
    const row = sheets[0].rows[2]
    expect(row[12]).toEqual({ f: 'HYPERLINK("https://drive.google.com/file/d/drv_1/view","paper.jpg")' })
    expect(row[13]).toMatch(/not in Google Drive yet/)
    // Money cells are numbers in units, dates are dates.
    expect(row[0]).toEqual({ v: '2026-02-01', t: 'date' })
    expect(row[3]).toEqual({ v: 245, t: 'money' })
  })

  it('a Totals sheet with the disclaimer, totals per tag, per book and per month', () => {
    const sheets = accountantSheets(fixture(), 2026, {})
    expect(sheets.map((s: any) => s.name)).toEqual(['Entries', 'Totals'])
    const text = JSON.stringify(sheets[1].rows)
    expect(text).toContain(NOT_ADVICE)
    expect(text).toContain('Individual entrepreneur')
    const find = (label: string) => sheets[1].rows.find((r: any[]) => r[0] === label || r[0]?.v === label)
    expect(find('Taxable income')[2]).toEqual({ v: 157500, t: 'money' })
    expect(find('Deductible costs')[2]).toEqual({ v: 245, t: 'money' })
    expect(find('January 2026')[1]).toEqual({ v: 157500, t: 'money' })
    expect(find('Personal')[1]).toEqual({ v: 157500, t: 'money' })
    expect(sheets[0].filterRows).toBe(2)
  })

  it('builds a real xlsx (a zip) with the link formula inside', () => {
    const bytes: Uint8Array = workbook(accountantSheets(fixture(), 2026, { 'r-paper01': { name: 'p.jpg', driveId: 'drv_9' } }))
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK')
    expect(new TextDecoder().decode(bytes)).toContain('HYPERLINK(&quot;https://drive.google.com/file/d/drv_9/view&quot;')
  })
})
