/**
 * Diagnostic: log every team-member account's access_level so we can confirm the
 * owner's login is `owner`. The status/reply gate keys off access_level
 * (owner/manager are never money-hidden and can always update status / reply to
 * the customer; employee/driver are view-only unless they're the event leader).
 * Gated by ROLE_AUDIT=true; read-only; idempotent.
 */
import { pool } from './pool.js';

export async function roleAuditFromEnv(): Promise<void> {
  if (String(process.env.ROLE_AUDIT ?? '').toLowerCase() !== 'true') return;
  const rows = await pool.query<{
    id: string; name: string; role: string; access_level: string | null; job_title: string | null; active: boolean;
  }>(
    `SELECT id, name, role, access_level, job_title, active FROM team_members ORDER BY access_level, name`,
  );
  console.log(`[role-audit] ${rows.rows.length} account(s):`);
  for (const r of rows.rows) {
    console.log(
      `[role-audit] ${r.name} | access_level=${r.access_level ?? '(null→employee)'} | job_role=${r.role} | title=${r.job_title ?? '-'} | active=${r.active} | id=${r.id}`,
    );
  }
}
