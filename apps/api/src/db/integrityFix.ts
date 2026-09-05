/**
 * One-off data-integrity repairs flagged by DATA_AUDIT. Gated by INTEGRITY_FIX=true.
 * Idempotent. Changes data but sends NOTHING.
 *
 *  1) Align every order cart's date/time snapshot to its event, so the cart can
 *     never disagree with the event (removes the "cart date <> event" flag).
 *  2) Cancel pending, unsent CUSTOMER notifications for any event whose customer
 *     is UNREACHABLE (no valid email AND a placeholder phone) — those sends would
 *     only bounce/fail, and nothing should try to reach a customer we can't.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[integrity-fix] ${s}`);

export async function integrityFixFromEnv(): Promise<void> {
  if (process.env.INTEGRITY_FIX !== 'true') return;
  try {
    // 1) Cart date/time snapshot ← event (only carts that already carry the key).
    const align = await pool.query(
      `UPDATE orders o
          SET cart = jsonb_set(
                       jsonb_set(cart, '{eventDate}', to_jsonb(to_char(e.event_date,'YYYY-MM-DD'))),
                       '{startTime}', to_jsonb(e.start_time))
         FROM events e
        WHERE e.order_id = o.id AND e.phase <> 'Cancelled' AND cart ? 'eventDate'
          AND (cart->>'eventDate' IS DISTINCT FROM to_char(e.event_date,'YYYY-MM-DD')
               OR cart->>'startTime' IS DISTINCT FROM e.start_time)`,
    );
    P(`cart date/time aligned to event on ${align.rowCount ?? 0} order(s)`);

    // 2) Suppress pending customer sends for UNREACHABLE customers.
    const supp = await pool.query(
      `UPDATE notifications n SET cancelled_at = now()
         FROM events e JOIN customers c ON c.id = e.customer_id
        WHERE n.event_id = e.id
          AND n.channel IN ('email','whatsapp')
          AND n.sent_at IS NULL AND n.whatsapp_sent_at IS NULL AND n.cancelled_at IS NULL
          AND (c.email IS NULL OR c.email !~ '@')
          AND (c.phone IS NULL OR c.phone ~ '^[0+ ]*$' OR length(regexp_replace(c.phone,'\\D','','g')) < 7)
        RETURNING n.event_id`,
    );
    const evs = Array.from(new Set((supp.rows as any[]).map((r) => r.event_id)));
    P(`suppressed ${supp.rowCount ?? 0} pending send(s) for ${evs.length} unreachable event(s): ${evs.join(', ') || '—'}`);
    P('DONE');
  } catch (err) {
    console.error('[integrity-fix] failed:', (err as Error).message);
  }
}
