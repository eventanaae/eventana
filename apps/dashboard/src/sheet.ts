/**
 * Dependency-free spreadsheet reader for the QuickBooks migration upload.
 * Supports .csv (plain text) and .xlsx (a ZIP of XML — unzipped natively with
 * the browser's DecompressionStream, no library, so it needs no npm dependency
 * that would desync the build lockfile). Returns a grid of rows (arrays of cell
 * strings); the caller finds the header row and maps columns.
 */

export async function parseSheetFile(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || file.type === 'text/csv') {
    return parseCsv(await file.text());
  }
  return parseXlsx(await file.arrayBuffer());
}

// ── CSV ──────────────────────────────────────────────────────────────────────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell); cell = '';
    } else if (c === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
    } else if (c === '\r') {
      // ignore; handled by \n
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ── XLSX (ZIP + minimal OOXML) ───────────────────────────────────────────────
async function parseXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const bytes = new Uint8Array(buf);
  const dv = new DataView(buf);
  const entries = readZipCentralDirectory(bytes, dv);

  const sheetName =
    Object.keys(entries).find((n) => /^xl\/worksheets\/sheet1\.xml$/i.test(n)) ||
    Object.keys(entries).find((n) => /^xl\/worksheets\/.*\.xml$/i.test(n));
  if (!sheetName) throw new Error('That file is not a readable Excel export — please try “Save As → CSV” and upload that.');

  const sharedName = Object.keys(entries).find((n) => /^xl\/sharedStrings\.xml$/i.test(n));
  const shared = sharedName ? parseSharedStrings(await readEntry(bytes, dv, entries[sharedName])) : [];
  const sheetXml = await readEntry(bytes, dv, entries[sheetName]);
  return parseSheet(sheetXml, shared);
}

type ZipEntry = { method: number; compressedSize: number; localOffset: number };

function readZipCentralDirectory(bytes: Uint8Array, dv: DataView): Record<string, ZipEntry> {
  // End Of Central Directory: signature 0x06054b50, scan backwards.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65557; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Unreadable Excel file — please upload a CSV instead.');
  const cdOffset = dv.getUint32(eocd + 16, true);
  const count = dv.getUint16(eocd + 10, true);
  const entries: Record<string, ZipEntry> = {};
  let p = cdOffset;
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const fnLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + fnLen));
    entries[name] = { method, compressedSize, localOffset };
    p += 46 + fnLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(bytes: Uint8Array, dv: DataView, e: ZipEntry): Promise<string> {
  // Local file header: sig 0x04034b50; data after 30 + fnLen + extraLen.
  const o = e.localOffset;
  if (dv.getUint32(o, true) !== 0x04034b50) throw new Error('Corrupt Excel file — please upload a CSV instead.');
  const fnLen = dv.getUint16(o + 26, true);
  const extraLen = dv.getUint16(o + 28, true);
  const start = o + 30 + fnLen + extraLen;
  const data = bytes.subarray(start, start + e.compressedSize);
  let out: Uint8Array;
  if (e.method === 0) out = data;
  else {
    const DS: any = (globalThis as any).DecompressionStream;
    if (!DS) throw new Error('This browser can’t open .xlsx here — please upload a CSV instead.');
    const ds = new DS('deflate-raw');
    // Copy into a fresh ArrayBuffer-backed view so the Blob part type is
    // concrete (avoids the Uint8Array<ArrayBufferLike> vs BlobPart mismatch).
    const part = data.slice();
    const stream = new Blob([part as unknown as BlobPart]).stream().pipeThrough(ds);
    out = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return new TextDecoder().decode(out);
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const parts = xml.split('<si>');
  for (let i = 1; i < parts.length; i++) {
    const si = parts[i].split('</si>')[0];
    const texts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]));
    out.push(texts.join(''));
  }
  return out;
}

function colToIndex(ref: string): number {
  const letters = (ref.match(/^[A-Z]+/) || ['A'])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c\s+([^>]*?)\/?>(?:([\s\S]*?)<\/c>)?/g)) {
      const attrs = cm[1];
      const inner = cm[2] || '';
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1] || `A${rows.length + 1}`;
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || 'n';
      const idx = colToIndex(ref);
      let val = '';
      if (type === 's') {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        val = v != null ? (shared[Number(v)] ?? '') : '';
      } else if (type === 'inlineStr') {
        const t = (inner.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
        val = t != null ? unescapeXml(t) : '';
      } else {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        val = v != null ? unescapeXml(v) : '';
      }
      while (row.length < idx) row.push('');
      row[idx] = val;
    }
    rows.push(row);
  }
  return rows;
}
