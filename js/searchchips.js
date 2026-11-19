// Log search: the filters of a query as chips you can remove one by one.
// Pure: splits the text into terms (a phrase like "over 500" or "from 1 oct
// to 15 oct" is one term), labels each, and rebuilds the text without one.

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const MON = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const PHRASE = [
  `from\\s+\\d{1,2}\\s+${MON}(?:\\s+\\d{4})?\\s+(?:to|until|-)\\s+\\d{1,2}\\s+${MON}(?:\\s+\\d{4})?`,
  '(?:over|above|more\\s+than|under|below|less\\s+than)\\s+\\d[\\d.,]*',
  '(?:this|last|current)\\s+(?:month|year|week)',
  '[<>]=?\\s+\\d[\\d.,]*',
  '(?:source|src):"[^"]+"',
  '(?:source|src):\\S+(?:\\s+\\d{1,2}(?!\\S))?',
].join('|');
const TERM_RE = new RegExp(`(?:${PHRASE})|\\S+`, 'gi');

const cap = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());

/** The terms of a query, in order: { raw, label }. */
export function queryTerms(query, state = null) {
  const out = [];
  for (const m of String(query || '').matchAll(TERM_RE)) {
    const raw = m[0];
    const t = fold(raw).replace(/\s+/g, ' ');
    let label;
    let k;
    if (/^from \d/.test(t)) label = cap(raw.replace(/\s+/g, ' '));
    else if ((k = t.match(/^(over|above|more than) (.+)$/))) label = `Over ${k[2]}`;
    else if ((k = t.match(/^(under|below|less than) (.+)$/))) label = `Under ${k[2]}`;
    else if ((k = t.match(/^>=\s*(.+)$/))) label = `At least ${k[1]}`;
    else if ((k = t.match(/^<=\s*(.+)$/))) label = `At most ${k[1]}`;
    else if ((k = t.match(/^>\s*(.+)$/))) label = `Over ${k[1]}`;
    else if ((k = t.match(/^<\s*(.+)$/))) label = `Under ${k[1]}`;
    else if (/^(this|last|current) (month|year|week)$/.test(t)) label = cap(t);
    else if (/^\d+(?:[.,]\d+)?-\d+(?:[.,]\d+)?$/.test(t)) label = t.replace('-', '–');
    else if ((k = raw.match(/^(?:cat|category):(.+)$/i))) label = `Category: ${k[1]}`;
    else if ((k = raw.match(/^(?:acc|account):(.+)$/i))) label = `Account: ${k[1]}`;
    else if ((k = raw.match(/^(?:source|src):"?(.+?)"?$/i))) label = `Source: ${k[1]}`;
    else if ((k = raw.match(/^(?:sub|subcategory):(.+)$/i))) label = `Subcategory: ${k[1]}`;
    else if ((k = raw.match(/^from:(.+)$/i))) label = `From ${k[1]}`;
    else if ((k = raw.match(/^to:(.+)$/i))) label = `Until ${k[1]}`;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) label = raw;
    else if (/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(raw)) label = raw.replace('..', ' – ');
    else if (/^#/.test(raw)) label = raw;
    else if (/^\d+(?:[.,]\d+)?$/.test(raw)) label = `Amount ${raw}`;
    else {
      label = raw;
      if (state && t.length >= 3) {
        const cat = (state.settings?.categories || []).find((c) => fold(c.name) === t || fold(c.id) === t);
        const acc = (state.settings?.accounts || []).find((a) => fold(a.name) === t);
        if (cat) label = `Category: ${cat.name}`;
        else if (acc) label = `Account: ${acc.name}`;
      }
    }
    out.push({ raw, label });
  }
  return out;
}

/** The query text without term number `i`. */
export function withoutTerm(query, i, state = null) {
  return queryTerms(query, state).filter((_, j) => j !== i).map((x) => x.raw).join(' ');
}

/** The chips row (HTML), or '' when the query has no terms. `esc` escapes text. */
export function chipsHTML(query, esc, state = null) {
  const terms = queryTerms(query, state);
  if (!terms.length) return '';
  return `<div class="sq-chips" data-testid="search-chips" role="group" aria-label="Search filters">${terms.map((x, i) => `<span class="sq-chip"><span>${esc(x.label)}</span><button type="button" data-act="sq-chip-x" data-i="${i}" aria-label="Remove ${esc(x.label)}">✕</button></span>`).join('')}</div>`;
}
