/**
 * Set staff employment start/end dates from the environment, so annual leave
 * accrues from the right day. Set STAFF_EMPLOYMENT to a JSON array of
 * { name, start, end? } (dates as YYYY-MM-DD); each is matched to a team member
 * by name. Idempotent — re-running just re-applies the same values. No-op when
 * the variable is unset.
 *
 *   STAFF_EMPLOYMENT='[{"name":"Diana","start":"2025-04-12"}]'
 */
import { pool } from './pool.js';

interface Entry { name: string; start?: string; end?: string; openingUsed?: number; note?: string; }

export async function setEmploymentDatesFromEnv(): Promise<void> {
  const raw = process.env.STAFF_EMPLOYMENT;
  if (!raw) return;
  let entries: Entry[];
  try {
    entries = JSON.parse(raw);
  } catch {
    console.error('[employment] STAFF_EMPLOYMENT is not valid JSON — skipping');
    return;
  }
  if (!Array.isArray(entries) || entries.length === 0) return;

  for (const e of entries) {
    if (!e?.name) continue;
    const openingUsed = Number.isFinite(e.openingUsed as number) ? Number(e.openingUsed) : null;
    const note = typeof e.note === 'string' ? e.note : null;
    const res = await pool.query(
      `UPDATE team_members SET
         employment_start_date   = COALESCE($2::date, employment_start_date),
         employment_end_date     = COALESCE($3::date, employment_end_date),
         leave_opening_used_days = COALESCE($4::numeric, leave_opening_used_days),
         employment_note         = COALESCE($5, employment_note)
       WHERE lower(name) = lower($1) AND active`,
      [e.name, e.start ?? null, e.end ?? null, openingUsed, note],
    );
    console.log(`[employment] ${e.name}: start=${e.start ?? '—'} end=${e.end ?? '—'} openingUsed=${openingUsed ?? '—'} note=${note ? 'set' : '—'} (${res.rowCount ?? 0} row)`);
  }
}
