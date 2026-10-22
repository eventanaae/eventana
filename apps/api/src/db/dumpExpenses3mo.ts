/**
 * READ-ONLY one-shot: dump every expense from the last three calendar months
 * (this month + the two before it) to the logs, one JSON row per line, plus a
 * META summary line. Used to build an Excel expense report when the prod DB
 * can't be queried directly. Gated by SET_SHAN_LEADER='expdump3mo' (reuses the
 * one-shot trigger key). Writes nothing; blank the flag after.
 */
import { pool } from './pool.js';

interface Row {
  id: string;
  spent_on: string | null;
  month: string | null;
  category: string | null;
  description: string | null;
  vendor: string | null;
  amount_fils: number | null;
  payment_method: string | null;
  source: string | null;
  note: string | null;
  event_id: string | null;
  recorded_by: string | null;
  receipt_url: string | null;
  created_at: string | null;
}

export async function dumpExpenses3moFromEnv(): Promise<void> {
  if (String(process.env.SET_SHAN_LEADER ?? '').toLowerCase() !== 'expdump3mo') return;
  try {
    const { rows } = await pool.query<Row>(
      `SELECT id::text,
              to_char(spent_on,'YYYY-MM-DD')                AS spent_on,
              to_char(spent_on,'YYYY-MM')                   AS month,
              category, description, vendor,
              amount_fils::bigint                           AS amount_fils,
              payment_method, source, note, event_id, recorded_by, receipt_url,
              to_char(created_at AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD HH24:MI') AS created_at
         FROM expenses
        WHERE spent_on >= date_trunc('month', current_date) - interval '2 months'
        ORDER BY spent_on DESC, id DESC`,
    );

    const total = rows.reduce((s, r) => s + Number(r.amount_fils ?? 0), 0);
    const byCat: Record<string, number> = {};
    const byMonth: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const r of rows) {
      const a = Number(r.amount_fils ?? 0);
      byCat[r.category ?? 'other'] = (byCat[r.category ?? 'other'] ?? 0) + a;
      byMonth[r.month ?? '?'] = (byMonth[r.month ?? '?'] ?? 0) + a;
      bySource[r.source ?? 'manual'] = (bySource[r.source ?? 'manual'] ?? 0) + a;
    }
    console.log(`EXPDUMP|META|${JSON.stringify({ count: rows.length, total_fils: total, byMonth, byCat, bySource })}`);
    for (const r of rows) console.log(`EXPDUMP|ROW|${JSON.stringify(r)}`);
    console.log(`EXPDUMP|DONE|${rows.length}`);
  } catch (err) {
    console.error('[expdump] failed:', (err as Error).message);
  }
}
