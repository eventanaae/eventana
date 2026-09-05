/**
 * Regenerate prep tasks for upcoming events. Gated by REGEN_PREP:
 *   REGEN_PREP=missing  → only events (today-onward) that currently have NONE
 *   REGEN_PREP=all      → every non-cancelled event today-onward (so existing
 *                         ones pick up newly-mapped label-based tasks too)
 * Same work the dashboard "Generate prep for all upcoming events" button does;
 * generatePrepTasks preserves completed tasks on a rebuild. Logs per event.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[prep-gen] ${s}`);

export async function generatePrepMissingFromEnv(): Promise<void> {
  const mode = String(process.env.REGEN_PREP ?? '').toLowerCase();
  if (mode !== 'missing' && mode !== 'all') return;
  const { generatePrepTasks } = await import('../domain/prep.js');
  try {
    const onlyMissing = mode === 'missing';
    const { rows } = await pool.query(
      `SELECT e.id, to_char(e.event_date,'YYYY-MM-DD') AS date, c.name AS customer
         FROM events e LEFT JOIN customers c ON c.id = e.customer_id
        WHERE e.phase <> 'Cancelled' AND e.event_date >= CURRENT_DATE
          ${onlyMissing ? 'AND NOT EXISTS (SELECT 1 FROM prep_tasks pt WHERE pt.event_id = e.id)' : ''}
        ORDER BY e.event_date`,
    );
    P(`mode=${mode} — events to (re)generate: ${rows.length}`);
    let events = 0; let created = 0;
    for (const r of rows) {
      try {
        const res = await generatePrepTasks(r.id);
        if (res) { events++; created += res.created; P(`  ${r.id} "${r.customer}" ${r.date} → ${res.created} tasks`); }
        else P(`  ${r.id} "${r.customer}" ${r.date} → SKIPPED (null)`);
      } catch (err) {
        P(`  ${r.id} "${r.customer}" ${r.date} → FAILED: ${(err as Error).message}`);
      }
    }
    P(`DONE — ${events} events, ${created} tasks total`);
  } catch (e) {
    P(`FAILED: ${(e as Error).message}`);
  }
}
