/**
 * A short, human context line for a STAFF notification about an event — so a
 * WhatsApp/push alert reads as a real party, not a bare internal id. Example:
 *   "Mahira's Kids Birthday · K-Pop · EV-1730 · Fri 11 Sep 2026"
 * Falls back to the customer name when there's no guest-of-honour, and always
 * carries the booking reference (EV-<receipt number>) and the date.
 */
import { pool } from '../db/pool.js';
import { celebrationLabel } from '@eventana/shared';

export async function staffEventBrief(eventId: string): Promise<{ reference: string; line: string }> {
  const { rows } = await pool.query<{
    date_h: string | null; celebration_type: string | null;
    baby: string | null; theme: string | null; customer: string | null; receipt_number: string | null;
  }>(
    `SELECT to_char(e.event_date,'Dy DD Mon YYYY') AS date_h,
            e.celebration_type,
            initcap(o.cart->>'eventFor')            AS baby,
            COALESCE(th.name, initcap(o.cart->>'customTheme')) AS theme,
            c.name                                  AS customer,
            (SELECT fr.number FROM finance_receipts fr
              WHERE fr.event_id = e.id OR (e.order_id IS NOT NULL AND fr.order_id = e.order_id)
              ORDER BY (fr.event_id = e.id) DESC, fr.id LIMIT 1) AS receipt_number
       FROM events e
       LEFT JOIN orders o   ON o.id = e.order_id
       LEFT JOIN themes th  ON th.id = e.theme_id
       LEFT JOIN customers c ON c.id = e.customer_id
      WHERE e.id = $1`,
    [eventId],
  ).catch(() => ({ rows: [] as any[] }));

  const r = rows[0];
  const reference = r?.receipt_number ? `EV-${r.receipt_number}` : eventId;
  if (!r) return { reference, line: reference };

  const baby = (r.baby ?? '').trim();
  const type = r.celebration_type ? celebrationLabel(r.celebration_type) : '';
  const theme = (r.theme ?? '').trim();
  const customer = (r.customer ?? '').trim();

  const parts: string[] = [];
  parts.push(baby ? `${baby}'s ${type || 'celebration'}` : (type || 'Celebration'));
  if (theme) parts.push(theme);
  if (!baby && customer) parts.push(customer); // no guest-of-honour → at least the customer
  parts.push(reference);
  if (r.date_h) parts.push(r.date_h.replace(/\s+/g, ' '));
  return { reference, line: parts.join(' · ') };
}
