/**
 * End-to-end proof that a win-back code actually works, BEFORE any customer is
 * sent one. Gated by WINBACK_TEST=true. Creates a throwaway test customer, mints
 * a real win-back code for it, then runs it through the SAME validatePromo() the
 * live checkout uses at several subtotals, checks single-use and expiry, and
 * finally deletes everything it created. Pure verification — no customer is
 * touched, no email sent.
 */
import { pool } from './pool.js';
import { validatePromo } from '../domain/discounts.js';
import { issueWinbackCode, WINBACK_AMOUNT_FILS } from '../domain/winback.js';

const P = (s: string) => console.log(`[winback-test] ${s}`);
const TEST_ID = 'CUST-WINBACKTEST';

export async function winbackTestFromEnv(): Promise<void> {
  if (String(process.env.WINBACK_TEST ?? '').toLowerCase() !== 'true') return;
  let pass = 0; let fail = 0;
  const check = (name: string, ok: boolean, detail: string) => {
    if (ok) { pass++; P(`  PASS ${name} — ${detail}`); }
    else { fail++; P(`  FAIL ${name} — ${detail}`); }
  };
  try {
    // Clean slate, then a throwaway customer named so the code is recognisable.
    await pool.query(`DELETE FROM promo_redemptions WHERE customer_id = $1`, [TEST_ID]);
    await pool.query(`DELETE FROM promo_codes WHERE customer_id = $1`, [TEST_ID]);
    await pool.query(`DELETE FROM customers WHERE id = $1`, [TEST_ID]);
    await pool.query(
      `INSERT INTO customers (id, name, email, phone) VALUES ($1, 'Winback Tester', 'winbacktest@example.com', '+971500000000')`,
      [TEST_ID],
    );

    const issued = await issueWinbackCode(pool, TEST_ID);
    check('issue', !!issued && !issued.reused, `code=${issued?.code}`);
    const code = issued!.code;
    check('code-named-after-customer', /^WINBACKTESTER600-/.test(code), code);

    // Below AED 3,000 → rejected on min spend.
    const low = await validatePromo(pool, code, TEST_ID, 250_000); // AED 2,500
    check('min-spend-rejects-below-3000', !low.ok, low.ok ? `amount=${low.amountFils}` : low.reason);

    // Exactly AED 3,000 → applies AED 600.
    const at = await validatePromo(pool, code, TEST_ID, 300_000);
    check('applies-at-3000', at.ok && at.amountFils === WINBACK_AMOUNT_FILS, at.ok ? `amount=${at.amountFils}` : at.reason);

    // AED 5,000 → still exactly AED 600 (fixed, not percent).
    const hi = await validatePromo(pool, code, TEST_ID, 500_000);
    check('fixed-600-above-3000', hi.ok && hi.amountFils === WINBACK_AMOUNT_FILS, hi.ok ? `amount=${hi.amountFils}` : hi.reason);

    // Wrong customer can't use a personal code.
    const other = await validatePromo(pool, code, 'CUST-SOMEONELSE', 500_000);
    check('personal-code-owner-only', !other.ok, other.ok ? 'WRONGLY ACCEPTED' : other.reason);

    // Redeem once, then it must reject as already used.
    await pool.query(
      `INSERT INTO promo_redemptions (code, customer_id, order_id, amount_fils) VALUES ($1,$2,'ORD-TEST',$3)`,
      [code, TEST_ID, WINBACK_AMOUNT_FILS],
    );
    const reuse = await validatePromo(pool, code, TEST_ID, 500_000);
    check('single-use-enforced', !reuse.ok, reuse.ok ? 'WRONGLY REUSED' : reuse.reason);

    // Expiry: force it into the past and confirm rejection.
    await pool.query(`DELETE FROM promo_redemptions WHERE customer_id = $1`, [TEST_ID]);
    await pool.query(`UPDATE promo_codes SET expires_at = now() - interval '1 day' WHERE code = $1`, [code]);
    const expired = await validatePromo(pool, code, TEST_ID, 500_000);
    check('expiry-enforced', !expired.ok, expired.ok ? 'WRONGLY ACCEPTED' : expired.reason);

    P(`RESULT: ${pass} passed, ${fail} failed`);
  } catch (e) {
    P(`ERROR: ${(e as Error).message}`);
  } finally {
    // Always clean up the throwaway data.
    await pool.query(`DELETE FROM promo_redemptions WHERE customer_id = $1`, [TEST_ID]).catch(() => {});
    await pool.query(`DELETE FROM promo_codes WHERE customer_id = $1`, [TEST_ID]).catch(() => {});
    await pool.query(`DELETE FROM customers WHERE id = $1`, [TEST_ID]).catch(() => {});
    P('cleaned up test data — DONE');
  }
}
