/**
 * Apply the owner's event-leader priority to every upcoming event: the leader is
 * the highest person on the crew in the order Shan › Jane › Dindo › Diana ›
 * Gloria › Marsha (Marsha leads remotely). Going forward the staffing engine does
 * this automatically; this backfills the current events. Gated by
 * SET_SHAN_LEADER=true; idempotent.
 */
import { pool } from './pool.js';

const PRIORITY = ['shan', 'jane', 'dindo', 'diana', 'gloria', 'marsha'];
const firstLc = (n: string | null) => (n ?? '').trim().split(/\s+/)[0].toLowerCase();

export async function setShanLeaderFromEnv(): Promise<void> {
  if (String(process.env.SET_SHAN_LEADER ?? '').toLowerCase() !== 'true') return;
  const evs = await pool.query<{ id: string }>(
    `SELECT id FROM events WHERE phase <> 'Cancelled' AND (COALESCE(date_tbd, false) OR event_date >= current_date)`,
  );
  let n = 0;
  for (const { id } of evs.rows) {
    const crew = await pool.query<{ assignee_id: string; name: string }>(
      `SELECT es.assignee_id, tm.name FROM event_staff es JOIN team_members tm ON tm.id = es.assignee_id
        WHERE es.event_id = $1 AND es.assignee_id IS NOT NULL AND es.status IN ('assigned','confirmed')`,
      [id],
    );
    if (crew.rows.length === 0) continue;
    let leaderId: string | null = null;
    let remote = false;
    for (const name of PRIORITY) {
      const hit = crew.rows.find((r) => firstLc(r.name) === name);
      if (hit) { leaderId = hit.assignee_id; remote = name === 'marsha'; break; }
    }
    if (!leaderId) continue;
    await pool.query(`UPDATE event_staff SET is_leader = false WHERE event_id = $1`, [id]);
    await pool.query(`DELETE FROM event_staff WHERE event_id = $1 AND role = 'leader'`, [id]);
    await pool.query(
      `INSERT INTO event_staff (event_id, role, slot, assignee_id, is_leader, status, reason, source)
       VALUES ($1,'leader',1,$2,true,'assigned',$3,'Leader')`,
      [id, leaderId, remote ? 'Remote event leader' : 'Event leader'],
    );
    n++;
  }
  console.log(`[leader-priority] applied leader priority to ${n} upcoming event(s)`);
}
