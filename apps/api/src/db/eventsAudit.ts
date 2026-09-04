/**
 * Read-only EVENTS audit, logged to the boot log. Gated by EVENTS_AUDIT=true.
 * Finds duplicate events (the "same pink card 10+ times on Home" report) — same
 * customer + date + celebration grouped, and today's events — so we can see if
 * the DB holds duplicate event rows for one party. Sends/changes nothing.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[events-audit] ${s}`);

export async function eventsAuditFromEnv(): Promise<void> {
  if (String(process.env.EVENTS_AUDIT ?? '').toLowerCase() !== 'true') return;
  try {
    const dups = await pool.query(
      `SELECT c.name AS customer, to_char(e.event_date,'YYYY-MM-DD') AS d, e.celebration_type,
              count(*)::int n, array_agg(e.id ORDER BY e.id) AS ids
         FROM events e JOIN customers c ON c.id = e.customer_id
        WHERE e.phase <> 'Cancelled'
        GROUP BY c.name, e.event_date, e.celebration_type
       HAVING count(*) > 1
        ORDER BY n DESC LIMIT 40`,
    );
    P(`duplicate event groups (same customer+date+type): ${dups.rowCount}`);
    for (const r of dups.rows) P(`  ${r.customer} · ${r.d} · ${r.celebration_type} → ${r.n} events: ${(r.ids as string[]).join(', ')}`);
    const today = await pool.query(
      `SELECT c.name AS customer, count(*)::int n
         FROM events e JOIN customers c ON c.id = e.customer_id
        WHERE e.event_date = CURRENT_DATE AND e.phase <> 'Cancelled'
        GROUP BY c.name ORDER BY n DESC`,
    );
    P(`today's events by customer:`);
    for (const r of today.rows) P(`  ${r.customer}: ${r.n}`);
    const totalToday = await pool.query(`SELECT count(*)::int n FROM events WHERE event_date=CURRENT_DATE AND phase<>'Cancelled'`);
    P(`total non-cancelled events TODAY: ${totalToday.rows[0].n}`);
    P('done.');
  } catch (err) {
    console.error('[events-audit] failed:', (err as Error).message);
  }
}
