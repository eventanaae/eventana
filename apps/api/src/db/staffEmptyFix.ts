/**
 * One-off: run crew auto-assignment ONLY for upcoming events that currently have
 * NO assigned crew (typically QuickBooks-converted / imported bookings the old
 * requirements engine couldn't read, e.g. "Medium Main Backdrop" / "Host
 * service"). Gated by STAFF_EMPTY_FIX=true.
 *
 * Crucially it SKIPS any event that already has crew, so a team the owner
 * arranged by hand is never overwritten. Idempotent.
 */
import { pool } from './pool.js';

export async function staffEmptyFixFromEnv(): Promise<void> {
  if (String(process.env.STAFF_EMPTY_FIX ?? '').toLowerCase() !== 'true') return;
  try {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT e.id FROM events e
        WHERE e.phase <> 'Cancelled' AND e.event_date >= CURRENT_DATE - 1
          AND NOT EXISTS (
            SELECT 1 FROM event_staff es
             WHERE es.event_id = e.id AND es.assignee_id IS NOT NULL AND es.is_leader = false)
          AND NOT EXISTS (
            SELECT 1 FROM event_staff es
             WHERE es.event_id = e.id AND es.part_time_name IS NOT NULL)
        ORDER BY e.event_date`,
    );
    const { assignStaffForEvent } = await import('../domain/staffing.js');
    let ok = 0, fail = 0;
    for (const e of rows) {
      try { await assignStaffForEvent(e.id); ok++; }
      catch (err) { fail++; console.error(`[staff-empty] ${e.id} failed: ${(err as Error).message.slice(0, 80)}`); }
    }
    console.log(`[staff-empty] done — ${ok} empty-team event(s) staffed, ${fail} failed.`);
  } catch (err) {
    console.error('[staff-empty] failed:', (err as Error).message);
  }
}
