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
    // Per-YEAR totals 2023..this year, so the report can be trusted for every
    // year, not just recent months. Same new-vs-old columns.
    P('year | revenue(new/old) | expenses(new/old) | events(new/old)');
    for (let y = 2023; y <= now.getUTCFullYear(); y++) {
      const start = `${y}-01-01`;
      const endStr = `${y + 1}-01-01`;
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
      P(`${y} | AED ${aed(Number(r.rev_new))} / ${aed(Number(r.rev_old))} | AED ${aed(Number(r.exp_new))} / ${aed(Number(r.exp_old))} | ${r.ev_new} / ${r.ev_old}`);
    }
    // Date coverage of the historical data, by source — proves QuickBooks rows
    // carry REAL dates (not all current_date), so old years aren't empty.
    const recRange = await pool.query(
      `SELECT COALESCE(source,'(none)') AS source, COUNT(*) n,
              to_char(MIN(date),'YYYY-MM-DD') AS first, to_char(MAX(date),'YYYY-MM-DD') AS last,
              COALESCE(SUM(total_fils),0) v
         FROM finance_receipts GROUP BY source ORDER BY n DESC`,
    );
    P('receipts by source (count | date range | total):');
    for (const r of recRange.rows) P(`  ${r.source}: ${r.n} | ${r.first}..${r.last} | AED ${aed(Number(r.v))}`);
    const expRange = await pool.query(
      `SELECT COALESCE(source,'(none)') AS source, COUNT(*) n,
              to_char(MIN(spent_on),'YYYY-MM-DD') AS first, to_char(MAX(spent_on),'YYYY-MM-DD') AS last,
              COALESCE(SUM(amount_fils),0) v
         FROM expenses GROUP BY source ORDER BY n DESC`,
    );
    P('expenses by source (count | date range | total):');
    for (const r of expRange.rows) P(`  ${r.source}: ${r.n} | ${r.first}..${r.last} | AED ${aed(Number(r.v))}`);
    P('done.');
  } catch (err) {
    console.error('[report-audit] failed:', (err as Error).message);
  }
}
