'use strict';
/* lib/xlsx.js — eksport Excel i bërë në SERVER, pa varësi (vetëm node:zlib).
 *
 * Pse: deri tani Excel-i pritej në browser (localStorage/SheetJS lokal) → kjo thyen
 * rregullin "asgjë biznesi në browser" dhe nuk funksionon për 20 përdorues. Këtu
 * skedari .xlsx prodhohet në server, me faqezim slice(20) për modul (kërkesa e P3)
 * dhe me numFmt të vërtetë (datat si datë, shumat si numër me 2 shifra, kg me 3).
 *
 *   const { buildWorkbook } = require('./lib/xlsx');
 *   const buf = buildWorkbook({
 *     title: 'Kthimet e klientëve',
 *     columns: [
 *       { key: 'number',   title: 'Numri',      width: 18 },
 *       { key: 'date',     title: 'Data',       type: 'date',   width: 12 },
 *       { key: 'customer', title: 'Klienti',    width: 28 },
 *       { key: 'kg',       title: 'Kg',         type: 'kg',     width: 10, align: 'right' },
 *       { key: 'total',    title: 'Shuma (ALL)',type: 'money',  width: 14, align: 'right' },
 *     ],
 *     rows,                    // të gjitha rreshtat e modulit (nga DB, me company_id)
 *     pageSize: 20,            // slice(20) → çdo faqe në një worksheet të vetën
 *   });
 *   res.setHeader('Content-Type', XLSX_MIME);
 *   res.setHeader('Content-Disposition', 'attachment; filename="kthimet.xlsx"');
 *   res.end(buf);
 */
const zlib = require('node:zlib');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* ---------- numFmt (formatet e numrave/datave, si në aplikacionin shqip) ---------- */
const NUMFMTS = {
  money: { id: 164, code: '#,##0.00' },        // 1 250.00
  kg:    { id: 165, code: '#,##0.000' },       // 216.500
  qty:   { id: 166, code: '#,##0' },           // 8
  rate:  { id: 167, code: '0.00%' },
  date:  { id: 14,  code: '' },                // format i brendshëm i Excel për datë
  datetime: { id: 22, code: '' },
  text:  { id: 0,   code: '' },
};

/* ---------- ZIP (deflate) me dorë ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function dosDateTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}
function zip(entries) {
  const now = dosDateTime(new Date());
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt16LE(now.time, 10); lh.writeUInt16LE(now.date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10); ch.writeUInt16LE(now.time, 12); ch.writeUInt16LE(now.date, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([ch, nameBuf]));

    offset += lh.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}

/* ---------- XML helpers ---------- */
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
function colName(i) {           // 0 → A, 25 → Z, 26 → AA
  let n = i + 1, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function serialDate(v) {        // datë → numri serial i Excel (1900 system)
  const d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(1899, 11, 30)) / 86400000);
}

/* ---------- Fletët (worksheet) ---------- */
function sheetXml(opts) {
  const cols = opts.columns || [];
  const rows = opts.rows || [];
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  parts.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
  if (opts.freezeHeader !== false) parts.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
  if (cols.length) {
    parts.push('<cols>' + cols.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.width || 14) + '" customWidth="1"/>').join('') + '</cols>');
  }
  parts.push('<sheetData>');

  // Rreshti i titullit të raportit (opsional) + rreshti i kolonave
  let rIdx = 0;
  if (opts.heading) {
    rIdx++;
    parts.push('<row r="' + rIdx + '"><c r="A' + rIdx + '" s="5" t="inlineStr"><is><t>' + esc(opts.heading) + '</t></is></c></row>');
  }
  rIdx++;
  parts.push('<row r="' + rIdx + '">' + cols.map((c, i) =>
    '<c r="' + colName(i) + rIdx + '" s="4" t="inlineStr"><is><t>' + esc(c.title || c.key) + '</t></is></c>').join('') + '</row>');

  for (const row of rows) {
    rIdx++;
    const cells = cols.map((c, i) => {
      const ref = colName(i) + rIdx;
      const raw = (row && typeof row === 'object') ? row[c.key] : row;
      const type = c.type || 'text';
      const style = STYLE_ID[type] != null ? STYLE_ID[type] : 0;
      if (raw == null || raw === '') return '<c r="' + ref + '" s="' + style + '"/>';
      if (type === 'date' || type === 'datetime') {
        const s = serialDate(raw);
        if (s != null) return '<c r="' + ref + '" s="' + style + '"><v>' + s + '</v></c>';
        return '<c r="' + ref + '" s="0" t="inlineStr"><is><t>' + esc(raw) + '</t></is></c>';
      }
      if (type === 'money' || type === 'kg' || type === 'qty' || type === 'rate' || type === 'number') {
        const n = Number(String(raw).replace(/\s/g, '').replace(',', '.'));
        if (Number.isFinite(n)) return '<c r="' + ref + '" s="' + style + '"><v>' + n + '</v></c>';
        return '<c r="' + ref + '" s="0" t="inlineStr"><is><t>' + esc(raw) + '</t></is></c>';
      }
      if (typeof raw === 'number') return '<c r="' + ref + '" s="' + style + '"><v>' + raw + '</v></c>';
      return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t>' + esc(raw) + '</t></is></c>';
    });
    parts.push('<row r="' + rIdx + '">' + cells.join('') + '</row>');
  }

  // Rreshti SHUMA (opsional, si në printimet shqip)
  if (opts.totalRow && cols.length) {
    rIdx++;
    const cells = cols.map((c, i) => {
      const ref = colName(i) + rIdx;
      const sum = opts.totalRow[c.key];
      if (i === 0 && sum == null) return '<c r="' + ref + '" s="6" t="inlineStr"><is><t>' + esc(opts.totalLabel || 'SHUMA') + '</t></is></c>';
      if (sum == null || sum === '') return '<c r="' + ref + '" s="6"/>';
      const style = STYLE_ID[c.type || 'text'] != null ? STYLE_ID[c.type || 'text'] : 0;
      return '<c r="' + ref + '" s="' + (style + 2) + '"><v>' + Number(sum) + '</v></c>';
    });
    parts.push('<row r="' + rIdx + '">' + cells.join('') + '</row>');
  }

  parts.push('</sheetData>');
  if (opts.autoFilter && cols.length) {
    parts.push('<autoFilter ref="A1:' + colName(cols.length - 1) + rIdx + '"/>');
  }
  parts.push('</worksheet>');
  return parts.join('');
}

/* Stilet: 0 = tekst, 1 = para, 2 = kg, 3 = sasi, 4 = titull kolone, 5 = titull raporti, 6 = total */
const STYLE_ID = { text: 0, money: 1, kg: 2, qty: 3, number: 1, rate: 3, date: 7, datetime: 8 };

function stylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="4">'
    + '<numFmt numFmtId="164" formatCode="' + esc(NUMFMTS.money.code) + '"/>'
    + '<numFmt numFmtId="165" formatCode="' + esc(NUMFMTS.kg.code) + '"/>'
    + '<numFmt numFmtId="166" formatCode="' + esc(NUMFMTS.qty.code) + '"/>'
    + '<numFmt numFmtId="167" formatCode="' + esc(NUMFMTS.rate.code) + '"/>'
    + '</numFmts>'
    + '<fonts count="3">'
    + '<font><sz val="11"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="13"/><name val="Calibri"/></font>'
    + '</fonts>'
    + '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FF20744A"/><bgColor indexed="64"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFE8F1EC"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
    + '<border><left style="thin"><color rgb="FFBFD3C8"/></left><right style="thin"><color rgb="FFBFD3C8"/></right><top style="thin"><color rgb="FFBFD3C8"/></top><bottom style="thin"><color rgb="FFBFD3C8"/></bottom><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="9">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                              /* 0 tekst */
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +                      /* 1 para */
    + '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +                      /* 2 kg */
    + '<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +                      /* 3 sasi */
    + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' + /* 4 titull kolone */
    + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                                /* 5 titull raporti */
    + '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>' +                                /* 6 total (label) */
    + '<xf numFmtId="14" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +                       /* 7 datë */
    + '<xf numFmtId="22" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +                       /* 8 datë+kohë */
    + '</cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>';
}

/* ---------- Libri (workbook) ---------- */
function buildWorkbook(opts) {
  const o = opts || {};
  const pageSize = Math.max(1, Number(o.pageSize || 20));       // slice(20) — kërkesa P3
  const allRows = Array.isArray(o.rows) ? o.rows : [];
  const pages = [];
  for (let i = 0; i < allRows.length; i += pageSize) pages.push(allRows.slice(i, i + pageSize));
  if (!pages.length) pages.push([]);
  const maxPages = Math.max(1, Number(o.maxPages || 250));      // mbrojtje: jo libër pafund
  const usedPages = pages.slice(0, maxPages);

  const sheetName = (i) => {
    const base = String(o.sheetName || 'Faqja');
    return (base + ' ' + (i + 1)).replace(/[\\/*?:\[\]]/g, ' ').slice(0, 31);
  };

  const entries = [];
  entries.push({ name: '[Content_Types].xml', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + usedPages.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
    + '</Types>' });

  entries.push({ name: '_rels/.rels', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>' });

  entries.push({ name: 'xl/workbook.xml', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheets>' + usedPages.map((_, i) => '<sheet name="' + esc(sheetName(i)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets>'
    + '</workbook>' });

  entries.push({ name: 'xl/_rels/workbook.xml.rels', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + usedPages.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('')
    + '<Relationship Id="rId' + (usedPages.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '</Relationships>' });

  entries.push({ name: 'xl/styles.xml', data: stylesXml() });

  usedPages.forEach((rows, i) => {
    entries.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml({
      columns: o.columns || [],
      rows,
      heading: (i === 0) ? (o.title || o.heading || '') : ((o.title || '') + ' — vazhdim ' + (i + 1)),
      totalRow: (o.totalRow && i === usedPages.length - 1) ? o.totalRow : null,
      totalLabel: o.totalLabel,
      autoFilter: o.autoFilter !== false && i === 0,
      freezeHeader: o.freezeHeader,
    }) });
  });

  const buf = zip(entries);
  buf.pages = usedPages.length;
  buf.rowCount = allRows.length;
  return buf;
}

module.exports = { buildWorkbook, XLSX_MIME, NUMFMTS, colName, serialDate };
