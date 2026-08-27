import { pool } from './pool.js';

/**
 * One-time cleanup of duplicate / test staff rows created during setup and QA:
 *  • tm-auth-smoke-test — a login smoke-test account.
 *  • tm-sheem           — a second, never-used owner row (the live owner is
 *                         tm-shim, which holds the email + password + logins).
 *  • TM-443630          — a duplicate "Shan" employee row (the real driver is
 *                         tm-shan, which holds his invite email).
 *
 * Every removal is GUARDED: a row is deleted only when it has no password (was
 * never a real login), no crew memberships and no staffing slots — so this can
 * never remove an account that anyone actually uses or that carries event
 * history. Idempotent: once the rows are gone, later runs are no-ops.
 */
export async function purgeOrphanStaff(): Promise<void> {
  const ids = ['tm-auth-smoke-test', 'tm-sheem', 'TM-443630'];
  for (const id of ids) {
    try {
      const { rows } = await pool.query(
        `SELECT tm.id,
           (tm.password_hash IS NOT NULL) AS has_pw,
           (SELECT COUNT(*) FROM event_team et WHERE et.member_id = tm.id) AS teams,
           (SELECT COUNT(*) FROM event_staff es WHERE es.assignee_id = tm.id) AS slots
         FROM team_members tm WHERE tm.id = $1`,
        [id],
      );
      const r = rows[0];
      if (!r) continue;
      if (r.has_pw || Number(r.teams) > 0 || Number(r.slots) > 0) {
        console.warn(`[cleanup] keeping ${id} — it has a login or event history`);
        continue;
      }
      // Clear the few soft references it could carry, then remove the row.
      for (const sql of [
        `DELETE FROM staff_days_off WHERE member_id = $1`,
        `DELETE FROM staff_rewards WHERE member_id = $1`,
        `DELETE FROM tips WHERE member_id = $1`,
      ]) {
        await pool.query(sql, [id]).catch(() => {});
      }
      await pool.query(`DELETE FROM team_members WHERE id = $1`, [id]);
      console.log(`[cleanup] removed duplicate/test staff ${id}`);
    } catch (err) {
      console.error(`[cleanup] failed to purge ${id}:`, err);
    }
  }
}
