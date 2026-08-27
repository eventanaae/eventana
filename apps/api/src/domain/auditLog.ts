/**
 * Append-only audit trail for critical actions. Best-effort: a logging failure
 * must never break the action it records, so every write is fire-and-forget.
 */
import { pool } from '../db/pool.js';

export function logAudit(entry: {
  actor: string;
  role?: string | null;
  action: string;
  target?: string | null;
  detail?: Record<string, unknown> | null;
}): void {
  void pool
    .query(
      `INSERT INTO audit_log (actor, role, action, target, detail) VALUES ($1,$2,$3,$4,$5)`,
      [entry.actor || 'unknown', entry.role ?? null, entry.action, entry.target ?? null, entry.detail ? JSON.stringify(entry.detail) : null],
    )
    .catch(() => {});
}

/** Recent audit entries, newest first. Owner-only at the route. */
export async function listAudit(opts: { action?: string; limit?: number } = {}): Promise<any[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const { rows } = await pool.query(
    `SELECT id, actor, role, action, target, detail, to_char(created_at,'YYYY-MM-DD HH24:MI') AS at
       FROM audit_log
      ${opts.action ? 'WHERE action = $1' : ''}
      ORDER BY created_at DESC LIMIT ${limit}`,
    opts.action ? [opts.action] : [],
  );
  return rows;
}
