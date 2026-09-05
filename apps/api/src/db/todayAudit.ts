/**
 * Read-only HOME/UPCOMING audit, logged to the boot log. Gated by TODAY_AUDIT=true.
 * Lists every non-cancelled event from today onward with its order linkage, and
 * flags the ones the OLD Home query silently dropped (missing order row, or a
 * TBD/undated date) — the "a manual event didn't show on Home" report. Reads
 * only; changes nothing.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[today-audit] ${s}`);

export async function todayAuditFromEnv(): Promise<void> {
  if (String(process.env.TODAY_AUDIT ?? '').toLowerCase() !== 'true') return;
  try {
    const { rows } = await pool.query(
      `SELECT e.id, to_char(e.event_date,'YYYY-MM-DD') AS d, e.date_tbd, e.phase,
              e.order_id, (o.id IS NOT NULL) AS order_exists, c.name AS customer
         FROM events e
         LEFT JOIN customers c ON c.id = e.customer_id
         LEFT JOIN orders o ON o.id = e.order_id
        WHERE e.phase <> 'Cancelled'
          AND (e.event_date >= CURRENT_DATE OR e.event_date IS NULL)
        ORDER BY e.event_date NULLS FIRST, e.id`,
    );
    P(`upcoming non-cancelled events: ${rows.length}`);
    let droppedNoOrder = 0, droppedNoDate = 0;
    for (const r of rows) {
      const dropped: string[] = [];
      if (!r.order_exists) { dropped.push('NO-ORDER-ROW'); droppedNoOrder++; }
      if (!r.d) { dropped.push('NO-DATE'); droppedNoDate++; }
      P(`  ${r.id} · ${r.d ?? 'TBD'} · ${r.phase} · ${r.customer ?? '?'} · order=${r.order_id ?? 'null'}(${r.order_exists ? 'ok' : 'MISSING'})${dropped.length ? ' · WAS-DROPPED: ' + dropped.join(',') : ''}`);
    }
    P(`old Home query would drop: ${droppedNoOrder} (no order) + ${droppedNoDate} (no date). New query shows all ${rows.length}.`);
    P('done.');
  } catch (err) {
    console.error('[today-audit] failed:', (err as Error).message);
  }
}
