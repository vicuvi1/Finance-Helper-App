// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeFields.test.ts) by scripts/port-mega-tests.mjs.
// Your own fields (#1): definitions in a settings key, values in `fields` on a
// record; types, search, export and import. Made-up data only.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS modules from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore
import * as F from '../../js/fields.js'
// @ts-ignore
import { searchTx } from '../../js/search.js'
// @ts-ignore
import { txRows, previewImport, csvText, TX_HEADER } from '../../js/moneyexport.js'
// @ts-ignore
import { parseCSV } from '../../js/csv.js'
// @ts-ignore
import { mergeStates, toCloud } from '../../js/sync.js'

let n = 0
const tx = (over: any = {}) => {
  const amount = over.amount ?? 100000
  return { id: `f${++n}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date: '2026-11-05', account: 'card', category: 'food', note: '', createdAt: n, updatedAt: n, ...over }
}
const money = (list: any[] = []) => M.normalizeState({
  settings: { currency: 'MDL', accounts: [{ id: 'card', name: 'Card', kind: 'card', currency: 'MDL', start: 0 }, { id: 'safe', name: 'Safe', kind: 'savings', currency: 'MDL', start: 0 }] },
  tx: list
})
const NOW = 1_800_000_000_000
const withFields = () => {
  const s = money([tx({ id: 'a', note: 'Logo' }), tx({ id: 'b', note: 'Hosting' }), tx({ id: 'c', type: 'income', category: 'work', note: 'Invoice 7' })])
  const project = F.addField(s, { name: 'Project', type: 'pick', options: 'Website, App', kinds: ['expense', 'income'], def: 'website' }, NOW).def
  const receipt = F.addField(s, { name: 'Receipt no.', type: 'text', kinds: ['expense'] }, NOW).def
  const hours = F.addField(s, { name: 'Hours', type: 'number', kinds: ['income'] }, NOW).def
  const paid = F.addField(s, { name: 'Paid', type: 'bool', kinds: ['expense', 'income', 'transfer'] }, NOW).def
  const due = F.addField(s, { name: 'Due', type: 'date', kinds: ['income'] }, NOW).def
  return { s, project, receipt, hours, paid, due }
}

describe('definitions', () => {
  it('adds fields to the settings key and stamps the settings', () => {
    const { s, project } = withFields()
    expect(project).toMatchObject({ id: 'f-project', name: 'Project', type: 'pick', options: ['Website', 'App'], kinds: ['expense', 'income'], def: 'Website' })
    expect(s.settings.customFields).toHaveLength(5)
    expect(s.settings.updatedAt).toBe(NOW)
  })

  it('checks names, types, options, kinds and defaults', () => {
    const { s } = withFields()
    expect(F.addField(s, { name: '', type: 'text', kinds: ['expense'] }).error).toBe('Give the field a name')
    expect(F.addField(s, { name: 'project', type: 'text', kinds: ['expense'] }).error).toBe('You already have a field with this name')
    expect(F.addField(s, { name: 'Client', type: 'pick', options: '', kinds: ['expense'] }).error).toBe('Add at least one option')
    expect(F.addField(s, { name: 'Client', type: 'text', kinds: [] }).error).toBe('Tick at least one kind of record')
    expect(F.addField(s, { name: 'Count', type: 'number', kinds: ['expense'], def: 'abc' }).error).toBe('The default does not fit the type')
    expect(F.addField(s, { name: 'Client', type: 'color', kinds: ['expense'] }).error).toBe('Pick a type')
  })

  it('which fields a kind shows, defaults for a new record', () => {
    const { s } = withFields()
    expect(F.defsFor(s, 'expense').map((d: any) => d.name)).toEqual(['Project', 'Receipt no.', 'Paid'])
    expect(F.defsFor(s, 'transfer').map((d: any) => d.name)).toEqual(['Paid'])
    expect(F.defaultsFor(s, 'expense')).toEqual({ 'f-project': 'Website' })
  })

  it('archiving keeps the values on records; editing keeps the id', () => {
    const { s, project } = withFields()
    const t = s.tx[0]
    F.setValue(t, project.id, 'App')
    F.archiveField(s, project.id)
    expect(F.defsFor(s, 'expense').some((d: any) => d.id === project.id)).toBe(false)
    expect(t.fields[project.id]).toBe('App')
    F.archiveField(s, project.id, false)
    const r = F.updateField(s, project.id, { name: 'Project', type: 'pick', options: ['Website', 'App', 'Shop'], kinds: ['expense'] })
    expect(r.def.id).toBe(project.id)
    expect(r.def.options).toEqual(['Website', 'App', 'Shop'])
    expect(r.def.def).toBeUndefined()
  })
})

describe('types', () => {
  it('coerce each type', () => {
    const { project, receipt, hours, paid, due } = withFields()
    expect(F.coerce(project, 'app')).toEqual({ ok: true, value: 'App' })
    expect(F.coerce(project, 'Shop').ok).toBe(false)
    expect(F.coerce(receipt, '  A-12 ')).toEqual({ ok: true, value: 'A-12' })
    expect(F.coerce(hours, '1 234,5')).toEqual({ ok: true, value: 1234.5 })
    expect(F.coerce(hours, 'many').ok).toBe(false)
    expect(F.coerce(paid, 'Yes')).toEqual({ ok: true, value: true })
    expect(F.coerce(paid, 'nu')).toEqual({ ok: true, value: false })
    expect(F.coerce(due, '2026-12-01')).toEqual({ ok: true, value: '2026-12-01' })
    expect(F.coerce(due, '1 Dec').ok).toBe(false)
    expect(F.coerce(receipt, '')).toEqual({ ok: true, value: undefined })
  })

  it('setValue adds and removes; an empty map goes away', () => {
    const t: any = tx()
    expect(F.setValue(t, 'f-x', 'A')).toBe(true)
    expect(t.fields).toEqual({ 'f-x': 'A' })
    expect(F.setValue(t, 'f-x', 'A')).toBe(false)
    F.setValue(t, 'f-x', undefined)
    expect('fields' in t).toBe(false)
  })
})

describe('search', () => {
  it('"project:website" and friends filter the Log', () => {
    const { s, project, receipt, hours, paid } = withFields()
    F.setValue(s.tx[0], project.id, 'Website')
    F.setValue(s.tx[1], project.id, 'App')
    F.setValue(s.tx[1], receipt.id, 'R-77')
    F.setValue(s.tx[2], hours.id, 12)
    F.setValue(s.tx[2], paid.id, true)
    const ids = (q: string) => searchTx(s, q, '2026-11-16').map((t: any) => t.id)
    expect(ids('project:website')).toEqual(['a'])
    expect(ids('project:app hosting')).toEqual(['b'])
    expect(ids('receiptno:r-77')).toEqual(['b'])
    expect(ids('receipt:r-77')).toEqual(['b'])
    expect(ids('hours:>10')).toEqual(['c'])
    expect(ids('hours:<10')).toEqual([])
    expect(ids('paid:yes')).toEqual(['c'])
    expect(ids('paid:no')).toEqual(['a', 'b'])
    expect(ids('project:none')).toEqual(['c'])
    // Not a field: a plain word, as before.
    expect(ids('nosuch:thing')).toEqual([])
  })
})

describe('export and import', () => {
  it('a "Field: X" column per field; the round trip loses nothing', () => {
    const { s, project, hours, paid } = withFields()
    F.setValue(s.tx[0], project.id, 'Website')
    F.setValue(s.tx[2], hours.id, 7.5)
    F.setValue(s.tx[2], paid.id, false)
    const rows = txRows(s)
    expect(rows[0].slice(0, TX_HEADER.length)).toEqual(TX_HEADER)
    expect(rows[0].slice(TX_HEADER.length)).toEqual(['Field: Project', 'Field: Receipt no.', 'Field: Hours', 'Field: Paid', 'Field: Due'])
    const a = rows.find((r: any[]) => r[0] === 'a')!
    expect(a[TX_HEADER.length]).toBe('Website')
    const c = rows.find((r: any[]) => r[0] === 'c')!
    expect(c[TX_HEADER.length + 2]).toBe('7.5')
    expect(c[TX_HEADER.length + 3]).toBe('no')
    // Through CSV text and back into an empty copy that has the same fields.
    const back = parseCSV(csvText(rows))
    const empty = money([])
    empty.settings.customFields = s.settings.customFields
    const p = previewImport(back, empty)
    expect(p.add.map((t: any) => t.fields || null)).toEqual(s.tx.map((t: any) => t.fields || null))
  })

  it('a value edited in the spreadsheet column wins; one that does not fit stays as it was', () => {
    const { s, project } = withFields()
    F.setValue(s.tx[0], project.id, 'Website')
    const rows = txRows(s)
    const col = rows[0].indexOf('Field: Project')
    rows.find((r: any[]) => r[0] === 'a')![col] = 'app'
    rows.find((r: any[]) => r[0] === 'b')![col] = 'Not an option'
    const empty = money([])
    empty.settings.customFields = s.settings.customFields
    const p = previewImport(rows, empty)
    expect(p.add.find((t: any) => t.id === 'a').fields[project.id]).toBe('App')
    expect(p.add.find((t: any) => t.id === 'b').fields).toBeUndefined()
  })

  it('without fields the export is exactly as before', () => {
    const s = money([tx({ id: 'z' })])
    expect(txRows(s)[0]).toEqual(TX_HEADER)
  })
})

describe('sync', () => {
  it('definitions travel as a settings key (newer settings win); values travel on the record', () => {
    const { s, project } = withFields()
    F.setValue(s.tx[0], project.id, 'App')
    s.tx[0].updatedAt = NOW
    const local = money([tx({ id: 'a', note: 'Logo', updatedAt: 1 })])
    const merged = mergeStates(local, toCloud(s, 'dev2')).state
    expect(merged.settings.customFields.map((d: any) => d.name)).toEqual(['Project', 'Receipt no.', 'Hours', 'Paid', 'Due'])
    expect(merged.tx.find((t: any) => t.id === 'a').fields).toEqual({ [project.id]: 'App' })
  })
})
