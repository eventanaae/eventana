/** Debug: list recent bank_transactions with status, so we can see what's pending
 *  vs approved/ignored and why only some show in the approval queue. Guarded. */
import { pool } from './pool.js';

export async function dumpPendingFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.DUMP_PENDING_TAG ?? 'v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = $1`, [`dump_pending_${tag}`]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const counts = await pool.query<any>(`SELECT status, count(*)::int n FROM bank_transactions GROUP BY status ORDER BY n DESC`);
  console.log(`[dump-pending] counts: ${counts.rows.map((r) => `${r.status}=${r.n}`).join(', ')}`);
  const { rows } = await pool.query<any>(
    `SELECT to_char(created_at,'MM-DD HH24:MI') AS at, status, source, direction,
            amount_fils, merchant
       FROM bank_transactions
      ORDER BY created_at DESC LIMIT 30`,
  );
  for (const r of rows) {
    console.log(`[dump-pending] ${r.at} | ${r.status} | ${r.source} | ${r.direction} | AED ${(Number(r.amount_fils) / 100).toFixed(2)} | ${r.merchant ?? '—'}`);
  }
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [`dump_pending_${tag}`]).catch(() => {});
}
