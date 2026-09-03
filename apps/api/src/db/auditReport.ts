/**
 * Read-only audit report, logged to the boot log so it can be inspected without
 * DB access. Gated by AUDIT_REPORT=true. Sends NOTHING, changes NOTHING — pure
 * SELECTs. Produces the per-Sale / per-customer notification picture the owner
 * asked for: which events have valid contact info, whether their notifications
 * are scheduled / sent / cancelled, and whether QuickBooks-imported or manual
 * sales entered the notification workflow at all.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[audit] ${s}`);

export async function auditReportFromEnv(): Promise<void> {
  if (process.env.AUDIT_REPORT !== 'true') return;
  try {
    // ── Totals ────────────────────────────────────────────────────────────
    const totals = await pool.query(`
      SELECT
        (SELECT count(*) FROM events)                                        AS events,
        (SELECT count(*) FROM events WHERE event_date >= current_date)       AS upcoming,
        (SELECT count(*) FROM events WHERE phase = 'Cancelled')              AS cancelled,
        (SELECT count(*) FROM orders)                                        AS orders,
        (SELECT count(*) FROM finance_receipts)                              AS receipts,
        (SELECT count(*) FROM finance_invoices)                              AS invoices,
        (SELECT count(*) FROM customers)                                     AS customers,
        (SELECT count(*) FROM expenses)                                      AS expenses,
        (SELECT count(*) FROM expenses WHERE source = 'quickbooks')          AS qb_expenses,
        (SELECT count(*) FROM expenses WHERE receipt_url IS NOT NULL)        AS expenses_with_receipt,
        (SELECT count(*) FROM notifications)                                 AS notifs
    `);
    P(`TOTALS ${JSON.stringify(totals.rows[0])}`);

    // ── Notification queue by template + delivery state ──────────────────
    const byTpl = await pool.query(`
      SELECT template, channel,
             count(*) AS total,
             count(*) FILTER (WHERE sent_at IS NOT NULL)          AS sent,
             count(*) FILTER (WHERE whatsapp_sent_at IS NOT NULL) AS wa_sent,
             count(*) FILTER (WHERE cancelled_at IS NOT NULL)     AS cancelled,
             count(*) FILTER (WHERE sent_at IS NULL AND cancelled_at IS NULL
                               AND (scheduled_for IS NULL OR scheduled_for <= now())) AS due_unsent,
             count(*) FILTER (WHERE sent_at IS NULL AND cancelled_at IS NULL
                               AND scheduled_for > now())         AS future
        FROM notifications
       GROUP BY template, channel ORDER BY template, channel
    `);
    for (const r of byTpl.rows) P(`TPL ${JSON.stringify(r)}`);

    // ── Contact-data health across events ────────────────────────────────
    const contact = await pool.query(`
      SELECT
        count(*)                                                              AS events,
        count(*) FILTER (WHERE c.email IS NULL OR btrim(c.email) = '')        AS no_email,
        count(*) FILTER (WHERE c.email IS NOT NULL AND c.email NOT LIKE '%_@_%._%') AS bad_email,
        count(*) FILTER (WHERE c.phone IS NULL OR btrim(c.phone) = '')        AS no_phone,
        count(*) FILTER (WHERE e.customer_id IS NULL)                         AS no_customer
        FROM events e LEFT JOIN customers c ON c.id = e.customer_id
    `);
    P(`CONTACT ${JSON.stringify(contact.rows[0])}`);

    // ── Upcoming events: is every expected notification scheduled? ───────
    const upcoming = await pool.query(`
      SELECT e.id, to_char(e.event_date,'YYYY-MM-DD') AS d, e.start_time, e.phase,
             c.name, (c.email IS NOT NULL AND btrim(c.email)<>'') AS has_email,
             (c.phone IS NOT NULL AND btrim(c.phone)<>'') AS has_phone,
             o.status AS ostatus,
             (SELECT count(*) FROM notifications n WHERE n.event_id=e.id AND n.template='booking_confirmation') AS conf,
             (SELECT count(*) FROM notifications n WHERE n.event_id=e.id AND n.template='three_day_reminder' AND n.cancelled_at IS NULL) AS rem3,
             (SELECT count(*) FROM notifications n WHERE n.event_id=e.id AND n.template='event_day' AND n.cancelled_at IS NULL) AS evday,
             (SELECT count(*) FROM notifications n WHERE n.event_id=e.id AND n.template='feedback_request' AND n.cancelled_at IS NULL) AS fb
        FROM events e LEFT JOIN customers c ON c.id=e.customer_id LEFT JOIN orders o ON o.id=e.order_id
       WHERE e.event_date >= current_date AND e.phase <> 'Cancelled'
       ORDER BY e.event_date LIMIT 60
    `);
    P(`UPCOMING count=${upcoming.rows.length}`);
    for (const r of upcoming.rows) {
      const gaps = [];
      if (!r.conf) gaps.push('noConfRow');
      if (!r.rem3) gaps.push('no3day');
      if (!r.evday) gaps.push('noEventDay');
      if (!r.fb) gaps.push('noFeedback');
      if (!r.has_email) gaps.push('NO_EMAIL');
      if (!r.has_phone) gaps.push('NO_PHONE');
      P(`EV ${r.id} ${r.d} ${r.start_time} ${r.phase} "${r.name ?? '—'}" ${r.ostatus ?? '—'} ${gaps.length ? '⚠ ' + gaps.join(',') : 'ok'}`);
    }

    // ── Past events with a still-DUE unsent customer notification (would a
    //    late message fire?) ────────────────────────────────────────────
    const stale = await pool.query(`
      SELECT count(DISTINCT n.event_id) AS events, count(*) AS rows
        FROM notifications n JOIN events e ON e.id=n.event_id
       WHERE n.channel='email' AND n.sent_at IS NULL AND n.cancelled_at IS NULL
         AND (n.scheduled_for IS NULL OR n.scheduled_for <= now())
         AND e.event_date < current_date
         AND n.template IN ('booking_confirmation','three_day_reminder','event_day','feedback_request')
    `);
    P(`STALE_PAST_DUE ${JSON.stringify(stale.rows[0])}`);

    // ── QuickBooks-sourced sales that never entered the notification flow ─
    // (finance rows from QB with no matching notifications for their event.)
    const qbNoNotif = await pool.query(`
      SELECT count(*) AS qb_receipts,
             count(*) FILTER (WHERE r.event_id IS NULL) AS qb_receipts_no_event
        FROM finance_receipts r WHERE r.source = 'quickbooks'
    `).catch(() => ({ rows: [{ note: 'finance_receipts.source query failed' }] }));
    P(`QB_SALES ${JSON.stringify(qbNoNotif.rows[0])}`);

    P('DONE');
  } catch (e) {
    console.error('[audit] failed:', (e as Error).message);
  }
}
