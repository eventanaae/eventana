/**
 * Voice-over uploads for the ad videos. The owner records each ad at
 * /rec.html on the customer site (a plain page, so the browser lets it use
 * the microphone) and the audio is stored on Cloudinary.
 *
 * Guarded by a private link key: only its SHA-256 lives here, the key itself
 * is only in the link given to the owner. Nothing here touches bookings,
 * customers or money.
 */
import type { FastifyInstance } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pool } from '../db/pool.js';
import { uploadBytes } from '../integrations/cloudinary.js';

const KEY_SHA256 = 'fcf810c1a6fafd6373ca921bcdf0b1446aa48e7db7ddaaace5009deecae17e6d';
const MAX_BYTES = 25 * 1024 * 1024;

function keyOk(k: unknown): boolean {
  if (typeof k !== 'string' || k.length < 8 || k.length > 64) return false;
  const a = createHash('sha256').update(k).digest();
  return timingSafeEqual(a, Buffer.from(KEY_SHA256, 'hex'));
}

export async function voiceRecRoutes(app: FastifyInstance) {
  // Raw audio bodies (Safari sends audio/mp4, Chrome audio/webm).
  app.addContentTypeParser(/^(audio|video)\//, { parseAs: 'buffer', bodyLimit: MAX_BYTES }, (_req, body, done) => {
    done(null, body);
  });

  /** Which ads already have a take (newest per ad). */
  app.get('/api/voice-rec', async (req, reply) => {
    const q = req.query as { k?: string };
    if (!keyOk(q.k)) return reply.code(403).send({ ok: false, error: 'bad_key' });
    const r = await pool.query<{ ad: string; url: string; created_at: Date }>(
      `SELECT DISTINCT ON (ad) ad, url, created_at FROM ad_voice_takes ORDER BY ad, created_at DESC`,
    );
    return { ok: true, takes: Object.fromEntries(r.rows.map((x) => [x.ad, { url: x.url, at: x.created_at }])) };
  });

  app.post('/api/voice-rec', { bodyLimit: MAX_BYTES }, async (req, reply) => {
    const q = req.query as { k?: string; ad?: string };
    if (!keyOk(q.k)) return reply.code(403).send({ ok: false, error: 'bad_key' });
    const ad = String(q.ad ?? '');
    if (!/^a\d{1,2}$/.test(ad)) return reply.code(400).send({ ok: false, error: 'bad_ad' });
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length < 2000) return reply.code(400).send({ ok: false, error: 'empty_audio' });
    const mime = String(req.headers['content-type'] ?? '').slice(0, 60);
    const ext = mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : 'm4a';
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const url = await uploadBytes(new Uint8Array(body), 'eventana/ad-voice', `${ad}_${stamp}.${ext}`, 60000);
    if (!url) return reply.code(502).send({ ok: false, error: 'storage_failed' });
    await pool.query(`INSERT INTO ad_voice_takes (ad, url, mime, bytes) VALUES ($1, $2, $3, $4)`, [ad, url, mime, body.length]);
    req.log.info({ ad, bytes: body.length }, 'voice-rec saved');
    return { ok: true, url };
  });
}
