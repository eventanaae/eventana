/**
 * Read-only MONTHLY REPORT audit, logged to the boot log (no DB console needed).
 * Gated by REPORT_AUDIT=true. Sends NOTHING, changes NOTHING — pure SELECTs.
 *
 * Purpose: the owner reported the Monthly finance report showed Expenses AED 0
 * and a false 100% margin for August. The report now includes QuickBooks-imported
 * spend and counts every non-cancelled event in the month (not just those marked
 * 'Event Completed'). This prints, for the last few months, both the OLD numbers
 * (what the report showed) and the NEW numbers (what it shows after the fix), so
 * the correction can be verified without any DB console.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[report-audit] ${s}`);
const aed = (fils: number) => (fils / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function reportAuditFromEnv(): Promise<void> {
  if (process.env.REPORT_AUDIT !== 'true') return;
  try {
    // Last 4 months including the current one, most recent first.
    const now = new Date();
    const months: string[] = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    P('month | revenue(new/old) | expenses(new/old) | events(new/old)');
    for (const m of months) {
      const start = `${m}-01`;
      const end = new Date(`${start}T00:00:00Z`);
      end.setUTCMonth(end.getUTCMonth() + 1);
      const endStr = end.toISOString().slice(0, 10);
      const { rows } = await pool.query(
        `SELECT
           (SELECT COALESCE(SUM(total_fils),0) FROM finance_receipts WHERE date >= $1 AND date < $2) AS rev_new,
           (SELECT COALESCE(SUM(total_fils),0) FROM orders WHERE status='paid' AND kind IN ('booking','addon') AND created_at >= $1 AND created_at < $2) AS rev_old,
           (SELECT COALESCE(SUM(amount_fils),0) FROM expenses WHERE spent_on >= $1 AND spent_on < $2) AS exp_new,
           (SELECT COALESCE(SUM(amount_fils),0) FROM expenses WHERE source <> 'quickbooks' AND spent_on >= $1 AND spent_on < $2) AS exp_old,
           (SELECT COUNT(*) FROM events WHERE phase <> 'Cancelled' AND event_date >= $1 AND event_date < $2) AS ev_new,
           (SELECT COUNT(*) FROM events WHERE phase='Event Completed' AND event_date >= $1 AND event_date < $2) AS ev_old`,
        [start, endStr],
      );
      const r = rows[0];
      P(`${m} | AED ${aed(Number(r.rev_new))} / ${aed(Number(r.rev_old))} | AED ${aed(Number(r.exp_new))} / ${aed(Number(r.exp_old))} | ${r.ev_new} / ${r.ev_old}`);
    }
    // Where do August expenses live, by source? Confirms the QB-vs-dashboard split.
    const bySrc = await pool.query(
      `SELECT COALESCE(source,'(none)') AS source, COUNT(*) n, COALESCE(SUM(amount_fils),0) v
         FROM expenses WHERE spent_on >= '2026-08-01' AND spent_on < '2026-09-01'
        GROUP BY source ORDER BY v DESC`,
    );
    P('August expenses by source:');
    for (const r of bySrc.rows) P(`  ${r.source}: ${r.n} row(s), AED ${aed(Number(r.v))}`);
    P('done.');
  } catch (err) {
    console.error('[report-audit] failed:', (err as Error).message);
  }
}
