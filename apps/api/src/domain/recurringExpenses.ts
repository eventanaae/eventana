/**
 * Auto-post recurring expenses that repeat on a fixed schedule, so nobody has to
 * enter them by hand. Runs inside the periodic reconcile sweep (and on boot).
 *
 * Currently: the Emirates NBD (Peugeot van) loan — 36 monthly installments of
 * AED 3,889 on the 24th, starting Sep 2025 through Aug 2028. Each due installment
 * is inserted once (idempotent, keyed by its "Van Installment N/36" description).
 */
import { pool } from '../db/pool.js';

const VAN = { amountFils: 388900, count: 36, startYear: 2025, startMonth0: 8 /* Sep */, day: 24 };

export async function sweepRecurringExpenses(): Promise<void> {
  const now = new Date();
  let posted = 0;
  for (let n = 1; n <= VAN.count; n++) {
    const d = new Date(Date.UTC(VAN.startYear, VAN.startMonth0 + (n - 1), VAN.day));
    if (d.getTime() > now.getTime()) continue; // not due yet
    const desc = `Van Installment ${n}/36`;
    const exists = await pool.query(
      `SELECT 1 FROM expenses WHERE description = $1 AND lower(btrim(vendor)) LIKE '%emirates nbd peugeot%' LIMIT 1`,
      [desc],
    );
    if (exists.rowCount) continue;
    await pool.query(
      `INSERT INTO expenses (category, description, amount_fils, vendor, spent_on, payment_method, source)
       VALUES ('Assets', $1, $2, 'Emirates Nbd Peugeot', $3, 'bank_transfer', 'auto')`,
      [desc, VAN.amountFils, d.toISOString().slice(0, 10)],
    );
    posted++;
    console.log(`[recurring] van installment ${n}/36 auto-posted (${d.toISOString().slice(0, 10)})`);
  }
  if (posted) console.log(`[recurring] posted ${posted} due recurring expense(s)`);
}
