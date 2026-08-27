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
import {
  hashPassword, verifyPassword, issueStaffSession,
  issueStaffSetupToken, verifyStaffSetupToken, passwordProblem,
} from '../domain/staffAuth.js';

function setupLink(token: string): string {
  const base = String(config.publicDashboardUrl).replace(/\/$/, '');
  return `${base}/?setup=${encodeURIComponent(token)}`;
}

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
        RETURNING id, name, access_level`,
      [parsed.memberId, hashPassword(p.data.password)],
    );
    const m = rows[0];
    if (!m) return reply.status(404).send({ error: 'not_found' });
    logAudit({ actor: m.name, role: m.access_level, action: parsed.kind === 'setup' ? 'password_set' : 'password_reset', target: m.id });
    return { token: issueStaffSession(m.id), name: m.name, role: m.access_level ?? 'employee' };
  });
}
