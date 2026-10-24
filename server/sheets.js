import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

// Minimal spreadsheet files: write .xlsx (one or more sheets of text) and .csv, read the first sheet
// of an .xlsx or a .csv back into rows of strings. Enough for question import and export.

const xmlEsc = (s) =>
  String(s ?? '')
    // Characters XML 1.0 does not allow.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const colName = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

function sheetXml(rows, widths = []) {
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const body = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row
          .map((v, c) => {
            const ref = `${colName(c)}${r + 1}`;
            const style = r === 0 ? ' s="1"' : ' s="2"';
            if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
            return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
          })
          .join('')}</row>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
}

/** sheets: [{ name, rows: [[cell, …], …], widths?: [number] }] → .xlsx bytes. */
export function writeXlsx(sheets) {
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((s, i) => `<sheet name="${xmlEsc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF6E1018"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>`,
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s.rows, s.widths);
  });
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
}

/** CSV with a BOM so Excel opens Kazakh letters correctly. */
export function writeCsv(rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return Buffer.from(`﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`, 'utf8');
}

// ─── Reading ───────────────────────────────────────────────────────
const unEsc = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

/** Text of a cell's <is> or a shared string <si>: all <t> runs joined (rich text keeps its words). */
const runsText = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unEsc(m[1])).join('');

const colIndex = (ref) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] || 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

const MAX_UNZIPPED = 20 * 1024 * 1024;

/** First worksheet of an .xlsx as rows of strings. Throws an Error with a Kazakh message. */
export function readXlsx(buf) {
  let files;
  try {
    let total = 0;
    files = unzipSync(new Uint8Array(buf), {
      // Only the parts we read, and never more than a sane amount of data.
      filter: (f) => {
        total += f.originalSize;
        if (total > MAX_UNZIPPED) throw new Error('too big');
        return /^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml)$/.test(f.name);
      },
    });
  } catch {
    throw new Error('Excel файлын оқу мүмкін болмады. Файл .xlsx форматында екенін тексеріңіз.');
  }
  const text = (name) => (files[name] ? strFromU8(files[name]) : '');
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runsText(m[1]));
  // The first sheet in workbook order.
  const firstId = /<sheet\b[^>]*r:id="([^"]+)"/.exec(text('xl/workbook.xml'))?.[1];
  const target = firstId && new RegExp(`Id="${firstId}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${firstId}"`).exec(text('xl/_rels/workbook.xml.rels'));
  const path = target ? `xl/${(target[1] || target[2]).replace(/^\/?xl\//, '').replace(/^\//, '')}` : 'xl/worksheets/sheet1.xml';
  const sheet = text(path) || text('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('Excel файлында бет (sheet) табылмады.');
  const rows = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const attrs = rm[1] || rm[3] || '';
    const r = Number(/\br="(\d+)"/.exec(attrs)?.[1]) || rows.length + 1;
    const row = [];
    let next = 0;
    for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = cm[1];
      const ref = /\br="([A-Z]+\d+)"/.exec(a)?.[1];
      const ci = ref ? colIndex(ref) : next;
      next = ci + 1;
      const type = /\bt="(\w+)"/.exec(a)?.[1];
      const inner = cm[2] || '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = runsText(inner);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) value = unEsc(v);
      row[ci] = value;
    }
    rows[r - 1] = Array.from(row, (x) => x ?? '');
  }
  return Array.from(rows, (x) => x ?? []);
}

/** CSV (comma or semicolon, as Excel saves it in different locales) as rows of strings. */
export function readCsv(buf) {
  let s = buf.toString('utf8');
  if (s.includes('�')) s = new TextDecoder('windows-1251').decode(buf);
  s = s.replace(/^﻿/, '');
  const firstLine = s.split(/\r?\n/, 1)[0];
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Reads an uploaded spreadsheet by its real bytes: .xlsx is a zip, anything else is treated as CSV text. */
export function readSpreadsheet(buf) {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return { format: 'xlsx', rows: readXlsx(buf) };
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0xd0cf11e0) throw new Error('Ескі .xls форматы қолданылмайды. Файлды Excel-де «.xlsx» немесе «CSV UTF-8» ретінде сақтаңыз.');
  if (buf.subarray(0, 1024).includes(0)) throw new Error('Файл форматы танылмады. Excel (.xlsx) немесе CSV файлын жүктеңіз.');
  return { format: 'csv', rows: readCsv(buf) };
}
