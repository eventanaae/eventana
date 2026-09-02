/**
 * Backfill a member's PAST leave as visible history rows (leave taken before this
 * system existed). Set STAFF_LEAVE_HISTORY to a JSON array of
 * { name, entries: [{ start, end, days?, reason? }] }. Each entry becomes an
 * approved leave_requests row (marked decided_by='historical-import' so it can be
 * re-imported idempotently). These replace the single opening-used lump with a
 * real, dated history the employee can see. No-op when the variable is unset.
 *
 *   STAFF_LEAVE_HISTORY='[{"name":"Dindo","entries":[{"start":"2022-09-01","end":"2022-09-30"}]}]'
 */
import { pool } from './pool.js';

interface Entry { start: string; end: string; days?: number; reason?: string; }
interface Member { name: string; entries: Entry[]; }

const MARKER = 'historical-import';

export async function applyLeaveHistoryFromEnv(): Promise<void> {
  const raw = process.env.STAFF_LEAVE_HISTORY;
  if (!raw) return;
  let members: Member[];
  try {
    members = JSON.parse(raw);
  } catch {
    console.error('[leave-history] STAFF_LEAVE_HISTORY is not valid JSON — skipping');
    return;
  }
  if (!Array.isArray(members) || members.length === 0) return;

  for (const m of members) {
    if (!m?.name || !Array.isArray(m.entries)) continue;
    const { rows } = await pool.query(`SELECT id FROM team_members WHERE lower(name) = lower($1) AND active`, [m.name]);
    const id = rows[0]?.id;
    if (!id) { console.log(`[leave-history] ${m.name}: no member`); continue; }
    // Idempotent: clear any prior import for this member, then re-insert.
    await pool.query(`DELETE FROM leave_requests WHERE member_id = $1 AND decided_by = $2`, [id, MARKER]);
    let n = 0;
    for (const e of m.entries) {
      if (!e?.start || !e?.end) continue;
      const days = Number.isFinite(e.days as number)
        ? Number(e.days)
        : Math.floor((Date.parse(e.end) - Date.parse(e.start)) / 86_400_000) + 1;
      await pool.query(
        `INSERT INTO leave_requests (member_id, start_date, end_date, days, reason, status, submitted_at, decided_by, decided_at)
         VALUES ($1, $2::date, $3::date, $4, $5, 'approved', $3::timestamptz, $6, $3::timestamptz)`,
        [id, e.start, e.end, days, e.reason ?? null, MARKER],
      );
      n++;
    }
    console.log(`[leave-history] ${m.name}: ${n} record(s)`);
  }
}
