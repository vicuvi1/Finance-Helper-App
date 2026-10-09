// Small RFC 4180 CSV reader/writer (quotes, commas and newlines inside cells).

export function parseCSV(text) {
  const src = String(text).replace(/^﻿/, '');
  const delim = sniffDelimiter(src);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delim) {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Excel in many European locales saves with ";" instead of ",".
function sniffDelimiter(src) {
  const first = src.split(/\r?\n/, 1)[0] || '';
  const count = (c) => first.split(c).length - 1;
  if (count('\t') > count(',') && count('\t') > count(';')) return '\t';
  return count(';') > count(',') ? ';' : ',';
}

export function toCSV(rows) {
  return rows.map((r) => r.map((v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n') + '\r\n';
}
