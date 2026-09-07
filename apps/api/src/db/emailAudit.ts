/**
 * URGENT diagnostic: find every customer whose email is the OWNER's email
 * (a wrong overwrite), plus the "Shaima" customer + event EV-2026-0211 /
 * receipt #1726 the owner flagged. Read-only. Gated EMAIL_AUDIT=true.
 */
import { pool } from './pool.js';
import { config } from '../config.js';

const P = (s: string) => console.log(`[email-audit] ${s}`);

export async function emailAuditFromEnv(): Promise<void> {
  if (String(process.env.EMAIL_AUDIT ?? '').toLowerCase() !== 'true') return;
  try {
    const owner = String(config.email.financeReportTo?.[0] ?? 'shaima-ak@hotmail.com').toLowerCase();
    P(`owner email = ${owner}`);

    // 1) Every customer carrying the owner's email.
    const dup = await pool.query<{ id: string; name: string; email: string; phone: string; origin: string | null; registered_at: string }>(
      `SELECT id, name, email, phone, origin, to_char(registered_at,'YYYY-MM-DD HH24:MI') AS registered_at
         FROM customers WHERE lower(email) = $1 ORDER BY registered_at`, [owner]);
    P(`customers with the owner's email: ${dup.rowCount}`);
    for (const c of dup.rows) {
      const evs = await pool.query<{ id: string; d: string }>(
        `SELECT id, to_char(event_date,'YYYY-MM-DD') AS d FROM events WHERE customer_id = $1 ORDER BY event_date`, [c.id]);
      P(`  ${c.id} · "${c.name}" · ${c.phone} · origin=${c.origin ?? '-'} · reg=${c.registered_at} · events=[${evs.rows.map((e) => `${e.id}(${e.d})`).join(', ')}]`);
    }

    // 2) Customers named Shaima/Shayma (the flagged party).
    const sh = await pool.query<{ id: string; name: string; email: string | null; phone: string }>(
      `SELECT id, name, email, phone FROM customers
        WHERE lower(name) LIKE '%shaima%' OR lower(name) LIKE '%shayma%' OR lower(name) LIKE '%shaikha%'
        ORDER BY name`);
    P(`customers named Shaima/Shayma: ${sh.rowCount}`);
    for (const c of sh.rows) P(`  ${c.id} · "${c.name}" · ${c.email ?? '(no email)'} · ${c.phone}`);

    // 3) The specific event + receipt the owner flagged.
    for (const evId of ['EV-2026-0211']) {
      const e = await pool.query<{ id: string; customer_id: string; name: string; email: string | null; phone: string; d: string }>(
        `SELECT e.id, e.customer_id, c.name, c.email, c.phone, to_char(e.event_date,'YYYY-MM-DD') AS d
           FROM events e JOIN customers c ON c.id = e.customer_id WHERE e.id = $1`, [evId]);
      if (e.rowCount) { const r = e.rows[0]; P(`event ${evId}: customer=${r.customer_id} "${r.name}" · ${r.email ?? '(no email)'} · ${r.phone} · ${r.d}`); }
      else P(`event ${evId}: not found`);
    }
    for (const num of ['1726']) {
      const r = await pool.query<{ number: string; customer_name: string; event_id: string | null; customer_id: string | null }>(
        `SELECT number, customer_name, event_id, customer_id FROM finance_receipts WHERE number = $1`, [num]);
      if (r.rowCount) { const x = r.rows[0]; P(`receipt #${num}: name="${x.customer_name}" · event=${x.event_id ?? '-'} · hist_cust=${x.customer_id ?? '-'}`); }
    }
    P('DONE — read-only, nothing changed.');
  } catch (err) {
    console.error('[email-audit] failed:', (err as Error).message);
  }
}
