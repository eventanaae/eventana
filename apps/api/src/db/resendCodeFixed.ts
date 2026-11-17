/**
 * Owner-approved, one-off "your code works now" email to ONE customer whose
 * personal code was refused by the checkout bug fixed on 17 Nov 2026.
 * Gated by RESEND_CODE_FIXED=<CODE>; runs once per code (app_kv marker).
 *
 * SAFETY: verifies the code is a live personal code (active, unused, not
 * expired, owner has an email) BEFORE sending; otherwise aborts and sends
 * nothing. Marsha is copied automatically (EMAIL_MONITOR_BCC) like every email.
 */
import { claimOneShot, pool } from './pool.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';
import { renderCodeFixedEmail } from '../domain/notify.js';

const P = (s: string) => console.log(`[code-fixed] ${s}`);

export async function resendCodeFixedFromEnv(): Promise<void> {
  await sendCodeFixed(String(process.env.RESEND_CODE_FIXED ?? ''));
}

/**
 * Queue path (the service is at its env-var limit): an owner-approved send is
 * queued as an app_secrets row `queue:code_fixed:<CODE>`; the 5-minute sweep
 * picks it up, removes it and sends once (the one-shot marker still guards).
 */
export async function sweepCodeFixedQueue(): Promise<void> {
  const { rows } = await pool.query<{ k: string }>(
    `DELETE FROM app_secrets WHERE k LIKE 'queue:code_fixed:%' RETURNING k`);
  for (const r of rows) await sendCodeFixed(r.k.slice('queue:code_fixed:'.length));
}

async function sendCodeFixed(raw: string): Promise<void> {
  const code = raw.trim().toUpperCase();
  if (!code) return;
  if (!emailEnabled()) { P('email disabled — abort'); return; }
  if (!(await claimOneShot(`oneshot:RESEND_CODE_FIXED:${code}`))) { P(`${code} already sent — skip`); return; }
  try {
    const { rows } = await pool.query(
      `SELECT p.code, p.active, p.uses, p.max_uses, p.expires_at, c.name, c.email
         FROM promo_codes p JOIN customers c ON c.id = p.customer_id
        WHERE p.code = $1`, [code]);
    const r = rows[0];
    const problems: string[] = [];
    if (!r) problems.push('not a personal code');
    else {
      if (!r.active) problems.push('inactive');
      if (r.max_uses != null && r.uses >= r.max_uses) problems.push('already used');
      if (r.expires_at && new Date(r.expires_at).getTime() < Date.now()) problems.push('expired');
      if (!r.email || !/@/.test(String(r.email))) problems.push('no email');
    }
    if (problems.length) { P(`ABORT — NOT sending ${code}: ${problems.join('; ')}`); return; }
    const first = String(r.name || '').trim().split(/\s+/)[0] ?? '';
    const { subject, html } = renderCodeFixedEmail({ firstName: first, code, expiresAt: r.expires_at });
    const res = await sendEmail({ to: r.email, subject, html });
    P(res.ok ? `SENT ${code} to the code owner (monitor BCC'd)` : `send FAILED for ${code}`);
  } catch (e) {
    P(`FAILED: ${(e as Error).message}`);
  }
}
