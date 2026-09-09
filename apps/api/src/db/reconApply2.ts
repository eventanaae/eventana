/**
 * Owner-approved recon actions round 2 (2026-09-09). Gated by RECON_APPLY2=true;
 * run once then turn the flag off.
 *
 *  0. IMPORTANT: the customer PROFILE screen (finance.customerDetail) reads
 *     `historical_customers`, NOT the live `customers` table. Round-1 wrote the
 *     recovered phones to `customers` only, so they didn't show on the profile.
 *     Here we also write them to `historical_customers.phone` (where blank),
 *     matched by email — so the numbers actually appear on the profile.
 *  1. Add Sara Alharbi with her email corrected (outlook.cok → outlook.com).
 *  2. Clean up TEST customer accounts (fake numbers 500000000/500000009 or a
 *     "test" name / Qa User). Deletes ONLY those with NO events and NO orders;
 *     any test account with real events/orders is reported, not deleted. The
 *     owner's own Shaima/Sheem accounts are kept.
 */
import { pool } from './pool.js';
import { randomBytes } from 'node:crypto';

// The 12 recovered phones (Tanfeeth excluded) — email -> verified phone.
const PHONES: Array<[string, string]> = [
  ['asma.alshehhi@cbuae.gov.ae', '0557557517'],
  ['rodha.almansoori@edgegroup.ae', '0502299003'],
  ['halimahassan577@gmail.com', '0529531113'],
  ['m.asalganim@gmail.com', '0562626166'],
  ['emanbinthani@gmail.com', '0501883030'],
  ['gamasha_22@hotmail.com', '0528833003'],
  ['hania_khalid@hotmail.co.uk', '0551831551'],
  ['mh3a.77@gmail.com', '0555006063'],
  ['r3.alghubari@icloud.com', '0544999094'],
  ['rasha.younis44@gmail.com', '0554374155'],
  ['reemboushehri@yahoo.com', '0566411444'],
  ['sh.maj@hotmail.com', '0501157666'],
];

export async function reconApply2FromEnv(): Promise<void> {
  if (String(process.env.RECON_APPLY2 ?? '').toLowerCase() !== 'true') return;
  const L = (s: string) => console.log(`[recon-apply2] ${s}`);
  try {
    // Verify Ebs before.
    const before = await pool.query(
      `SELECT id, full_name, phone FROM historical_customers WHERE lower(btrim(email)) = 'rodha.almansoori@edgegroup.ae'`,
    );
    for (const r of before.rows) L(`VERIFY(before) historical ${r.full_name} #${r.id} phone='${r.phone ?? ''}'`);

    // 0. Sync recovered phones into historical_customers (the profile source).
    let hist = 0;
    for (const [em, ph] of PHONES) {
      const r = await pool.query(
        `UPDATE historical_customers SET phone = $2
          WHERE lower(btrim(email)) = lower($1) AND coalesce(btrim(phone),'') = '' RETURNING id`,
        [em, ph],
      );
      hist += r.rowCount ?? 0;
      if (r.rowCount) L(`historical phone ${em} -> ${ph}: updated ${r.rowCount}`);
    }
    L(`historical phones filled: ${hist}/${PHONES.length}`);

    // Verify Ebs after.
    const after = await pool.query(
      `SELECT id, full_name, phone FROM historical_customers WHERE lower(btrim(email)) = 'rodha.almansoori@edgegroup.ae'`,
    );
    for (const r of after.rows) L(`VERIFY(after) historical ${r.full_name} #${r.id} phone='${r.phone ?? ''}'`);

    // 1. Add Sara Alharbi (corrected email) to live customers.
    const em = 'sa201802335@outlook.com';
    const ex = await pool.query(`SELECT 1 FROM customers WHERE lower(btrim(email)) = lower($1) LIMIT 1`, [em]);
    if (ex.rowCount) L('Sara Alharbi already exists — skip');
    else {
      const id = 'CUST-' + randomBytes(4).toString('hex').toUpperCase();
      await pool.query(`INSERT INTO customers (id, name, phone, email, origin) VALUES ($1,$2,$3,$4,'quickbooks')`, [id, 'Sara Alharbi', '0549988558', em]);
      L(`added Sara Alharbi ${id} <${em}>`);
    }

    // 2. Test-account cleanup (live customers).
    const test = await pool.query<{ id: string; name: string; phone: string }>(
      `SELECT id, name, phone FROM customers
        WHERE ( regexp_replace(coalesce(phone,''),'[^0-9]','','g') LIKE '%500000000'
             OR regexp_replace(coalesce(phone,''),'[^0-9]','','g') LIKE '%500000009'
             OR name ILIKE '%test%'
             OR lower(btrim(name)) = 'qa user' )
          AND name NOT ILIKE '%shaima%' AND name NOT ILIKE '%sheem%'`,
    );
    L(`test candidates: ${test.rows.length}`);
    let del = 0; let skip = 0;
    for (const c of test.rows) {
      const ev = Number((await pool.query(`SELECT count(*) n FROM events WHERE customer_id = $1`, [c.id])).rows[0].n);
      const od = Number((await pool.query(`SELECT count(*) n FROM orders WHERE customer_id = $1`, [c.id])).rows[0].n);
      if (ev === 0 && od === 0) {
        try { await pool.query(`DELETE FROM customers WHERE id = $1`, [c.id]); del++; }
        catch (e) { skip++; L(`SKIP ${c.name} (${c.id}) — FK: ${(e as Error).message.slice(0, 60)}`); }
      } else { skip++; L(`KEPT ${c.name} (${c.id}) — has ${ev} events / ${od} orders`); }
    }
    L(`test cleanup: deleted ${del}, kept/skipped ${skip}`);
    L('DONE');
  } catch (e) {
    L(`error: ${(e as Error).message.slice(0, 200)}`);
  }
}
