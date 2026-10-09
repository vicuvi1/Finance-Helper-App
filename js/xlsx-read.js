// Reads an Excel / Google Sheets .xlsx file without libraries: unzip (the
// browser's own deflate), then the sheet XML. Returns every tab as rows of
// cell values: text, numbers, and dates as "YYYY-MM-DD".

const dec = new TextDecoder();

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Minimal zip reader: central directory -> each file's bytes.
export async function unzip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This is not an Excel (.xlsx) file.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged .xlsx file.');
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = dv.getUint16(local + 26, true);
    const lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    files[name] = { method, data: u8.subarray(start, start + size) };
    p += 46 + nameLen + extraLen + commentLen;
  }
  const out = {};
  for (const [name, f] of Object.entries(files)) {
    if (f.method === 0) out[name] = f.data;
    else if (f.method === 8) out[name] = await inflate(f.data);
  }
  return out;
}

const unescapeXml = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
  const map = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  if (map[e.toLowerCase()]) return map[e.toLowerCase()];
  return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
});
const attr = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const textOf = (xml) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');

function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref)?.[0] || 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Excel stores dates as days since 1899-12-30.
export function serialToISO(serial) {
  const ms = Math.round((serial - 25569) * 864e5);
  return new Date(ms).toISOString().slice(0, 10);
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 22, 27, 30, 36, 50, 57]);

function dateStyles(stylesXml) {
  const custom = {};
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) custom[attr(m[0], 'numFmtId')] = unescapeXml(attr(m[0], 'formatCode') || '');
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] || '';
  return [...xfs.matchAll(/<xf\b[^>]*\/?>/g)].map((m) => {
    const id = Number(attr(m[0], 'numFmtId') || 0);
    if (BUILTIN_DATE.has(id)) return true;
    const code = (custom[id] || '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    return /[dy]/i.test(code) && !/^[hms:.\s]*$/i.test(code);
  });
}

export async function readWorkbook(buf) {
  const files = await unzip(buf);
  const text = (name) => (files[name] ? dec.decode(files[name]) : '');
  const wb = text('xl/workbook.xml');
  if (!wb) throw new Error('This is not an Excel (.xlsx) file.');
  const rels = text('xl/_rels/workbook.xml.rels');
  const target = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) target[attr(m[0], 'Id')] = attr(m[0], 'Target');
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const isDate = dateStyles(text('xl/styles.xml'));

  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescapeXml(attr(m[0], 'name') || 'Sheet');
    const rid = attr(m[0], 'r:id');
    let path = (target[rid] || '').replace(/^\//, '');
    if (!path.startsWith('xl/')) path = `xl/${path}`;
    const xml = text(path);
    const rows = [];
    for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const r = Number(attr(rm[0], 'r')) - 1;
      const row = [];
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const head = cm[1];
        const body = cm[2] || '';
        const ci = colIndex(attr(head, 'r') || '');
        const t = attr(head, 't');
        const s = Number(attr(head, 's') || 0);
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let val = '';
        if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = textOf(body);
        else if (t === 'str' || t === 'e') val = unescapeXml(v ?? '');
        else if (t === 'b') val = v === '1';
        else if (v != null) {
          const n = Number(v);
          val = isDate[s] && n > 0 && n < 2958466 ? serialToISO(n) : n;
        }
        row[ci] = val;
      }
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
      rows[r >= 0 ? r : rows.length] = row;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    sheets.push({ name, rows });
  }
  return sheets;
}
