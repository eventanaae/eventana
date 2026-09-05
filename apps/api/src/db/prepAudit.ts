/**
 * Audit which upcoming events are missing prep tasks (so they don't appear in
 * the dashboard "By event" prep list) and why. Gated by PREP_AUDIT=true.
 * Read-only. For every non-cancelled event from yesterday onward, prints the
 * prep-task count, whether it has an order row (prep generation INNER-JOINs
 * orders, so a missing order_id yields zero tasks), and its package.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[prep-audit] ${s}`);

export async function prepAuditFromEnv(): Promise<void> {
  if (String(process.env.PREP_AUDIT ?? '').toLowerCase() !== 'true') return;
  try {
    const { rows } = await pool.query(
      `SELECT e.id, to_char(e.event_date,'YYYY-MM-DD') AS date, c.name AS customer,
              e.phase, e.order_id,
              (o.id IS NOT NULL) AS has_order,
              (SELECT count(*)::int FROM prep_tasks pt WHERE pt.event_id = e.id) AS prep,
              (SELECT count(*)::int FROM event_services es WHERE es.event_id = e.id) AS line_items,
              p.name AS package
         FROM events e
         LEFT JOIN customers c ON c.id = e.customer_id
         LEFT JOIN orders o ON o.id = e.order_id
         LEFT JOIN packages p ON p.id = e.package_id
        WHERE e.phase <> 'Cancelled' AND e.event_date >= CURRENT_DATE - interval '1 day'
        ORDER BY e.event_date`,
    );
    P(`upcoming non-cancelled events (from yesterday): ${rows.length}`);
    let missing = 0;
    for (const r of rows) {
      const flag = r.prep === 0 ? ' ← NO PREP' : '';
      if (r.prep === 0) missing++;
      P(`  ${r.id} ${r.date} "${r.customer}" phase=${r.phase} prep=${r.prep} order=${r.has_order ? 'yes' : 'NO(' + (r.order_id ?? 'null') + ')'} items=${r.line_items} pkg=${r.package ?? '—'}${flag}`);
    }
    P(`events with NO prep tasks: ${missing}/${rows.length}`);
  } catch (e) {
    P(`FAILED: ${(e as Error).message}`);
  }
  P('DONE');
}
