/** Diagnostic: full detail of the 3 remaining uncategorised expenses for owner review. Read-only, one-shot. */
import { pool } from './pool.js';
export async function dumpUncat3FromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const g = await pool.query(`SELECT 1 FROM app_kv WHERE k='uncat3_v1'`).catch(() => ({ rowCount: 0 }));
  if (g.rowCount) return;
  const { rows } = await pool.query(
    `SELECT id, to_char(spent_on,'YYYY-MM-DD') d, round(amount_fils/100.0)::int aed,
            COALESCE(category,'') category, COALESCE(category_bk,'') category_bk,
            COALESCE(vendor,'(blank)') vendor, COALESCE(description,'') description,
            COALESCE(source,'') source, COALESCE(payment_method,'') pm,
            CASE WHEN COALESCE(btrim(receipt_url),'')='' THEN 'no' ELSE receipt_url END rcpt
       FROM expenses WHERE id = ANY($1::bigint[]) ORDER BY amount_fils DESC`,
    [[3784, 3825, 3747]],
  );
  for (const r of rows as any[]) console.log(`[uncat3] #${r.id} | ${r.d} | AED ${r.aed} | cat=${r.category} | was=${r.category_bk} | vend=${r.vendor} | src=${r.source} | pm=${r.pm} | desc="${r.description}" | rcpt=${r.rcpt}`);
  await pool.query(`INSERT INTO app_kv (k,v) VALUES ('uncat3_v1', now()) ON CONFLICT (k) DO NOTHING`).catch(() => {});
}
