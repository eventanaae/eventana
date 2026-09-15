/**
 * Diagnostic: resolve who an ambiguous transfer recipient is by cross-checking
 * our OWN registries — drivers, part_timers, staff_payments (person_kind), and
 * event_staff (part_time_name = someone who worked an event as a performer). Also
 * shows any other expenses tied to the same name for extra context. Read-only.
 * Gated DIAG_RESOLVE=true; DIAG_RESOLVE_NAMES = comma list (first name is enough).
 */
import { pool } from './pool.js';

export async function diagResolveNamesFromEnv(): Promise<void> {
  if (String(process.env.DIAG_RESOLVE ?? '').toLowerCase() !== 'true') return;
  const names = (process.env.DIAG_RESOLVE_NAMES ??
    'zeeshan,asruddin,faraz,muneeb,best moments,al samiah,sheem ibrahim,afzal,elena,jesiah,angelica,gulroz,umbreen,behfar')
    .split(',').map((s) => s.trim()).filter(Boolean);

  for (const q of names) {
    const like = `%${q.toLowerCase()}%`;
    const drv = await pool.query(`SELECT name, kind, active FROM drivers WHERE lower(name) LIKE $1`, [like]);
    const pt = await pool.query(`SELECT name, active FROM part_timers WHERE lower(name) LIKE $1`, [like]);
    const pay = await pool.query(
      `SELECT person_kind, count(*)::int n, sum(amount_fils)::bigint fils, min(month) a, max(month) b
         FROM staff_payments WHERE lower(person_name) LIKE $1 GROUP BY person_kind`, [like]);
    const es = await pool.query(
      `SELECT count(*)::int n FROM event_staff WHERE lower(COALESCE(part_time_name,'')) LIKE $1`, [like]);
    const exp = await pool.query(
      `SELECT category, count(*)::int n, sum(amount_fils)::bigint fils
         FROM expenses WHERE lower(COALESCE(vendor,'')) LIKE $1 OR lower(COALESCE(description,'')) LIKE $1
         GROUP BY category ORDER BY n DESC LIMIT 4`, [like]);

    const bits: string[] = [];
    if (drv.rows.length) bits.push(`DRIVER✓ (${drv.rows.map((r: any) => `${r.name}/${r.kind}${r.active ? '' : ' inactive'}`).join(', ')})`);
    if (pt.rows.length) bits.push(`PART-TIMER✓ (${pt.rows.map((r: any) => r.name).join(', ')})`);
    for (const p of pay.rows as any[]) bits.push(`paid as ${p.person_kind} ${p.n}× AED ${(Number(p.fils) / 100).toFixed(0)} (${p.a}→${p.b})`);
    if (es.rows[0]?.n) bits.push(`worked ${es.rows[0].n} event-slots (performer)`);
    const expStr = (exp.rows as any[]).map((r) => `${r.category}:${r.n}`).join(', ');
    console.log(`[resolve] "${q}" → ${bits.length ? bits.join(' · ') : 'NOT in registries'}${expStr ? ` · expenses[${expStr}]` : ''}`);
  }
  console.log('[resolve] DONE');
}
