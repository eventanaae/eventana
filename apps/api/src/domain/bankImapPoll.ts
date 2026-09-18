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
import { ingestBankAlert } from './bankInbox.js';

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

/** Temporary wire logging until the first successful LOGIN (then goes quiet). */
let verboseRx = true;
const esc = (b: Buffer): string => b.toString('latin1').replace(/\r/g, '\\r').replace(/\n/g, '\\n');

/** Minimal IMAP command/response pump over one TLS socket. */
class ImapConn {
  private sock: tls.TLSSocket;
  private buf: Buffer = Buffer.alloc(0);
  private seq = 0;
  private waiter: { tag: string; resolve: (b: Buffer) => void; reject: (e: Error) => void } | null = null;

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

function decodeQuotedPrintable(s: string): string {
  const noSoft = s.replace(/=\r?\n/g, '');
  const bytes = noSoft.replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  try { return Buffer.from(bytes, 'latin1').toString('utf8'); } catch { return bytes; }
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

/**
 * Pull a readable subject + text body out of a raw RFC822 message. Deliberately
 * forgiving: bank alerts are simple, and the raw text is stored regardless, so
 * a rough decode is enough for the amount/merchant regex to work.
 */
export function extractEmail(raw: string): { subject: string; text: string } {
  const sep = raw.indexOf('\r\n\r\n');
  const headerBlock = sep >= 0 ? raw.slice(0, sep) : raw;
  let body = sep >= 0 ? raw.slice(sep + 4) : '';
  const headers = headerBlock.replace(/\r\n[ \t]+/g, ' '); // unfold

  const subj = headers.match(/^subject:\s*(.*)$/im);
  const subject = decodeMimeWords((subj?.[1] ?? '').trim());

  const cte = (headers.match(/^content-transfer-encoding:\s*([^\r\n;]*)/im)?.[1] ?? '').toLowerCase().trim();
  const ctype = (headers.match(/^content-type:\s*([^\r\n]*)/im)?.[1] ?? '').toLowerCase();

  // For multipart, grab the first text/plain (or text/html) part crudely.
  const bnd = ctype.match(/boundary="?([^";\r\n]+)"?/);
  if (ctype.includes('multipart/') && bnd) {
    const parts = body.split(`--${bnd[1]}`);
    let chosen = '';
    let chosenIsHtml = false;
    for (const part of parts) {
      const pl = part.toLowerCase();
      if (pl.includes('content-type: text/plain')) { chosen = part; chosenIsHtml = false; break; }
      if (!chosen && pl.includes('content-type: text/html')) { chosen = part; chosenIsHtml = true; }
    }
    if (chosen) {
      const psep = chosen.indexOf('\r\n\r\n');
      const phead = psep >= 0 ? chosen.slice(0, psep).toLowerCase() : '';
      let pbody = psep >= 0 ? chosen.slice(psep + 4) : chosen;
      const pcte = (phead.match(/content-transfer-encoding:\s*([^\r\n;]*)/)?.[1] ?? '').trim();
      if (pcte === 'base64') { try { pbody = Buffer.from(pbody.replace(/\s+/g, ''), 'base64').toString('utf8'); } catch { /* keep */ } }
      else if (pcte === 'quoted-printable') pbody = decodeQuotedPrintable(pbody);
      const text = chosenIsHtml ? stripHtml(pbody) : pbody;
      return { subject, text: text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim() };
    }
  }

  // Single-part body.
  if (cte === 'base64') { try { body = Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8'); } catch { /* keep */ } }
  else if (cte === 'quoted-printable') body = decodeQuotedPrintable(body);
  if (ctype.includes('text/html')) body = stripHtml(body);
  return { subject, text: body.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim() };
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
    if (verboseRx) { try { await conn.cmd('CAPABILITY'); } catch (e) { console.warn('[bank-imap] CAPABILITY:', e instanceof Error ? e.message : e); } }
    // SASL PLAIN with an inline initial response (server advertises SASL-IR):
    // base64 of NUL + user + NUL + pass. Avoids all IMAP quoted-string pitfalls.
    const NUL = Buffer.from([0]);
    const sasl = Buffer.concat([NUL, Buffer.from(c.user, 'utf8'), NUL, Buffer.from(c.pass, 'utf8')]).toString('base64');
    await conn.cmd(`AUTHENTICATE PLAIN ${sasl}`);
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
        const { subject, text } = extractEmail(rawMsg);
        const res = await ingestBankAlert(subject, `${subject}\n${text}`, 'privateemail');
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
