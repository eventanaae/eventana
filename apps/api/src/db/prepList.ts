/**
 * List the prep task titles per event so we can eyeball that each product mapped
 * to the right tasks. Gated by PREP_LIST=<eventId>[,<eventId>...] (or "all" for
 * every non-cancelled event today-onward). Read-only.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[prep-list] ${s}`);

export async function prepListFromEnv(): Promise<void> {
  const raw = String(process.env.PREP_LIST ?? '').trim();
  if (!raw) return;
  let ids: string[];
  if (raw.toLowerCase() === 'all') {
    const { rows } = await pool.query(
      `SELECT id FROM events WHERE phase <> 'Cancelled' AND event_date >= CURRENT_DATE ORDER BY event_date`);
    ids = rows.map((r: any) => r.id);
  } else {
    ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  for (const id of ids) {
    try {
      const meta = await pool.query(
        `SELECT c.name AS customer, p.name AS package, t.name AS theme
           FROM events e LEFT JOIN customers c ON c.id = e.customer_id
           LEFT JOIN packages p ON p.id = e.package_id
           LEFT JOIN themes t ON t.id = e.theme_id WHERE e.id = $1`, [id]);
      const m = meta.rows[0] ?? {};
      const tasks = await pool.query(
        `SELECT title, category, status,
                (SELECT string_agg(tm.name, ', ') FROM prep_task_staff pts
                   JOIN team_members tm ON tm.id = pts.member_id WHERE pts.task_id = pt.id) AS who
           FROM prep_tasks pt WHERE pt.event_id = $1 ORDER BY category DESC, title`, [id]);
      P(`${id} "${m.customer ?? '?'}" pkg=${m.package ?? '—'} theme=${m.theme ?? '—'} → ${tasks.rowCount} tasks`);
      for (const t of tasks.rows) P(`    [${t.category}] ${t.title} — ${t.who ?? 'UNASSIGNED'} (${t.status})`);
    } catch (err) {
      P(`${id} failed: ${(err as Error).message}`);
    }
  }
  P('DONE');
}
