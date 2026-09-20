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
    const dateStr = d.toISOString().slice(0, 10);
    // Idempotency keyed on the STABLE identity of the installment — its auto
    // source + due date + amount — not on the vendor name or description, which
    // the owner can edit in the Chart of Accounts (renaming the vendor used to
    // make this re-post the same installment on every sweep).
    const exists = await pool.query(
      `SELECT 1 FROM expenses
         WHERE source = 'auto' AND spent_on = $1::date AND amount_fils = $2
         LIMIT 1`,
      [dateStr, VAN.amountFils],
    );
    if (exists.rowCount) continue;
    await pool.query(
      `INSERT INTO expenses (category, description, amount_fils, vendor, spent_on, payment_method, source)
       VALUES ('Assets', $1, $2, 'Emirates Nbd Peugeot', $3, 'bank_transfer', 'auto')`,
      [desc, VAN.amountFils, dateStr],
    );
    posted++;
    console.log(`[recurring] van installment ${n}/36 auto-posted (${dateStr})`);
  }
  if (posted) console.log(`[recurring] posted ${posted} due recurring expense(s)`);
}
