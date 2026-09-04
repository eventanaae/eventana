/**
 * One-off, owner-only reconciliation actions. Every function is idempotent and
 * conservative: it only changes data it can fix with confidence, never guesses a
 * customer's real phone number or a historical payment method, and reports
 * exactly what it touched vs. what it left for manual review.
 */
import { pool } from '../db/pool.js';

/**
 * Normalise a UAE phone to E.164 (+9715XXXXXXXX) ONLY when the correct value is
 * unambiguous. Returns the normalised value + whether it changed, or null when
 * the number can't be fixed with confidence (must stay for manual review).
 */
export function normalizeUaePhone(raw: string | null | undefined): { value: string; changed: boolean } | null {
  const original = String(raw ?? '').trim();
  if (!original) return null;
  const digits = original.replace(/\D/g, '');
  let e164: string | null = null;

  if (/^\+9715\d{8}$/.test(original)) {
    e164 = original; // already correct
  } else if (/^009715\d{8}$/.test(digits)) {
    e164 = '+' + digits.slice(2); // 009715... → +9715...
  } else if (/^9710(5\d{8})$/.test(digits)) {
    e164 = '+971' + digits.slice(4); // +971 0 5XXXXXXXX (double-prefix bug) → +9715XXXXXXXX
  } else if (/^9715\d{8}$/.test(digits)) {
    e164 = '+' + digits; // 9715XXXXXXXX (missing +) → +9715XXXXXXXX
  } else if (/^05\d{8}$/.test(digits)) {
    e164 = '+971' + digits.slice(1); // 05XXXXXXXX → +9715XXXXXXXX
  } else if (/^5\d{8}$/.test(digits)) {
    e164 = '+971' + digits; // 5XXXXXXXX (9 digits) → +9715XXXXXXXX
  } else {
    return null; // landline / too short / unknown — do NOT touch
  }
  return { value: e164, changed: e164 !== original };
}

/**
 * The phone a NEW customer is allowed to save: it must carry a dialling key.
 * A UAE mobile typed as 05X/5X is accepted and promoted to +9715XXXXXXXX; any
 * other number must already be international (+<country><digits>). Returns the
 * value to store, or null when the number has no usable key (reject it).
 */
export function toValidCustomerPhone(raw: string | null | undefined): string | null {
  const original = String(raw ?? '').trim();
  if (!original) return null;
  const uae = normalizeUaePhone(original);
  if (uae) return uae.value; // UAE mobile (already-correct or 05X/5X/… variants)
  // International: a leading + and 8–15 digits total (E.164), spaces/dashes ok.
  const compact = original.replace(/[\s()-]/g, '');
  if (/^\+\d{8,15}$/.test(compact)) return compact;
  return null;
}

/**
 * Title-case a person's name: the first letter of each word capitalised, the
 * rest lower — "AISHA ALI" and "aisha ali" both become "Aisha Ali". Handles
 * hyphen/apostrophe sub-parts ("al-naami" → "Al-Naami", "o'brien" → "O'Brien").
 * Non-Latin scripts (Arabic) are left unchanged — they have no case.
 */
export function titleCaseName(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return s;
  const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w);
  return s
    .split(' ')
    .map((word) => word.split(/([-'])/).map((part) => (part === '-' || part === "'" ? part : cap(part))).join(''))
    .join(' ');
}

/** Normalise every confidently-fixable phone across the live + QuickBooks books. */
export async function normalizePhones(): Promise<any> {
  const targets = [
    { table: 'customers', idCol: 'id', cols: ['phone', 'backup_phone'] },
    { table: 'historical_customers', idCol: 'id', cols: ['phone', 'phone_alt'] },
  ];
  const summary: Record<string, { changed: number; alreadyOk: number; needsReview: number; empty: number }> = {};
  for (const t of targets) {
    for (const col of t.cols) {
      const key = `${t.table}.${col}`;
      summary[key] = { changed: 0, alreadyOk: 0, needsReview: 0, empty: 0 };
      const { rows } = await pool.query(`SELECT ${t.idCol} AS id, ${col} AS v FROM ${t.table}`);
      for (const r of rows) {
        const cur = String(r.v ?? '').trim();
        if (!cur) { summary[key].empty++; continue; }
        const norm = normalizeUaePhone(cur);
        if (!norm) { summary[key].needsReview++; continue; }
        if (!norm.changed) { summary[key].alreadyOk++; continue; }
        await pool.query(`UPDATE ${t.table} SET ${col} = $2 WHERE ${t.idCol} = $1`, [r.id, norm.value]);
        summary[key].changed++;
      }
    }
  }
  return { ok: true, summary, note: 'Only 05XXXXXXXX / 9715XXXXXXXX / +971 0 5… variants were rewritten to +9715XXXXXXXX. Landlines and unclear numbers were left untouched (Needs Review).' };
}

/**
 * The QuickBooks import stamped every migrated receipt paid_with='Cash' with no
 * evidence — a fabricated default. Relabel those to 'Unknown' so the payment
 * method is honestly unverified rather than falsely reported as cash. Only the
 * migrated ('quickbooks') rows still showing the blanket 'Cash' are touched;
 * genuine dashboard sales keep their real method.
 */
export async function markUnknownPaymentMethods(): Promise<any> {
  const { rowCount } = await pool.query(
    `UPDATE finance_receipts SET paid_with = 'Unknown'
      WHERE source = 'quickbooks' AND paid_with = 'Cash'`,
  );
  return { ok: true, relabelled: rowCount ?? 0, note: 'QuickBooks receipts previously defaulted to Cash are now Unknown (needs the real method from a QuickBooks re-export).' };
}

/**
 * Heal refunds that moved money but never emailed the customer (the pre-fix bug),
 * and any future gap: for every order with a refunded / partially_refunded
 * payment event that has NO refund_processed notification, schedule one. The
 * normal sweep then emails it. Idempotent — a second run finds nothing.
 */
export async function backfillRefundEmails(dryRun = false): Promise<any> {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (pe.order_id) pe.order_id, pe.amount_fils, pe.provider_status, o.event_id,
            c.name AS customer, c.email
       FROM payment_events pe
       JOIN orders o    ON o.id = pe.order_id
       JOIN customers c ON c.id = o.customer_id
      WHERE pe.new_status IN ('refunded','partially_refunded')
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
           WHERE n.template = 'refund_processed'
             AND (n.payload->>'orderId') = pe.order_id)
      ORDER BY pe.order_id, pe.created_at DESC`,
  );
  const candidates = rows.map((r) => ({ orderId: r.order_id, customer: r.customer, hasEmail: !!r.email, amountFils: Number(r.amount_fils ?? 0) }));
  if (dryRun) return { ok: true, dryRun: true, candidates };
  let scheduled = 0;
  for (const r of rows) {
    await pool.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       VALUES ($1,'email','refund_processed', now(), $2)`,
      [r.event_id ?? null, JSON.stringify({ orderId: r.order_id, amountFils: Number(r.amount_fils ?? 0), reference: r.provider_status ?? null })],
    );
    scheduled++;
  }
  return { ok: true, scheduled, candidates };
}
