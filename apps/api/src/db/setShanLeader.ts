/**
 * Owner's rule (2026-09-08): Shan leads every event he's assigned to — he's the
 * one on the road who updates the live status. Going forward the staffing engine
 * does this automatically; this backfills the current upcoming events. Gated by
 * SET_SHAN_LEADER=true; idempotent (re-running just re-asserts Shan as leader).
 */
import { pool } from './pool.js';

export async function setShanLeaderFromEnv(): Promise<void> {
  if (String(process.env.SET_SHAN_LEADER ?? '').toLowerCase() !== 'true') return;
  const shan = (await pool.query<{ id: string }>(`SELECT id FROM team_members WHERE name ILIKE 'shan%' AND active LIMIT 1`)).rows[0];
  if (!shan) { console.log('[shan-leader] Shan not found'); return; }

  const evs = await pool.query<{ event_id: string }>(
    `SELECT DISTINCT es.event_id
       FROM event_staff es JOIN events e ON e.id = es.event_id
      WHERE es.assignee_id = $1 AND e.phase <> 'Cancelled'
        AND (COALESCE(e.date_tbd, false) OR e.event_date >= current_date)`,
    [shan.id],
  );
  let n = 0;
  for (const { event_id } of evs.rows) {
    await pool.query(`UPDATE event_staff SET is_leader = false WHERE event_id = $1`, [event_id]);
    await pool.query(`DELETE FROM event_staff WHERE event_id = $1 AND role = 'leader'`, [event_id]);
    await pool.query(
      `INSERT INTO event_staff (event_id, role, slot, assignee_id, is_leader, status, reason, source)
       VALUES ($1,'leader',1,$2,true,'assigned','Event leader','Leader')`,
      [event_id, shan.id],
    );
    n++;
  }
  console.log(`[shan-leader] Shan set as leader for ${n} upcoming event(s)`);
}
