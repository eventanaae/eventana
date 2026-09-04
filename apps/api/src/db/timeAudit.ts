/**
 * Read-only TIME/DATE audit, logged to the boot log (no DB console needed).
 * Gated by TIME_AUDIT=true. Sends NOTHING, changes NOTHING — pure SELECTs.
 *
 * Purpose: a customer reported the event TIME on their receipt/confirmation was
 * wrong (6 PM shown for a 5 PM booking). time12() is pure, so a wrong hour means
 * events.start_time itself holds the wrong value. This finds every event whose
 * stored start_time / event_date differs from what the customer actually chose
 * at checkout (the order cart snapshot), which is exactly where such an error
 * shows up — and prints the customer name + date so the offending booking can
 * be identified without any DB console.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[time-audit] ${s}`);

export async function timeAuditFromEnv(): Promise<void> {
  if (process.env.TIME_AUDIT !== 'true') return;
  try {
    // Every non-cancelled event vs the customer's checkout choice (cart).
    const { rows } = await pool.query(`
      SELECT e.id,
             to_char(e.event_date,'YYYY-MM-DD') AS event_date,
             e.start_time, e.base_end_time, e.phase,
             c.name AS customer, c.email,
             o.cart->>'startTime' AS cart_start,
             o.cart->>'eventDate' AS cart_date,
             o.created_at AS ordered_at
        FROM events e
        LEFT JOIN customers c ON c.id = e.customer_id
        LEFT JOIN orders o    ON o.id = e.order_id
       WHERE e.phase <> 'Cancelled'
       ORDER BY e.event_date DESC
    `);
    P(`scanned ${rows.length} non-cancelled event(s)`);

    // Mismatches: stored time/date differs from the cart snapshot.
    const timeMismatch = rows.filter(
      (r) => r.cart_start && r.start_time && String(r.cart_start) !== String(r.start_time),
    );
    const dateMismatch = rows.filter(
      (r) => r.cart_date && r.event_date && String(r.cart_date) !== String(r.event_date),
    );
    P(`TIME mismatches (stored <> cart choice): ${timeMismatch.length}`);
    for (const r of timeMismatch) {
      P(`  ⚠ ${r.id} "${r.customer ?? '—'}" ${r.event_date} stored=${r.start_time} cartChose=${r.cart_start} <${r.email ?? 'no-email'}>`);
    }
    P(`DATE mismatches (stored <> cart choice): ${dateMismatch.length}`);
    for (const r of dateMismatch) {
      P(`  ⚠ ${r.id} "${r.customer ?? '—'}" stored=${r.event_date} cartChose=${r.cart_date} <${r.email ?? 'no-email'}>`);
    }

    // The 9 events the seeded-time one-time fix bumped 17:00 -> 18:00. If any is
    // a genuine 5 PM booking, this is where a wrong 6 PM would have come from.
    const seededIds = ['EV-2026-0204','EV-2026-0196','EV-2026-0201','EV-2026-0203','EV-2026-0202','EV-2026-0197','EV-2026-0198','EV-2026-0199','EV-2026-0200'];
    const seeded = rows.filter((r) => seededIds.includes(String(r.id)));
    P(`seeded-fix events present: ${seeded.length}`);
    for (const r of seeded) {
      P(`  · ${r.id} "${r.customer ?? '—'}" ${r.event_date} stored=${r.start_time} cartChose=${r.cart_start ?? '—'}`);
    }

    // All events at 18:00 (the value the customer says is wrong) with their cart
    // choice, so a 5 PM booking wrongly stored as 6 PM stands out.
    const at18 = rows.filter((r) => String(r.start_time) === '18:00');
    P(`events stored at 18:00: ${at18.length}`);
    for (const r of at18.slice(0, 40)) {
      P(`  · ${r.id} "${r.customer ?? '—'}" ${r.event_date} cartChose=${r.cart_start ?? '—'}`);
    }

    // Recent manual finance receipts (these carry a date but NO time today).
    const rec = await pool.query(`
      SELECT number, to_char(date,'YYYY-MM-DD') AS date, event_id, event_for, customer_name, source
        FROM finance_receipts
       ORDER BY id DESC LIMIT 25
    `).catch(() => ({ rows: [] as any[] }));
    P(`recent receipts: ${rec.rows.length}`);
    for (const r of rec.rows) {
      P(`  R#${r.number} ${r.date} event=${r.event_id ?? '—'} for="${r.event_for ?? '—'}" "${r.customer_name ?? '—'}" (${r.source ?? 'manual'})`);
    }

    // ── FULL DETAIL for recent/upcoming events, to diff against the customer's
    //    original booking message (name, phones, email, date, start-end, baby,
    //    theme). Joins the customer contact + the linked receipt's party fields.
    const detail = await pool.query(`
      SELECT e.id,
             to_char(e.event_date,'YYYY-MM-DD') AS event_date,
             e.start_time, e.base_end_time, e.emirate,
             e.theme_id, e.custom_theme,
             c.name AS customer, c.phone, c.backup_phone, c.email,
             r.event_for AS baby, r.theme AS receipt_theme, r.number AS receipt_no
        FROM events e
        LEFT JOIN customers c ON c.id = e.customer_id
        LEFT JOIN finance_receipts r ON r.event_id = e.id
       WHERE e.event_date >= date '2026-08-01' AND e.phase <> 'Cancelled'
       ORDER BY e.event_date
    `);
    P(`FULL DETAIL: ${detail.rows.length} event(s)`);
    for (const r of detail.rows) {
      P(`DET ${r.id} | ${r.event_date} ${r.start_time}-${r.base_end_time} | "${r.customer ?? '—'}" ph=${r.phone ?? '—'}/${r.backup_phone ?? '—'} <${r.email ?? '—'}> | baby="${r.baby ?? '—'}" theme=${r.theme_id ?? (r.custom_theme ? 'custom' : '—')}/${r.receipt_theme ?? '—'} | ${r.emirate ?? '—'} | R#${r.receipt_no ?? '—'}`);
    }

    P('DONE');
  } catch (e) {
    console.error('[time-audit] failed:', (e as Error).message);
  }
}
