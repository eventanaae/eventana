/**
 * One-off backfill: generate prep tasks for every upcoming (today-onward),
 * non-cancelled event that currently has NONE — the same work the dashboard
 * "Generate prep for all upcoming events" button does, but scoped to the events
 * that are actually missing so we don't disturb ones already prepared. Gated by
 * GENERATE_PREP_MISSING=true. Logs what it created per event.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[prep-gen] ${s}`);

export async function generatePrepMissingFromEnv(): Promise<void> {
  if (String(process.env.GENERATE_PREP_MISSING ?? '').toLowerCase() !== 'true') return;
  const { generatePrepTasks } = await import('../domain/prep.js');
  try {
    const { rows } = await pool.query(
      `SELECT e.id, to_char(e.event_date,'YYYY-MM-DD') AS date, c.name AS customer
         FROM events e LEFT JOIN customers c ON c.id = e.customer_id
        WHERE e.phase <> 'Cancelled' AND e.event_date >= CURRENT_DATE
          AND NOT EXISTS (SELECT 1 FROM prep_tasks pt WHERE pt.event_id = e.id)
        ORDER BY e.event_date`,
    );
    P(`upcoming events missing prep: ${rows.length}`);
    let events = 0; let created = 0;
    for (const r of rows) {
      try {
        const res = await generatePrepTasks(r.id);
        if (res) { events++; created += res.created; P(`  ${r.id} "${r.customer}" ${r.date} → created ${res.created} tasks`); }
        else P(`  ${r.id} "${r.customer}" ${r.date} → SKIPPED (generator returned null)`);
      } catch (err) {
        P(`  ${r.id} "${r.customer}" ${r.date} → FAILED: ${(err as Error).message}`);
      }
    }
    P(`DONE — ${events} events prepared, ${created} tasks created`);
  } catch (e) {
    P(`FAILED: ${(e as Error).message}`);
  }
}
