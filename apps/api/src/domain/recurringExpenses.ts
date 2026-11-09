/**
 * Auto-post recurring expenses that repeat on a fixed schedule, so nobody has to
 * enter them by hand. Runs inside the periodic reconcile sweep (and on boot).
 *
 * Currently: the Emirates NBD (Peugeot van) loan — 36 monthly installments of
 * AED 3,889 on the 24th, starting Sep 2025 through Aug 2028.
 *
 * Each installment is posted EXACTLY ONCE EVER. Once handled, a marker
 * `van_installment_posted:N` is written to app_kv, and the marker (not the
 * expense row) is what we check — so deleting, renaming or editing the auto
 * expense never makes it re-post. An installment is also NOT posted (but still
 * marked) when the same spend already exists — an expense or a bank row of the
 * same amount (±1%) within ±7 days of the due date (e.g. the real bank debit came
 * in via Zoho/RAKBANK first) — so the owner never sees it twice.
 */
import { pool, withTransaction } from '../db/pool.js';

const VAN = { amountFils: 388900, count: 36, startYear: 2025, startMonth0: 8 /* Sep */, day: 24 };

const markerKey = (n: number) => `van_installment_posted:${n}`;
const BACKFILL_KEY = 'van_installment_markers_backfilled_v1';

async function setMarker(n: number): Promise<void> {
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [markerKey(n)]);
}

/**
 * One-time: before the first marker is ever written, mark every installment that
 * already exists as an expense (matched by its "Van Installment N/36" label,
 * any amount/date/source) so the switch to markers never re-posts history.
 */
async function backfillMarkers(): Promise<void> {
  const done = await pool.query(`SELECT 1 FROM app_kv WHERE k = $1`, [BACKFILL_KEY]);
  if (done.rowCount) return;
  const { rows } = await pool.query<{ description: string }>(
    `SELECT DISTINCT description FROM expenses WHERE description ~* '^\\s*van installment\\s+\\d+\\s*/\\s*36'`,
  );
  for (const r of rows) {
    const m = r.description.match(/van installment\s+(\d+)\s*\/\s*36/i);
    const n = m ? Number(m[1]) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= VAN.count) await setMarker(n);
  }
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [BACKFILL_KEY]);
  if (rows.length) console.log(`[recurring] backfilled ${rows.length} van installment marker(s)`);
}

export async function sweepRecurringExpenses(): Promise<void> {
  await backfillMarkers();
  const now = new Date();
  const lo = Math.floor(VAN.amountFils * 0.99);
  const hi = Math.ceil(VAN.amountFils * 1.01);
  let posted = 0;
  for (let n = 1; n <= VAN.count; n++) {
    const d = new Date(Date.UTC(VAN.startYear, VAN.startMonth0 + (n - 1), VAN.day));
    if (d.getTime() > now.getTime()) continue; // not due yet
    const desc = `Van Installment ${n}/36`;
    const dateStr = d.toISOString().slice(0, 10);

    // Posted (or deliberately skipped) before → never again, whatever happened
    // to the expense row since.
    const marked = await pool.query(`SELECT 1 FROM app_kv WHERE k = $1`, [markerKey(n)]);
    if (marked.rowCount) continue;

    // The same spend is already recorded (an expense, or a bank row that isn't
    // ignored) near the due date → don't add a second copy; just mark it done.
    const near = await pool.query(
      `SELECT 1 FROM expenses
         WHERE amount_fils BETWEEN $1 AND $2 AND spent_on BETWEEN ($3::date - 7) AND ($3::date + 7)
       UNION ALL
       SELECT 1 FROM bank_transactions
         WHERE status <> 'ignored' AND direction = 'debit'
           AND amount_fils BETWEEN $1 AND $2 AND posted_on BETWEEN ($3::date - 7) AND ($3::date + 7)
       LIMIT 1`,
      [lo, hi, dateStr],
    );
    if (near.rowCount) {
      await setMarker(n);
      console.log(`[recurring] van installment ${n}/36 already recorded near ${dateStr} — not auto-posting`);
      continue;
    }

    // Claim the marker and insert the expense atomically: two overlapping sweeps
    // can't both post it, and a failed insert leaves no marker behind.
    const didPost = await withTransaction(async (db) => {
      const claim = await db.query(
        `INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING RETURNING k`,
        [markerKey(n)],
      );
      if (!claim.rowCount) return false;
      await db.query(
        `INSERT INTO expenses (category, description, amount_fils, vendor, spent_on, payment_method, source)
         VALUES ('Assets', $1, $2, 'Emirates Nbd Peugeot', $3, 'bank_transfer', 'auto')`,
        [desc, VAN.amountFils, dateStr],
      );
      return true;
    });
    if (!didPost) continue;
    posted++;
    console.log(`[recurring] van installment ${n}/36 auto-posted (${dateStr})`);
  }
  if (posted) console.log(`[recurring] posted ${posted} due recurring expense(s)`);
}
