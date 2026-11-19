// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeLearn.test.ts) by scripts/port-mega-tests.mjs.
// Money phase 5, learned category rules (js/learn.js), on made-up data:
// merchant names, confidence levels, what counts as evidence, rules as a
// merged list with tombstones, and the new fields surviving today's v3 sync.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS modules from the embedded app
import { merchantOf, choiceTable, merchantChoice, suggest, canAutoFile, isEvidence, addRule2, removeRule2, mergeRules, rulesView } from '../../js/learn.js'
// @ts-ignore
import { normalizeState, suggestCategory, addRule, removeRule, keptOnEdit } from '../../js/model.js'
// @ts-ignore
import { mergeStates, toCloud } from '../../js/sync.js'

const NOW = Date.parse('2026-11-12T12:00:00Z')
let n = 0
const tx = (note: string, category: string, extra: Record<string, unknown> = {}) => ({
  id: `t${++n}`,
  type: 'expense',
  amount: 4500,
  currency: 'MDL',
  rate: 1,
  base: 4500,
  date: '2026-11-01',
  category,
  account: 'wallet',
  note,
  createdAt: NOW - 86400_000,
  updatedAt: NOW - 86400_000,
  ...extra
})
const state = (list: any[], settings: Record<string, unknown> = {}) => normalizeState({ settings: { currency: 'MDL', updatedAt: 1, ...settings }, tx: list, people: [], deleted: {} })

describe('merchant names', () => {
  it('drops case, punctuation, branch numbers, bank words and legal forms', () => {
    expect(merchantOf('LINELLA 23')).toBe('linella')
    expect(merchantOf('Plata la LINELLA SRL #4411')).toBe('linella')
    expect(merchantOf('linella-23, str. Ismail')).toBe('linella')
    expect(merchantOf('Linella')).toBe('linella')
    expect(merchantOf('MAIB*UBER TRIP 12/11')).toBe('uber trip')
    expect(merchantOf('Uber Eats')).toBe('uber eats')
    expect(merchantOf('Cafénea 7')).toBe('cafenea')
    expect(merchantOf('POS 4411 MD')).toBe('')
    expect(merchantOf('')).toBe('')
  })
})

describe('confidence from your own records', () => {
  it('3 of 3 is sure, 3 of 5 is maybe, 1 of 1 is only maybe', () => {
    const s3 = state([tx('Linella 1', 'food'), tx('LINELLA 23', 'food'), tx('linella srl', 'food')])
    expect(merchantChoice(s3, 'Linella 99', 'expense', NOW)).toMatchObject({ category: 'food', level: 'sure', n: 3, confidence: 1 })
    const s5 = state([tx('Linella', 'food'), tx('Linella', 'food'), tx('Linella', 'food'), tx('Linella', 'fun'), tx('Linella', 'gifts')])
    expect(merchantChoice(s5, 'linella', 'expense', NOW)).toMatchObject({ category: 'food', level: 'maybe', confidence: 0.6 })
    expect(merchantChoice(state([tx('Linella', 'food')]), 'linella', 'expense', NOW)).toMatchObject({ level: 'maybe', n: 1 })
  })

  it('recent choices outweigh old ones (half-life)', () => {
    const s = state([tx('Kiosk', 'fun', { date: '2024-01-05' }), tx('Kiosk', 'fun', { date: '2024-02-05' }), tx('Kiosk', 'food', { date: '2026-11-01' })])
    expect(merchantChoice(s, 'kiosk', 'expense', NOW).category).toBe('food')
  })

  it('auto-filed guesses and unconfirmed captures are not evidence', () => {
    expect(isEvidence(tx('Glovo', 'food', { catBy: 'auto' }))).toBe(false)
    expect(isEvidence(tx('Glovo', 'food', { source: 'capture' }))).toBe(false)
    expect(isEvidence(tx('Glovo', 'food', { source: 'capture', confirmedAt: NOW }))).toBe(true)
    expect(isEvidence(tx('Glovo', 'other'))).toBe(false)
    const s = state([tx('Glovo', 'food', { catBy: 'auto' }), tx('Glovo', 'food', { catBy: 'auto' }), tx('Glovo', 'food', { catBy: 'auto' })])
    expect(merchantChoice(s, 'glovo', 'expense', NOW)).toBeNull()
  })

  it('learns the book per merchant (tx.book, missing = personal)', () => {
    const s = state([tx('Figma', 'subscriptions', { book: 'business' }), tx('Figma', 'subscriptions', { book: 'business' }), tx('Figma', 'subscriptions', { book: 'business' })])
    expect(merchantChoice(s, 'FIGMA 15', 'expense', NOW)).toMatchObject({ book: 'business', level: 'sure' })
    expect(merchantChoice(state([tx('Kiosk', 'food'), tx('Kiosk', 'food'), tx('Kiosk', 'food')]), 'kiosk', 'expense', NOW).book).toBe('personal')
  })

  it('the table is cached until the records change', () => {
    const s = state([tx('Linella', 'food')])
    const a = choiceTable(s, NOW)
    expect(choiceTable(s, NOW)).toBe(a)
    s.tx.push(tx('Linella', 'food', { updatedAt: NOW }))
    expect(choiceTable(s, NOW)).not.toBe(a)
  })
})

describe('suggest: rule beats merchant beats words', () => {
  it('a rule is sure and wins over what the records say', () => {
    const s = state([tx('Linella', 'food'), tx('Linella', 'food'), tx('Linella', 'food')])
    addRule2(s, { match: 'linella', type: 'expense', category: 'fun' }, NOW)
    expect(suggest(s, { note: 'LINELLA 5', type: 'expense' }, { now: NOW })).toMatchObject({ category: 'fun', level: 'sure', why: 'rule' })
  })

  it('auto vs suggest: only sure may file without a tap; chips are the 3 best', () => {
    const sure = suggest(state([tx('Linella', 'food'), tx('Linella', 'food'), tx('Linella', 'food')]), { note: 'linella 2', type: 'expense' }, { now: NOW })
    expect(canAutoFile(sure)).toBe(true)
    const maybe = suggest(state([tx('Linella', 'food'), tx('Linella', 'food'), tx('Linella', 'fun')]), { note: 'linella', type: 'expense' }, { now: NOW })
    expect(maybe.level).toBe('maybe')
    expect(canAutoFile(maybe)).toBe(false)
    expect(maybe.alternatives.slice(0, 2)).toEqual(['food', 'fun'])
    const none = suggest(state([tx('Linella', 'food'), tx('Bus', 'transport')]), { note: 'Unknown shop', type: 'expense' }, { guess: 'gifts', now: NOW })
    expect(none).toMatchObject({ level: 'guess', why: 'keyword', category: 'gifts' })
    expect(none.alternatives.length).toBe(3)
    expect(canAutoFile(none)).toBe(false)
  })

  it('suggestCategory (imports, quick add) takes a sure merchant, even with a branch number', () => {
    const s = state([tx('Linella 1', 'fun'), tx('Linella 2', 'fun'), tx('Linella 3', 'fun')])
    // "linella" is a food keyword; three records filed as Fun win.
    expect(suggestCategory(s, 'LINELLA 23', 'expense')).toBe('fun')
    // Only maybe: the old order is kept (keywords).
    expect(suggestCategory(state([tx('Linella 1', 'fun')]), 'LINELLA 23', 'expense')).toBe('food')
  })
})

describe('rules: a merged list with tombstones', () => {
  it("Finance's addRule keeps one rule per text and type (same id), removeRule leaves a tombstone", () => {
    const s = state([])
    const a = addRule(s, { match: 'Bolt', type: 'expense', category: 'transport' }, 100)
    const b = addRule(s, { match: 'bolt', type: 'expense', category: 'fun' }, 200)
    expect(b.id).toBe(a.id)
    expect(s.settings.rules).toHaveLength(1)
    expect(s.settings.rules[0]).toMatchObject({ category: 'fun', updatedAt: 200 })
    removeRule(s, a.id, 300)
    expect(s.settings.rules).toHaveLength(0)
    expect(s.deleted[a.id]).toBe(300)
  })

  it('two devices each add a rule: both are kept', () => {
    const a = state([], { updatedAt: 10 })
    const b = state([], { updatedAt: 20 })
    addRule2(a, { match: 'linella', type: 'expense', category: 'food' }, 10)
    addRule2(b, { match: 'bolt', type: 'expense', category: 'transport' }, 20)
    const m = mergeStates(a, toCloud(b, '')).state
    expect(m.settings.rules.map((r: any) => r.match).sort()).toEqual(['bolt', 'linella'])
  })

  it('old client stale rules list cannot bring a deleted rule back, and a new rule it never saw stays', () => {
    const mine = state([], { updatedAt: 50 })
    const gone = addRule2(mine, { match: 'kiosk', type: 'expense', category: 'fun' }, 40)
    // An older device saw "kiosk" only, then saved other settings later (newer settings, old rules list).
    const old = JSON.parse(JSON.stringify(mine))
    old.settings.rules = [{ id: gone.id, match: 'kiosk', type: 'expense', category: 'fun', createdAt: 40 }]
    old.settings.limit = { on: true, amount: 300000 }
    old.settings.updatedAt = 900
    removeRule2(mine, gone.id, 60)
    addRule2(mine, { match: 'linella', type: 'expense', category: 'food' }, 70)
    const m = mergeStates(mine, toCloud(old, '')).state
    expect(m.settings.rules.map((r: any) => r.match)).toEqual(['linella'])
    expect(m.settings.limit).toEqual({ on: true, amount: 300000 })
    // And the other way round (the old copy merging the new one).
    const back = mergeStates(normalizeState(toCloud(old, '').data), toCloud(mine, '')).state
    expect(back.settings.rules.map((r: any) => r.match)).toEqual(['linella'])
  })

  it('a copy with no rules at all stays the same (no endless re-sync)', () => {
    const a = state([tx('Linella', 'food')])
    const r = mergeStates(a, toCloud(a, ''))
    expect(r.pullChanged).toBe(false)
    expect(r.pushNeeded).toBe(false)
  })

  it('mergeRules: the newer rule wins, a rule without updatedAt is as old as its settings', () => {
    const out = mergeRules([{ id: 'r1', match: 'bolt', type: 'expense', category: 'fun' }], [{ id: 'r1', match: 'bolt', type: 'expense', category: 'transport', updatedAt: 5 }], {}, 9, 0)
    expect(out).toEqual([{ id: 'r1', match: 'bolt', type: 'expense', category: 'fun', updatedAt: 9 }])
  })

  it('the Rules screen lists your rules and what was learned (2+ records), with how sure', () => {
    const s = state([tx('Linella', 'food'), tx('Linella 4', 'food'), tx('Bus', 'transport'), tx('Glovo', 'food'), tx('Glovo', 'food')])
    addRule2(s, { match: 'glovo', type: 'expense', category: 'food', learned: true }, NOW)
    const v = rulesView(s, NOW)
    expect(v.rules).toMatchObject([{ match: 'glovo', learned: true }])
    expect(v.learned).toMatchObject([{ merchant: 'linella', category: 'food', n: 2, level: 'maybe', confidence: 1 }])
  })
})

describe("phase 5 fields survive today's v3 sync", () => {
  it('catBy, confirmedAt, source, book, rule fields and tombstones round-trip without loss', () => {
    const a = state([
      tx('Glovo', 'food', { id: 'cap-1', source: 'capture', catBy: 'you', confirmedAt: NOW, book: 'business' }),
      tx('Bolt', 'transport', { id: 'cap-2', source: 'capture', catBy: 'auto' }),
      tx('Rent', 'home', { id: 'rec-r1-2026-11-03', source: 'auto', catBy: 'rule', confirmedAt: NOW, recurring: 'r1' })
    ], { updatedAt: 100 })
    const kept = addRule2(a, { match: 'glovo', type: 'expense', category: 'food', book: 'business', learned: true }, 100)
    const dropped = addRule2(a, { match: 'kiosk', type: 'expense', category: 'fun' }, 100)
    removeRule2(a, dropped.id, 110)
    // The other device: today's code loads the shared copy, edits another record and a setting, saves.
    const b = normalizeState(JSON.parse(JSON.stringify(toCloud(a, '').data)))
    b.tx.push(tx('Bus', 'transport', { id: 'other', updatedAt: NOW + 5 }))
    b.settings.limit = { on: true, amount: 100000 }
    b.settings.updatedAt = 200
    const shared = JSON.parse(JSON.stringify(toCloud(b, '')))
    for (const merged of [mergeStates(a, shared).state, mergeStates(b, toCloud(a, '')).state]) {
      const by = Object.fromEntries(merged.tx.map((t: any) => [t.id, t]))
      expect(by['cap-1']).toMatchObject({ source: 'capture', catBy: 'you', confirmedAt: NOW, book: 'business' })
      expect(by['cap-2']).toMatchObject({ source: 'capture', catBy: 'auto' })
      expect(by['cap-2'].confirmedAt).toBeUndefined()
      expect(by['rec-r1-2026-11-03']).toMatchObject({ source: 'auto', catBy: 'rule', confirmedAt: NOW })
      expect(by.other).toBeTruthy()
      expect(merged.settings.rules).toEqual([expect.objectContaining({ id: kept.id, match: 'glovo', book: 'business', learned: true, updatedAt: 100 })])
      expect(merged.deleted[dropped.id]).toBe(110)
      expect(merged.settings.limit).toEqual({ on: true, amount: 100000 })
      // No new top-level keys in the blob.
      expect(Object.keys(toCloud(merged, '').data).sort()).toEqual(Object.keys(toCloud(a, '').data).sort())
    }
  })
})

describe('editing a record in Finance keeps what the form does not show', () => {
  it('source, confirmedAt, book, reconcile and unknown fields stay; a field the form clears stays cleared', () => {
    const before = { ...tx('Glovo', 'food', { id: 'cap-1', source: 'capture', confirmedAt: NOW, catBy: 'you', book: 'business', future: { a: 1 }, sub: 'food-delivery', person: 'p1' }) }
    // The sheet rebuilds the record from its fields (no sub, no person this time).
    const fromForm = { id: 'cap-1', createdAt: before.createdAt, updatedAt: NOW + 5, type: 'expense', amount: 5000, currency: 'MDL', date: before.date, note: 'Glovo', account: 'wallet', category: 'food', rate: 1, base: 5000 }
    const out = keptOnEdit(before, fromForm)
    expect(out).toMatchObject({ amount: 5000, source: 'capture', confirmedAt: NOW, catBy: 'you', book: 'business', future: { a: 1 }, updatedAt: NOW + 5 })
    expect(out.sub).toBeUndefined()
    expect(out.person).toBeUndefined()
  })
  it('a new category, or editing one filed by itself, makes it your choice', () => {
    const auto = tx('Bolt', 'transport', { id: 'cap-2', source: 'capture', catBy: 'auto' })
    expect(keptOnEdit(auto, { ...auto, category: 'transport', updatedAt: NOW }).catBy).toBe('you')
    expect(keptOnEdit(tx('Bus', 'transport'), { ...tx('Bus', 'fun') }).catBy).toBe('you')
    expect(keptOnEdit(tx('Bus', 'transport'), { ...tx('Bus', 'transport') }).catBy).toBeUndefined()
  })
})

