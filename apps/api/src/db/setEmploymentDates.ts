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

interface Entry { name: string; start?: string; end?: string; openingUsed?: number; note?: string; dayOff?: number | null; dob?: string; salaryIncrement?: string; passportName?: string; passportNumber?: string; emiratesId?: string; }

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
    // dayOff: 0–6 sets the weekly day off; null explicitly clears it; undefined leaves it.
    const dayOffProvided = e.dayOff !== undefined;
    const dayOff = typeof e.dayOff === 'number' ? e.dayOff : null;
    const dob = typeof e.dob === 'string' ? e.dob : null;
    const salaryIncrement = typeof e.salaryIncrement === 'string' ? e.salaryIncrement : null;
    const passportName = typeof e.passportName === 'string' ? e.passportName : null;
    const passportNumber = typeof e.passportNumber === 'string' ? e.passportNumber : null;
    const emiratesId = typeof e.emiratesId === 'string' ? e.emiratesId : null;
    const res = await pool.query(
      `UPDATE team_members SET
         employment_start_date   = COALESCE($2::date, employment_start_date),
         employment_end_date     = COALESCE($3::date, employment_end_date),
         leave_opening_used_days = COALESCE($4::numeric, leave_opening_used_days),
         employment_note         = COALESCE($5, employment_note),
         weekly_day_off          = CASE WHEN $6 THEN $7::smallint ELSE weekly_day_off END,
         birthday                = COALESCE($8::date, birthday),
         salary_increment_note   = COALESCE($9, salary_increment_note),
         passport_name           = COALESCE($10, passport_name),
         passport_number         = COALESCE($11, passport_number),
         emirates_id             = COALESCE($12, emirates_id)
       WHERE lower(name) = lower($1) AND active`,
      [e.name, e.start ?? null, e.end ?? null, openingUsed, note, dayOffProvided, dayOff, dob, salaryIncrement, passportName, passportNumber, emiratesId],
    );
    console.log(`[employment] ${e.name}: start=${e.start ?? '—'} dayOff=${dayOffProvided ? dayOff : '—'} dob=${dob ?? '—'} passport=${passportName ? 'set' : '—'} eid=${emiratesId ? 'set' : '—'} (${res.rowCount ?? 0} row)`);
  }
}
