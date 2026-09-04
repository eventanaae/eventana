/**
 * One-off: re-run the crew auto-assignment for every upcoming event with the
 * corrected engine (one person = one role per event, no double-booking; a leader
 * is always someone who holds a role). Fixes events whose team was assigned by
 * the older logic. Gated by REASSIGN_ALL=true. Idempotent.
 *
 * Note: this re-computes the internal plan, so any part-time slot returns to
 * "needs a part-timer" for the team to re-confirm — it does not invent names.
 */
import { pool } from './pool.js';

export async function reassignAllFromEnv(): Promise<void> {
  if (String(process.env.REASSIGN_ALL ?? '').toLowerCase() !== 'true') return;
  try {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM events
        WHERE phase <> 'Cancelled' AND event_date >= CURRENT_DATE - 1
        ORDER BY event_date`,
    );
    const { assignStaffForEvent } = await import('../domain/staffing.js');
    let ok = 0, fail = 0, dup = 0;
    for (const e of rows) {
      try {
        await assignStaffForEvent(e.id);
        // Sanity check: no member should now hold two role slots on this event.
        const d = await pool.query(
          `SELECT count(*)::int c FROM (
             SELECT assignee_id FROM event_staff
              WHERE event_id = $1 AND assignee_id IS NOT NULL AND is_leader = false
              GROUP BY assignee_id HAVING count(*) > 1) x`,
          [e.id],
        );
        if (Number(d.rows[0].c) > 0) { dup++; console.log(`[reassign] ${e.id}: STILL has a doubled member`); }
        ok++;
      } catch (err) {
        fail++;
        console.error(`[reassign] ${e.id} failed: ${(err as Error).message.slice(0, 80)}`);
      }
    }
    console.log(`[reassign] done — ${ok} event(s) reassigned, ${fail} failed, ${dup} still doubled.`);
  } catch (err) {
    console.error('[reassign] failed:', (err as Error).message);
  }
}
