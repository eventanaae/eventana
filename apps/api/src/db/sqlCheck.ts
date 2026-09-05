/**
 * One-off validation of the lifecycle VALUES/WHERE query shape used on the
 * booking-confirmation path (confirm.ts). Runs the SELECT part only (no insert,
 * no side effects) so we can prove the SQL is valid before trusting it on the
 * critical path. Gated by SQL_CHECK=true.
 */
import { pool } from './pool.js';

export async function sqlCheckFromEnv(): Promise<void> {
  if (String(process.env.SQL_CHECK ?? '').toLowerCase() !== 'true') return;
  try {
    const r = await pool.query(
      `SELECT channel, template, to_char(sched,'YYYY-MM-DD HH24:MI') AS sched FROM (VALUES
         ('email','booking_confirmation', now()),
         ('email','three_day_reminder', (now()::timestamptz - interval '3 days')),
         ('email','event_day', (now()::timestamptz + interval '2 hours')),
         ('email','feedback_request', (now()::timestamptz + interval '1 day')),
         ('whatsapp','feedback_request', (now()::timestamptz + interval '1 day')),
         ('driver','driver_new_order', now())
       ) v(channel,template,sched)
       WHERE v.sched > now() OR v.template IN ('booking_confirmation','driver_new_order')`,
    );
    console.log(`[sql-check] OK — ${r.rowCount} rows kept: ${r.rows.map((x: any) => `${x.template}/${x.channel}`).join(', ')}`);
  } catch (e) {
    console.error('[sql-check] FAILED:', (e as Error).message);
  }
}
