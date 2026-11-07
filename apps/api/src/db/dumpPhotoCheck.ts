/**
 * READ-ONLY one-shot: which expenses have NO receipt photo. The owner says every
 * photo was moved into the new system — this checks it. Prints totals per source
 * and per category, then one line per expense with no photo (and every
 * equipment/asset expense with its photo URL either way).
 * Gated by SET_SHAN_LEADER='photochk'. Blank it after.
 */
import { pool } from './pool.js';

export async function dumpPhotoCheckFromEnv(): Promise<void> {
  if (String(process.env.SET_SHAN_LEADER ?? '').toLowerCase() !== 'photochk') return;
  try {
    const has = `COALESCE(btrim(receipt_url),'') <> ''`;
    const { rows: tot } = await pool.query(
      `SELECT COALESCE(source,'') s, count(*)::int n, count(*) FILTER (WHERE ${has})::int img FROM expenses GROUP BY 1 ORDER BY 2 DESC`,
    );
    for (const r of tot) console.log(`PCHKSRC|${r.s}|total ${r.n}|with photo ${r.img}`);
    const { rows: bt } = await pool.query(
      `SELECT count(*)::int n, count(*) FILTER (WHERE COALESCE(btrim(receipt_url),'') <> '')::int img,
              count(*) FILTER (WHERE expense_id IS NOT NULL AND COALESCE(btrim(receipt_url),'') <> '')::int linked FROM bank_transactions`,
    );
    console.log(`PCHKBANK|${JSON.stringify(bt[0])}`);
    const clean = (v: unknown) => String(v ?? '').replace(/[\s|]+/g, ' ').trim();
    const { rows } = await pool.query(
      `SELECT id::text id, to_char(spent_on,'YYYY-MM-DD') d, amount_fils::bigint f, COALESCE(category,'') c,
              COALESCE(vendor,'') v, COALESCE(description,'') ds, COALESCE(source,'') s, COALESCE(qb_id,'') q,
              COALESCE(btrim(receipt_url),'') u
         FROM expenses
        WHERE NOT (${has}) OR category ~* '(equip|asset|furniture|machine)'
        ORDER BY spent_on, id`,
    );
    for (const r of rows) {
      console.log(`PCHK|${r.d}|EXP-${r.id}|AED ${(Number(r.f) / 100).toFixed(2)}|${clean(r.c)}|${clean(r.v)}|${clean(r.ds).slice(0, 60)}|${r.s}|qb ${r.q}|${r.u || 'NO PHOTO'}`);
    }
    console.log(`PCHKDONE|${rows.length}`);
  } catch (err) {
    console.error('[photochk] failed:', (err as Error).message);
  }
}
