/**
 * Reconciliation audit (owner-only, read-only).
 *
 * Fixed diagnostic queries that answer the owner's audit questions without any
 * free-form SQL: what the "outstanding" money really is, payment-method
 * coverage, phone-number formatting problems, duplicate customers, and the
 * state of expenses + refunds. Every query is read-only and parameter-free.
 */
import { pool } from '../db/pool.js';
import { formatAed } from '@eventana/shared';

const digits = (col: string) => `regexp_replace(COALESCE(${col},''), '[^0-9]', '', 'g')`;

/** Mask a phone for display in the report: keep the prefix + last 3 digits. */
function maskPhone(p: string | null): string {
  const s = String(p ?? '').trim();
  if (!s) return '(empty)';
  if (s.length <= 4) return s;
  return s.slice(0, Math.min(4, s.length - 3)) + '•••' + s.slice(-3);
}

export async function auditReport(section: string): Promise<any> {
  switch (section) {
    // The real make-up of the CEO "outstanding / expected in" figure: live
    // orders that were never paid (mostly abandoned checkouts).
    case 'outstanding': {
      const { rows } = await pool.query(
        `SELECT o.id, o.kind, COALESCE(o.source,'app') AS source, o.status,
                o.total_fils, to_char(o.created_at,'YYYY-MM-DD') AS created,
                (now()::date - o.created_at::date) AS age_days,
                c.name AS customer, c.phone,
                (o.event_id IS NOT NULL) AS has_event
           FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
          WHERE o.status IN ('awaiting_payment','processing','needs_review')
          ORDER BY o.total_fils DESC`,
      );
      const total = rows.reduce((s, r) => s + Number(r.total_fils), 0);
      const byStatus: Record<string, { n: number; fils: number }> = {};
      const bySource: Record<string, { n: number; fils: number }> = {};
      for (const r of rows) {
        (byStatus[r.status] ??= { n: 0, fils: 0 }); byStatus[r.status].n++; byStatus[r.status].fils += Number(r.total_fils);
        (bySource[r.source] ??= { n: 0, fils: 0 }); bySource[r.source].n++; bySource[r.source].fils += Number(r.total_fils);
      }
      return {
        section, count: rows.length, totalFils: total, totalDisplay: formatAed(total),
        byStatus, bySource,
        note: 'These are live orders that were never paid — NOT invoices and NOT QuickBooks. Old app rows are almost always abandoned checkouts; manual pay-links may be genuinely awaiting payment.',
        rows: rows.map((r) => ({ ...r, phone: maskPhone(r.phone), totalDisplay: formatAed(Number(r.total_fils)) })),
      };
    }

    // Payment-method coverage across every money surface.
    case 'payment_methods': {
      const [receiptsByPaid, paymentsByProvider, paidOrders] = await Promise.all([
        pool.query(`SELECT COALESCE(paid_with,'(null)') AS method, source, COUNT(*) n, SUM(total_fils) fils
                      FROM finance_receipts GROUP BY 1,2 ORDER BY n DESC`),
        pool.query(`SELECT provider, status, COUNT(*) n, SUM(amount_fils) fils
                      FROM payments GROUP BY 1,2 ORDER BY n DESC`),
        pool.query(`SELECT COALESCE(o.source,'app') AS source, COUNT(*) n
                      FROM orders o WHERE o.status='paid' GROUP BY 1`),
      ]);
      return {
        section,
        receiptsByMethod: receiptsByPaid.rows.map((r) => ({ ...r, display: formatAed(Number(r.fils)) })),
        paymentsByProvider: paymentsByProvider.rows.map((r) => ({ ...r, display: formatAed(Number(r.fils)) })),
        paidOrdersBySource: paidOrders.rows,
        note: 'QuickBooks-imported receipts default paid_with=Cash — those are really Unknown/Needs Review, not confirmed cash.',
      };
    }

    // Phone-number formatting audit across the live book and the QuickBooks book.
    case 'phones': {
      const classify = (table: string, col: string, extra = '') => `
        SELECT '${table}' AS book,
          COUNT(*) FILTER (WHERE COALESCE(${col},'')='') AS empty,
          COUNT(*) FILTER (WHERE ${col} ~ '^\\+9715[0-9]{8}$') AS valid_e164,
          COUNT(*) FILTER (WHERE ${digits(col)} ~ '^05[0-9]{8}$' AND ${col} !~ '^\\+9715[0-9]{8}$') AS fixable_local,
          COUNT(*) FILTER (WHERE ${digits(col)} ~ '^9710' OR ${col} ~ '^\\+9710') AS double_prefix,
          COUNT(*) FILTER (WHERE ${digits(col)} ~ '^9714') AS landline,
          COUNT(*) FILTER (WHERE COALESCE(${col},'')<>''
             AND ${col} !~ '^\\+9715[0-9]{8}$'
             AND NOT (${digits(col)} ~ '^05[0-9]{8}$')
             AND NOT (${digits(col)} ~ '^9710' OR ${col} ~ '^\\+9710')
             AND NOT (${digits(col)} ~ '^9714')) AS other_review
          FROM ${table} ${extra}`;
      const [live, hist, histAlt, badSamples] = await Promise.all([
        pool.query(classify('customers', 'phone')),
        pool.query(classify('historical_customers', 'phone')),
        pool.query(classify('historical_customers', 'phone_alt', "WHERE COALESCE(phone_alt,'')<>''")),
        pool.query(
          `SELECT full_name AS name, phone FROM historical_customers
            WHERE COALESCE(phone,'')<>'' AND phone !~ '^\\+9715[0-9]{8}$'
              AND NOT (${digits('phone')} ~ '^05[0-9]{8}$')
            LIMIT 25`),
      ]);
      return {
        section,
        liveCustomers: live.rows[0],
        historicalCustomers: hist.rows[0],
        historicalAlt: histAlt.rows[0],
        unclassifiedSamples: badSamples.rows.map((r) => ({ name: r.name, phone: maskPhone(r.phone) })),
        note: 'valid_e164 = already correct. fixable_local (05XXXXXXXX) can be safely normalised to +9715XXXXXXXX. double_prefix (+971050…) is the reported bug. other_review must NOT be auto-changed.',
      };
    }

    // Likely duplicate customers by the last 9 digits of the phone number.
    case 'dup_customers': {
      const { rows } = await pool.query(
        `WITH allc AS (
           SELECT 'live' AS book, id::text AS id, name, phone FROM customers
           UNION ALL
           SELECT 'qb' AS book, id::text, full_name, phone FROM historical_customers
         ), keyed AS (
           SELECT *, right(${digits('phone')}, 9) AS k FROM allc
            WHERE length(${digits('phone')}) >= 9
         )
         SELECT k, COUNT(*) n, array_agg(book || ':' || name) AS who
           FROM keyed GROUP BY k HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 60`,
      );
      return {
        section, groups: rows.length,
        rows: rows.map((r) => ({ tail: '•••' + String(r.k).slice(-3), n: r.n, who: r.who })),
        note: 'Same last-9-digits = likely same person across format variants or live/QB books. Review before any merge — do NOT auto-merge.',
      };
    }

    // Expenses completeness + shape.
    case 'expenses': {
      const [tot, byCat, byYear, missing] = await Promise.all([
        pool.query(`SELECT COUNT(*) n, COALESCE(SUM(amount_fils),0) fils FROM expenses`),
        pool.query(`SELECT category, COUNT(*) n, SUM(amount_fils) fils FROM expenses GROUP BY 1 ORDER BY fils DESC`),
        pool.query(`SELECT to_char(spent_on,'YYYY') y, COUNT(*) n, SUM(amount_fils) fils FROM expenses GROUP BY 1 ORDER BY 1`),
        pool.query(`SELECT
             COUNT(*) FILTER (WHERE COALESCE(vendor,'')='') no_vendor,
             COUNT(*) FILTER (WHERE COALESCE(payment_method,'')='') no_method,
             COUNT(*) FILTER (WHERE COALESCE(category,'')='' OR category='general') no_category,
             COUNT(*) FILTER (WHERE COALESCE(ref_no,'')='') no_ref
           FROM expenses`),
      ]);
      return {
        section,
        total: { n: Number(tot.rows[0].n), fils: Number(tot.rows[0].fils), display: formatAed(Number(tot.rows[0].fils)) },
        byCategory: byCat.rows.map((r) => ({ ...r, display: formatAed(Number(r.fils)) })),
        byYear: byYear.rows.map((r) => ({ ...r, display: formatAed(Number(r.fils)) })),
        missing: missing.rows[0],
        note: 'expenses table holds live-entered expenses only. QuickBooks annual expense totals live in historical_financials (P&L), not itemised here.',
      };
    }

    // Refund + cancellation state.
    case 'refunds': {
      const [cancels, refundEvents] = await Promise.all([
        pool.query(
          `SELECT c.order_id, c.event_id, c.cancelled_by, c.reason, c.refund_amount_fils,
                  c.refund_percent, c.refund_status, c.refund_reference,
                  to_char(c.created_at,'YYYY-MM-DD') AS created,
                  e.phase, (e.cancelled_at IS NOT NULL) AS event_cancelled
             FROM cancellations c LEFT JOIN events e ON e.id = c.event_id
            ORDER BY c.created_at DESC`),
        pool.query(
          `SELECT order_id, new_status, source, amount_fils, note, to_char(created_at,'YYYY-MM-DD') AS created
             FROM payment_events WHERE new_status IN ('refunded','partially_refunded') ORDER BY created_at DESC`),
      ]);
      return {
        section,
        cancellations: cancels.rows.map((r) => ({ ...r, refundDisplay: formatAed(Number(r.refund_amount_fils)) })),
        refundPaymentEvents: refundEvents.rows.map((r) => ({ ...r, display: formatAed(Number(r.amount_fils ?? 0)) })),
        note: 'cancellations.reason is currently a free-text/percentage note; the structured refund-reason category is being added.',
      };
    }

    default: {
      const [orders, customers, hist, receipts, expenses, cancels] = await Promise.all([
        pool.query(`SELECT status, COUNT(*) n FROM orders GROUP BY 1 ORDER BY n DESC`),
        pool.query(`SELECT COUNT(*) n, COUNT(*) FILTER (WHERE COALESCE(email,'')<>'') with_email, COUNT(*) FILTER (WHERE COALESCE(backup_phone,'')<>'') with_alt FROM customers`),
        pool.query(`SELECT COUNT(*) n FROM historical_customers`),
        pool.query(`SELECT COUNT(*) n FROM finance_receipts`),
        pool.query(`SELECT COUNT(*) n FROM expenses`),
        pool.query(`SELECT COUNT(*) n FROM cancellations`),
      ]);
      return {
        section: 'summary',
        ordersByStatus: orders.rows,
        liveCustomers: customers.rows[0],
        historicalCustomers: Number(hist.rows[0].n),
        receipts: Number(receipts.rows[0].n),
        expenses: Number(expenses.rows[0].n),
        cancellations: Number(cancels.rows[0].n),
        sections: ['summary', 'outstanding', 'payment_methods', 'phones', 'dup_customers', 'expenses', 'refunds'],
      };
    }
  }
}
