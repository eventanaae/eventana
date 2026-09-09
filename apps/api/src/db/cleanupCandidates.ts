/**
 * READ-ONLY: list (a) customers that are almost certainly the SAME person —
 * identical last-9 phone digits AND identical email — safe-to-merge candidates,
 * and (b) unpaid orders (never completed) that are cleanup candidates. Writes
 * NOTHING. Gated by CLEANUP_CANDIDATES=true. The owner reviews before any
 * merge/delete happens.
 */
import { pool } from './pool.js';

const aed = (fils: number) => `AED ${(Number(fils || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function cleanupCandidatesFromEnv(): Promise<void> {
  if (String(process.env.CLEANUP_CANDIDATES ?? '').toLowerCase() !== 'true') return;
  const L = (s: string) => console.log(`[cleanup-cand] ${s}`);
  try {
    // (a) EXACT-match duplicate customers: same last-9 phone digits AND same
    // lower(email), both present. These are safe to merge (same person).
    const dups = await pool.query<{ key: string; ids: string[]; names: string[]; phone: string; email: string }>(
      `WITH k AS (
         SELECT id::text, name,
                right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'), 9) AS ph,
                lower(btrim(coalesce(email,''))) AS em
           FROM customers
          WHERE coalesce(btrim(phone),'') <> '' AND coalesce(btrim(email),'') <> ''
       )
       SELECT ph||'|'||em AS key, array_agg(id) AS ids, array_agg(name) AS names,
              max(ph) AS phone, max(em) AS email
         FROM k WHERE length(ph) = 9
        GROUP BY ph, em HAVING count(*) > 1
        ORDER BY count(*) DESC`,
    );
    L(`===== EXACT-MATCH DUPLICATE CUSTOMERS (same phone + email) = ${dups.rows.length} group(s) =====`);
    for (const g of dups.rows) {
      // per-member event/order counts
      const detail: string[] = [];
      for (let i = 0; i < g.ids.length; i++) {
        const id = g.ids[i];
        const ev = (await pool.query(`SELECT count(*) n FROM events WHERE customer_id=$1`, [id])).rows[0].n;
        const od = (await pool.query(`SELECT count(*) n FROM orders WHERE customer_id=$1`, [id])).rows[0].n;
        detail.push(`${g.names[i]}#${id} (${ev}ev/${od}ord)`);
      }
      L(`DUP …${g.phone.slice(-4)} <${g.email}> : ${detail.join(' | ')}`);
    }

    // (b) Unpaid orders — never reached a paid/captured state.
    const un = await pool.query<{ total: string; sum: string }>(
      `SELECT count(*) AS total, coalesce(sum(total_fils),0) AS sum
         FROM orders WHERE status NOT IN ('paid','captured','refunded','partially_refunded')`,
    );
    L(`===== UNPAID ORDERS (not paid/captured) = ${un.rows[0].total}, worth ${aed(Number(un.rows[0].sum))} =====`);
    const list = await pool.query<{ id: string; name: string; status: string; total_fils: string; age: string; has_event: boolean }>(
      `SELECT o.id, c.name, o.status, o.total_fils,
              date_part('day', now() - o.created_at)::int::text AS age,
              (o.event_id IS NOT NULL) AS has_event
         FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.status NOT IN ('paid','captured','refunded','partially_refunded')
        ORDER BY o.created_at DESC LIMIT 40`,
    );
    for (const o of list.rows) L(`UNPAID ${o.id} · ${o.name} · ${o.status} · ${aed(Number(o.total_fils))} · ${o.age}d old · event=${o.has_event}`);
    L('===== END (read-only — nothing changed) =====');
  } catch (e) {
    L(`error: ${(e as Error).message.slice(0, 200)}`);
  }
}
