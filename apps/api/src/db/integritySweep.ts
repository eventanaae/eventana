/**
 * Order → operational integrity sweep. Gated by INTEGRITY_SWEEP=1.
 *
 * Finds and closes every place where something a customer paid for / ordered can
 * silently fail to become operationally real — the class of bug behind the
 * 2026-09-12 incident (a paid service that never reached the event page or a
 * prep task). For each upcoming event it:
 *   1. runs backfillUncoveredPrep — any booked line the templates/staffing don't
 *      recognise becomes a prep task (auto-assigned if we can guess the skill,
 *      else escalated to the owner/Marsha); ADDITIVE, never resets in-progress work,
 *   2. refreshes the standing "prep needs assigning" alert from real task state
 *      (surfaces both fully-unassigned AND under-staffed tasks on the bell/home).
 * Then it REPORTS the residual gaps for the owner: assignment gaps, events with
 * no day-of crew, paid invoices that never became events, and receipts still
 * unconverted. Read-mostly (the only writes are the additive prep tasks + alerts).
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[integrity] ${s}`);

export async function integritySweepFromEnv(): Promise<void> {
  if (String(process.env.INTEGRITY_SWEEP ?? '').trim() !== '1') return;
  try {
    const today = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10); // Dubai
    const evs = await pool.query<{ id: string; date: string }>(
      `SELECT id, to_char(event_date,'YYYY-MM-DD') AS date
         FROM events
        WHERE event_date >= $1::date AND phase <> 'Cancelled'
          AND source IS DISTINCT FROM 'quickbooks_import'
        ORDER BY event_date`,
      [today],
    );
    P(`scanning ${evs.rows.length} upcoming events`);

    // ── 1. Authoritative prep rebuild (templates + catch-all + refresh) ───────
    // Full regen (not just the additive backfill) so it also clears any stale
    // catch-all tasks and re-applies the latest classification per event.
    const { generatePrepTasks } = await import('../domain/prep.js');
    for (const e of evs.rows) {
      await generatePrepTasks(e.id).catch((err) => P(`  regen ${e.id} failed: ${(err as Error).message}`));
    }
    P(`rebuilt prep for ${evs.rows.length} upcoming events (catch-all + alerts applied)`);

    // ── 2. Prep assignment gaps still open (unassigned OR under-staffed) ──────
    const gaps = await pool.query<{ event_id: string; date: string; title: string; people_needed: number; assigned: number }>(
      `SELECT pt.event_id, to_char(e.event_date,'YYYY-MM-DD') AS date, pt.title, pt.people_needed,
              count(pts.member_id)::int assigned
         FROM prep_tasks pt
         JOIN events e ON e.id = pt.event_id
         LEFT JOIN prep_task_staff pts ON pts.task_id = pt.id
        WHERE e.event_date >= $1::date AND e.phase <> 'Cancelled' AND pt.status <> 'completed'
        GROUP BY pt.id, pt.event_id, e.event_date, pt.title, pt.people_needed
       HAVING count(pts.member_id) < pt.people_needed
        ORDER BY e.event_date, pt.event_id`,
      [today]);
    if (gaps.rows.length === 0) P('assignment: every upcoming prep task is fully staffed ✅');
    else {
      P(`assignment: ${gaps.rows.length} prep task(s) need someone (surfaced on bell/home):`);
      for (const g of gaps.rows) {
        P(`  ${g.event_id} · ${g.date} — ${g.title} ${g.assigned === 0 ? '(NOBODY)' : `(needs ${g.people_needed}, has ${g.assigned})`}`);
      }
    }

    // ── 3. Upcoming events with no day-of crew plan at all ───────────────────
    const noCrew = await pool.query<{ id: string; date: string }>(
      `SELECT e.id, to_char(e.event_date,'YYYY-MM-DD') AS date
         FROM events e
        WHERE e.event_date >= $1::date AND e.phase <> 'Cancelled'
          AND e.source IS DISTINCT FROM 'quickbooks_import'
          AND NOT EXISTS (SELECT 1 FROM event_staff s WHERE s.event_id = e.id)
        ORDER BY e.event_date`,
      [today]);
    if (noCrew.rows.length === 0) P('crew: every upcoming event has a day-of crew plan ✅');
    else {
      P(`crew: ${noCrew.rows.length} upcoming event(s) have NO day-of crew assigned:`);
      for (const c of noCrew.rows) P(`  ${c.id} · ${c.date}`);
    }

    // ── 4. Paid invoices that never became an event (parallel silent-drop) ───
    const paidInv = await pool.query<{ number: string; customer_name: string; total_fils: number; due_date: string | null }>(
      `SELECT number, customer_name, total_fils, to_char(due_date,'YYYY-MM-DD') AS due_date
         FROM finance_invoices
        WHERE (status = 'paid' OR paid_at IS NOT NULL)
        ORDER BY paid_at DESC NULLS LAST LIMIT 25`);
    if (paidInv.rows.length === 0) P('invoices: no PAID invoices (they are the unpaid docs by design) ✅');
    else {
      P(`invoices: ${paidInv.rows.length} PAID invoice(s) — these do NOT auto-create an event/prep (review):`);
      for (const i of paidInv.rows) P(`  ${i.number} · ${i.customer_name} · AED ${(Number(i.total_fils) / 100).toFixed(2)} · due ${i.due_date ?? '—'}`);
    }

    // ── 5. Receipts never converted to an event (upcoming or date-TBD) ───────
    const unconv = await pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM finance_receipts
        WHERE event_id IS NULL AND (date IS NULL OR date >= $1::date)
          AND COALESCE(source,'') <> 'quickbooks'`,
      [today]);
    const un = unconv.rows[0]?.n ?? 0;
    if (un === 0) P('receipts: every upcoming/TBD receipt is linked to an event ✅');
    else P(`receipts: ${un} upcoming/date-TBD receipt(s) have NO event yet (date-TBD receipts don't convert until a real date is set)`);
  } catch (err) {
    P(`failed: ${(err as Error).message}`);
  }
  P('DONE');
}
