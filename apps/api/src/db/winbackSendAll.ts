/**
 * One-time bulk send of the win-back discount-code email to every customer who
 * has a code but was never emailed it (last_reminded_at IS NULL). The normal
 * auto-campaign only sends ~120/day to stay under the old Resend daily cap; now
 * that Resend is on Pro (no daily cap) this clears the whole held backlog.
 *
 *   WINBACK_SEND_ALL=list  → count + a sample; sends NOTHING (owner preview).
 *   WINBACK_SEND_ALL=send  → email every pending code, stamping last_reminded_at
 *                            on success so it's never sent twice. Same audience
 *                            and template as the proven auto-campaign.
 * Excludes opted-out addresses and the owner's own account.
 */
import { pool } from './pool.js';
import { config } from '../config.js';

const P = (s: string) => console.log(`[winback-all] ${s}`);
const mask = (e: string) => { const [u, d] = String(e).split('@'); return d ? `${u.slice(0, 2)}•••@${d}` : '(none)'; };

interface Row { id: string; name: string; email: string; code: string; expires_at: Date | null }

async function pending(): Promise<Row[]> {
  const ownerEmail = String(config.email.financeReportTo?.[0] ?? '').toLowerCase();
  const { rows } = await pool.query<Row>(
    `SELECT c.id, c.name, c.email, p.code, p.expires_at
       FROM promo_codes p
       JOIN customers c ON c.id = p.customer_id
      WHERE p.campaign = 'winback' AND p.active
        AND c.email IS NOT NULL AND btrim(c.email) <> '' AND c.email_opt_out = FALSE
        AND (p.expires_at IS NULL OR p.expires_at > now())
        AND (p.max_uses IS NULL OR p.uses < p.max_uses)
        AND NOT EXISTS (SELECT 1 FROM promo_redemptions r WHERE r.code = p.code)
        AND p.last_reminded_at IS NULL
      ORDER BY c.name`,
  );
  return rows.filter((r) => r.email.toLowerCase() !== ownerEmail && !r.email.toLowerCase().includes('example.'));
}

export async function winbackSendAllFromEnv(): Promise<void> {
  const mode = String(process.env.WINBACK_SEND_ALL ?? '').toLowerCase();
  if (mode !== 'list' && mode !== 'send') return;
  try {
    const rows = await pending();
    P(`pending win-back code emails (never sent): ${rows.length}`);
    if (mode === 'list') {
      for (const r of rows.slice(0, 25)) P(`  ${r.name} · ${mask(r.email)} · ${r.code}`);
      if (rows.length > 25) P(`  …and ${rows.length - 25} more`);
      P('list mode — nothing sent. Set WINBACK_SEND_ALL=send to deliver them all.');
      return;
    }
    const { sendWinbackEmail } = await import('../domain/notify.js');
    let sent = 0, failed = 0;
    for (const r of rows) {
      const ok = await sendWinbackEmail({
        firstName: (r.name || '').split(' ')[0], email: r.email, code: r.code, expiresAt: r.expires_at, customerId: r.id,
      }).catch(() => false);
      if (ok) {
        await pool.query(`UPDATE promo_codes SET last_reminded_at = now() WHERE code = $1`, [r.code]);
        sent++;
      } else {
        failed++;
      }
      if ((sent + failed) % 50 === 0) P(`  progress: ${sent} sent, ${failed} failed of ${rows.length}`);
      await new Promise((res) => setTimeout(res, 120)); // gentle pacing for Resend
    }
    P(`DONE — sent ${sent}, failed ${failed} of ${rows.length}. Clear WINBACK_SEND_ALL now.`);
  } catch (err) {
    console.error('[winback-all] failed:', (err as Error).message);
  }
}
