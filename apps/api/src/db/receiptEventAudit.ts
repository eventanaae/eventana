/**
 * Receipt ↔ Event reconciliation. Every UPCOMING paid receipt must have a matching
 * operational event (so it shows in Upcoming Events and gets prep tasks + crew).
 *
 * Two modes, both owner-triggered:
 *   RECEIPT_EVENT_AUDIT=true   → DRY-RUN. Lists every upcoming receipt with no
 *                                event, plus upcoming events that have zero prep
 *                                tasks. Read-only — changes nothing.
 *   RECEIPT_EVENT_FIX=convert  → APPLIES the fix: converts every upcoming receipt
 *                                that has no event (ensureEventForReceipt), then
 *                                generates prep tasks for any upcoming event still
 *                                missing them. Lifecycle emails are SUPPRESSED
 *                                (skipLifecycle) — back-filling old bookings must
 *                                never spam a customer with a fresh "confirmation".
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[rcpt-event] ${s}`);
const aed = (fils: unknown) => (Number(fils || 0) / 100).toLocaleString('en-US');

export async function receiptEventAuditFromEnv(): Promise<void> {
  const audit = String(process.env.RECEIPT_EVENT_AUDIT ?? '').toLowerCase() === 'true';
  const fixMode = String(process.env.RECEIPT_EVENT_FIX ?? '').toLowerCase() === 'convert';
  const hasDetail = String(process.env.EVENT_DETAIL ?? '').trim().length > 0;
  if (!audit && !fixMode && !hasDetail) return;

  const today = new Date().toISOString().slice(0, 10);

  // ---- On-demand: dump one event's package/theme/services/prep tasks --------
  const detailIds = String(process.env.EVENT_DETAIL ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const id of detailIds) {
    try {
      const e = await pool.query(
        `SELECT e.id, to_char(e.event_date,'YYYY-MM-DD') AS d, e.phase,
                e.package_id, e.theme_id, e.custom_theme, e.celebration_type,
                p.name AS package_name, t.name AS theme_name, c.name AS customer
           FROM events e
           LEFT JOIN packages p ON p.id = e.package_id
           LEFT JOIN themes   t ON t.id = e.theme_id
           LEFT JOIN customers c ON c.id = e.customer_id
          WHERE e.id = $1`, [id]);
      if (!e.rowCount) { P(`detail ${id}: NOT FOUND`); continue; }
      const r = e.rows[0];
      P(`detail ${id} "${r.customer}" ${r.d} phase=${r.phase} pkg=${r.package_name ?? r.package_id ?? 'NONE'} theme=${r.theme_name ?? r.custom_theme ?? 'NONE'}`);
      const sv = await pool.query(`SELECT label, quantity, amount_fils FROM event_services WHERE event_id = $1 ORDER BY id`, [id]);
      P(`  services (${sv.rowCount}):`);
      for (const s of sv.rows) P(`    - ${s.label} ×${s.quantity} (AED ${aed(s.amount_fils)})`);
      const pt = await pool.query(`SELECT title, category, skill, status FROM prep_tasks WHERE event_id = $1 ORDER BY category, id`, [id]);
      P(`  prep tasks (${pt.rowCount}):`);
      for (const p of pt.rows) P(`    - [${p.category}] ${p.title} (skill=${p.skill ?? '—'}, ${p.status})`);
    } catch (err) { P(`detail ${id} failed: ${(err as Error).message}`); }
  }
  if (detailIds.length && !audit && !fixMode) { P('DONE'); return; }

  try {
    // ---- The gap: upcoming receipts with no linked event -------------------
    // "Upcoming" = event date today-or-later, OR date still TBD (unscheduled but
    // paid — it still belongs in the events list).
    const gap = await pool.query(
      `SELECT r.id, r.number, r.customer_name,
              to_char(r.date,'YYYY-MM-DD') AS d, r.date_tbd, r.total_fils,
              coalesce(r.source,'dashboard') AS source,
              -- would a conversion have a real customer email to notify?
              (SELECT c.email FROM customers c
                WHERE lower(c.name) = lower(r.customer_name)
                  AND c.email IS NOT NULL AND c.email <> '' LIMIT 1) AS app_email
         FROM finance_receipts r
        WHERE r.event_id IS NULL
          AND (r.date >= $1 OR r.date_tbd = TRUE)
        ORDER BY r.date`,
      [today],
    );

    P(`UPCOMING receipts with NO event: ${gap.rowCount}`);
    for (const r of gap.rows) {
      const when = r.date_tbd ? 'TBD' : r.d;
      P(`  • #${r.number} · ${r.customer_name} · ${when} · AED ${aed(r.total_fils)} · src=${r.source} · email=${r.app_email ?? 'none'}`);
    }

    // ---- Sanity totals ------------------------------------------------------
    const tot = await pool.query(
      `SELECT
         count(*) FILTER (WHERE date >= $1 OR date_tbd) AS upcoming_receipts,
         count(*) FILTER (WHERE (date >= $1 OR date_tbd) AND event_id IS NOT NULL) AS have_event,
         count(*) FILTER (WHERE (date >= $1 OR date_tbd) AND event_id IS NULL) AS missing_event
       FROM finance_receipts`,
      [today],
    );
    const t = tot.rows[0];
    P(`totals: upcoming=${t.upcoming_receipts} · have_event=${t.have_event} · missing=${t.missing_event}`);

    // ---- Proof: every upcoming receipt → its event id ----------------------
    const linked = await pool.query(
      `SELECT r.number, r.customer_name, to_char(r.date,'YYYY-MM-DD') AS d,
              r.date_tbd, r.event_id
         FROM finance_receipts r
        WHERE (r.date >= $1 OR r.date_tbd = TRUE)
        ORDER BY r.date`,
      [today],
    );
    P(`upcoming receipt → event map:`);
    for (const r of linked.rows) {
      P(`  #${r.number} ${r.customer_name} · ${r.date_tbd ? 'TBD' : r.d} → ${r.event_id ?? 'NO EVENT'}`);
    }

    // ---- PAST real sales (non-QuickBooks) with no event: these are completed
    // bookings that never became an operational event at all (not even in Past
    // Events). QuickBooks history is expected to have none, so it is only counted.
    const pastGap = await pool.query(
      `SELECT r.number, r.customer_name, to_char(r.date,'YYYY-MM-DD') AS d,
              r.total_fils, coalesce(r.source,'dashboard') AS source
         FROM finance_receipts r
        WHERE r.date < $1 AND r.date_tbd = FALSE AND r.event_id IS NULL
          AND coalesce(r.source,'dashboard') <> 'quickbooks'
        ORDER BY r.date DESC LIMIT 40`,
      [today],
    );
    const qbPast = await pool.query(
      `SELECT count(*) AS n FROM finance_receipts
        WHERE date < $1 AND event_id IS NULL AND coalesce(source,'dashboard') = 'quickbooks'`,
      [today],
    );
    P(`PAST real (non-QB) sales with NO event: ${pastGap.rowCount} (QuickBooks history w/o event: ${qbPast.rows[0].n})`);
    for (const r of pastGap.rows) {
      P(`  • #${r.number} · ${r.customer_name} · ${r.d} · AED ${aed(r.total_fils)} · src=${r.source}`);
    }

    // ---- Upcoming events that have NO prep tasks (the "system doesn't know
    // the tasks" concern) ----------------------------------------------------
    const noPrep = await pool.query(
      `SELECT e.id, to_char(e.event_date,'YYYY-MM-DD') AS d, c.name
         FROM events e
         LEFT JOIN customers c ON c.id = e.customer_id
        WHERE e.event_date >= $1
          AND NOT EXISTS (SELECT 1 FROM prep_tasks pt WHERE pt.event_id = e.id)
        ORDER BY e.event_date`,
      [today],
    );
    P(`UPCOMING events with NO prep tasks: ${noPrep.rowCount}`);
    for (const e of noPrep.rows) P(`  • ${e.id} · ${e.name ?? '—'} · ${e.d}`);

    // ---- Apply the fix ------------------------------------------------------
    if (fixMode) {
      P('FIX: converting upcoming receipts → events (emails suppressed) …');
      const { convertUpcomingReceiptsToEvents } = await import('../domain/finance.js');
      const res = await convertUpcomingReceiptsToEvents({ skipLifecycle: true });
      P(`FIX: converted ${res.created.length}/${res.considered}: ${res.created.join(', ') || '—'}`);

      // Backfill prep tasks for any upcoming event still missing them (covers
      // events that existed before but never got their prep generated).
      const still = await pool.query(
        `SELECT e.id FROM events e
          WHERE e.event_date >= $1
            AND NOT EXISTS (SELECT 1 FROM prep_tasks pt WHERE pt.event_id = e.id)
          ORDER BY e.event_date`,
        [today],
      );
      const { generatePrepTasks } = await import('../domain/prep.js');
      let gen = 0;
      for (const e of still.rows) {
        try { await generatePrepTasks(e.id); gen++; }
        catch (err) { P(`  prep ${e.id} failed: ${(err as Error).message.slice(0, 60)}`); }
      }
      P(`FIX: generated prep tasks for ${gen} event(s)`);
    }

    P('DONE');
  } catch (err) {
    console.error('[rcpt-event] failed:', (err as Error).message);
  }
}
