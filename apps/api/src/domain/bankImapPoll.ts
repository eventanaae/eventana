/**
 * Bank mailbox reader (bank@eventanauae.com on Namecheap Private Email).
 *
 * WHY hand-rolled: the API is built with `npm ci` (a locked dependency tree)
 * and we have no local Node here to regenerate package-lock.json, so we cannot
 * add an IMAP npm package. This is a small IMAP-over-TLS client written with
 * Node built-ins only (node:tls) — zero new dependencies.
 *
 * WHAT it does: every few minutes it logs in, reads UNSEEN messages from INBOX,
 * hands each one to ingestBankAlert() (which creates a PENDING bank_transactions
 * row and notifies the owner + Marsha), then marks the message \Seen. Nothing is
 * auto-posted to expenses: the owner still approves each pending row, so an
 * imperfectly-parsed email is safe — the raw text is kept for review.
 *
 * Enable by setting in Render (API service):
 *   BANK_IMAP_POLL=true
 *   BANK_IMAP_USER=bank@eventanauae.com     (default)
 *   BANK_IMAP_PASS=<the mailbox password>   (owner sets this; never in the repo)
 *   BANK_IMAP_HOST=mail.privateemail.com    (default)
 *   BANK_IMAP_PORT=993                       (default)
 *   BANK_IMAP_INTERVAL_MIN=5                 (default)
 */
import * as tls from 'node:tls';
import { ingestInboxEmail } from './bankInbox.js';
import { pool } from '../db/pool.js';

interface ImapCfg {
  host: string;
  port: number;
  user: string;
  pass: string;
}

function cfg(): ImapCfg | null {
  if (String(process.env.BANK_IMAP_POLL ?? '').toLowerCase() !== 'true') return null;
  const pass = process.env.BANK_IMAP_PASS ?? '';
  if (!pass) {
    console.warn('[bank-imap] BANK_IMAP_POLL=true but BANK_IMAP_PASS is empty — skipping.');
    return null;
  }
  return {
    host: process.env.BANK_IMAP_HOST ?? 'mail.privateemail.com',
    port: Number(process.env.BANK_IMAP_PORT ?? 993),
    // Strip stray CR/LF that a copy-pasted env value can carry — they are never
    // part of a real credential and would corrupt the IMAP command line.
    user: (process.env.BANK_IMAP_USER ?? 'bank@eventanauae.com').replace(/[\r\n]/g, ''),
    pass: pass.replace(/[\r\n]/g, ''),
  };
}

/**
 * Scan a buffer for the end of an IMAP response tagged `tag`, correctly
 * skipping over IMAP literals ({N}\r\n<N octets>). Returns the byte offset just
 * past the tagged completion line, or -1 if more data is still needed.
 */
function completeOffset(buf: Buffer, tag: string): number {
  let i = 0;
  const done = new RegExp(`^${tag} (OK|NO|BAD)\\b`, 'i');
  for (;;) {
    const nl = buf.indexOf('\r\n', i);
    if (nl < 0) return -1;
    const line = buf.slice(i, nl).toString('latin1');
    const lit = line.match(/\{(\d+)\}$/);
    if (lit) {
      const litStart = nl + 2;
      const litLen = Number(lit[1]);
      if (buf.length < litStart + litLen) return -1;
      i = litStart + litLen; // jump past the literal payload, keep scanning
      continue;
    }
    if (done.test(line)) return nl + 2;
    i = nl + 2;
  }
}

/**
 * Wire-level debug logging. Off by default; set BANK_IMAP_DEBUG=true to trace
 * the IMAP handshake (never logs email bodies — it self-silences the moment a
 * login succeeds, before any message is fetched). Left in place so a future
 * connection problem can be diagnosed by flipping one env flag.
 */
let verboseRx = String(process.env.BANK_IMAP_DEBUG ?? '').toLowerCase() === 'true';
const esc = (b: Buffer): string => b.toString('latin1').replace(/\r/g, '\\r').replace(/\n/g, '\\n');

/** Minimal IMAP command/response pump over one TLS socket. */
class ImapConn {
  private sock: tls.TLSSocket;
  private buf: Buffer = Buffer.alloc(0);
  private seq = 0;
  private waiter: { tag: string; resolve: (b: Buffer) => void; reject: (e: Error) => void; cont?: boolean } | null = null;

  constructor(sock: tls.TLSSocket) {
    this.sock = sock;
    sock.on('data', (chunk: Buffer) => {
      if (verboseRx) console.log(`[bank-imap] rx(${this.waiter?.tag ?? '-'}): ${esc(chunk.slice(0, 200))}`);
      this.buf = Buffer.concat([this.buf, chunk]);
      this.tryResolve();
    });
    const fail = (e: Error) => {
      if (this.waiter) { const w = this.waiter; this.waiter = null; w.reject(e); }
    };
    sock.on('error', (e: Error) => fail(e));
    sock.on('close', () => fail(new Error('IMAP socket closed')));
  }

  private tryResolve(): void {
    if (!this.waiter) return;
    // SASL continuation: server answers a bare "+ ..." line asking for the next
    // token. Resolve on it (before tag-completion scanning).
    if (this.waiter.cont) {
      const cm = this.buf.toString('latin1').match(/^\+[^\n]*\n/);
      if (cm) {
        this.buf = this.buf.slice(cm[0].length);
        const w = this.waiter;
        this.waiter = null;
        w.resolve(Buffer.alloc(0));
        return;
      }
    }
    const end = completeOffset(this.buf, this.waiter.tag);
    if (end < 0) return;
    const resp = this.buf.slice(0, end);
    this.buf = this.buf.slice(end);
    const w = this.waiter;
    this.waiter = null;
    const status = resp.toString('latin1').match(new RegExp(`(?:^|\\r\\n)${w.tag} (OK|NO|BAD)\\b`, 'i'));
    if (status && status[1].toUpperCase() !== 'OK') {
      w.reject(new Error(`IMAP ${w.tag} ${status[1]}: ${resp.toString('latin1').trim().slice(-200)}`));
    } else {
      w.resolve(resp);
    }
  }

  /** Wait for the untagged server greeting (no tag). */
  greeting(): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.buf.indexOf('\r\n') >= 0) {
          this.buf = this.buf.slice(this.buf.indexOf('\r\n') + 2);
          resolve();
        }
      };
      if (this.buf.indexOf('\r\n') >= 0) return check();
      const onData = () => {
        if (this.buf.indexOf('\r\n') >= 0) {
          this.sock.off('data', onData);
          check();
        }
      };
      this.sock.on('data', onData);
      setTimeout(() => { this.sock.off('data', onData); reject(new Error('IMAP greeting timeout')); }, 15000);
    });
  }

  cmd(command: string): Promise<Buffer> {
    const tag = `A${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.waiter = { tag, resolve, reject };
      this.sock.write(`${tag} ${command}\r\n`);
      // Data already buffered may complete this command immediately.
      this.tryResolve();
      setTimeout(() => {
        if (this.waiter && this.waiter.tag === tag) {
          this.waiter = null;
          if (verboseRx) console.log(`[bank-imap] ${tag} timeout; buf(${this.buf.length}): ${esc(this.buf.slice(-240))}`);
          reject(new Error(`IMAP ${tag} timeout: ${command.split(' ')[0]}`));
        }
      }, 30000);
    });
  }

  private wait(tag: string, cont: boolean, label: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.waiter = { tag, resolve, reject, cont };
      this.tryResolve();
      setTimeout(() => {
        if (this.waiter && this.waiter.tag === tag) {
          this.waiter = null;
          if (verboseRx) console.log(`[bank-imap] ${tag} ${label} timeout; buf(${this.buf.length}): ${esc(this.buf.slice(-240))}`);
          reject(new Error(`IMAP ${tag} timeout: ${label}`));
        }
      }, 45000);
    });
  }

  /** Multi-line SASL PLAIN: send AUTHENTICATE, await "+", send base64 creds. */
  async authPlain(user: string, pass: string): Promise<Buffer> {
    const tag = `A${++this.seq}`;
    this.sock.write(`${tag} AUTHENTICATE PLAIN\r\n`);
    const cont = await this.wait(tag, true, 'AUTH-cont');
    // If the server already answered tagged (rejected), stop here.
    if (cont.length && /(?:^|\r\n)A\d+ (NO|BAD)\b/i.test(cont.toString('latin1'))) return cont;
    const NUL = Buffer.from([0]);
    const b64 = Buffer.concat([NUL, Buffer.from(user, 'utf8'), NUL, Buffer.from(pass, 'utf8')]).toString('base64');
    // Safe diagnostic: never logs the password itself, only its length, so a
    // trailing space or truncation shows up without exposing the secret.
    if (verboseRx) console.log(`[bank-imap] sending SASL response: user=${user} userLen=${user.length} passLen=${pass.length} b64Len=${b64.length}`);
    const ok = this.sock.write(`${b64}\r\n`);
    if (verboseRx) console.log(`[bank-imap] SASL response flushed=${ok}`);
    return this.wait(tag, false, 'AUTH-final');
  }

  logout(): void {
    try { this.sock.write(`Z LOGOUT\r\n`); } catch { /* ignore */ }
    try { this.sock.end(); } catch { /* ignore */ }
  }
}

/** Decode a =?charset?enc?...?= MIME encoded-word (subjects). Best effort. */
function decodeMimeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, cs: string, enc: string, data: string) => {
    try {
      if (enc.toUpperCase() === 'B') return Buffer.from(data, 'base64').toString('utf8');
      // Q-encoding
      const bytes = data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_x, h) => String.fromCharCode(parseInt(h, 16)));
      return Buffer.from(bytes, 'latin1').toString('utf8');
    } catch { return data; }
  });
}

function stripHtml(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|td|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
}

export interface EmailAttachment { filename: string; contentType: string; bytes: Buffer; }
export interface ParsedEmail { subject: string; from: string; text: string; attachments: EmailAttachment[]; }

function headerValue(headers: string, name: string): string {
  const m = headers.match(new RegExp(`^${name}:\\s*([^\\r\\n]*)`, 'im'));
  return m ? m[1].trim() : '';
}

function paramOf(headerLine: string, key: string): string {
  const q = headerLine.match(new RegExp(`${key}\\s*=\\s*"([^"]*)"`, 'i'));
  if (q) return q[1].trim();
  const u = headerLine.match(new RegExp(`${key}\\s*=\\s*([^;\\r\\n]+)`, 'i'));
  return u ? u[1].trim() : '';
}

function decodePartBytes(body: string, cte: string): Buffer {
  const enc = cte.toLowerCase().trim();
  if (enc === 'base64') { try { return Buffer.from(body.replace(/\s+/g, ''), 'base64'); } catch { return Buffer.from(body, 'latin1'); } }
  if (enc === 'quoted-printable') {
    const noSoft = body.replace(/=\r?\n/g, '');
    const bytes = noSoft.replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(bytes, 'latin1');
  }
  return Buffer.from(body, 'utf8');
}

/** True for parts we'd keep as a receipt (PDF/CSV/spreadsheet/zip or an explicit attachment) — not inline logos. */
function isReceiptPart(ctype: string, disp: string, filename: string): boolean {
  const t = ctype.toLowerCase();
  if (/(application\/pdf|text\/csv|application\/vnd\.|application\/octet-stream|application\/zip|application\/x-zip)/.test(t)) return true;
  if (disp.includes('attachment')) return !t.startsWith('text/');
  if (filename && /\.(pdf|csv|xlsx?|zip)$/i.test(filename)) return true;
  return false;
}

/** Recursively walk a MIME section, collecting body text and receipt attachments. */
function walkSection(section: string, acc: { text: string; html: string; attachments: EmailAttachment[] }): void {
  const sep = section.indexOf('\r\n\r\n');
  const headerBlock = (sep >= 0 ? section.slice(0, sep) : '').replace(/\r\n[ \t]+/g, ' ');
  const body = sep >= 0 ? section.slice(sep + 4) : section;
  const ctypeLine = headerValue(headerBlock, 'content-type') || 'text/plain';
  const ctype = ctypeLine.toLowerCase();
  const cte = headerValue(headerBlock, 'content-transfer-encoding');
  const dispLine = headerValue(headerBlock, 'content-disposition');
  const disp = dispLine.toLowerCase();
  const filename = decodeMimeWords(paramOf(dispLine, 'filename') || paramOf(ctypeLine, 'name'));

  if (ctype.startsWith('multipart/')) {
    // MIME boundaries are CASE-SENSITIVE — read it from the original-case header,
    // not the lowercased copy. Outlook uses mixed-case boundaries (e.g.
    // "_005_FRWPR03MB…"), and lowercasing them made the split silently fail, so
    // forwarded receipts came through with no text and no attachments.
    const bnd = ctypeLine.match(/boundary="?([^";\r\n]+)"?/i);
    if (bnd) {
      const chunks = body.split(`--${bnd[1]}`);
      for (let i = 1; i < chunks.length; i++) {
        let chunk = chunks[i];
        if (chunk.startsWith('--')) break; // closing delimiter "--boundary--"
        chunk = chunk.replace(/^\r?\n/, '');
        if (chunk.trim()) walkSection(chunk, acc);
      }
      return;
    }
  }

  // A forwarded email is often attached as a nested message (message/rfc822 or
  // multipart/digest). The real receipt — its HTML with the amount AND its PDF —
  // lives INSIDE. Walk into it as its own RFC822 message, otherwise everything in
  // it is lost (this was the "AED 0 + no attachment" bug on forwarded receipts).
  if (ctype.startsWith('message/rfc822') || ctype.startsWith('message/global')) {
    const inner = /base64|quoted-printable/i.test(cte) ? decodePartBytes(body, cte).toString('utf8') : body;
    if (inner.trim()) walkSection(inner, acc);
    return;
  }

  if (isReceiptPart(ctype, disp, filename)) {
    const bytes = decodePartBytes(body, cte);
    if (bytes.length > 0 && bytes.length <= 15 * 1024 * 1024) {
      acc.attachments.push({ filename: filename || 'attachment', contentType: ctypeLine.split(';')[0].trim() || 'application/octet-stream', bytes });
    }
    return;
  }

  const decoded = decodePartBytes(body, cte).toString('utf8');
  if (ctype.startsWith('text/html')) acc.html += (acc.html ? '\n' : '') + decoded;
  else if (ctype.startsWith('text/') || !ctype) acc.text += (acc.text ? '\n' : '') + decoded;
}

/**
 * Parse a raw RFC822 message into subject/from/text plus any receipt-like
 * attachments (PDF/CSV/etc.). Forgiving by design: the raw text is stored
 * regardless, so a rough decode is enough for the amount regex to work.
 */
export function extractEmail(raw: string): ParsedEmail {
  const sep = raw.indexOf('\r\n\r\n');
  const topHeaders = (sep >= 0 ? raw.slice(0, sep) : raw).replace(/\r\n[ \t]+/g, ' ');
  const subject = decodeMimeWords(headerValue(topHeaders, 'subject'));
  const from = decodeMimeWords(headerValue(topHeaders, 'from'));
  const acc = { text: '', html: '', attachments: [] as EmailAttachment[] };
  walkSection(raw, acc);
  let text = acc.text.trim();
  if (!text && acc.html) text = stripHtml(acc.html);
  text = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
  return { subject, from, text, attachments: acc.attachments };
}

/** Parse UIDs from a `* SEARCH 1 2 3` response. */
function parseSearchUids(resp: string): number[] {
  const m = resp.match(/^\*\s+SEARCH\b([^\r\n]*)/im);
  if (!m) return [];
  return m[1].trim().split(/\s+/).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
}

/** Extract the literal payload from a `UID FETCH ... {N}\r\n<...>` response. */
function extractLiteral(resp: Buffer): string | null {
  const s = resp.toString('latin1');
  const m = s.match(/\{(\d+)\}\r\n/);
  if (!m) return null;
  const start = (m.index ?? 0) + m[0].length;
  const len = Number(m[1]);
  return resp.slice(start, start + len).toString('utf8');
}

/** One poll cycle. Returns how many messages were ingested. */
async function pollOnce(): Promise<{ read: number; ingested: number }> {
  const c = cfg();
  if (!c) return { read: 0, ingested: 0 };

  const sock = await new Promise<tls.TLSSocket>((resolve, reject) => {
    const s = tls.connect({ host: c.host, port: c.port, servername: c.host }, () => resolve(s));
    s.once('error', reject);
    s.setTimeout(30000, () => { s.destroy(); reject(new Error('IMAP socket timeout')); });
  });

  const conn = new ImapConn(sock);
  let read = 0;
  let ingested = 0;
  try {
    await conn.greeting();
    if (verboseRx) {
      // CAPABILITY answers instantly; NOOP proves a *second* command round-trips
      // (isolates a pump bug from a server-side auth hang).
      try { await conn.cmd('CAPABILITY'); } catch (e) { console.warn('[bank-imap] CAPABILITY:', e instanceof Error ? e.message : e); }
      try { await conn.cmd('NOOP'); console.log('[bank-imap] NOOP ok — 2nd command round-trips'); } catch (e) { console.warn('[bank-imap] NOOP:', e instanceof Error ? e.message : e); }
    }
    // Multi-line SASL PLAIN (await "+" then send creds). Sidesteps quoted-string
    // pitfalls and the inline-IR path that hung on this server.
    await conn.authPlain(c.user, c.pass);
    verboseRx = false; // login worked — stop logging raw wire data (which includes email bodies)
    await conn.cmd('SELECT INBOX');
    const search = await conn.cmd('UID SEARCH UNSEEN');
    const uids = parseSearchUids(search.toString('latin1')).slice(0, 25); // cap per cycle
    for (const uid of uids) {
      read++;
      try {
        const fetch = await conn.cmd(`UID FETCH ${uid} BODY.PEEK[]`);
        const rawMsg = extractLiteral(fetch);
        if (!rawMsg) { console.warn(`[bank-imap] uid ${uid}: no body literal`); continue; }
        const email = extractEmail(rawMsg);
        const res = await ingestInboxEmail(email, 'privateemail');
        if (res && !res.duplicate) ingested++;
        // Mark seen so we don't re-ingest it next cycle.
        await conn.cmd(`UID STORE ${uid} +FLAGS (\\Seen)`);
      } catch (err) {
        console.error(`[bank-imap] uid ${uid} failed:`, err instanceof Error ? err.message : err);
      }
    }
  } finally {
    conn.logout();
  }
  return { read, ingested };
}

let running = false;
let timer: NodeJS.Timeout | null = null;

/** Wire the poller into boot. No-op unless BANK_IMAP_POLL=true with a password. */
export function startBankImapPolling(): void {
  const c = cfg();
  if (!c) return;
  const intervalMs = Math.max(1, Number(process.env.BANK_IMAP_INTERVAL_MIN ?? 5)) * 60_000;
  const tick = async () => {
    if (running) return; // never overlap
    running = true;
    try {
      const r = await pollOnce();
      if (r.read || r.ingested) console.log(`[bank-imap] cycle: read ${r.read}, ingested ${r.ingested}`);
    } catch (err) {
      console.error('[bank-imap] cycle failed:', err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };
  console.log(`[bank-imap] enabled — polling ${c.user} on ${c.host}:${c.port} every ${intervalMs / 60000}min`);
  // First run shortly after boot, then on the interval.
  setTimeout(tick, 10_000);
  timer = setInterval(tick, intervalMs);
}

export function stopBankImapPolling(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * One-time RE-READ of recent mail (env-gated). The normal poller only reads
 * UNSEEN messages and marks each \Seen, so anything it dropped (e.g. a receipt
 * in a currency/format the parser has since learned) is never re-read. This
 * re-scans the last few days with BODY.PEEK (which does NOT change read/unread
 * state) and re-ingests every message; the ingest de-dupe means already-recorded
 * ones are skipped. Guarded in app_kv so it runs once per REREAD tag.
 *
 * Enable: BANK_IMAP_REREAD=true (+ optional BANK_IMAP_REREAD_DAYS, default 2, and
 * BANK_IMAP_REREAD_TAG to force another run). Requires RUN_MIGRATIONS_ON_BOOT.
 */
export async function rereadRecentInboxFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  // Runs once per tag (guarded in app_kv). Bump BANK_IMAP_REREAD_TAG to force a
  // fresh run later; no env flag needed for the first run.
  const guardKey = `bank_imap_reread_${process.env.BANK_IMAP_REREAD_TAG ?? 'v10'}`;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = $1`, [guardKey]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const c = cfg();
  if (!c) { console.warn('[bank-imap] reread: poller not configured (BANK_IMAP_POLL/PASS)'); return; }

  // Re-read only ADDS what's missing — the ingest de-dupes by the receipt/
  // transaction reference number, so an email already captured (pending OR
  // approved) is skipped, never duplicated. We do NOT delete existing rows.
  const days = Math.max(1, Number(process.env.BANK_IMAP_REREAD_DAYS ?? 2));
  const since = new Date(Date.now() - days * 86_400_000);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][since.getUTCMonth()];
  const sinceStr = `${since.getUTCDate()}-${mon}-${since.getUTCFullYear()}`; // IMAP DD-Mon-YYYY

  const sock = await new Promise<tls.TLSSocket>((resolve, reject) => {
    const s = tls.connect({ host: c.host, port: c.port, servername: c.host }, () => resolve(s));
    s.once('error', reject);
    s.setTimeout(30000, () => { s.destroy(); reject(new Error('IMAP socket timeout')); });
  });
  const conn = new ImapConn(sock);
  let read = 0;
  let ingested = 0;
  try {
    await conn.greeting();
    await conn.authPlain(c.user, c.pass);
    verboseRx = false;
    await conn.cmd('SELECT INBOX');
    const search = await conn.cmd(`UID SEARCH SINCE ${sinceStr}`);
    const uids = parseSearchUids(search.toString('latin1')).slice(0, 200);
    for (const uid of uids) {
      read++;
      try {
        const fetch = await conn.cmd(`UID FETCH ${uid} BODY.PEEK[]`); // PEEK = don't touch \Seen
        const rawMsg = extractLiteral(fetch);
        if (!rawMsg) continue;
        const email = extractEmail(rawMsg);
        const res = await ingestInboxEmail(email, 'privateemail');
        if (res && !res.duplicate) ingested++;
      } catch (err) {
        console.error(`[bank-imap] reread uid ${uid} failed:`, err instanceof Error ? err.message : err);
      }
    }
  } finally {
    conn.logout();
  }
  console.log(`[bank-imap] reread SINCE ${sinceStr}: read ${read}, ingested ${ingested}`);
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [guardKey]).catch(() => {});
}
