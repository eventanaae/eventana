/**
 * Apple Wallet passes (.pkpass) — built with no extra dependencies.
 *
 * A .pkpass is a ZIP of pass.json + images + manifest.json (SHA-1 of each) +
 * a detached PKCS#7 signature of the manifest. We generate solid-pink PNGs in
 * code, hash with node:crypto, sign the manifest with openssl (present in the
 * runtime image), and write the ZIP by hand. Absent creds → walletEnabled()
 * is false and the route returns unavailable.
 */
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.js';

export function walletEnabled(): boolean {
  const w = config.wallet;
  return Boolean(w.certPem && w.keyPem && w.wwdrPem && w.typeId && w.teamId);
}

/* ---- solid-colour PNG encoder ---- */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function solidPng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolour RGB
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) {
    row[1 + x * 3] = rgb[0];
    row[1 + x * 3 + 1] = rgb[1];
    row[1 + x * 3 + 2] = rgb[2];
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

const PINK: [number, number, number] = [233, 79, 156];
const IMAGES: Record<string, Buffer> = {
  'icon.png': solidPng(29, 29, PINK),
  'icon@2x.png': solidPng(58, 58, PINK),
  'icon@3x.png': solidPng(87, 87, PINK),
  'logo.png': solidPng(160, 50, PINK),
  'logo@2x.png': solidPng(320, 100, PINK),
};

/* ---- minimal ZIP writer (stored, no compression) ---- */
function zip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(e.data.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const local = Buffer.concat([lh, name, e.data]);
    locals.push(local);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(e.data.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([ch, name]));
    offset += local.length;
  }
  const cd = Buffer.concat(central);
  const localAll = Buffer.concat(locals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(localAll.length, 16);
  return Buffer.concat([localAll, cd, end]);
}

/* ---- detached PKCS#7 signature of the manifest, via openssl ---- */
async function signManifest(manifest: Buffer): Promise<Buffer> {
  const w = config.wallet;
  const dir = await mkdtemp(join(tmpdir(), 'pkpass-'));
  try {
    const cert = join(dir, 'cert.pem');
    const key = join(dir, 'key.pem');
    const wwdr = join(dir, 'wwdr.pem');
    const man = join(dir, 'manifest.json');
    const sig = join(dir, 'signature');
    await Promise.all([
      writeFile(cert, w.certPem!),
      writeFile(key, w.keyPem!),
      writeFile(wwdr, w.wwdrPem!),
      writeFile(man, manifest),
    ]);
    await new Promise<void>((resolve, reject) => {
      execFile(
        'openssl',
        ['smime', '-binary', '-sign', '-certfile', wwdr, '-signer', cert, '-inkey', key, '-in', man, '-out', sig, '-outform', 'DER', '-noattr'],
        (err) => (err ? reject(err) : resolve()),
      );
    });
    return await readFile(sig);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface PassEvent {
  id: string;
  title: string;
  dateLabel: string;
  timeLabel: string;
  guest?: string | null;
  emirate: string;
}

export async function generateEventPass(ev: PassEvent): Promise<Buffer> {
  const w = config.wallet;
  const passJson = Buffer.from(
    JSON.stringify({
      formatVersion: 1,
      passTypeIdentifier: w.typeId,
      teamIdentifier: w.teamId,
      serialNumber: ev.id,
      organizationName: 'Eventana',
      description: 'Eventana Event Ticket',
      foregroundColor: 'rgb(255,255,255)',
      backgroundColor: 'rgb(233,79,156)',
      labelColor: 'rgb(255,255,255)',
      logoText: 'Eventana',
      barcodes: [{ message: ev.id, format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1', altText: ev.id }],
      eventTicket: {
        primaryFields: [{ key: 'event', label: 'EVENT', value: ev.title }],
        secondaryFields: [
          { key: 'date', label: 'DATE', value: ev.dateLabel },
          { key: 'time', label: 'TIME', value: ev.timeLabel },
        ],
        auxiliaryFields: [
          { key: 'guest', label: 'GUEST OF HONOUR', value: ev.guest || 'Your celebration' },
          { key: 'where', label: 'WHERE', value: ev.emirate },
        ],
      },
    }),
    'utf8',
  );

  const files: Record<string, Buffer> = { 'pass.json': passJson, ...IMAGES };
  const manifest = Buffer.from(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(files).map(([name, data]) => [name, createHash('sha1').update(data).digest('hex')]),
      ),
    ),
    'utf8',
  );
  const signature = await signManifest(manifest);

  return zip([
    ...Object.entries(files).map(([name, data]) => ({ name, data })),
    { name: 'manifest.json', data: manifest },
    { name: 'signature', data: signature },
  ]);
}
