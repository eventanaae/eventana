/**
 * Staff email/password authentication (public — these endpoints ARE the login,
 * so they sit OUTSIDE the admin token gate). Login issues a signed session
 * token the dashboard stores and sends as x-staff-token. Set-password serves
 * both the first-time invite and forgot-password. The master token and the old
 * personal access_tokens still work (see the admin auth middleware), so this is
 * a safe, additive switch.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';
import { logAudit } from '../domain/auditLog.js';
import { pushToOwner } from '../integrations/push.js';
import {
  hashPassword, verifyPassword, issueStaffSession,
  issueStaffSetupToken, verifyStaffSetupToken, passwordProblem,
} from '../domain/staffAuth.js';

export function buildSetupLink(token: string): string {
  const base = String(config.publicDashboardUrl).replace(/\/$/, '');
  return `${base}/?setup=${encodeURIComponent(token)}`;
}
const setupLink = buildSetupLink;

/** Send a "set your password" email (first-time invite or reset). Returns ok. */
export async function sendStaffSetupEmail(opts: { name: string; email: string; token: string; kind: 'setup' | 'reset' }): Promise<boolean> {
  if (!emailEnabled()) return false;
  const link = setupLink(opts.token);
  const first = String(opts.name || 'there').split(' ')[0];
  const isSetup = opts.kind === 'setup';
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#3B3641">
      <div style="font-size:22px;font-weight:800;color:#E94F9C;margin-bottom:6px">Eventana</div>
      <h2 style="font-size:19px;margin:14px 0 8px">Hi ${first} 👋</h2>
      <p style="font-size:15px;line-height:1.6;margin:0 0 14px">
        ${isSetup
          ? 'Welcome to the Eventana team dashboard! Set your password to activate your account.'
          : 'We received a request to reset your Eventana dashboard password.'}
      </p>
      <a href="${link}" style="display:inline-block;background:#F06CA8;color:#fff;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:12px;font-size:15px">
        ${isSetup ? 'Set my password' : 'Reset my password'}
      </a>
      <p style="font-size:12.5px;color:#96888f;line-height:1.6;margin:18px 0 0">
        This link ${isSetup ? 'is valid for 3 days' : 'expires in 30 minutes'}. If you didn't expect it, you can ignore this email.
      </p>
    </div>`;
  const res = await sendEmail({ to: opts.email, subject: isSetup ? 'Set up your Eventana account' : 'Reset your Eventana password', html });
  return res.ok;
}

export async function staffAuthRoutes(app: FastifyInstance) {
  // In-memory rate limit on the ADMIN auth endpoints (credential spray / reset
  // mailbomb). The customer limiter in publicRoutes doesn't reach here — Fastify
  // encapsulates hooks per plugin — so the higher-value staff login was unthrottled.
  const rlBuckets = new Map<string, { count: number; reset: number }>();
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (!/^\/api\/staff\/(login|forgot|set-password)$/.test(path)) return;
    const ip =
      (request.headers['cf-connecting-ip'] as string | undefined) ||
      ((request.headers['x-forwarded-for'] as string | undefined) ?? '').split(',')[0].trim() ||
      request.ip;
    const key = `${ip}:${path}`;
    const now = Date.now();
    let b = rlBuckets.get(key);
    if (!b || b.reset <= now) { b = { count: 0, reset: now + 60_000 }; rlBuckets.set(key, b); }
    b.count += 1;
    if (b.count > 8) {
      reply.header('retry-after', Math.ceil((b.reset - now) / 1000));
      return reply.status(429).send({ error: 'rate_limited', message: 'Too many attempts — please wait a moment.' });
    }
  });
  setInterval(() => { const now = Date.now(); for (const [k, b] of rlBuckets) if (b.reset <= now) rlBuckets.delete(k); }, 300_000).unref();

  /** Email + password → a signed session token. */
  app.post('/api/staff/login', async (request, reply) => {
    const p = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const { rows } = await pool.query(
      `SELECT id, name, access_level, password_hash, active FROM team_members WHERE lower(email) = lower($1) LIMIT 1`,
      [p.data.email],
    );
    const m = rows[0];
    // One generic failure for wrong email OR wrong password (no user enumeration).
    if (!m || !m.active || !verifyPassword(p.data.password, m.password_hash)) {
      return reply.status(401).send({ error: 'invalid_credentials', message: 'Wrong email or password.' });
    }
    await pool.query(`UPDATE team_members SET last_login_at = now() WHERE id = $1`, [m.id]);
    logAudit({ actor: m.name, role: m.access_level, action: 'login', target: m.id });
    return { token: issueStaffSession(m.id), name: m.name, role: m.access_level ?? 'employee' };
  });

  /** Start a password reset. Always returns ok (never reveals if the email exists). */
  app.post('/api/staff/forgot', async (request, reply) => {
    const p = z.object({ email: z.string().email() }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const { rows } = await pool.query(
      `SELECT id, name, email FROM team_members WHERE lower(email) = lower($1) AND active LIMIT 1`,
      [p.data.email],
    );
    const m = rows[0];
    if (m) {
      const token = issueStaffSetupToken(m.id, 'reset');
      await sendStaffSetupEmail({ name: m.name, email: m.email, token, kind: 'reset' });
      logAudit({ actor: m.name, action: 'password_reset_requested', target: m.id });
    }
    return { ok: true };
  });

  /** Set a password from a setup/reset link, then sign the member in. */
  app.post('/api/staff/set-password', async (request, reply) => {
    const p = z.object({ token: z.string().min(10), password: z.string().min(1) }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const parsed = verifyStaffSetupToken(p.data.token);
    if (!parsed) return reply.status(400).send({ error: 'invalid_or_expired', message: 'This link is invalid or has expired. Ask the owner for a new one.' });
    const problem = passwordProblem(p.data.password);
    if (problem) return reply.status(400).send({ error: 'weak_password', message: problem });
    const { rows } = await pool.query(
      `UPDATE team_members
          SET password_hash = $2, email_verified = TRUE, must_set_password = FALSE
        WHERE id = $1 AND active
        RETURNING id, name, email, access_level`,
      [parsed.memberId, hashPassword(p.data.password)],
    );
    const m = rows[0];
    if (!m) return reply.status(404).send({ error: 'not_found' });
    logAudit({ actor: m.name, role: m.access_level, action: parsed.kind === 'setup' ? 'password_set' : 'password_reset', target: m.id });

    // Tell the owner a team member has activated their account. Shows in the
    // owner/manager notification bell, and pushes to their devices if registered.
    if (parsed.kind === 'setup') {
      await pool.query(
        `INSERT INTO notifications (channel, template, scheduled_for, payload)
         VALUES ('push','staff_activated', now(), $1)`,
        [JSON.stringify({ name: m.name, memberId: m.id, level: m.access_level })],
      ).catch(() => {});
      void (async () => {
        const owners = await pool.query(`SELECT id FROM team_members WHERE access_level IN ('owner','manager') AND active`).catch(() => ({ rows: [] as any[] }));
        for (const o of owners.rows) {
          void pushToOwner('staff', o.id, 'Team member activated ✅', `${m.name} set their password and can now sign in.`);
        }
      })();
    }
    // No session is issued here on purpose: the staff member is sent to the
    // sign-in screen to log in with the password they just chose (so they learn
    // the real login, and the password is confirmed to work). `email` pre-fills it.
    return { ok: true, email: m.email, name: m.name };
  });
}
