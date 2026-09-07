/**
 * Diagnostic: log every team-member account's role so we can confirm the owner's
 * login is `owner` (owners/managers are never money-hidden and can always update
 * status / reply to customers). Gated by ROLE_AUDIT=true; read-only; idempotent.
 */
import { pool } from './pool.js';

export async function roleAuditFromEnv(): Promise<void> {
  if (String(process.env.ROLE_AUDIT ?? '').toLowerCase() !== 'true') return;
  const rows = await pool.query<{
    id: string; name: string; role: string; event_role: string | null; email: string | null;
  }>(
    `SELECT id, name, role, event_role, email FROM team_members ORDER BY role, name`,
  );
  console.log(`[role-audit] ${rows.rows.length} account(s):`);
  for (const r of rows.rows) {
    console.log(
      `[role-audit] ${r.name} | role=${r.role} | event_role=${r.event_role ?? '-'} | email=${r.email ?? '-'} | id=${r.id}`,
    );
  }
}
