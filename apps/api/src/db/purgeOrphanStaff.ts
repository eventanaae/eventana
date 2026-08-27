import { pool } from './pool.js';

/**
 * One-time cleanup of duplicate / test staff rows created during setup and QA.
 * Idempotent: once each row is gone, later runs are no-ops.
 *
 *  • tm-auth-smoke-test — a login smoke-test account (email @example.com). It
 *    carries a test password but no real work, so it is force-removed.
 *  • tm-sheem — a second, never-used owner row. The live owner is tm-shim,
 *    which holds the real email + password + login history. Guarded delete.
 *  • TM-443630 — a duplicate "Shan" employee row with NO login. The real driver
 *    is tm-shan (his invite email). The staffing engine assigned the DUPLICATE
 *    to six upcoming events, so we MERGE those assignments onto tm-shan before
 *    deleting the duplicate, keeping Shan on every event under one account.
 */
export async function purgeOrphanStaff(): Promise<void> {
  // 1) Force-remove the smoke-test account (clear its soft references first).
  await forceRemove('tm-auth-smoke-test');

  // 2) Guarded remove of the never-used second owner row.
  await guardedRemove('tm-sheem');

  // 3) Merge the duplicate Shan into the real driver account, then remove it.
  await mergeInto('TM-443630', 'tm-shan');
}

/** Delete a member outright after clearing the small tables that reference it. */
async function forceRemove(id: string): Promise<void> {
  try {
    const { rows } = await pool.query(`SELECT 1 FROM team_members WHERE id = $1`, [id]);
    if (!rows[0]) return;
    for (const sql of [
      `DELETE FROM staff_days_off WHERE member_id = $1`,
      `DELETE FROM staff_rewards WHERE member_id = $1`,
      `DELETE FROM tips WHERE member_id = $1`,
      `DELETE FROM event_team WHERE member_id = $1`,
      `UPDATE event_staff SET assignee_id = NULL WHERE assignee_id = $1`,
    ]) {
      await pool.query(sql, [id]).catch(() => {});
    }
    await pool.query(`DELETE FROM team_members WHERE id = $1`, [id]);
    console.log(`[cleanup] removed test account ${id}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${id}:`, err);
  }
}

/** Delete a member only when it has no login, no crew rows and no slots. */
async function guardedRemove(id: string): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT (password_hash IS NOT NULL) AS has_pw,
         (SELECT COUNT(*) FROM event_team et WHERE et.member_id = $1) AS teams,
         (SELECT COUNT(*) FROM event_staff es WHERE es.assignee_id = $1) AS slots
       FROM team_members WHERE id = $1`,
      [id],
    );
    const r = rows[0];
    if (!r) return;
    if (r.has_pw || Number(r.teams) > 0 || Number(r.slots) > 0) {
      console.warn(`[cleanup] keeping ${id} — it has a login or event history`);
      return;
    }
    await pool.query(`DELETE FROM team_members WHERE id = $1`, [id]);
    console.log(`[cleanup] removed duplicate account ${id}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${id}:`, err);
  }
}

/**
 * Merge a duplicate member (`from`) into the canonical one (`into`): move every
 * staffing slot and crew membership across (skipping any the target already
 * holds, to avoid double-booking), then delete the duplicate. The target keeps
 * its own login; the duplicate must have none.
 */
async function mergeInto(from: string, into: string): Promise<void> {
  try {
    const chk = await pool.query(
      `SELECT (SELECT COUNT(*) FROM team_members WHERE id = $1) AS from_exists,
              (SELECT COUNT(*) FROM team_members WHERE id = $2) AS into_exists,
              (SELECT password_hash IS NOT NULL FROM team_members WHERE id = $1) AS from_has_pw`,
      [from, into],
    );
    const c = chk.rows[0];
    if (!c || Number(c.from_exists) === 0) return; // already merged
    if (Number(c.into_exists) === 0) {
      console.warn(`[cleanup] cannot merge ${from} — target ${into} is missing`);
      return;
    }
    if (c.from_has_pw) {
      console.warn(`[cleanup] not merging ${from} — it has its own login`);
      return;
    }
    // Move staffing slots the target isn't already on; drop the rest as redundant.
    await pool.query(
      `UPDATE event_staff es SET assignee_id = $2
        WHERE es.assignee_id = $1
          AND NOT EXISTS (SELECT 1 FROM event_staff x WHERE x.event_id = es.event_id AND x.assignee_id = $2)`,
      [from, into],
    );
    await pool.query(`DELETE FROM event_staff WHERE assignee_id = $1`, [from]);
    // Mirror the same move onto the event_team roster.
    await pool.query(
      `UPDATE event_team et SET member_id = $2
        WHERE et.member_id = $1
          AND NOT EXISTS (SELECT 1 FROM event_team x WHERE x.event_id = et.event_id AND x.member_id = $2)`,
      [from, into],
    );
    await pool.query(`DELETE FROM event_team WHERE member_id = $1`, [from]);
    // Carry over any small side records, then remove the duplicate.
    for (const sql of [
      `UPDATE tips SET member_id = $2 WHERE member_id = $1`,
      `DELETE FROM staff_days_off WHERE member_id = $1`,
      `DELETE FROM staff_rewards WHERE member_id = $1`,
    ]) {
      await pool.query(sql, [from, into]).catch(() => {});
    }
    await pool.query(`DELETE FROM team_members WHERE id = $1`, [from]);
    console.log(`[cleanup] merged duplicate ${from} into ${into}`);
  } catch (err) {
    console.error(`[cleanup] failed to merge ${from} into ${into}:`, err);
  }
}
