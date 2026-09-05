/**
 * Minimal, dependency-free image -> PDF wrapper.
 *
 * We deliberately avoid pulling in a PDF library (the API is built with
 * `npm ci` in an environment where adding a dependency is not an option). For a
 * JPEG this is easy and reliable: a PDF can embed the raw JPEG bytes verbatim
 * via a `/DCTDecode` image XObject, so we only need the image's pixel
 * dimensions (parsed from the JPEG frame header) and a hand-written, byte-
 * accurate one-page PDF that draws the image at full page size.
 *
 * PNG is intentionally NOT supported: embedding a PNG into a PDF without a
 * library needs a full zlib/PNG decoder (PDF has no native PNG filter), so we
 * return null and let the caller attach only the image.
 */

/** Parse a baseline/progressive JPEG's frame header for pixel size + component
 *  count. Returns null if the bytes are not a JPEG we can read. */
function jpegInfo(buf: Buffer): { width: number; height: number; components: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null; // SOI
  let off = 2;
  while (off + 1 < buf.length) {
    // A marker is 0xFF followed by a non-0xFF, non-0x00 byte. Skip any fill.
    if (buf[off] !== 0xff) {
      off++;
      continue;
    }
    let marker = buf[off + 1];
    while (marker === 0xff && off + 1 < buf.length) {
      off++;
      marker = buf[off + 1];
    }
    off += 2;
    // Standalone markers carry no length payload.
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (off + 1 >= buf.length) break;
    const segLen = buf.readUInt16BE(off);
    // SOF0 (baseline), SOF1 (extended sequential), SOF2 (progressive).
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      // segment layout: length(2) precision(1) height(2) width(2) components(1)
      if (off + 7 >= buf.length) break;
      const height = buf.readUInt16BE(off + 3);
      const width = buf.readUInt16BE(off + 5);
      const components = buf[off + 7];
      if (!width || !height) return null;
      return { width, height, components };
    }
    if (segLen < 2) break; // malformed
    off += segLen;
  }
  return null;
}

/**
 * Wrap an image in a single-page PDF sized to the image.
 * Only JPEG is supported (embedded losslessly via /DCTDecode). Returns null for
 * PNG or any input we can't safely embed — the caller then skips the PDF.
 */
export function imageToPdf(buf: Buffer, kind: 'jpeg' | 'png'): Buffer | null {
  if (kind !== 'jpeg') return null; // PNG needs a full decoder — not attempted.
  const info = jpegInfo(buf);
  if (!info) return null;
  const { width, height, components } = info;
  const colorSpace = components === 1 ? '/DeviceGray' : components === 4 ? '/DeviceCMYK' : '/DeviceRGB';

  // Bytes are written as latin1 so each unit maps to one byte; the raw JPEG is
  // spliced in unmodified. Object numbers 1..5, xref built from real offsets.
  const enc = (s: string): Buffer => Buffer.from(s, 'latin1');
  const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;

  const objs: Buffer[] = [];
  objs[1] = enc('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objs[2] = enc('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  objs[3] = enc(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
  );
  objs[4] = Buffer.concat([
    enc(
      `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
        `/ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${buf.length} >>\nstream\n`,
    ),
    buf,
    enc('\nendstream\nendobj\n'),
  ]);
  objs[5] = Buffer.concat([
    enc(`5 0 obj\n<< /Length ${content.length} >>\nstream\n`),
    enc(content),
    enc('\nendstream\nendobj\n'),
  ]);

  const header = enc('%PDF-1.4\n');
  const parts: Buffer[] = [header];
  const offsets: number[] = [];
  let pos = header.length;
  for (let i = 1; i <= 5; i++) {
    offsets[i] = pos;
    parts.push(objs[i]);
    pos += objs[i].length;
  }

  const xrefStart = pos;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  parts.push(enc(xref));

  return Buffer.concat(parts);
}
