/**
 * Instagram comment offer: a customer comments «حفلة» on a reel, follows the
 * account, and the Instagram auto-reply tool (ManyChat) asks this endpoint for
 * her personal code, then sends it to her in a direct message.
 *
 * Offer (owner, 17 Nov 2026): AED 300 off + free delivery, min booking AED 3,000,
 * valid 30 days, one use, booked on the website, not combinable (the checkout's
 * no-stacking rule keeps only the biggest discount).
 *
 * Guarded by a private key: only its SHA-256 lives here; the key itself is only
 * in the ManyChat request header. Issuing is idempotent per Instagram username.
 */
import type { FastifyInstance } from 'fastify';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { pool } from '../db/pool.js';

const KEY_SHA256 = '6a350be0519185976c026161876ddce8702b4712a741e08c7aeb2990b054ecf7';
export const IG_COMMENT_CAMPAIGN = 'igcomment';
export const IG_COMMENT_OFFER = { amountFils: 30000, minSpendFils: 300000, validDays: 30 } as const;
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function keyOk(k: unknown): boolean {
  if (typeof k !== 'string' || k.length < 8 || k.length > 128) return false;
  const a = createHash('sha256').update(k).digest();
  return timingSafeEqual(a, Buffer.from(KEY_SHA256, 'hex'));
}

/** Instagram handle → code stem: letters/digits only, uppercased, ≤ 24 chars. */
export function codeStem(username: string): string {
  return username.replace(/^@/, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 24);
}

export async function igCommentRoutes(app: FastifyInstance) {
  app.post('/api/ig/comment-code', async (req, reply) => {
    const key = req.headers['x-eventana-key'];
    if (!keyOk(Array.isArray(key) ? key[0] : key)) return reply.code(403).send({ ok: false, error: 'bad_key' });
    const body = (req.body ?? {}) as { username?: unknown };
    const username = typeof body.username === 'string' ? body.username.trim().slice(0, 60) : '';
    const stem = codeStem(username);
    if (!stem) return reply.code(400).send({ ok: false, error: 'username_required' });
    const handle = username.replace(/^@/, '').toLowerCase();

    // One code per Instagram account: return the existing one if already issued.
    const prior = await pool.query<{ code: string; expires_at: Date; uses: number }>(
      `SELECT code, expires_at, uses FROM promo_codes WHERE campaign = $1 AND ig_username = $2 ORDER BY created_at LIMIT 1`,
      [IG_COMMENT_CAMPAIGN, handle],
    );
    if (prior.rowCount) {
      const p = prior.rows[0];
      return { ok: true, code: p.code, expiresAt: p.expires_at, existing: true, used: p.uses > 0 };
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const suffix = Array.from({ length: 3 }, () => ALPH[randomInt(ALPH.length)]).join('');
      const code = `HAFLA-${stem}-${suffix}`;
      const r = await pool.query<{ code: string; expires_at: Date }>(
        `INSERT INTO promo_codes (code, kind, value, min_spend_fils, max_uses, active, expires_at, campaign, ig_username)
         VALUES ($1, 'fixed', $2, $3, 1, TRUE, ((date_trunc('day', now() AT TIME ZONE 'Asia/Dubai') + make_interval(days => $4 + 1) - interval '1 second') AT TIME ZONE 'Asia/Dubai'), $5, $6)
         ON CONFLICT (code) DO NOTHING
         RETURNING code, expires_at`,
        [code, IG_COMMENT_OFFER.amountFils, IG_COMMENT_OFFER.minSpendFils, IG_COMMENT_OFFER.validDays, IG_COMMENT_CAMPAIGN, handle],
      );
      if (r.rowCount) return { ok: true, code: r.rows[0].code, expiresAt: r.rows[0].expires_at, existing: false };
    }
    return reply.code(500).send({ ok: false, error: 'could_not_issue' });
  });
}
