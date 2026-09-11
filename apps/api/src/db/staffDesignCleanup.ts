/**
 * One-shot: apply the owner's rule to EXISTING upcoming events — the remote
 * designer (Marsha) belongs in "Team for this event" ONLY when the order has
 * shop items to buy/print (the giveaways/extras 'design' slot). A 'design' slot
 * that exists purely for a CUSTOM THEME is back-office design (already covered by
 * the prep Cricut/New-Backdrop tasks) and must NOT put her on the day-of team.
 *
 * Surgical: removes only the custom-theme 'design' event_staff rows (identified
 * by their source/reason) and re-syncs the event_team mirror — it never touches
 * any other assignment or a manually confirmed part-timer. Gated by
 * STAFF_DESIGN_CLEANUP=true; run once, then turn the flag off.
 */
import { pool } from './pool.js';

export async function staffDesignCleanupFromEnv(): Promise<void> {
  if (String(process.env.STAFF_DESIGN_CLEANUP ?? '').toLowerCase() !== 'true') return;
  const L = (s: string) => console.log(`[design-cleanup] ${s}`);
  try {
    // 1. Delete the custom-theme-only design slots on upcoming, non-cancelled events.
    const del = await pool.query<{ event_id: string }>(
      `DELETE FROM event_staff es
         USING events e
        WHERE es.event_id = e.id
          AND es.role = 'design'
          AND es.is_leader = false
          AND (es.source = 'Custom theme' OR es.reason ILIKE '%custom theme%')
          AND e.phase IS DISTINCT FROM 'Cancelled'
          AND e.event_date >= CURRENT_DATE
        RETURNING es.event_id`,
    );
    const events = Array.from(new Set(del.rows.map((r) => r.event_id)));
    L(`removed ${del.rowCount ?? 0} custom-theme design slot(s) across ${events.length} event(s)`);

    // 2. Re-sync the event_team mirror for those events: drop any member who is no
    //    longer backed by a real event_staff assignee (i.e. the dropped designer).
    let cleaned = 0;
    for (const evId of events) {
      const r = await pool.query(
        `DELETE FROM event_team et
          WHERE et.event_id = $1
            AND et.member_id NOT IN (
              SELECT assignee_id FROM event_staff WHERE event_id = $1 AND assignee_id IS NOT NULL
            )`,
        [evId],
      );
      cleaned += r.rowCount ?? 0;
    }
    L(`event_team rows removed: ${cleaned}`);
    L('DONE');
  } catch (e) {
    console.error('[design-cleanup] failed:', (e as Error).message);
  }
}
