/**
 * One-shot backfill: every UPCOMING, non-cancelled event that already has a
 * "Main Backdrop" prep task but is missing the design "Cricut" task (because it
 * was booked before the design_cricut-on-backdrop rule) gets the Cricut task
 * added and assigned to Marsha. Surgical — it inserts ONLY the missing task and
 * never touches or resets any existing task (unlike a full re-generate). Gated
 * by PREP_CRICUT_BACKFILL=true; turn it off after one run.
 */
import { pool } from './pool.js';

export async function prepBackfillCricutFromEnv(): Promise<void> {
  if (String(process.env.PREP_CRICUT_BACKFILL ?? '').toLowerCase() !== 'true') return;
  const L = (s: string) => console.log(`[cricut-backfill] ${s}`);
  try {
    // Marsha (the only design-skill member) — assignee for every Cricut task.
    const marsha = (await pool.query<{ id: string }>(
      `SELECT id FROM team_members WHERE active AND lower(name) LIKE 'marsha%' LIMIT 1`,
    )).rows[0]?.id ?? null;
    if (!marsha) L('WARN: no active Marsha found — tasks will be created unassigned');

    // Upcoming, non-cancelled events with a backdrop prep task but no Cricut.
    const evs = (await pool.query<{ event_id: string; due: string }>(
      `SELECT DISTINCT pt.event_id,
              to_char(e.event_date - interval '5 days','YYYY-MM-DD') AS due
         FROM prep_tasks pt
         JOIN events e ON e.id = pt.event_id
        WHERE pt.key = 'prep_backdrop'
          AND e.phase IS DISTINCT FROM 'Cancelled'
          AND e.event_date >= CURRENT_DATE
          AND NOT EXISTS (
            SELECT 1 FROM prep_tasks c WHERE c.event_id = pt.event_id AND c.key = 'design_cricut'
          )`,
    )).rows;
    L(`events needing Cricut: ${evs.length}`);

    let added = 0;
    for (const ev of evs) {
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO prep_tasks (event_id, key, title, category, skill, people_needed, due_date, status)
         VALUES ($1,'design_cricut','Cricut','design','design',1,$2,'not_started') RETURNING id`,
        [ev.event_id, ev.due],
      );
      const taskId = ins.rows[0].id;
      if (marsha) {
        await pool.query(
          `INSERT INTO prep_task_staff (task_id, member_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [taskId, marsha],
        );
      }
      await pool.query(
        `INSERT INTO prep_task_log (task_id, event_id, action, detail, actor)
         VALUES ($1,$2,'generated','Cricut added (backdrop backfill)','system')`,
        [taskId, ev.event_id],
      ).catch(() => {});
      added++;
      L(`+ ${ev.event_id} → Cricut (due ${ev.due})`);
    }
    L(`DONE — added ${added} Cricut task(s)`);
  } catch (e) {
    console.error('[cricut-backfill] failed:', (e as Error).message);
  }
}
