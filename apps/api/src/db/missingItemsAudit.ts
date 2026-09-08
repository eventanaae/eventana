/**
 * READ-ONLY: log the most recent missing_items with their supplier field, so we
 * can confirm whether the supplier a reporter typed is actually being saved
 * (Jane reported it wasn't showing). Writes nothing. Gated by MISSING_AUDIT=true.
 */
import { pool } from './pool.js';

export async function missingItemsAuditFromEnv(): Promise<void> {
  if (String(process.env.MISSING_AUDIT ?? '').toLowerCase() !== 'true') return;
  const { rows } = await pool.query<{
    id: string; item: string; supplier: string | null; location: string | null;
    reported_by: string | null; status: string; created: string;
  }>(
    `SELECT id, item, supplier, location, reported_by, status,
            to_char(created_at,'YYYY-MM-DD HH24:MI') AS created
       FROM missing_items ORDER BY created_at DESC LIMIT 20`,
  );
  const withSup = rows.filter((r) => (r.supplier ?? '').trim()).length;
  console.log(`[missing-audit] last ${rows.length} reported items · ${withSup} have a supplier, ${rows.length - withSup} don't`);
  for (const r of rows) {
    console.log(`[missing-audit] #${r.id} "${r.item}" | supplier=${r.supplier ?? '(none)'} | loc=${r.location ?? '-'} | by=${r.reported_by ?? '-'} | ${r.status} | ${r.created}`);
  }
}
