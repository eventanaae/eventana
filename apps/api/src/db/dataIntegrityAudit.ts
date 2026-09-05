/**
 * Read-only CUSTOMER-DATA INTEGRITY audit, logged to the boot log. Gated by
 * DATA_AUDIT=true. Sends NOTHING, changes NOTHING.
 *
 * For every upcoming non-cancelled event it cross-checks the customer-facing
 * fields across all sources (event ↔ linked receipt ↔ order cart ↔ customer) and
 * prints a per-event verdict: [OK] or [ISSUES] with the exact problems. This is
 * the pre-send safety gate — nothing automated should go to a customer while any
 * event still reports issues.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[data-audit] ${s}`);
const isPlaceholderPhone = (p: string | null) =>
  !p || /^[0+ ]*$/.test(p) || p.replace(/\D/g, '').length < 7;
const validEmail = (e: string | null) => !!e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

export async function dataIntegrityAuditFromEnv(): Promise<void> {
  if (process.env.DATA_AUDIT !== 'true') return;
  try {
    const { rows } = await pool.query(`
      SELECT e.id,
             to_char(e.event_date,'YYYY-MM-DD') AS event_date, e.date_tbd,
             e.start_time, e.base_end_time, e.phase,
             c.name AS customer, c.email, c.phone,
             o.cart->>'eventDate' AS cart_date, o.cart->>'startTime' AS cart_start,
             initcap(o.cart->>'eventFor') AS cart_baby,
             r.number AS receipt_no, to_char(r.date,'YYYY-MM-DD') AS receipt_date,
             r.event_time AS receipt_time, r.event_for AS receipt_baby, r.date_tbd AS receipt_tbd,
             (SELECT count(*)::int FROM notifications n
               WHERE n.event_id = e.id AND n.channel IN ('email','whatsapp')
                 AND n.sent_at IS NULL AND n.whatsapp_sent_at IS NULL AND n.cancelled_at IS NULL) AS pending_sends
        FROM events e
        JOIN customers c ON c.id = e.customer_id
        LEFT JOIN orders o ON o.id = e.order_id
        LEFT JOIN finance_receipts r ON r.event_id = e.id
       WHERE e.phase <> 'Cancelled' AND (e.event_date >= CURRENT_DATE OR e.event_date IS NULL)
       ORDER BY e.event_date NULLS FIRST`);

    let ok = 0, bad = 0, pendingTotal = 0;
    for (const r of rows) {
      const issues: string[] = [];
      // Date: present (or explicitly TBD), and consistent event↔receipt↔cart.
      if (!r.event_date && !r.date_tbd) issues.push('no event date and not TBD');
      if (r.receipt_no && r.receipt_date && r.event_date && r.receipt_date !== r.event_date)
        issues.push(`receipt date ${r.receipt_date} <> event ${r.event_date}`);
      if (r.cart_date && r.event_date && r.cart_date !== r.event_date)
        issues.push(`cart date ${r.cart_date} <> event ${r.event_date}`);
      if (r.date_tbd !== r.receipt_tbd && r.receipt_no != null)
        issues.push(`TBD mismatch event=${r.date_tbd} receipt=${r.receipt_tbd}`);
      // Time: present and consistent event↔receipt.
      if (!r.start_time) issues.push('no start time');
      if (r.receipt_time && r.start_time && r.receipt_time !== r.start_time)
        issues.push(`receipt time ${r.receipt_time} <> event ${r.start_time}`);
      if (r.cart_start && r.start_time && r.cart_start !== r.start_time)
        issues.push(`cart time ${r.cart_start} <> event ${r.start_time}`);
      // Identity + contact.
      if (!r.customer || !String(r.customer).trim()) issues.push('no customer name');
      if (!validEmail(r.email)) issues.push(`no/invalid email "${r.email ?? ''}"`);
      if (isPlaceholderPhone(r.phone)) issues.push(`placeholder phone "${r.phone ?? ''}"`);
      // Reference.
      if (!r.receipt_no) issues.push('no linked receipt (no EV-<num> reference)');

      pendingTotal += Number(r.pending_sends) || 0;
      const tag = `${r.id} ${r.event_date ?? 'TBD'} ${r.start_time ?? '--'} "${r.customer ?? '—'}" ref=${r.receipt_no ? 'EV-' + r.receipt_no : '—'} pending=${r.pending_sends}`;
      if (issues.length) { bad++; P(`  ✗ [ISSUES] ${tag} :: ${issues.join('; ')}`); }
      else { ok++; P(`  ✓ [OK] ${tag}`); }
    }
    P(`summary: ${ok} OK, ${bad} with issues, of ${rows.length} upcoming event(s). Pending unsent customer notifications across all: ${pendingTotal}.`);
    P('DONE');
  } catch (err) {
    console.error('[data-audit] failed:', (err as Error).message);
  }
}
