/** One-time (owner batch 1 of missing expenses, 2026-09-21):
 *  - End-of-August 2026 salaries (6 staff) that weren't recorded.
 *  - New account "خدمة مجتمعية" (Community Service) + a 1000 donation under it.
 *  - Reclassify all payments to "Public" (a restaurant) into that account.
 *  Guarded. */
import { pool } from './pool.js';

const SAL_DATE = '2026-08-31';
const COMMUNITY = 'خدمة مجتمعية';
const SALARIES: { name: string; fils: number; note: string }[] = [
  { name: 'Shaima', fils: 500000, note: 'راتب أغسطس 2026' },
  { name: 'Dandu', fils: 450000, note: 'راتب أغسطس 2026' },
  { name: 'Diana', fils: 100000, note: 'راتب أغسطس 2026 — قُص 200 (إنذار/warning)' },
  { name: 'Gloria', fils: 100000, note: 'راتب أغسطس 2026 — قُص 200 (إنذار/warning)' },
  { name: 'Marsha', fils: 300000, note: 'راتب أغسطس 2026' },
  { name: 'Shan', fils: 300000, note: 'راتب أغسطس 2026 (موظف جديد)' },
];

export async function recordMissing1FromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const gk = 'record_missing1_v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const aed = (f: number) => (Number(f) / 100).toFixed(2);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 1) Salaries.
    let salTotal = 0;
    for (const s of SALARIES) {
      await client.query(
        `INSERT INTO expenses (category, description, amount_fils, vendor, spent_on, payment_method, source)
         VALUES ('Salaries', $1, $2, $3, $4::date, 'bank_transfer', 'manual')`,
        [s.note, s.fils, s.name, SAL_DATE],
      );
      salTotal += s.fils;
    }
    console.log(`[missing1] salaries: ${SALARIES.length} rows = AED ${aed(salTotal)}`);

    // 2) Community Service account + donation.
    await client.query(
      `INSERT INTO expenses (category, description, amount_fils, vendor, spent_on, payment_method, source)
       VALUES ($1, 'تبرع', 100000, NULL, '2026-09-20'::date, 'bank_transfer', 'manual')`,
      [COMMUNITY],
    );
    console.log(`[missing1] added account "${COMMUNITY}" + donation AED 1000.00`);

    // 3) Reclassify "Public" (restaurant) payments into Community Service. Log first.
    const pub = await client.query<any>(
      `SELECT id, COALESCE(category,'—') c, COALESCE(vendor,'—') v, amount_fils, to_char(spent_on,'YYYY-MM-DD') d
         FROM expenses WHERE vendor ILIKE '%public%'`);
    console.log(`[missing1] "Public" expenses found: ${pub.rows.length}`);
    for (const r of pub.rows) console.log(`[missing1]   Public id=${r.id} | ${r.c} | ${r.v} | AED ${aed(r.amount_fils)} | ${r.d}`);
    const moved = await client.query(`UPDATE expenses SET category = $1 WHERE vendor ILIKE '%public%'`, [COMMUNITY]);
    console.log(`[missing1] moved ${moved.rowCount} Public payment(s) → "${COMMUNITY}"`);

    await client.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]);
    await client.query('COMMIT');
    console.log(`[missing1] done.`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[missing1] failed, rolled back:', (e as Error).message);
  } finally {
    client.release();
  }
}
