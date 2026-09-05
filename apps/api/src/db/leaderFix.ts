/**
 * One-off: re-pick the Event Leader for every upcoming event from its CURRENT
 * roster, following the mandatory rule (Jane/Dindo lead whenever they're on the
 * crew; else first on-site crew; else Marsha remote). Gated by LEADER_FIX=true.
 *
 * Unlike REASSIGN_ALL this does NOT re-plan the crew — it PRESERVES the owner's
 * manual team picks and only corrects a stale `is_leader` marker (the customer's
 * "Leader" badge) that was left pointing at whoever led before she edited the
 * team. Idempotent.
 */
import { pool } from './pool.js';

export async function leaderFixFromEnv(): Promise<void> {
  if (String(process.env.LEADER_FIX ?? '').toLowerCase() !== 'true') return;
  try {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM events
        WHERE phase <> 'Cancelled' AND event_date >= CURRENT_DATE - 1
        ORDER BY event_date`,
    );
    const { recomputeEventLeader } = await import('../domain/staffing.js');
    let ok = 0, fail = 0;
    for (const e of rows) {
      try { await recomputeEventLeader(e.id); ok++; }
      catch (err) { fail++; console.error(`[leader-fix] ${e.id} failed: ${(err as Error).message.slice(0, 80)}`); }
    }
    console.log(`[leader-fix] done — ${ok} event(s) re-led, ${fail} failed.`);
  } catch (err) {
    console.error('[leader-fix] failed:', (err as Error).message);
  }
}
