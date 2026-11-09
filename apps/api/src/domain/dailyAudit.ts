/**
 * Daily System Audit (owner, Nov 2026).
 *
 * Every day at 10:00 Dubai the owner gets ONE report of a full end-to-end check
 * of the system plus recommendations. It deliberately does NOT rely on one rule:
 * ~45 independent read-only checks look at the business from different angles —
 * money (orders ↔ payments ↔ receipts ↔ refunds), bookings, events, inventory,
 * staff/prep, customer notifications, expenses, bank feeds and system health —
 * and several of them cross-check one source against another (payments captured
 * vs revenue booked by day, provider refunds vs the refund ledger, receipt
 * refunds vs the ledger, …).
 *
 * Rules every check follows:
 *  - READ ONLY. Each check runs in its own READ ONLY transaction with a
 *    statement_timeout, inside its own try/catch: one broken check is reported
 *    as "could not run" and never stops the others.
 *  - Sample rows carry ids / numbers / dates / amounts (a customer or staff NAME
 *    at most) — NEVER a phone number or an email (stripped again before storing).
 *  - Legitimate history is not flagged: QuickBooks-imported receipts/orders
 *    (finance_receipts.source='quickbooks', orders.source='quickbooks_import'),
 *    'converted' orders (synthetic, the money lives on the receipt), 'edit:'
 *    receipt_addon_money slices, manual pay-link orders and TBD events. Most
 *    checks also look at a recent window only, so old legacy rows don't flood.
 *
 * Entry points: runDailyAudit() (pure check run), storeAuditRun(), sendAuditReport(),
 * sweepDailyAudit() (called from the reconcile sweep; once per Dubai day ≥ 10:00,
 * claimed in app_kv BEFORE running so two instances can't double-send) and
 * runDailyAuditOneShot() (env RUN_DAILY_AUDIT, logs only — no email/push).
 */
import type { PoolClient } from 'pg';
import { formatAed } from '@eventana/shared';
import { pool } from '../db/pool.js';

export type AuditSeverity = 'critical' | 'warning' | 'info';
export type AuditArea =
  | 'money' | 'bookings' | 'events' | 'inventory' | 'staff'
  | 'notifications' | 'expenses' | 'bank' | 'system';

export interface AuditCheck {
  key: string;
  area: AuditArea;
  title: string;
  titleAr: string;
  severity: AuditSeverity;
  /** A SELECT (no trailing semicolon). Every row it returns is one finding. */
  sql: string;
  recommendation: string;
  recommendationAr: string;
}

export interface AuditResult {
  key: string;
  area: AuditArea;
  title: string;
  titleAr: string;
  severity: AuditSeverity;
  count: number;
  sample: Array<Record<string, unknown>>;
  recommendation: string;
  recommendationAr: string;
  error?: string;
  ms: number;
}

export interface AuditTotals {
  today: string;
  yesterday: string;
  revenueYesterdayFils: number;
  revenueMtdFils: number;
  bookingsYesterday: number;
  bookingsMtd: number;
  capturedYesterdayFils: number;
  capturedMtdFils: number;
  refundsYesterdayFils: number;
  refundsMtdFils: number;
  expensesYesterdayFils: number;
  expensesMtdFils: number;
  newEventsYesterday: number;
  error?: string;
}

export interface AuditRun {
  ranAt: string;
  runDay: string;
  issues: number;
  critical: number;
  errors: number;
  results: AuditResult[];
  totals: AuditTotals | null;
  aiSummary?: string | null;
}

/* ------------------------------------------------------------------ */
/* SQL building blocks                                                 */
/* ------------------------------------------------------------------ */

/** Dubai calendar day (explicit, so it never depends on the session time zone). */
const TODAY = `(now() AT TIME ZONE 'Asia/Dubai')::date`;
/** An order that has been paid (and possibly refunded since). */
const PAID = `('paid','partially_refunded','refunded')`;
/** A payment row that represents money received. */
const PAY_OK = `('paid','captured','partially_refunded','refunded')`;
/** Orders that carry their own money (not synthetic: converted / QuickBooks import). */
const moneyOrder = (a: string) => `COALESCE(${a}.source,'app') NOT IN ('converted','quickbooks_import')`;
/** App (customer self-serve) order: source NULL/'app'/'api' — not a manual pay link. */
const appOrder = (a: string) => `COALESCE(${a}.source,'app') IN ('app','api')`;
const ts = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD HH24:MI')`;
const day = (col: string) => `to_char(${col},'YYYY-MM-DD')`;
/** Safe numeric read of a JSON field (never throws on junk text). */
const jnum = (expr: string, dflt: string) =>
  `(CASE WHEN (${expr}) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${expr})::numeric ELSE ${dflt} END)`;

/* ------------------------------------------------------------------ */
/* The checks                                                          */
/* ------------------------------------------------------------------ */

export const AUDIT_CHECKS: AuditCheck[] = [
  // ═══════════════════════════ MONEY ═══════════════════════════
  {
    key: 'money.paid_order_without_payment',
    area: 'money',
    severity: 'critical',
    title: 'Paid order with no successful payment record',
    titleAr: 'طلب مسجّل مدفوع بدون أي دفعة ناجحة',
    sql: `SELECT o.id AS order_id, o.kind, o.status, COALESCE(o.source,'app') AS source, o.total_fils, ${ts('o.created_at')} AS created
            FROM orders o
           WHERE o.status IN ${PAID} AND ${moneyOrder('o')} AND o.total_fils > 0
             AND o.kind <> 'tip'
             AND o.created_at > now() - interval '60 days'
             AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status IN ${PAY_OK})
           ORDER BY o.created_at DESC`,
    recommendation: 'Open each order and confirm the money really arrived at the provider (Stripe/Tabby/Tamara/Ziina). If it did not, the booking was confirmed without payment — contact the customer.',
    recommendationAr: 'افتحي كل طلب وتأكدي إن الفلوس فعلاً وصلت عند مزوّد الدفع (Stripe / Tabby / Tamara / Ziina). إذا ما وصلت، الحجز انأكد بدون دفع — تواصلي مع العميل.',
  },
  {
    key: 'money.double_payment',
    area: 'money',
    severity: 'critical',
    title: 'Order paid more than once',
    titleAr: 'طلب انْدفع أكثر من مرة',
    sql: `SELECT o.id AS order_id, o.kind, o.total_fils, count(*)::int AS payments,
                 sum(p.amount_fils)::bigint AS paid_fils, string_agg(p.provider, ',' ORDER BY p.created_at) AS providers
            FROM orders o JOIN payments p ON p.order_id = o.id AND p.status IN ${PAY_OK} AND p.status <> 'refunded'
           WHERE o.created_at > now() - interval '60 days'
           GROUP BY o.id, o.kind, o.total_fils
          HAVING count(*) > 1
           ORDER BY max(p.created_at) DESC`,
    recommendation: 'Refund the extra payment at the provider (or record it as credit) — the customer was charged twice.',
    recommendationAr: 'رجّعي الدفعة الزايدة عند مزوّد الدفع (أو سجليها رصيد للعميل) — العميل انخصم منه مرتين.',
  },
  {
    key: 'money.paid_amount_mismatch',
    area: 'money',
    severity: 'warning',
    title: 'App order total ≠ amount the customer paid',
    titleAr: 'مبلغ الطلب من التطبيق ما يطابق المبلغ المدفوع',
    sql: `SELECT o.id AS order_id, o.kind, o.total_fils, sum(p.amount_fils)::bigint AS paid_fils,
                 max(p.provider) AS provider, ${ts('o.created_at')} AS created
            FROM orders o JOIN payments p ON p.order_id = o.id AND p.status IN ${PAY_OK}
           WHERE o.status IN ${PAID} AND ${appOrder('o')} AND o.kind <> 'tip'
             AND o.created_at > now() - interval '60 days'
           GROUP BY o.id, o.kind, o.total_fils, o.created_at
          HAVING count(*) = 1 AND sum(p.amount_fils) <> o.total_fils
           ORDER BY o.created_at DESC`,
    recommendation: 'Compare the provider charge with the order; adjust the receipt or refund/collect the difference.',
    recommendationAr: 'قارني المبلغ المخصوم عند المزوّد مع الطلب، وعدّلي الإيصال أو رجّعي/حصّلي الفرق.',
  },
  {
    key: 'money.bnpl_not_captured',
    area: 'money',
    severity: 'warning',
    title: 'Tabby/Tamara authorised >48h ago but never captured',
    titleAr: 'دفعة تابي/تمارا موافق عليها من أكثر من ٤٨ ساعة بس ما انسحبت',
    sql: `SELECT p.order_id, p.provider, p.status, p.amount_fils, ${ts('p.updated_at')} AS last_update
            FROM payments p JOIN orders o ON o.id = p.order_id
           WHERE p.provider IN ('tabby','tamara') AND p.status = 'paid' AND p.captured_fils = 0
             AND o.status = 'paid'
             AND p.updated_at < now() - interval '48 hours'
             AND p.created_at > now() - interval '30 days'
           ORDER BY p.updated_at`,
    recommendation: 'Check the payment in the Tabby/Tamara portal and capture it — an uncaptured authorisation expires and the money is never received.',
    recommendationAr: 'افتحي الدفعة في بوابة تابي/تمارا وسوّي Capture — الموافقة اللي ما تنسحب تنتهي والفلوس ما توصل أبداً.',
  },
  {
    key: 'money.refund_status_mismatch',
    area: 'money',
    severity: 'warning',
    title: 'Order status disagrees with the refund ledger',
    titleAr: 'حالة الطلب ما تتفق مع سجل الاستردادات',
    sql: `WITH rf AS (SELECT order_id, sum(amount_fils)::bigint AS led FROM refunds GROUP BY 1),
               pr AS (SELECT order_id, sum(refunded_fils)::bigint AS pref FROM payments GROUP BY 1)
          SELECT o.id AS order_id, o.kind, o.status, o.total_fils, COALESCE(rf.led,0) AS ledger_refunds_fils,
                 COALESCE(pr.pref,0) AS provider_refunded_fils,
                 CASE WHEN o.status = 'paid' THEN 'paid but has refunds'
                      WHEN o.status IN ('refunded','partially_refunded') THEN 'refund status without any refund'
                      ELSE 'refund on an unpaid order' END AS issue
            FROM orders o
            LEFT JOIN rf ON rf.order_id = o.id
            LEFT JOIN pr ON pr.order_id = o.id
           WHERE o.updated_at > now() - interval '120 days'
             AND (   (o.status = 'paid' AND COALESCE(rf.led,0) > 0)
                  OR (o.status IN ('refunded','partially_refunded') AND COALESCE(rf.led,0) = 0 AND COALESCE(pr.pref,0) = 0)
                  OR (o.status NOT IN ${PAID} AND COALESCE(rf.led,0) > 0))
           ORDER BY o.updated_at DESC`,
    recommendation: 'Open the order: either a refund was recorded but the order was not updated, or the order was marked refunded without a refund record. Fix so reports and the refund cap stay right.',
    recommendationAr: 'افتحي الطلب: يا إما انسجل استرداد والطلب ما تحدّث، يا إما الطلب انعلّم مسترد بدون سجل استرداد. صلّحيه عشان التقارير وحد الاسترداد يكونون صح.',
  },
  {
    key: 'money.refund_exceeds_paid',
    area: 'money',
    severity: 'critical',
    title: 'Refunds larger than what the customer paid',
    titleAr: 'المبلغ المسترد أكبر من اللي دفعه العميل',
    sql: `WITH rf AS (SELECT order_id, sum(amount_fils)::bigint AS led, max(created_at) AS last_at FROM refunds GROUP BY 1)
          SELECT o.id AS order_id, o.kind, o.total_fils, rf.led AS refunded_fils, COALESCE(rc.rcpt_fils,0) AS receipt_fils,
                 ${ts('rf.last_at')} AS last_refund
            FROM rf JOIN orders o ON o.id = rf.order_id
            LEFT JOIN LATERAL (
              SELECT max(r.total_fils)::bigint AS rcpt_fils FROM finance_receipts r
               WHERE r.order_id = o.id
                  OR (o.event_id IS NOT NULL AND r.event_id = o.event_id)
                  OR r.event_id IN (SELECT e.id FROM events e WHERE e.order_id = o.id)) rc ON true
           WHERE rf.last_at > now() - interval '120 days'
             AND rf.led > GREATEST(o.total_fils, COALESCE(rc.rcpt_fils,0))
           ORDER BY rf.last_at DESC`,
    recommendation: 'Check the refunds on this order for a duplicate entry and delete/undo the extra one.',
    recommendationAr: 'راجعي الاستردادات على هذا الطلب، غالباً في استرداد مكرر — احذفيه أو تراجعي عنه.',
  },
  {
    key: 'money.receipt_refund_mismatch',
    area: 'money',
    severity: 'warning',
    title: 'Receipt "refunded" amount ≠ refund ledger',
    titleAr: 'مبلغ الاسترداد على الإيصال ما يطابق سجل الاستردادات',
    sql: `SELECT r.number AS receipt, r.source, r.total_fils, r.refunded_fils AS receipt_refunded_fils, l.ledger_fils
            FROM finance_receipts r
            JOIN LATERAL (
              SELECT COALESCE(sum(f.amount_fils),0)::bigint AS ledger_fils, max(f.created_at) AS last_at
                FROM refunds f
               WHERE f.order_id = r.order_id
                  OR (r.event_id IS NOT NULL AND (
                        f.order_id IN (SELECT e.order_id FROM events e WHERE e.id = r.event_id)
                     OR f.order_id IN (SELECT o.id FROM orders o WHERE o.event_id = r.event_id)))) l ON true
           WHERE r.created_at > now() - interval '400 days'
             AND (r.refunded_fils > 0 OR l.ledger_fils > 0)
             AND r.refunded_fils <> l.ledger_fils
             AND COALESCE(l.last_at, r.created_at) > now() - interval '90 days'
           ORDER BY COALESCE(l.last_at, r.created_at) DESC`,
    recommendation: 'The receipt (and its emailed copy) shows a different refund than the ledger. Re-open the receipt and correct the refunded amount.',
    recommendationAr: 'الإيصال (والنسخة اللي انرسلت للعميل) يبيّن استرداد غير اللي في السجل. افتحي الإيصال وصححي مبلغ الاسترداد.',
  },
  {
    key: 'money.provider_refund_not_in_ledger',
    area: 'money',
    severity: 'warning',
    title: 'Provider refunded more than the refund ledger shows',
    titleAr: 'المزوّد رجّع فلوس أكثر من المسجل عندنا',
    sql: `WITH rf AS (SELECT order_id, sum(amount_fils)::bigint AS led FROM refunds GROUP BY 1)
          SELECT p.order_id, p.provider, sum(p.refunded_fils)::bigint AS provider_refunded_fils, COALESCE(max(rf.led),0) AS ledger_fils,
                 ${ts('max(p.updated_at)')} AS last_update
            FROM payments p LEFT JOIN rf ON rf.order_id = p.order_id
           WHERE p.refunded_fils > 0 AND p.updated_at > now() - interval '90 days'
           GROUP BY p.order_id, p.provider
          HAVING sum(p.refunded_fils) > COALESCE(max(rf.led),0) + 100
           ORDER BY max(p.updated_at) DESC`,
    recommendation: 'A refund was made directly in the provider dashboard. Record it in the app (Refund → record only) so revenue and the receipt are correct.',
    recommendationAr: 'في استرداد انسوّى مباشرة من لوحة المزوّد. سجليه في النظام (استرداد → تسجيل فقط) عشان الإيرادات والإيصال يكونون صح.',
  },
  {
    key: 'money.addon_slice_mismatch',
    area: 'money',
    severity: 'warning',
    title: 'Add-on money slice does not match its add-on order',
    titleAr: 'مبلغ الإضافة على الإيصال ما يطابق طلب الإضافة',
    sql: `SELECT r.number AS receipt, m.order_id, m.amount_fils AS slice_fils, o.kind, o.status, o.total_fils AS order_fils,
                 ${day('m.booked_on')} AS slice_day,
                 CASE WHEN o.id IS NULL THEN 'order missing' WHEN o.kind <> 'addon' THEN 'not an add-on order'
                      WHEN o.status NOT IN ${PAID} THEN 'order not paid'
                      WHEN o.total_fils <> m.amount_fils THEN 'amount differs'
                      ELSE 'event differs' END AS issue
            FROM receipt_addon_money m
            JOIN finance_receipts r ON r.id = m.receipt_id
            LEFT JOIN orders o ON o.id = m.order_id
           WHERE m.order_id NOT LIKE 'edit:%'
             AND m.created_at > now() - interval '120 days'
             AND (o.id IS NULL OR o.kind <> 'addon' OR o.status NOT IN ${PAID} OR o.total_fils <> m.amount_fils
                  OR (r.event_id IS NOT NULL AND o.event_id IS DISTINCT FROM r.event_id))
           ORDER BY m.created_at DESC`,
    recommendation: 'Open the receipt and the add-on order; correct the add-on amount so daily revenue is right.',
    recommendationAr: 'افتحي الإيصال وطلب الإضافة، وصححي مبلغ الإضافة عشان إيراد اليوم يطلع صح.',
  },
  {
    key: 'money.revenue_slice_invalid',
    area: 'money',
    severity: 'critical',
    title: 'Negative / invalid revenue slice (day-by-day revenue is wrong)',
    titleAr: 'جزء إيراد بالسالب أو غلط (إيراد الأيام يطلع غلط)',
    sql: `SELECT r.number AS receipt, r.source, v.slice, v.slice_order_id, ${day('v.money_day')} AS money_day, v.amount_fils,
                 'negative or zero slice' AS issue
            FROM receipt_money_by_day v JOIN finance_receipts r ON r.id = v.receipt_id
           -- a receipt whose own total is negative is a credit note (QuickBooks
           -- history), not a broken slice
           WHERE (v.amount_fils < 0 AND r.total_fils >= 0) OR (v.slice = 'addon' AND v.amount_fils = 0)
          UNION ALL
          SELECT r.number, r.source, 'edit', m.order_id, ${day('m.booked_on')}, m.amount_fils, 'edit slice points at another receipt'
            FROM receipt_addon_money m JOIN finance_receipts r ON r.id = m.receipt_id
           WHERE m.order_id LIKE 'edit:%' AND split_part(m.order_id, ':', 2) <> m.receipt_id::text`,
    recommendation: 'Open the receipt: an edit/add-on moved more money than the receipt holds. Re-save the receipt with the correct total.',
    recommendationAr: 'افتحي الإيصال: تعديل أو إضافة نقل فلوس أكثر من قيمة الإيصال. احفظي الإيصال من جديد بالمبلغ الصحيح.',
  },
  {
    key: 'money.receipt_math',
    area: 'money',
    severity: 'warning',
    title: 'Receipt totals don\'t add up (items vs subtotal vs total)',
    titleAr: 'حسبة الإيصال ما تركب (البنود / المجموع / الإجمالي)',
    sql: `SELECT number AS receipt, source, subtotal_fils, discount_fils, shipping_fils, total_fils, items_fils,
                 CASE WHEN total_fils < 0 THEN 'negative total'
                      WHEN abs(items_fils - subtotal_fils) > 100 THEN 'items ≠ subtotal'
                      ELSE 'subtotal − discount + delivery ≠ total' END AS issue
            FROM (
              SELECT r.number, r.source, r.subtotal_fils, r.discount_fils, r.shipping_fils, r.total_fils, r.created_at,
                     (SELECT COALESCE(sum(round(${jnum(`li->>'qty'`, '1')} * ${jnum(`li->>'priceFils'`, '0')})),0)::bigint
                        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.line_items) = 'array' THEN r.line_items ELSE '[]'::jsonb END) li) AS items_fils,
                     jsonb_typeof(r.line_items) = 'array' AND jsonb_array_length(r.line_items) > 0 AS has_items
                FROM finance_receipts r
               WHERE r.source <> 'quickbooks' AND r.created_at > now() - interval '90 days') x
           WHERE total_fils < 0
              OR (has_items AND abs(items_fils - subtotal_fils) > 100)
              OR (source = 'dashboard' AND GREATEST(0, subtotal_fils - discount_fils + shipping_fils) <> total_fils)
           ORDER BY created_at DESC`,
    recommendation: 'Open the receipt and re-save it so the line items, subtotal and total agree.',
    recommendationAr: 'افتحي الإيصال واحفظيه من جديد عشان البنود والمجموع والإجمالي يتطابقون.',
  },
  {
    key: 'money.receipt_points_to_unpaid_order',
    area: 'money',
    severity: 'warning',
    title: 'Receipt linked to a missing or unpaid order',
    titleAr: 'إيصال مربوط بطلب مو موجود أو مو مدفوع',
    sql: `SELECT r.number AS receipt, r.source, r.order_id, o.kind, o.status, r.total_fils, ${day('r.booked_on')} AS booked_on
            FROM finance_receipts r LEFT JOIN orders o ON o.id = r.order_id
           WHERE r.order_id IS NOT NULL AND r.created_at > now() - interval '180 days'
             AND (o.id IS NULL OR o.status NOT IN ${PAID})
           ORDER BY r.created_at DESC`,
    recommendation: 'A sale is on the books for an order that is not paid — verify the payment; delete the receipt if the money never came in.',
    recommendationAr: 'في بيع مسجّل لطلب مو مدفوع — تأكدي من الدفع، وإذا الفلوس ما وصلت احذفي الإيصال.',
  },
  {
    key: 'money.invoice_inconsistent',
    area: 'money',
    severity: 'warning',
    title: 'Invoice payment figures inconsistent / balance payment not applied',
    titleAr: 'أرقام الفاتورة متضاربة أو دفعة رصيد ما انطبقت على الفاتورة',
    sql: `SELECT 'invoice' AS kind, i.number AS ref, i.status, i.total_fils, i.amount_paid_fils AS paid_fils,
                 CASE WHEN i.amount_paid_fils > i.total_fils THEN 'paid more than total'
                      WHEN i.status = 'paid' AND i.amount_paid_fils < i.total_fils THEN 'marked paid but balance due'
                      ELSE 'zero/negative total' END AS issue
            FROM finance_invoices i
           WHERE COALESCE(i.source,'') <> 'quickbooks'
             AND (i.amount_paid_fils > i.total_fils
                  OR (i.status = 'paid' AND i.amount_paid_fils < i.total_fils)
                  OR (i.total_fils <= 0 AND i.created_at > now() - interval '180 days'))
          UNION ALL
          SELECT 'invoice_pay_order', o.id, o.status, o.total_fils, NULL::bigint, 'paid balance not applied to the invoice'
            FROM orders o
           WHERE o.kind = 'invoice_pay' AND o.status IN ${PAID} AND o.created_at > now() - interval '60 days'
             AND NOT EXISTS (SELECT 1 FROM invoice_payments ip WHERE ip.order_id = o.id)`,
    recommendation: 'Open the invoice and correct the amount paid (or apply the customer\'s balance payment to it).',
    recommendationAr: 'افتحي الفاتورة وصححي المبلغ المدفوع (أو طبّقي دفعة الرصيد على الفاتورة).',
  },
  {
    key: 'money.revenue_vs_payments_daily',
    area: 'money',
    severity: 'warning',
    title: 'Cross-check: app revenue booked per day ≠ app payments received that day',
    titleAr: 'مطابقة: إيراد التطبيق المسجل باليوم ≠ المدفوعات اللي وصلت نفس اليوم',
    sql: `WITH days AS (SELECT generate_series(${TODAY} - 7, ${TODAY} - 1, interval '1 day')::date AS d),
               rev AS (
                 SELECT v.money_day AS d, sum(v.amount_fils)::bigint AS f
                   FROM receipt_money_by_day v
                   JOIN finance_receipts r ON r.id = v.receipt_id
                   LEFT JOIN orders o ON o.id = v.slice_order_id
                  WHERE v.money_day >= ${TODAY} - 7 AND v.money_day < ${TODAY}
                    AND ((v.slice = 'base' AND r.source IN ('app','shop') AND o.id IS NOT NULL AND ${appOrder('o')})
                      OR (v.slice = 'addon' AND o.kind = 'addon' AND ${appOrder('o')}))
                  GROUP BY 1),
               pay AS (
                 SELECT (COALESCE(fs.at, p.updated_at) AT TIME ZONE 'Asia/Dubai')::date AS d, sum(p.amount_fils)::bigint AS f
                   FROM payments p JOIN orders o ON o.id = p.order_id
                   LEFT JOIN LATERAL (SELECT min(pe.created_at) AS at FROM payment_events pe
                                       WHERE pe.payment_id = p.id AND pe.new_status IN ('paid','captured')) fs ON true
                  WHERE p.status IN ${PAY_OK} AND o.kind IN ('booking','addon','shop') AND ${appOrder('o')}
                    AND p.created_at > now() - interval '10 days'
                  GROUP BY 1)
          SELECT to_char(days.d,'YYYY-MM-DD') AS day, COALESCE(rev.f,0) AS revenue_fils, COALESCE(pay.f,0) AS payments_fils,
                 COALESCE(rev.f,0) - COALESCE(pay.f,0) AS diff_fils
            FROM days LEFT JOIN rev ON rev.d = days.d LEFT JOIN pay ON pay.d = days.d
           WHERE abs(COALESCE(rev.f,0) - COALESCE(pay.f,0)) > 100
           ORDER BY days.d DESC`,
    recommendation: 'For that day compare the Sales page with the provider payouts: a positive diff means a receipt without payment (or an edit), negative means a payment with no receipt.',
    recommendationAr: 'لذاك اليوم قارني صفحة المبيعات مع تحويلات مزوّد الدفع: الفرق الموجب يعني إيصال بدون دفعة (أو تعديل)، والسالب يعني دفعة بدون إيصال.',
  },

  // ═══════════════════════════ BOOKINGS ═══════════════════════════
  {
    key: 'bookings.paid_order_without_receipt',
    area: 'bookings',
    severity: 'critical',
    title: 'Paid booking/shop order not on the Sales page',
    titleAr: 'حجز أو طلب متجر مدفوع وما له إيصال في المبيعات',
    sql: `SELECT o.id AS order_id, o.kind, COALESCE(o.source,'app') AS source, o.status, o.total_fils, ${ts('o.created_at')} AS created
            FROM orders o
           WHERE o.status IN ${PAID} AND o.kind IN ('booking','shop') AND ${moneyOrder('o')}
             AND o.created_at > now() - interval '60 days' AND o.created_at < now() - interval '1 hour'
             AND NOT EXISTS (SELECT 1 FROM finance_receipts r WHERE r.order_id = o.id)
             AND NOT EXISTS (SELECT 1 FROM finance_receipts r JOIN events e ON e.id = r.event_id WHERE e.order_id = o.id)
             AND NOT EXISTS (SELECT 1 FROM app_kv k WHERE k.k = 'receipt_deleted:' || o.id)
           ORDER BY o.created_at DESC`,
    recommendation: 'Revenue is missing from the books. Run "Backfill missing sales" from Finance or create the receipt by hand.',
    recommendationAr: 'في إيراد ناقص من الحسابات. شغّلي "إضافة المبيعات الناقصة" من المالية أو سوّي الإيصال يدوي.',
  },
  {
    key: 'bookings.paid_addon_not_on_receipt',
    area: 'bookings',
    severity: 'critical',
    title: 'Paid add-on not merged into any receipt',
    titleAr: 'إضافة مدفوعة ما انضافت لأي إيصال',
    sql: `SELECT o.id AS order_id, o.event_id, o.status, o.total_fils, ${ts('o.created_at')} AS created
            FROM orders o
           WHERE o.kind = 'addon' AND o.status IN ${PAID}
             AND o.created_at > now() - interval '60 days' AND o.created_at < now() - interval '1 hour'
             AND NOT EXISTS (SELECT 1 FROM receipt_addon_money m WHERE m.order_id = o.id)
             AND NOT EXISTS (SELECT 1 FROM finance_receipts r WHERE r.order_id = o.id)
             AND NOT EXISTS (SELECT 1 FROM app_kv k WHERE k.k = 'receipt_deleted:' || o.id)
           ORDER BY o.created_at DESC`,
    recommendation: 'Add the add-on lines to the event\'s receipt (or create a receipt) so the money is counted on the day it was paid.',
    recommendationAr: 'ضيفي بنود الإضافة على إيصال الفعالية (أو سوّي إيصال) عشان الفلوس تنحسب في يوم الدفع.',
  },
  {
    key: 'bookings.event_order_not_paid',
    area: 'bookings',
    severity: 'critical',
    title: 'Live event whose order is missing / not a paid booking',
    titleAr: 'فعالية قائمة وطلبها مو موجود أو مو حجز مدفوع',
    sql: `SELECT e.id AS event_id, ${day('e.event_date')} AS event_date, e.phase, e.order_id, o.kind, o.status
            FROM events e LEFT JOIN orders o ON o.id = e.order_id
           WHERE e.cancelled_at IS NULL AND e.created_at > now() - interval '120 days'
             AND (o.id IS NULL OR o.kind <> 'booking' OR o.status NOT IN ${PAID})
           ORDER BY e.event_date`,
    recommendation: 'An event exists without a paid booking behind it. Confirm payment with the customer or cancel the event.',
    recommendationAr: 'في فعالية بدون حجز مدفوع وراها. تأكدي من الدفع مع العميل أو ألغي الفعالية.',
  },
  {
    key: 'bookings.multiple_events_per_order',
    area: 'bookings',
    severity: 'critical',
    title: 'One order created more than one event',
    titleAr: 'طلب واحد طلّع أكثر من فعالية',
    sql: `SELECT order_id, count(*)::int AS events, string_agg(id, ', ' ORDER BY id) AS event_ids
            FROM events GROUP BY order_id HAVING count(*) > 1`,
    recommendation: 'A duplicate party exists for one booking. Cancel the duplicate (no refund) so staff and stock aren\'t booked twice.',
    recommendationAr: 'في حفلة مكررة لنفس الحجز. ألغي النسخة المكررة (بدون استرداد) عشان الفريق والمخزون ما ينحجزون مرتين.',
  },
  {
    key: 'bookings.event_without_receipt',
    area: 'bookings',
    severity: 'warning',
    title: 'Live event with no sales receipt',
    titleAr: 'فعالية قائمة بدون إيصال مبيعات',
    sql: `SELECT e.id AS event_id, ${day('e.event_date')} AS event_date, e.phase, e.order_id, o.status, o.total_fils
            FROM events e LEFT JOIN orders o ON o.id = e.order_id
           WHERE e.cancelled_at IS NULL AND e.source IS DISTINCT FROM 'quickbooks_import'
             AND e.created_at > now() - interval '90 days' AND e.created_at < now() - interval '1 hour'
             AND NOT EXISTS (SELECT 1 FROM finance_receipts r WHERE r.event_id = e.id OR r.order_id = e.order_id)
             AND NOT EXISTS (SELECT 1 FROM app_kv k WHERE k.k = 'receipt_deleted:' || e.order_id)
           ORDER BY e.event_date`,
    recommendation: 'The party is on the schedule but its money is not in Sales. Create/link the receipt.',
    recommendationAr: 'الحفلة موجودة في الجدول بس فلوسها مو في المبيعات. سوّي الإيصال أو اربطيه.',
  },
  {
    key: 'bookings.receipt_without_event',
    area: 'bookings',
    severity: 'warning',
    title: 'Upcoming sale not turned into an event (team can\'t see it)',
    titleAr: 'بيع قادم ما تحوّل لفعالية (الفريق ما يشوفه)',
    sql: `SELECT r.number AS receipt, r.source, ${day('r.date')} AS event_date, r.date_tbd, r.total_fils, ${ts('r.created_at')} AS created
            FROM finance_receipts r LEFT JOIN orders o ON o.id = r.order_id
           WHERE r.event_id IS NULL AND r.source IN ('dashboard','manual','app')
             AND r.date >= ${TODAY} AND r.created_at < now() - interval '1 hour'
             AND (o.id IS NULL OR o.kind = 'booking')
             AND NOT EXISTS (SELECT 1 FROM events e WHERE e.order_id = r.order_id)
           ORDER BY r.date`,
    recommendation: 'Open the receipt and save it again (it converts to an event) so the crew, prep and stock are planned.',
    recommendationAr: 'افتحي الإيصال واحفظيه مرة ثانية (يتحوّل لفعالية) عشان الفريق والتحضير والمخزون ينخطط لهم.',
  },

  // ═══════════════════════════ EVENTS ═══════════════════════════
  {
    key: 'events.past_not_completed',
    area: 'events',
    severity: 'warning',
    title: 'Past event never marked completed',
    titleAr: 'فعالية فاتت وما انعلّمت منتهية',
    sql: `SELECT id AS event_id, ${day('event_date')} AS event_date, start_time, base_end_time, phase
            FROM events
           WHERE cancelled_at IS NULL AND NOT COALESCE(date_tbd,false)
             AND phase NOT IN ('Event Completed','Cancelled')
             AND event_date < ${TODAY} - 1 AND event_date >= ${TODAY} - 60
           ORDER BY event_date`,
    recommendation: 'Mark it completed (or cancelled / TBD). A stuck event blocks feedback requests and staff pay for that day; check its end time format.',
    recommendationAr: 'علّميها منتهية (أو ملغية / تاريخ غير محدد). الفعالية العالقة توقف طلب التقييم وأجور الفريق لذاك اليوم؛ تأكدي من صيغة وقت النهاية.',
  },
  {
    key: 'events.cancel_flags_mismatch',
    area: 'events',
    severity: 'warning',
    title: 'Event cancelled flag and phase disagree',
    titleAr: 'علامة الإلغاء ومرحلة الفعالية متضاربة',
    sql: `SELECT id AS event_id, ${day('event_date')} AS event_date, phase, ${ts('cancelled_at')} AS cancelled_at
            FROM events
           WHERE event_date >= ${TODAY} - 180
             AND ((cancelled_at IS NOT NULL AND phase <> 'Cancelled') OR (phase = 'Cancelled' AND cancelled_at IS NULL))
           ORDER BY event_date`,
    recommendation: 'Re-cancel or reinstate the event from the dashboard so every screen agrees.',
    recommendationAr: 'ألغي الفعالية أو رجّعيها من لوحة التحكم عشان كل الشاشات تتفق.',
  },
  {
    key: 'events.receipt_date_drift',
    area: 'events',
    severity: 'warning',
    title: 'Upcoming event date/time differs from its receipt',
    titleAr: 'تاريخ أو وقت الفعالية القادمة يختلف عن الإيصال',
    sql: `SELECT e.id AS event_id, r.number AS receipt, ${day('e.event_date')} AS event_date, ${day('r.date')} AS receipt_date,
                 e.start_time, r.event_time AS receipt_time, e.date_tbd, r.date_tbd AS receipt_tbd
            FROM events e JOIN finance_receipts r ON r.event_id = e.id
           WHERE e.cancelled_at IS NULL AND (e.event_date >= ${TODAY} OR e.date_tbd)
             AND (   (NOT e.date_tbd AND NOT r.date_tbd AND e.event_date <> r.date)
                  OR e.date_tbd <> r.date_tbd
                  OR (NULLIF(btrim(r.event_time),'') IS NOT NULL AND r.event_time <> e.start_time))
           ORDER BY e.event_date`,
    recommendation: 'The customer\'s receipt shows a different date/time than the team schedule. Correct whichever is wrong.',
    recommendationAr: 'إيصال العميل يبيّن تاريخ/وقت غير جدول الفريق. صححي اللي غلط فيهم.',
  },
  {
    key: 'events.missing_location',
    area: 'events',
    severity: 'warning',
    title: 'Event in the next 3 days with no location',
    titleAr: 'فعالية خلال ٣ أيام بدون موقع',
    sql: `SELECT id AS event_id, ${day('event_date')} AS event_date, start_time, emirate
            FROM events
           WHERE cancelled_at IS NULL AND NOT COALESCE(date_tbd,false)
             AND event_date BETWEEN ${TODAY} AND ${TODAY} + 3
             AND (map_lat = 0 OR map_lng = 0)
             AND COALESCE(btrim(location_note),'') = ''
             AND (address IS NULL OR address = '{}'::jsonb)
           ORDER BY event_date, start_time`,
    recommendation: 'Get the address / Google Maps pin from the customer and add it to the event before the driver leaves.',
    recommendationAr: 'خذي العنوان أو لوكيشن قوقل ماب من العميل وضيفيه للفعالية قبل ما يطلع السايق.',
  },

  // ═══════════════════════════ INVENTORY ═══════════════════════════
  {
    key: 'inventory.overbooked',
    area: 'inventory',
    severity: 'critical',
    title: 'Asset booked more times than units owned (same time window)',
    titleAr: 'قطعة محجوزة أكثر من عددها بنفس الوقت',
    sql: `SELECT h1.asset_code, a.units, h1.id AS hold_id, h1.event_id, ${ts('h1.starts_at')} AS starts, count(h2.id)::int + 1 AS concurrent
            FROM inventory_holds h1
            JOIN inventory_assets a ON a.code = h1.asset_code
            JOIN inventory_holds h2 ON h2.asset_code = h1.asset_code AND h2.id <> h1.id
                 AND h2.status IN ('held','reserved') AND (h2.status = 'reserved' OR h2.expires_at > now())
                 AND h2.starts_at < h1.ends_at AND h1.starts_at < h2.ends_at
           WHERE h1.status IN ('held','reserved') AND (h1.status = 'reserved' OR h1.expires_at > now())
             AND h1.ends_at > now()
           GROUP BY h1.asset_code, a.units, h1.id, h1.event_id, h1.starts_at
          HAVING count(h2.id) + 1 > a.units
           ORDER BY h1.starts_at`,
    recommendation: 'Two parties need the same item at the same time. Re-assign a variant, rent one, or move a party — before the day.',
    recommendationAr: 'حفلتين يبون نفس القطعة بنفس الوقت. غيّري النوع، أو استأجري وحدة، أو حركي وحدة من الحفلات — قبل اليوم.',
  },
  {
    key: 'inventory.holds_on_dead_bookings',
    area: 'inventory',
    severity: 'warning',
    title: 'Stock still reserved for a cancelled/failed booking',
    titleAr: 'مخزون محجوز لحجز ملغي أو فاشل',
    sql: `SELECT h.id AS hold_id, h.asset_code, h.status, h.order_id, o.status AS order_status, h.event_id,
                 ${ts('h.starts_at')} AS starts
            FROM inventory_holds h JOIN orders o ON o.id = h.order_id
            LEFT JOIN events e ON e.id = h.event_id
           WHERE h.status IN ('held','reserved') AND h.ends_at > now()
             AND (h.status = 'reserved' OR h.expires_at > now())
             AND (o.status IN ('failed','cancelled','refunded','expired') OR e.cancelled_at IS NOT NULL)
           ORDER BY h.starts_at`,
    recommendation: 'Release these holds so the items can be booked by other customers.',
    recommendationAr: 'حرّري هالحجوزات عشان القطع تنحجز لعملاء ثانيين.',
  },
  {
    key: 'inventory.unavailable_asset_booked',
    area: 'inventory',
    severity: 'warning',
    title: 'Item under maintenance/retired or reported broken but booked in the next 14 days',
    titleAr: 'قطعة في الصيانة أو خربانة ومحجوزة خلال ١٤ يوم',
    sql: `SELECT h.asset_code, a.status AS asset_status, h.event_id, ${ts('h.starts_at')} AS starts,
                 (SELECT string_agg(i.kind, ',') FROM asset_issues i WHERE i.asset_code = h.asset_code AND i.status <> 'resolved') AS open_issues
            FROM inventory_holds h JOIN inventory_assets a ON a.code = h.asset_code
            LEFT JOIN events e ON e.id = h.event_id
           WHERE h.status = 'reserved' AND e.cancelled_at IS NULL
             AND h.starts_at < now() + interval '14 days' AND h.ends_at > now()
             AND (a.status IN ('maintenance','retired')
                  OR EXISTS (SELECT 1 FROM asset_issues i WHERE i.asset_code = h.asset_code
                              AND i.status <> 'resolved' AND i.kind IN ('broken','damaged')))
           ORDER BY h.starts_at`,
    recommendation: 'Fix the item, swap in another unit, or tell the customer — before the party.',
    recommendationAr: 'صلّحي القطعة أو بدّليها بوحدة ثانية أو بلّغي العميل — قبل الحفلة.',
  },
  {
    key: 'inventory.hold_expired_not_released',
    area: 'inventory',
    severity: 'info',
    title: 'Expired temporary holds not released',
    titleAr: 'حجوزات مؤقتة انتهت وما انحررت',
    sql: `SELECT h.id AS hold_id, h.asset_code, h.order_id, ${ts('h.expires_at')} AS expired_at
            FROM inventory_holds h
           WHERE h.status = 'held' AND h.expires_at < now() - interval '1 hour'
           ORDER BY h.expires_at`,
    recommendation: 'The background sweep should release these; if the count keeps growing, the sweep is not running.',
    recommendationAr: 'المفروض النظام يحررها تلقائي؛ إذا العدد يزيد كل يوم معناته المهمة التلقائية واقفة.',
  },

  // ═══════════════════════════ STAFF ═══════════════════════════
  {
    key: 'staff.inactive_member_assigned',
    area: 'staff',
    severity: 'critical',
    title: 'Inactive / departed staff assigned to an upcoming event',
    titleAr: 'موظف غير نشط أو طالع من الشغل معيّن لفعالية قادمة',
    sql: `SELECT e.id AS event_id, ${day('e.event_date')} AS event_date, s.role, m.id AS member_id, m.name AS staff_name,
                 m.active, ${day('m.employment_end_date')} AS employment_end
            FROM event_staff s JOIN team_members m ON m.id = s.assignee_id JOIN events e ON e.id = s.event_id
           WHERE e.cancelled_at IS NULL AND e.event_date >= ${TODAY}
             AND (NOT m.active OR m.employment_end_date < e.event_date)
           ORDER BY e.event_date`,
    recommendation: 'Re-assign these slots to an active team member.',
    recommendationAr: 'عيّني موظف نشط بدالهم في هالمهام.',
  },
  {
    key: 'staff.unfilled_slots',
    area: 'staff',
    severity: 'warning',
    title: 'Crew slots still empty for events in the next 7 days',
    titleAr: 'أماكن فريق فاضية لفعاليات خلال ٧ أيام',
    sql: `SELECT e.id AS event_id, ${day('e.event_date')} AS event_date, count(*)::int AS empty_slots,
                 string_agg(DISTINCT s.role, ', ') AS roles
            FROM event_staff s JOIN events e ON e.id = s.event_id
           WHERE e.cancelled_at IS NULL AND NOT COALESCE(e.date_tbd,false)
             AND e.event_date BETWEEN ${TODAY} AND ${TODAY} + 7
             AND s.assignee_id IS NULL AND COALESCE(btrim(s.part_time_name),'') = ''
           GROUP BY e.id, e.event_date
           ORDER BY e.event_date`,
    recommendation: 'Assign an internal member or book a part-timer for each empty slot.',
    recommendationAr: 'عيّني موظف من الفريق أو احجزي بارت تايم لكل مكان فاضي.',
  },
  {
    key: 'staff.assigned_on_leave',
    area: 'staff',
    severity: 'warning',
    title: 'Staff assigned on a day they are on approved leave / day off',
    titleAr: 'موظف معيّن في يوم إجازته المعتمدة',
    sql: `SELECT e.id AS event_id, ${day('e.event_date')} AS event_date, m.id AS member_id, m.name AS staff_name, s.role,
                 ${day('d.start_date')} AS off_from, ${day('d.end_date')} AS off_to
            FROM event_staff s
            JOIN events e ON e.id = s.event_id
            JOIN team_members m ON m.id = s.assignee_id
            JOIN staff_days_off d ON d.member_id = s.assignee_id AND d.status = 'approved'
                 AND e.event_date BETWEEN d.start_date AND d.end_date
           WHERE e.cancelled_at IS NULL AND e.event_date >= ${TODAY}
           ORDER BY e.event_date`,
    recommendation: 'Swap the person out of the event, or cancel the leave with them.',
    recommendationAr: 'بدّلي الموظف في الفعالية، أو اتفقي معه وألغي الإجازة.',
  },
  {
    key: 'staff.double_booked',
    area: 'staff',
    severity: 'warning',
    title: 'Same staff member on two overlapping events',
    titleAr: 'نفس الموظف على فعاليتين بنفس الوقت',
    sql: `SELECT s1.assignee_id AS member_id, m.name AS staff_name, ${day('e1.event_date')} AS event_date,
                 s1.event_id AS event_a, e1.start_time AS start_a, s2.event_id AS event_b, e2.start_time AS start_b
            FROM event_staff s1
            JOIN event_staff s2 ON s2.assignee_id = s1.assignee_id AND s1.event_id < s2.event_id
            JOIN events e1 ON e1.id = s1.event_id
            JOIN events e2 ON e2.id = s2.event_id
            JOIN team_members m ON m.id = s1.assignee_id
           WHERE e1.event_date = e2.event_date AND e1.event_date >= ${TODAY}
             AND e1.cancelled_at IS NULL AND e2.cancelled_at IS NULL
             AND NOT COALESCE(e1.date_tbd,false) AND NOT COALESCE(e2.date_tbd,false)
             AND e1.start_time < e2.base_end_time AND e2.start_time < e1.base_end_time
           ORDER BY e1.event_date`,
    recommendation: 'One person cannot be at both parties — re-assign one of the slots.',
    recommendationAr: 'الشخص ما يقدر يكون في الحفلتين — بدّلي واحد من المكانين.',
  },
  {
    key: 'staff.prep_overdue',
    area: 'staff',
    severity: 'warning',
    title: 'Prep tasks past their due date for upcoming events',
    titleAr: 'مهام تحضير متأخرة عن موعدها لفعاليات قادمة',
    sql: `SELECT p.event_id, ${day('e.event_date')} AS event_date, p.title, p.status, ${day('p.due_date')} AS due_date
            FROM prep_tasks p JOIN events e ON e.id = p.event_id
           WHERE e.cancelled_at IS NULL AND e.event_date >= ${TODAY}
             AND p.due_date < ${TODAY} AND p.status <> 'completed'
           ORDER BY e.event_date, p.due_date`,
    recommendation: 'Follow up with the assignees today; escalate anything blocked ("issue").',
    recommendationAr: 'تابعي مع المسؤولين اليوم، وأي مهمة واقفة (مشكلة) صعّديها.',
  },
  {
    key: 'staff.prep_unassigned',
    area: 'staff',
    severity: 'warning',
    title: 'Prep tasks with nobody assigned (event within 7 days)',
    titleAr: 'مهام تحضير بدون أحد معيّن (فعالية خلال ٧ أيام)',
    sql: `SELECT p.event_id, ${day('e.event_date')} AS event_date, p.title, p.status
            FROM prep_tasks p JOIN events e ON e.id = p.event_id
           WHERE e.cancelled_at IS NULL AND NOT COALESCE(e.date_tbd,false)
             AND e.event_date BETWEEN ${TODAY} AND ${TODAY} + 7
             AND p.status <> 'completed'
             AND NOT EXISTS (SELECT 1 FROM prep_task_staff x WHERE x.task_id = p.id)
           ORDER BY e.event_date`,
    recommendation: 'Assign each task to someone with the right skill, or press "Generate prep" on the event again.',
    recommendationAr: 'عيّني كل مهمة لشخص عنده المهارة، أو اضغطي "توليد التحضير" للفعالية مرة ثانية.',
  },

  // ═══════════════════════════ NOTIFICATIONS ═══════════════════════════
  {
    key: 'notifications.customer_email_stuck',
    area: 'notifications',
    severity: 'warning',
    title: 'Customer emails overdue by more than 2 hours',
    titleAr: 'إيميلات للعملاء متأخرة أكثر من ساعتين',
    sql: `SELECT n.id AS notification_id, n.template, n.event_id, ${ts('n.scheduled_for')} AS due
            FROM notifications n JOIN events e ON e.id = n.event_id
           WHERE n.channel = 'email' AND n.sent_at IS NULL AND n.cancelled_at IS NULL
             AND n.template IN ('booking_confirmation','three_day_reminder','event_day','booking_updated',
                                'event_cancelled','cancellation_refund','team_on_the_way','team_arrived','setup_ready')
             AND n.scheduled_for < now() - interval '2 hours' AND n.scheduled_for > now() - interval '3 days'
             AND (NOT COALESCE(e.date_tbd,false) OR n.template IN ('event_cancelled','cancellation_refund'))
             AND (e.event_date >= ${TODAY} OR n.template IN ('event_cancelled','cancellation_refund'))
           ORDER BY n.scheduled_for`,
    recommendation: 'Email delivery is failing or the sweep is stopped. Check the email provider (Resend) status/API key and the server logs.',
    recommendationAr: 'إرسال الإيميل واقف أو المهمة التلقائية واقفة. شيكي على حالة مزوّد الإيميل (Resend) والمفتاح وسجلات السيرفر.',
  },
  {
    key: 'notifications.refund_email_stuck',
    area: 'notifications',
    severity: 'warning',
    title: 'Refund confirmation email not sent after 2 hours',
    titleAr: 'إيميل تأكيد الاسترداد ما انرسل بعد ساعتين',
    sql: `SELECT n.id AS notification_id, n.payload->>'orderId' AS order_id, (n.payload->>'amountFils') AS amount_fils,
                 ${ts('n.created_at')} AS created
            FROM notifications n
           WHERE n.template = 'refund_processed' AND n.sent_at IS NULL AND n.cancelled_at IS NULL
             AND n.created_at < now() - interval '2 hours' AND n.created_at > now() - interval '7 days'
           ORDER BY n.created_at`,
    recommendation: 'The customer has not been told about the refund — check the customer has an email and resend.',
    recommendationAr: 'العميل ما وصله خبر الاسترداد — تأكدي إن عنده إيميل وأعيدي الإرسال.',
  },
  {
    key: 'notifications.pending_on_cancelled_event',
    area: 'notifications',
    severity: 'warning',
    title: 'Customer messages still queued for a cancelled event',
    titleAr: 'رسائل للعميل لسا بالانتظار لفعالية ملغية',
    sql: `SELECT n.id AS notification_id, n.event_id, n.template, n.channel, ${ts('n.scheduled_for')} AS due
            FROM notifications n JOIN events e ON e.id = n.event_id
           WHERE e.cancelled_at IS NOT NULL AND n.cancelled_at IS NULL
             AND n.channel = 'email'
             AND (n.sent_at IS NULL OR n.whatsapp_sent_at IS NULL)
             AND n.template NOT IN ('event_cancelled','cancellation_refund','refund_processed','order_cancelled','driver_order_cancelled')
             AND COALESCE(n.scheduled_for, n.created_at) > now() - interval '1 day'
           ORDER BY n.scheduled_for`,
    recommendation: 'Cancel these messages so the customer doesn\'t get a reminder for a cancelled party.',
    recommendationAr: 'ألغي هالرسائل عشان العميل ما يوصله تذكير لحفلة ملغية.',
  },
  {
    key: 'notifications.duplicate_customer_send',
    area: 'notifications',
    severity: 'warning',
    title: 'Same customer message sent twice for one event (last 30 days)',
    titleAr: 'نفس الرسالة انرسلت للعميل مرتين لنفس الفعالية (آخر ٣٠ يوم)',
    sql: `SELECT event_id, template, count(*)::int AS sent, ${ts('max(sent_at)')} AS last_sent
            FROM notifications
           WHERE channel = 'email' AND sent_at IS NOT NULL AND event_id IS NOT NULL
             AND template IN ('booking_confirmation','three_day_reminder','event_day')
             AND sent_at > now() - interval '30 days'
           GROUP BY event_id, template HAVING count(*) > 1
           ORDER BY max(sent_at) DESC`,
    recommendation: 'Look at what queued the second message (reschedule / edit); customers notice duplicates.',
    recommendationAr: 'شوفي شو اللي حط الرسالة الثانية (تغيير موعد / تعديل)؛ العملاء ينتبهون للتكرار.',
  },

  // ═══════════════════════════ EXPENSES ═══════════════════════════
  {
    key: 'expenses.possible_duplicates',
    area: 'expenses',
    severity: 'warning',
    title: 'Possible duplicate expenses (same vendor, amount and day)',
    titleAr: 'مصاريف ممكن مكررة (نفس المورد والمبلغ واليوم)',
    sql: `SELECT lower(btrim(COALESCE(vendor,''))) AS vendor, amount_fils, ${day('spent_on')} AS spent_on, count(*)::int AS copies,
                 string_agg(id::text, ', ' ORDER BY id) AS expense_ids, string_agg(DISTINCT source, ',') AS sources
            FROM expenses
           WHERE source <> 'quickbooks' AND spent_on >= ${TODAY} - 45 AND amount_fils > 0
           GROUP BY 1, 2, 3 HAVING count(*) > 1
              -- copies that ALL came from separate bank-feed lines are separate
              -- charges (e.g. a 1.05 AED fee per transfer), not duplicates
              AND NOT bool_and(source = 'bank')
           ORDER BY spent_on DESC`,
    recommendation: 'Open each pair; if it is the same purchase (e.g. entered by hand AND approved from the Bank Inbox) delete one.',
    recommendationAr: 'افتحي كل اثنين؛ إذا نفس الشراء (مثلاً انضاف يدوي وانعتمد من صندوق البنك) احذفي واحد.',
  },
  {
    key: 'expenses.invalid',
    area: 'expenses',
    severity: 'warning',
    title: 'Expense with zero amount, no vendor or a future date',
    titleAr: 'مصروف مبلغه صفر أو بدون مورد أو تاريخه بالمستقبل',
    sql: `SELECT id AS expense_id, source, category, amount_fils, ${day('spent_on')} AS spent_on,
                 CASE WHEN amount_fils = 0 THEN 'zero amount' WHEN spent_on > ${TODAY} THEN 'future date' ELSE 'no vendor' END AS issue
            FROM expenses
           WHERE source <> 'quickbooks' AND created_at > now() - interval '45 days'
             AND (amount_fils = 0 OR spent_on > ${TODAY} OR COALESCE(btrim(vendor),'') = '')
           ORDER BY created_at DESC`,
    recommendation: 'Complete the vendor/amount/date so the P&L and supplier reports are right.',
    recommendationAr: 'كمّلي المورد والمبلغ والتاريخ عشان الأرباح وتقارير الموردين تطلع صح.',
  },
  {
    key: 'expenses.items_dont_add_up',
    area: 'expenses',
    severity: 'info',
    title: 'Itemised expense: items + VAT + delivery − discount ≠ amount',
    titleAr: 'مصروف مفصّل: البنود + الضريبة + التوصيل − الخصم ≠ المبلغ',
    sql: `SELECT id AS expense_id, category, amount_fils, items_fils, charges_fils, amount_fils - items_fils - charges_fils AS diff_fils
            FROM (
              SELECT x.id, x.category, x.amount_fils, x.created_at,
                     (SELECT COALESCE(sum(${jnum(`li->>'unitFils'`, '0')} * ${jnum(`li->>'qty'`, '1')}),0)::bigint
                        FROM jsonb_array_elements(x.line_items) li) AS items_fils,
                     (SELECT bool_and(${jnum(`li->>'unitFils'`, '0')} > 0) FROM jsonb_array_elements(x.line_items) li) AS all_priced,
                     (${jnum(`x.extra_charges->>'vatFils'`, '0')} + ${jnum(`x.extra_charges->>'deliveryFils'`, '0')}
                      + ${jnum(`x.extra_charges->>'otherFils'`, '0')} - ${jnum(`x.extra_charges->>'discountFils'`, '0')})::bigint AS charges_fils
                FROM expenses x
               WHERE x.source <> 'quickbooks' AND x.created_at > now() - interval '30 days'
                 AND jsonb_typeof(x.line_items) = 'array' AND jsonb_array_length(x.line_items) > 0
                 AND jsonb_typeof(x.extra_charges) = 'object') q
           WHERE all_priced AND abs(amount_fils - items_fils - charges_fils) > 100
           ORDER BY created_at DESC`,
    recommendation: 'Re-check the receipt photo: an item price, the VAT or the total was typed wrong.',
    recommendationAr: 'راجعي صورة الفاتورة: سعر بند أو الضريبة أو الإجمالي انكتب غلط.',
  },

  // ═══════════════════════════ BANK ═══════════════════════════
  {
    key: 'bank.pending_too_long',
    area: 'bank',
    severity: 'warning',
    title: 'Bank Inbox rows pending for more than 7 days',
    titleAr: 'حركات في صندوق البنك معلّقة أكثر من ٧ أيام',
    sql: `SELECT id AS bank_tx_id, source, direction, kind, amount_fils, ${day('posted_on')} AS posted_on, ${ts('created_at')} AS received
            FROM bank_transactions
           WHERE status = 'pending' AND created_at < now() - interval '7 days'
           ORDER BY created_at`,
    recommendation: 'Approve (with receipt) or ignore these so expenses and cash-on-hand are complete.',
    recommendationAr: 'اعتمدي (مع الفاتورة) أو تجاهلي هالحركات عشان المصاريف والكاش يكونون كاملين.',
  },
  {
    key: 'bank.feed_stale',
    area: 'bank',
    severity: 'warning',
    title: 'Automatic bank/fee feed has not synced for over 26 hours',
    titleAr: 'ربط البنك / الرسوم التلقائي ما تحدّث من أكثر من ٢٦ ساعة',
    sql: `SELECT replace(k, 'feed_ok_', '') AS feed, ${ts('v')} AS last_success,
                 floor(extract(epoch FROM (now() - v)) / 3600)::int AS hours_ago
            FROM app_kv
           WHERE k LIKE 'feed\\_ok\\_%' AND v < now() - interval '26 hours'
          UNION ALL
          SELECT 'zoho_sync_run', ${ts('v')}, floor(extract(epoch FROM (now() - v)) / 3600)::int
            FROM app_kv
           WHERE k = 'zoho_bank_sync_at' AND v < now() - interval '26 hours'`,
    recommendation: 'Reconnect the feed (Zoho / Wafeq / Stripe token) — until then expenses from it are not reaching the Bank Inbox.',
    recommendationAr: 'أعيدي ربط الخدمة (Zoho / Wafeq / Stripe) — لين تنربط المصاريف منها ما توصل لصندوق البنك.',
  },
  {
    key: 'bank.approved_inconsistent',
    area: 'bank',
    severity: 'warning',
    title: 'Bank row approved without an expense, expense used twice, or approved although flagged duplicate',
    titleAr: 'حركة بنك معتمدة بدون مصروف، أو مصروف مربوط مرتين، أو انعتمدت وهي معلّمة مكررة',
    sql: `SELECT b.id AS bank_tx_id, b.status, b.expense_id, b.amount_fils, ${day('b.posted_on')} AS posted_on,
                 CASE WHEN b.status = 'approved' AND x.id IS NULL THEN 'approved but no expense'
                      WHEN b.status <> 'approved' AND b.expense_id IS NOT NULL THEN 'not approved but linked to expense'
                      ELSE 'expense linked to 2+ bank rows' END AS issue
            FROM bank_transactions b LEFT JOIN expenses x ON x.id = b.expense_id
           WHERE (b.status = 'approved' AND x.id IS NULL AND b.decided_at > now() - interval '90 days')
              OR (b.status <> 'approved' AND b.expense_id IS NOT NULL)
              OR (b.expense_id IS NOT NULL AND (SELECT count(*) FROM bank_transactions b2 WHERE b2.expense_id = b.expense_id) > 1)
          UNION ALL
          SELECT b.id, b.status, b.expense_id, b.amount_fils, ${day('b.posted_on')}, 'approved although flagged: ' || left(b.possible_dup_of, 80)
            FROM bank_transactions b
           WHERE b.status = 'approved' AND b.possible_dup_of IS NOT NULL
             AND b.decided_at > now() - interval '45 days'
             AND (   (b.possible_dup_of ~ 'bank #[0-9]+' AND EXISTS (
                        SELECT 1 FROM bank_transactions d
                         WHERE d.id = substring(b.possible_dup_of from 'bank #([0-9]+)')::bigint AND d.status = 'approved'))
                  OR (b.possible_dup_of ~ 'expense #[0-9]+' AND EXISTS (
                        SELECT 1 FROM expenses x
                         WHERE x.id = substring(b.possible_dup_of from 'expense #([0-9]+)')::bigint AND x.id IS DISTINCT FROM b.expense_id)))`,
    recommendation: 'Open the row: an expense may be missing or counted twice. Fix the link or delete the duplicate expense.',
    recommendationAr: 'افتحي الحركة: ممكن مصروف ناقص أو محسوب مرتين. صلّحي الربط أو احذفي المصروف المكرر.',
  },

  // ═══════════════════════════ SYSTEM HEALTH ═══════════════════════════
  {
    key: 'system.money_alerts_24h',
    area: 'system',
    severity: 'critical',
    title: 'Money alerts raised in the last 24h (double payment, failed capture, sale not posted, payment unresolved)',
    titleAr: 'تنبيهات مالية خلال آخر ٢٤ ساعة (دفع مكرر، سحب فاشل، بيع ما انسجل، دفعة معلّقة)',
    sql: `SELECT n.id AS alert_id, n.template, n.payload->>'orderId' AS order_id, n.event_id, ${ts('n.created_at')} AS raised
            FROM notifications n
           WHERE n.channel = 'ops_alert'
             AND n.template IN ('double_payment','capture_failed','sale_post_failed','payment_unresolved','order_needs_review')
             AND n.created_at > now() - interval '24 hours'
           ORDER BY n.created_at DESC`,
    recommendation: 'Handle each alert from the dashboard Alerts list — these involve real customer money.',
    recommendationAr: 'تعاملي مع كل تنبيه من قائمة التنبيهات — هذي فيها فلوس عملاء حقيقية.',
  },
  {
    key: 'system.ops_alerts_24h',
    area: 'system',
    severity: 'warning',
    title: 'Operations alerts in the last 24h (inventory clash, add-on overrun, driver conflict)',
    titleAr: 'تنبيهات تشغيل خلال آخر ٢٤ ساعة (تعارض مخزون، إضافة تتعدى الوقت، تعارض سايق)',
    sql: `SELECT n.id AS alert_id, n.template, n.event_id, n.payload->>'orderId' AS order_id, ${ts('n.created_at')} AS raised
            FROM notifications n
           WHERE n.channel = 'ops_alert'
             AND n.template IN ('inventory_clash','inventory_conflict','addon_overrun','driver_conflict')
             AND n.created_at > now() - interval '24 hours'
           ORDER BY n.created_at DESC`,
    recommendation: 'Resolve each clash with the customer/team before the event day.',
    recommendationAr: 'حلّي كل تعارض مع العميل أو الفريق قبل يوم الفعالية.',
  },
  {
    key: 'system.payment_webhooks_failing',
    area: 'system',
    severity: 'critical',
    title: 'Payment webhooks not processed / amount mismatch / late success',
    titleAr: 'إشعارات الدفع ما انعالجت أو المبلغ مختلف أو دفع متأخر',
    sql: `SELECT w.id AS delivery_id, w.provider, w.provider_status, COALESCE(w.outcome,'not processed') AS outcome,
                 ${ts('w.received_at')} AS received
            FROM webhook_deliveries w
           WHERE w.signature_ok
             AND (   (w.processed_at IS NULL AND w.received_at < now() - interval '30 minutes' AND w.received_at > now() - interval '3 days')
                  OR (w.outcome IN ('amount_mismatch','late_success') AND w.received_at > now() - interval '7 days'))
           ORDER BY w.received_at DESC`,
    recommendation: 'A customer may have paid without the booking confirming. Check the order in Needs Review and the provider dashboard.',
    recommendationAr: 'ممكن عميل دفع والحجز ما انأكد. شيكي الطلب في "يحتاج مراجعة" وفي لوحة مزوّد الدفع.',
  },
  {
    key: 'system.payments_stuck',
    area: 'system',
    severity: 'warning',
    title: 'Payments stuck "processing" >2h, orders needing review, or payment processing errors (24h)',
    titleAr: 'دفعات عالقة "قيد المعالجة" أكثر من ساعتين أو طلبات تحتاج مراجعة أو أخطاء دفع',
    sql: `SELECT 'payment_processing' AS kind, p.order_id, p.provider, p.amount_fils, ${ts('p.updated_at')} AS since
            FROM payments p
           WHERE p.status = 'processing' AND p.updated_at < now() - interval '2 hours' AND p.created_at > now() - interval '7 days'
          UNION ALL
          SELECT 'order_needs_review', o.id, NULL, o.total_fils, ${ts('o.updated_at')}
            FROM orders o
           WHERE o.status = 'needs_review' AND o.updated_at > now() - interval '30 days'
          UNION ALL
          SELECT 'payment_event_error', pe.order_id, pe.provider, pe.amount_fils, ${ts('pe.created_at')}
            FROM payment_events pe
           WHERE pe.new_status = 'error' AND pe.created_at > now() - interval '24 hours'`,
    recommendation: 'Check each with the provider: confirm the booking if paid, otherwise mark it failed so stock is released.',
    recommendationAr: 'شيكي كل وحدة مع المزوّد: إذا مدفوعة أكّدي الحجز، وإذا لا علّميها فاشلة عشان المخزون يتحرر.',
  },
  {
    key: 'system.refunds_failed_or_owed',
    area: 'system',
    severity: 'critical',
    title: 'Refund failed, or a refund owed on a cancellation for over 48h',
    titleAr: 'استرداد فشل أو استرداد مستحق على إلغاء من أكثر من ٤٨ ساعة',
    sql: `SELECT c.order_id, c.event_id, c.refund_status, c.refund_amount_fils, ${ts('c.created_at')} AS cancelled
            FROM cancellations c
           WHERE c.refund_amount_fils > 0
             AND (c.refund_status = 'failed'
                  OR (c.refund_status IN ('pending','processing') AND c.created_at < now() - interval '48 hours'))
             AND NOT EXISTS (SELECT 1 FROM refunds f WHERE f.order_id = c.order_id)
             AND c.created_at > now() - interval '120 days'
           ORDER BY c.created_at`,
    recommendation: 'The customer is owed money. Retry the refund from the order, or refund by hand and record it.',
    recommendationAr: 'العميل له فلوس عندنا. أعيدي محاولة الاسترداد من الطلب، أو رجّعيها يدوي وسجليها.',
  },
];

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

const PII_KEY = /phone|email|mobile|whatsapp|passport|emirates_id/i;

/** Strip anything that could be contact data and make values JSON-friendly. */
function sanitizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === '__n' || PII_KEY.test(k)) continue;
    if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === 'string') {
      // A value that looks like an email or a phone number is masked, whatever its column.
      out[k] = /[^\s@]+@[^\s@]+\.[^\s@]+/.test(v) || /(?:\+|\b00|\b0)?9715\d{8}\b|\b05\d{8}\b/.test(v.replace(/[\s-]/g, ''))
        ? '[hidden]' : v.slice(0, 200);
    } else out[k] = v;
  }
  return out;
}

async function runOneCheck(c: AuditCheck, timeoutMs: number): Promise<AuditResult> {
  const t0 = Date.now();
  const base = {
    key: c.key, area: c.area, title: c.title, titleAr: c.titleAr, severity: c.severity,
    recommendation: c.recommendation, recommendationAr: c.recommendationAr,
  };
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '${Math.max(1000, Math.round(timeoutMs))}ms'`);
    await client.query(`SET LOCAL TIME ZONE 'Asia/Dubai'`);
    const { rows } = await client.query(
      `SELECT count(*) OVER () AS __n, q.* FROM (${c.sql}) q LIMIT 10`,
    );
    await client.query('COMMIT');
    const count = rows.length ? Number(rows[0].__n) : 0;
    return { ...base, count, sample: rows.map(sanitizeRow), ms: Date.now() - t0 };
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return { ...base, count: 0, sample: [], error: (err as Error).message.slice(0, 300), ms: Date.now() - t0 };
  } finally {
    client?.release();
  }
}

async function computeTotals(): Promise<AuditTotals> {
  const empty: AuditTotals = {
    today: '', yesterday: '', revenueYesterdayFils: 0, revenueMtdFils: 0, bookingsYesterday: 0, bookingsMtd: 0,
    capturedYesterdayFils: 0, capturedMtdFils: 0, refundsYesterdayFils: 0, refundsMtdFils: 0,
    expensesYesterdayFils: 0, expensesMtdFils: 0, newEventsYesterday: 0,
  };
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '20s'`);
    const { rows } = await client.query(
      `WITH d AS (SELECT ${TODAY} AS t, ${TODAY} - 1 AS y, date_trunc('month', ${TODAY})::date AS m),
            pay AS (
              SELECT (COALESCE(fs.at, p.updated_at) AT TIME ZONE 'Asia/Dubai')::date AS day, p.amount_fils
                FROM payments p JOIN orders o ON o.id = p.order_id
                LEFT JOIN LATERAL (SELECT min(pe.created_at) AS at FROM payment_events pe
                                    WHERE pe.payment_id = p.id AND pe.new_status IN ('paid','captured')) fs ON true
               WHERE p.status IN ${PAY_OK} AND o.kind <> 'tip' AND p.created_at > now() - interval '40 days')
       SELECT to_char(d.t,'YYYY-MM-DD') AS today, to_char(d.y,'YYYY-MM-DD') AS yesterday,
              (SELECT COALESCE(sum(amount_fils),0)::bigint FROM receipt_money_by_day WHERE money_day = d.y) AS rev_y,
              (SELECT COALESCE(sum(amount_fils),0)::bigint FROM receipt_money_by_day WHERE money_day BETWEEN d.m AND d.t) AS rev_m,
              (SELECT count(*)::int FROM receipt_money_by_day WHERE slice = 'base' AND money_day = d.y) AS bk_y,
              (SELECT count(*)::int FROM receipt_money_by_day WHERE slice = 'base' AND money_day BETWEEN d.m AND d.t) AS bk_m,
              (SELECT COALESCE(sum(amount_fils),0)::bigint FROM pay WHERE day = d.y) AS cap_y,
              (SELECT COALESCE(sum(amount_fils),0)::bigint FROM pay WHERE day BETWEEN d.m AND d.t) AS cap_m,
              (SELECT COALESCE(sum(amount_fils),0)::bigint FROM refunds WHERE (created_at AT TIME ZONE 'Asia/Dubai')::date = d.y) AS rf_y,
              (SELECT COALESCE(sum(amount_fils),0)::bigint FROM refunds WHERE (created_at AT TIME ZONE 'Asia/Dubai')::date BETWEEN d.m AND d.t) AS rf_m,
              (SELECT COALESCE(sum(amount_fils),0)::bigint FROM expenses WHERE source <> 'quickbooks' AND spent_on = d.y) AS ex_y,
              (SELECT COALESCE(sum(amount_fils),0)::bigint FROM expenses WHERE source <> 'quickbooks' AND spent_on BETWEEN d.m AND d.t) AS ex_m,
              (SELECT count(*)::int FROM events WHERE source IS DISTINCT FROM 'quickbooks_import'
                  AND (created_at AT TIME ZONE 'Asia/Dubai')::date = d.y) AS ev_y
         FROM d`,
    );
    await client.query('COMMIT');
    const r = rows[0];
    return {
      today: r.today, yesterday: r.yesterday,
      revenueYesterdayFils: Number(r.rev_y), revenueMtdFils: Number(r.rev_m),
      bookingsYesterday: Number(r.bk_y), bookingsMtd: Number(r.bk_m),
      capturedYesterdayFils: Number(r.cap_y), capturedMtdFils: Number(r.cap_m),
      refundsYesterdayFils: Number(r.rf_y), refundsMtdFils: Number(r.rf_m),
      expensesYesterdayFils: Number(r.ex_y), expensesMtdFils: Number(r.ex_m),
      newEventsYesterday: Number(r.ev_y),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return { ...empty, error: (err as Error).message.slice(0, 300) };
  } finally {
    client.release();
  }
}

/**
 * Run every check independently (each in its own read-only transaction with a
 * statement timeout) plus the context totals. Never throws for a single failing
 * check — that check comes back with `error` set.
 */
/**
 * Bookkeeping before the checks: a Tabby/Tamara payment marked paid but with no
 * captured amount on record is asked about at the provider (read), and the amount
 * the provider says it collected is written to payments.captured_fils. Changes no
 * status and moves no money. Best-effort, at most 20 rows.
 */
export async function syncBnplCaptured(): Promise<number> {
  let fixed = 0;
  try {
    const { rows } = await pool.query<{ id: string; provider: string; ppid: string }>(
      `SELECT id, provider, provider_payment_id AS ppid FROM payments
        WHERE provider IN ('tabby','tamara') AND status = 'paid' AND COALESCE(captured_fils,0) = 0
          AND provider_payment_id IS NOT NULL AND updated_at < now() - interval '1 hour'
        ORDER BY updated_at DESC LIMIT 20`);
    if (!rows.length) return 0;
    const { getProvider } = await import('../payments/index.js');
    for (const r of rows) {
      try {
        const remote = await getProvider(r.provider).retrievePayment(r.ppid);
        const cap = Number(remote.capturedFils) || 0;
        if (cap > 0) {
          await pool.query(`UPDATE payments SET captured_fils = $2, updated_at = now() WHERE id = $1 AND COALESCE(captured_fils,0) = 0`, [r.id, cap]);
          fixed++;
        }
      } catch (e) { console.error(`[daily-audit] capture sync ${r.provider} ${r.id}:`, (e as Error).message); }
    }
  } catch (e) { console.error('[daily-audit] capture sync failed:', (e as Error).message); }
  if (fixed) console.log(`[daily-audit] capture sync: recorded the provider's captured amount on ${fixed} payment(s)`);
  return fixed;
}

export async function runDailyAudit(opts: { timeoutMs?: number; checks?: AuditCheck[] } = {}): Promise<AuditRun> {
  if (!opts.checks) await syncBnplCaptured();
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const checks = opts.checks ?? AUDIT_CHECKS;
  const ranAt = new Date(Date.now());
  const results: AuditResult[] = [];
  // Sequential on purpose: at most one pool connection, never starves live traffic.
  for (const c of checks) results.push(await runOneCheck(c, timeoutMs));
  let totals: AuditTotals | null = null;
  try { totals = await computeTotals(); } catch (err) { console.error('[daily-audit] totals failed:', (err as Error).message); }
  const flagged = results.filter((r) => r.count > 0 && r.severity !== 'info');
  return {
    ranAt: ranAt.toISOString(),
    runDay: new Date(ranAt.getTime() + 4 * 3_600_000).toISOString().slice(0, 10),
    issues: flagged.length,
    critical: flagged.filter((r) => r.severity === 'critical').length,
    errors: results.filter((r) => r.error).length,
    results,
    totals,
  };
}

/* ------------------------------------------------------------------ */
/* Optional AI summary                                                 */
/* ------------------------------------------------------------------ */

/** Compact, personal-data-free view of the run for the AI layer. */
function compactForAi(run: AuditRun) {
  return {
    day: run.runDay,
    issues: run.issues,
    critical: run.critical,
    findings: run.results
      .filter((r) => r.count > 0 || r.error)
      .map((r) => ({
        check: r.key, area: r.area, severity: r.severity, title: r.title, count: r.count,
        couldNotRun: r.error ? true : undefined,
        // Ids/amounts/dates only — any name-like column is dropped.
        examples: r.sample.slice(0, 3).map((s) =>
          Object.fromEntries(Object.entries(s).filter(([k]) => !/name|customer|vendor|title|note/i.test(k)))),
        defaultAdvice: r.recommendation,
      })),
    totals: run.totals,
  };
}

export async function aiAuditSummary(run: AuditRun): Promise<string | null> {
  try {
    const { anthropicEnabled, generateText } = await import('../integrations/anthropic.js');
    if (!anthropicEnabled()) return null;
    const text = await generateText({
      system:
        'You are the operations & finance auditor for Eventana, a kids-party and events company in Dubai. ' +
        'You receive the JSON results of an automated daily system audit (amounts are in fils: 100 fils = 1 AED). ' +
        'Write for the OWNER, in friendly, clear Gulf (Emirati) Arabic. Output plain text only (no markdown headings, no tables): ' +
        'first a 2–4 sentence executive summary (overall health, the biggest risk, the money at stake), ' +
        'then "التوصيات:" followed by at most 7 numbered, prioritised, concrete actions (critical money issues first). ' +
        'Do not invent problems that are not in the data; if everything is clear, say so briefly.',
      prompt: JSON.stringify(compactForAi(run)),
      maxTokens: 1200,
    });
    return text && text.trim() ? text.trim().slice(0, 6000) : null;
  } catch (err) {
    console.error('[daily-audit] AI summary failed:', (err as Error).message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

export function deterministicSummary(run: AuditRun): string {
  if (!run.issues && !run.errors) return '✅ كل الفحوصات سليمة اليوم.';
  const top = run.results
    .filter((r) => r.count > 0 && r.severity !== 'info')
    .sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === 'critical' ? -1 : 1))
    .slice(0, 5)
    .map((r, i) => `${i + 1}. ${r.titleAr} (${r.count}) — ${r.recommendationAr}`);
  return [`⚠️ ${run.issues} ملاحظة، منها ${run.critical} حرجة${run.errors ? `، و${run.errors} فحص ما اشتغل` : ''}.`, ...top].join('\n');
}

export async function storeAuditRun(run: AuditRun, summary?: string | null): Promise<number | null> {
  try {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO daily_audit_runs (ran_at, run_day, issues, critical, results, summary)
       VALUES ($1, $2::date, $3, $4, $5::jsonb, $6) RETURNING id`,
      [run.ranAt, run.runDay, run.issues, run.critical,
        JSON.stringify({ results: run.results, totals: run.totals, errors: run.errors }),
        summary ?? deterministicSummary(run)],
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.error('[daily-audit] store failed:', (err as Error).message);
    return null;
  }
}

export async function latestAuditRun(): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query(
    `SELECT id, ran_at, to_char(run_day,'YYYY-MM-DD') AS run_day, issues, critical, results, summary
       FROM daily_audit_runs ORDER BY ran_at DESC, id DESC LIMIT 1`,
  );
  return rows[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Email + push                                                        */
/* ------------------------------------------------------------------ */

const OWNER_EMAIL = 'sheem@eventanauae.com';
const AREA_AR: Record<AuditArea, string> = {
  money: '💰 المال والمبيعات',
  bookings: '📒 الحجوزات والإيصالات',
  events: '🎉 الفعاليات',
  inventory: '📦 المخزون',
  staff: '👥 الفريق والتحضير',
  notifications: '✉️ رسائل العملاء',
  expenses: '🧾 المصاريف',
  bank: '🏦 البنك',
  system: '🩺 صحة النظام',
};
const AREA_ORDER: AuditArea[] = ['money', 'bookings', 'events', 'inventory', 'staff', 'notifications', 'expenses', 'bank', 'system'];
const SEV_AR: Record<AuditSeverity, { label: string; color: string; bg: string }> = {
  critical: { label: 'حرج', color: '#B42318', bg: '#FDECEC' },
  warning: { label: 'تنبيه', color: '#B54708', bg: '#FFF4E5' },
  info: { label: 'معلومة', color: '#475467', bg: '#F2F4F7' },
};

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const aed = (f: number) => `${formatAed(Math.round(f))} د.إ`;

function exampleLine(row: Record<string, unknown>): string {
  return Object.entries(row)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .slice(0, 7)
    .map(([k, v]) => {
      const val = /_fils$/.test(k) && typeof v === 'number' ? `${formatAed(v)} AED` : String(v);
      return `<b>${esc(k.replace(/_fils$/, ''))}</b>: ${esc(val)}`;
    })
    .join(' · ');
}

export function buildAuditEmailHtml(run: AuditRun, aiSummary: string | null): string {
  const ok = !run.issues && !run.errors;
  const headline = ok
    ? '✅ كل شي سليم — ما في ملاحظات اليوم'
    : `⚠️ ${run.issues} ملاحظة، منها ${run.critical} حرجة${run.errors ? ` · ${run.errors} فحص ما اشتغل` : ''}`;
  const t = run.totals;
  const totalsHtml = t && !t.error ? `
    <table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px;margin:6px 0 4px">
      <tr style="background:#FCEEF6"><th style="text-align:right;padding:6px 8px"></th><th style="text-align:right;padding:6px 8px">أمس (${esc(t.yesterday)})</th><th style="text-align:right;padding:6px 8px">من بداية الشهر</th></tr>
      <tr><td style="padding:6px 8px">الإيراد (حسب يوم الحجز)</td><td style="padding:6px 8px">${aed(t.revenueYesterdayFils)}</td><td style="padding:6px 8px">${aed(t.revenueMtdFils)}</td></tr>
      <tr><td style="padding:6px 8px">المدفوعات اللي وصلت</td><td style="padding:6px 8px">${aed(t.capturedYesterdayFils)}</td><td style="padding:6px 8px">${aed(t.capturedMtdFils)}</td></tr>
      <tr><td style="padding:6px 8px">الاستردادات</td><td style="padding:6px 8px">${aed(t.refundsYesterdayFils)}</td><td style="padding:6px 8px">${aed(t.refundsMtdFils)}</td></tr>
      <tr><td style="padding:6px 8px">عدد الحجوزات/المبيعات</td><td style="padding:6px 8px">${t.bookingsYesterday}</td><td style="padding:6px 8px">${t.bookingsMtd}</td></tr>
      <tr><td style="padding:6px 8px">المصاريف</td><td style="padding:6px 8px">${aed(t.expensesYesterdayFils)}</td><td style="padding:6px 8px">${aed(t.expensesMtdFils)}</td></tr>
      <tr><td style="padding:6px 8px">فعاليات جديدة</td><td style="padding:6px 8px">${t.newEventsYesterday}</td><td style="padding:6px 8px">—</td></tr>
    </table>
    <p style="margin:2px 0 0;color:#9B8A94;font-size:11px">الإيراد = حسب يوم دخول الفلوس للنظام (receipt_money_by_day)؛ المدفوعات = دفعات المزوّدين الناجحة؛ الفرق الطبيعي يجي من الكاش/التحويل والتعديلات.</p>`
    : `<p style="color:#B42318">ما قدرنا نحسب الأرقام: ${esc(t?.error ?? 'unknown')}</p>`;

  const sections = AREA_ORDER.map((area) => {
    const items = run.results.filter((r) => r.area === area && (r.count > 0 || r.error));
    const checked = run.results.filter((r) => r.area === area).length;
    if (!checked) return '';
    const body = items.length
      ? items.map((r) => {
          const sev = SEV_AR[r.severity];
          if (r.error) {
            return `<div style="border:1px solid #EAECF0;border-radius:10px;padding:10px 12px;margin:8px 0;background:#F9FAFB">
              <div style="font-weight:700">⛔ ${esc(r.titleAr)} — الفحص ما اشتغل</div>
              <div style="color:#667085;font-size:12px;direction:ltr;text-align:left">${esc(r.key)}: ${esc(r.error)}</div></div>`;
          }
          const ex = r.sample.slice(0, 5).map((s) => `<li style="margin:2px 0;direction:ltr;text-align:left">${exampleLine(s)}</li>`).join('');
          return `<div style="border:1px solid ${sev.bg};border-radius:10px;padding:10px 12px;margin:8px 0;background:${sev.bg}">
            <div><span style="color:${sev.color};font-weight:700">● ${sev.label}</span> &nbsp;<b>${esc(r.titleAr)}</b> — <b>${r.count}</b></div>
            <ul style="margin:6px 0;padding-inline-start:18px;font-size:12px;color:#344054">${ex}</ul>
            ${r.count > 5 ? `<div style="font-size:11px;color:#667085">… و${r.count - 5} غيرها</div>` : ''}
            <div style="font-size:13px;margin-top:4px">💡 ${esc(r.recommendationAr)}</div></div>`;
        }).join('')
      : `<div style="color:#027A48;font-size:13px">✅ ${checked} فحص — كله سليم</div>`;
    return `<h3 style="margin:18px 0 6px;font-size:16px">${AREA_AR[area]}</h3>${body}`;
  }).join('');

  const ai = aiSummary
    ? `<div style="background:#F5F0FF;border-radius:12px;padding:12px 14px;margin:12px 0;white-space:pre-wrap;font-size:14px;line-height:1.7"><b>🤖 الملخص والتوصيات</b>\n${esc(aiSummary)}</div>`
    : `<div style="background:#F5F0FF;border-radius:12px;padding:12px 14px;margin:12px 0;white-space:pre-wrap;font-size:14px;line-height:1.7"><b>📋 الملخص</b>\n${esc(deterministicSummary(run))}</div>`;

  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"></head>
  <body style="margin:0;background:#FBEAF2">
  <div dir="rtl" style="max-width:680px;margin:0 auto;padding:18px;font-family:Tahoma,Arial,sans-serif;color:#4A3540;text-align:right">
    <div style="background:#fff;border-radius:16px;padding:18px 20px">
      <div style="font-size:12px;color:#9B8A94">إيفنتانا — الفحص اليومي للنظام · ${esc(run.runDay)}</div>
      <h2 style="margin:6px 0 4px;font-size:20px">${headline}</h2>
      <div style="font-size:12px;color:#9B8A94">${run.results.length} فحص مستقل من زوايا مختلفة (المال، الحجوزات، الفعاليات، المخزون، الفريق، الرسائل، المصاريف، البنك، صحة النظام)</div>
      ${ai}
      <h3 style="margin:16px 0 4px;font-size:16px">📊 أرقام للسياق</h3>
      ${totalsHtml}
      ${sections}
      <p style="margin:18px 0 0;font-size:11px;color:#9B8A94">تقرير تلقائي للمالكة فقط — بدون أرقام تلفونات أو إيميلات. آخر نتيجة متوفرة في النظام: /api/admin/audit/latest</p>
    </div>
  </div></body></html>`;
}

export async function sendAuditReport(run: AuditRun, aiSummary: string | null): Promise<{ emailed: boolean; pushed: number }> {
  let emailed = false;
  let pushed = 0;
  try {
    const { emailEnabled, sendEmail } = await import('../integrations/email.js');
    if (emailEnabled()) {
      const subject = !run.issues && !run.errors
        ? `Eventana — الفحص اليومي ${run.runDay}: ✅ كل شي سليم`
        : `Eventana — الفحص اليومي ${run.runDay}: ⚠️ ${run.issues} ملاحظة (${run.critical} حرجة)`;
      const res = await sendEmail({ to: OWNER_EMAIL, subject, html: buildAuditEmailHtml(run, aiSummary), skipMonitorBcc: true });
      emailed = res.ok;
      if (!res.ok) console.error('[daily-audit] email failed:', res.error);
    }
  } catch (err) {
    console.error('[daily-audit] email failed:', (err as Error).message);
  }
  try {
    const { pushToOwner } = await import('../integrations/push.js');
    const owners = await pool.query<{ id: string }>(`SELECT id FROM team_members WHERE active AND access_level = 'owner'`);
    const title = !run.issues && !run.errors ? '✅ الفحص اليومي: كل شي سليم' : `⚠️ الفحص اليومي: ${run.issues} ملاحظة (${run.critical} حرجة)`;
    const top = run.results.filter((r) => r.count > 0 && r.severity === 'critical').slice(0, 3).map((r) => `${r.titleAr} (${r.count})`).join(' · ');
    const body = top || (run.issues ? 'التفاصيل في الإيميل.' : 'ما في شي يحتاج تدخل اليوم.');
    for (const o of owners.rows) {
      await pushToOwner('staff', o.id, title, body, { kind: 'daily_audit' }).catch(() => {});
      pushed++;
    }
  } catch (err) {
    console.error('[daily-audit] push failed:', (err as Error).message);
  }
  return { emailed, pushed };
}

/* ------------------------------------------------------------------ */
/* Scheduling                                                          */
/* ------------------------------------------------------------------ */

let auditRunning = false;

/**
 * Called from the periodic reconcile sweep. Once per Dubai day, at or after
 * 10:00 Dubai: claim `daily_audit:<YYYY-MM-DD>` in app_kv FIRST (atomic insert),
 * so several instances / sweeps can never run or send it twice; then run,
 * store, email the owner and push her a one-liner.
 */
export async function sweepDailyAudit(): Promise<void> {
  if (auditRunning) return;
  const dubai = new Date(Date.now() + 4 * 3_600_000);
  if (dubai.getUTCHours() < 10) return;
  const dayKey = `daily_audit:${dubai.toISOString().slice(0, 10)}`;
  auditRunning = true;
  try {
    const claim = await pool.query(
      `INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING RETURNING k`, [dayKey],
    );
    if (!claim.rowCount) return;
    const run = await runDailyAudit();
    const ai = await aiAuditSummary(run);
    run.aiSummary = ai;
    await storeAuditRun(run, ai);
    const sent = await sendAuditReport(run, ai);
    console.log(`[daily-audit] ${run.runDay} issues=${run.issues} critical=${run.critical} errors=${run.errors} emailed=${sent.emailed} pushed=${sent.pushed}`);
  } catch (err) {
    console.error('[daily-audit] sweep failed:', (err as Error).message);
  } finally {
    auditRunning = false;
  }
}

/** Log the run line by line (used by the on-demand one-shot). */
export function logAuditRun(run: AuditRun): void {
  for (const r of run.results) {
    const sample = JSON.stringify(r.sample.slice(0, 3)).slice(0, 1500);
    if (r.error) console.log(`[daily-audit] ${r.severity} ${r.key} count=ERROR error=${JSON.stringify(r.error)}`);
    else console.log(`[daily-audit] ${r.severity} ${r.key} count=${r.count} sample=${sample}`);
  }
  if (run.totals) console.log(`[daily-audit] totals=${JSON.stringify(run.totals)}`);
  console.log(`[daily-audit] done issues=${run.issues} critical=${run.critical} errors=${run.errors} checks=${run.results.length}`);
}

/**
 * On-demand run (env RUN_DAILY_AUDIT=<any value>): once per value (claimOneShot),
 * run + store + LOG every result. Deliberately no email and no push.
 */
export async function runDailyAuditOneShot(value: string): Promise<void> {
  const { claimOneShot } = await import('../db/pool.js');
  if (!(await claimOneShot(`oneshot:RUN_DAILY_AUDIT:${value}`))) return;
  console.log(`[daily-audit] on-demand run (${AUDIT_CHECKS.length} checks)…`);
  const run = await runDailyAudit();
  await storeAuditRun(run, null);
  logAuditRun(run);
}
