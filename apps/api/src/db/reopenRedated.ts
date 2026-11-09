/**
 * One-shot data fix (gated SET_SHAN_LEADER='reopenfix'): events that auto-completed
 * on their OLD date and were later moved to a future date still sit under "Past
 * events" as Event Completed. Lists every such event, re-opens it (Booking
 * Confirmed) and re-aligns its reminders/feedback to the new date. Also LISTS
 * (no change) date-TBD events with a past date that have crew assigned — those
 * drop out of the part-timer/driver report until a real date is confirmed.
 */
import { pool } from './pool.js';
import { reopenIfMovedToFuture, reAlignPendingNotifications } from '../domain/lifecycle.js';

export async function reopenRedatedFromEnv(): Promise<void> {
  if (String(process.env.SET_SHAN_LEADER ?? '').toLowerCase() !== 'reopenfix') return;
  try {
    const { rows } = await pool.query(
      `SELECT e.id, to_char(e.event_date,'YYYY-MM-DD') d, e.start_time, e.base_end_time, COALESCE(c.name,'') cust
         FROM events e LEFT JOIN customers c ON c.id = e.customer_id
        WHERE e.phase = 'Event Completed' AND e.cancelled_at IS NULL
          AND (COALESCE(e.date_tbd,false)
               OR (e.base_end_time ~ '^[0-2][0-9]:[0-5][0-9]$'
                   AND ((e.event_date + e.base_end_time::time) AT TIME ZONE 'Asia/Dubai') > now()))
        ORDER BY e.event_date`,
    );
    for (const r of rows) {
      const ok = await reopenIfMovedToFuture(r.id);
      if (ok) await reAlignPendingNotifications(r.id);
      console.log(`REOPEN|${r.id}|${r.cust}|${r.d} ${r.start_time}-${r.base_end_time}|${ok ? 'RE-OPENED' : 'skipped'}`);
    }
    console.log(`REOPENSUM|${rows.length} event(s) completed with a future date`);
    const tbd = await pool.query(
      `SELECT e.id, to_char(e.event_date,'YYYY-MM-DD') d, e.phase, COALESCE(c.name,'') cust,
              string_agg(es.role || ':' || COALESCE(es.part_time_name, '(staff)'), ', ') crew
         FROM events e JOIN event_staff es ON es.event_id = e.id LEFT JOIN customers c ON c.id = e.customer_id
        WHERE COALESCE(e.date_tbd,false) AND e.cancelled_at IS NULL AND e.event_date < CURRENT_DATE
          AND es.role IN ('clown','acrobat_clown','face_painting','balloon_artist','balloon_twisting','driver','pt_driver')
        GROUP BY e.id, e.event_date, e.phase, c.name ORDER BY e.event_date`,
    );
    for (const r of tbd.rows) console.log(`TBDPAST|${r.id}|${r.cust}|${r.d}|${r.phase}|${r.crew}`);
    console.log(`TBDPASTSUM|${tbd.rows.length}`);
  } catch (err) {
    console.error('[reopenfix] failed:', (err as Error).message);
  }
}
