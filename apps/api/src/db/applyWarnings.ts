/**
 * Seed/adjust disciplinary warnings from the environment. Set STAFF_WARNINGS to
 * a JSON array of { name, ym, reason?, affectsPoints? } (ym = 'YYYY-MM'); each is
 * matched to a team member by name. affectsPoints:false records the warning on
 * file WITHOUT wiping that month's competition points (an owner exception).
 * Idempotent (one row per member+month). No-op when the variable is unset.
 *
 *   STAFF_WARNINGS='[{"name":"Diana","ym":"2026-09","affectsPoints":false,"reason":"Final warning"}]'
 */
import { pool } from './pool.js';

interface Entry { name: string; ym: string; reason?: string; affectsPoints?: boolean; wtype?: string; issuedDate?: string; validUntil?: string; }

export async function applyWarningsFromEnv(): Promise<void> {
  const raw = process.env.STAFF_WARNINGS;
  if (!raw) return;
  let entries: Entry[];
  try {
    entries = JSON.parse(raw);
  } catch {
    console.error('[warnings] STAFF_WARNINGS is not valid JSON — skipping');
    return;
  }
  if (!Array.isArray(entries) || entries.length === 0) return;

  for (const e of entries) {
    if (!e?.name || !e?.ym) continue;
    const affects = e.affectsPoints !== false; // default true
    const res = await pool.query(
      `INSERT INTO staff_warnings (member_id, ym, reason, affects_points, wtype, issued_date, valid_until, created_by)
       SELECT id, $2, $3, $4, $5, $6::date, $7::date, 'owner' FROM team_members WHERE lower(name) = lower($1) AND active
       ON CONFLICT (member_id, ym) DO UPDATE
         SET reason = EXCLUDED.reason, affects_points = EXCLUDED.affects_points,
             wtype = EXCLUDED.wtype, issued_date = EXCLUDED.issued_date, valid_until = EXCLUDED.valid_until`,
      [e.name, e.ym, e.reason ?? null, affects, e.wtype ?? null, e.issuedDate ?? null, e.validUntil ?? null],
    );
    console.log(`[warnings] ${e.name} ${e.ym} type=${e.wtype ?? '—'} affects=${affects} (${res.rowCount ?? 0} row)`);
  }
}
