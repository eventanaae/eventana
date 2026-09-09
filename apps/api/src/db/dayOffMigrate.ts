/**
 * One boot task (gated by DAYOFF_MIGRATE=true) that does two owner-approved
 * things, both idempotent and safe to re-run:
 *   1. Ensure the day_off_change_requests table exists (so the self-service
 *      "move my day off" flow works even when RUN_MIGRATIONS_ON_BOOT is off).
 *   2. Remove Razan & Noon completely — they were never real employees. Deleted
 *      outright when they carry no history (events/leave/days-off/warnings/
 *      feedback); if a foreign key or history is in the way, deactivated instead
 *      (active=false, weekly_day_off cleared) so nothing is silently destroyed.
 * Turn the flag off after it runs.
 */
import { pool } from './pool.js';

const DDL = `
CREATE TABLE IF NOT EXISTS day_off_change_requests (
  id            BIGSERIAL PRIMARY KEY,
  member_id     TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  requested_day SMALLINT NOT NULL CHECK (requested_day BETWEEN 0 AND 6),
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by    TEXT,
  decided_at    TIMESTAMPTZ,
  decision_note TEXT
);
CREATE INDEX IF NOT EXISTS dayoff_change_member_idx ON day_off_change_requests (member_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS dayoff_change_status_idx ON day_off_change_requests (status);`;

export async function applyDayOffMigrateFromEnv(): Promise<void> {
  if (String(process.env.DAYOFF_MIGRATE ?? '').toLowerCase() !== 'true') return;
  const L = (s: string) => console.log(`[dayoff-migrate] ${s}`);
  try {
    await pool.query(DDL);
    L('ensured day_off_change_requests table');

    // 2. Remove Razan & Noon (first-name match, mirrors isLeaveExcluded).
    const members = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM team_members
        WHERE lower(btrim(name)) IN ('razan','noon')
           OR lower(btrim(name)) LIKE 'razan %'
           OR lower(btrim(name)) LIKE 'noon %'`,
    );
    if (members.rows.length === 0) L('no Razan/Noon members found (already removed)');
    for (const m of members.rows) {
      const c = (await pool.query(
        `SELECT
           (SELECT count(*) FROM event_team     WHERE member_id = $1) AS events,
           (SELECT count(*) FROM staff_days_off WHERE member_id = $1) AS days_off,
           (SELECT count(*) FROM leave_requests WHERE member_id = $1) AS leaves,
           (SELECT count(*) FROM staff_warnings WHERE member_id = $1) AS warnings,
           (SELECT count(*) FROM staff_feedback WHERE member_id = $1) AS feedback`,
        [m.id],
      )).rows[0];
      const total = ['events', 'days_off', 'leaves', 'warnings', 'feedback'].reduce((s, k) => s + Number(c[k]), 0);
      if (total === 0) {
        try {
          await pool.query(`DELETE FROM team_members WHERE id = $1`, [m.id]);
          L(`DELETED ${m.name} (${m.id}) — no history, fully removed`);
        } catch (e) {
          await pool.query(`UPDATE team_members SET active = false, weekly_day_off = NULL WHERE id = $1`, [m.id]);
          L(`could not delete ${m.name} (${(e as Error).message.slice(0, 90)}) — DEACTIVATED instead`);
        }
      } else {
        await pool.query(`UPDATE team_members SET active = false, weekly_day_off = NULL WHERE id = $1`, [m.id]);
        L(`DEACTIVATED ${m.name} (${m.id}) — has history (events=${c.events}, days_off=${c.days_off}, leaves=${c.leaves}, warnings=${c.warnings}, feedback=${c.feedback})`);
      }
    }
    L('DONE');
  } catch (e) {
    L(`error: ${(e as Error).message.slice(0, 200)}`);
  }
}
