/* ===== 极简 XLSX 读写（零依赖）=====
   写：ZIP 用 store（不压缩）方式打包，Excel/WPS/Numbers 都能直接打开
   读：用浏览器内置 DecompressionStream 解 deflate，解析 sheet1 的单元格
*/
'use strict';

const XLSX = (() => {

  /* ---------- CRC32 ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /* ---------- ZIP 打包（store 模式）---------- */
  function zip(files) {   // files: [{name, data:Uint8Array}]
    const chunks = [], central = [];
    let offset = 0;
    // 固定时间戳，保证同样内容打出的包一致
    const time = 0xB000, date = 0x5900;   // 2024-08-25 22:00
    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;

      const lh = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);        // version needed
      lv.setUint16(6, 0x0800, true);    // flags: UTF-8 文件名
      lv.setUint16(8, 0, true);         // 压缩方式: store
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      chunks.push(lh, f.data);

      const ch = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      central.push(ch);

      offset += lh.length + size;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, eocd], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---------- ZIP 解包 ---------- */
  async function unzip(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(u8.buffer);
    // 从尾部找 EOCD
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65558); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 xlsx/zip 文件');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = {};
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const cmtLen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      // 定位本地头之后的数据
      const lNameLen = dv.getUint16(lho + 26, true);
      const lExtraLen = dv.getUint16(lho + 28, true);
      const dataStart = lho + 30 + lNameLen + lExtraLen;
      const raw = u8.subarray(dataStart, dataStart + compSize);
      if (method === 0) out[name] = raw;
      else if (method === 8) {
        if (typeof DecompressionStream === 'undefined') throw new Error('当前环境不支持解压该 xlsx，请改用 CSV 导入');
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([raw]).stream().pipeThrough(ds);
        out[name] = new Uint8Array(await new Response(stream).arrayBuffer());
      }
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return out;
  }

  /* ---------- XML 助手 ---------- */
  const xmlEsc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');   // 剔除 XML 非法控制字符
  function colName(n) {   // 1 -> A, 27 -> AA
    let s = '';
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
    return s;
  }

  /* ---------- 生成工作表 XML ---------- */
  function sheetXml(rows, opts = {}) {
    const widths = opts.widths || [];
    let cols = '';
    if (widths.length) {
      cols = '<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
    }
    let body = '';
    rows.forEach((row, ri) => {
      let cells = '';
      row.forEach((v, ci) => {
        if (v === null || v === undefined || v === '') return;
        const ref = colName(ci + 1) + (ri + 1);
        const style = ri === 0 ? ' s="1"' : '';
        if (typeof v === 'number' && isFinite(v)) {
          cells += `<c r="${ref}"${style || ' s="2"'}><v>${v}</v></c>`;
        } else {
          cells += `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
        }
      });
      body += `<row r="${ri + 1}">${cells}</row>`;
    });
    const freeze = opts.freezeHeader === false ? '' :
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${body}</sheetData></worksheet>`;
  }

  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
<fonts count="2">
  <font><sz val="11"/><name val="等线"/></font>
  <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="等线"/></font>
</fonts>
<fills count="3">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF0B8F66"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>
  <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="0"/>
</styleSheet>`;

  /* ---------- 打包成 xlsx ---------- */
  /* sheets: [{name, rows: [[...],...], widths?: []}] */
  function build(sheets) {
    const files = [];
    const sheetIds = sheets.map((_, i) => i + 1);

    files.push({
      name: '[Content_Types].xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheetIds.map(i => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`)
    });
    files.push({
      name: '_rels/.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`)
    });
    files.push({
      name: 'xl/workbook.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`)
    });
    files.push({
      name: 'xl/_rels/workbook.xml.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheetIds.map(i => `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`)
    });
    files.push({ name: 'xl/styles.xml', data: enc.encode(STYLES_XML) });
    sheets.forEach((s, i) => {
      files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s.rows, s)) });
    });
    return zip(files);
  }

  /* ---------- 解析 ---------- */
  function sheetToRows(xml, shared) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const rows = [];
    for (const row of doc.getElementsByTagName('row')) {
      const r = (+row.getAttribute('r') || rows.length + 1) - 1;
      const arr = rows[r] || (rows[r] = []);
      for (const c of row.getElementsByTagName('c')) {
        const ref = c.getAttribute('r') || '';
        const colLetters = ref.replace(/\d+/g, '');
        let ci = 0;
        for (const ch of colLetters) ci = ci * 26 + (ch.charCodeAt(0) - 64);
        ci = Math.max(ci - 1, 0);
        const t = c.getAttribute('t');
        let val = '';
        if (t === 'inlineStr') {
          val = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
        } else {
          const v = c.getElementsByTagName('v')[0];
          if (!v) continue;
          if (t === 's') val = shared[+v.textContent] ?? '';
          else if (t === 'str') val = v.textContent;
          else if (t === 'b') val = v.textContent === '1';
          else { const n = parseFloat(v.textContent); val = isNaN(n) ? v.textContent : n; }
        }
        arr[ci] = val;
      }
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }

  /* 解析全部工作表 → [{name, rows}]（按工作簿里的顺序） */
  async function parseAll(arrayBuffer) {
    const files = await unzip(arrayBuffer);
    let shared = [];
    const ssKey = Object.keys(files).find(k => /sharedStrings\.xml$/i.test(k));
    if (ssKey) {
      const doc = new DOMParser().parseFromString(dec.decode(files[ssKey]), 'application/xml');
      shared = [...doc.getElementsByTagName('si')].map(si => {
        // 富文本会被拆成多个 <r><t>，拼起来；但要排除拼音注释 <rPh> 里的 t
        const ts = [];
        for (const t of si.getElementsByTagName('t')) {
          if (t.parentNode && t.parentNode.nodeName === 'rPh') continue;
          ts.push(t.textContent);
        }
        return ts.join('');
      });
    }
    // workbook.xml 给出工作表名与 rId 的对应，rels 再把 rId 映射到文件
    const wbKey = Object.keys(files).find(k => /^xl\/workbook\.xml$/i.test(k));
    const relKey = Object.keys(files).find(k => /^xl\/_rels\/workbook\.xml\.rels$/i.test(k));
    const out = [];
    if (wbKey && relKey) {
      const wb = new DOMParser().parseFromString(dec.decode(files[wbKey]), 'application/xml');
      const rel = new DOMParser().parseFromString(dec.decode(files[relKey]), 'application/xml');
      const relMap = {};
      for (const r of rel.getElementsByTagName('Relationship')) {
        let target = r.getAttribute('Target') || '';
        target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
        relMap[r.getAttribute('Id')] = 'xl/' + target;
      }
      for (const sh of wb.getElementsByTagName('sheet')) {
        const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
        const path = relMap[rid];
        if (!path || !files[path]) continue;
        out.push({ name: sh.getAttribute('name') || '', rows: sheetToRows(dec.decode(files[path]), shared) });
      }
    }
    if (!out.length) {
      // 兜底：直接按文件名顺序读
      const keys = Object.keys(files).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
        .sort((a, b) => (+a.match(/(\d+)/)[1]) - (+b.match(/(\d+)/)[1]));
      for (const k of keys) out.push({ name: k.replace(/.*sheet(\d+)\.xml/i, 'Sheet$1'), rows: sheetToRows(dec.decode(files[k]), shared) });
    }
    if (!out.length) throw new Error('xlsx 中没有找到工作表');
    return out;
  }

  /* 只要第一张表（保持向后兼容） */
  async function parse(arrayBuffer) {
    return (await parseAll(arrayBuffer))[0].rows;
  }

  return { build, parse, parseAll, zip, unzip };
})();
