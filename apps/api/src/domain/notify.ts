/**
 * Notification delivery.
 *
 * `notifications` is a queue: confirm/webhook/reschedule write rows with a
 * channel, template and (optionally) a future `scheduled_for`. THIS sweep is
 * what actually delivers them — it selects due, unsent, un-cancelled rows,
 * sends each, and stamps `sent_at`. Runs inside the 5-minute reconcile loop.
 *
 * Without this, booking confirmations and reminders were written and never
 * sent. Delivery is best-effort and idempotent: a transient failure leaves
 * `sent_at` NULL so the next sweep retries; a permanent skip (unknown template,
 * no recipient) is stamped so the queue can't back up forever.
 */
import { formatAed } from '@eventana/shared';
import { pool } from '../db/pool.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';
import { pushToStaff } from '../integrations/push.js';

export interface EmailRow {
  id: number;
  template: string;
  event_id: string;
  event_date: string | null;
  start_time: string | null;
  emirate: string | null;
  customer_name: string | null;
  customer_email: string | null;
  // Cancellation / refund fields (present only for a cancelled order).
  order_ref?: string | null;
  total_paid_fils?: number | null;
  refund_percent?: number | null;
  refund_amount_fils?: number | null;
  refund_reference?: string | null;
}

function shell(first: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#faf6f2;font-family:'Segoe UI',Arial,sans-serif;color:#3B3641">
    <div style="max-width:560px;margin:0 auto;padding:24px">
      <div style="text-align:center;padding:14px 0 18px">
        <span style="font-size:22px;font-weight:800;color:#E94F9C;letter-spacing:.5px">Eventana</span>
      </div>
      <div style="background:#fff;border-radius:18px;padding:26px 24px;line-height:1.6;font-size:15px">
        <p style="margin:0 0 14px">Hi ${first} 👋</p>
        ${bodyHtml}
      </div>
      <div style="text-align:center;color:#b3a8a0;font-size:11px;padding:16px 0;line-height:1.6">
        Eventana Events · Abu Dhabi &amp; Dubai, UAE
      </div>
    </div>
  </body></html>`;
}

function fils(n: number | null | undefined): string {
  return formatAed(Number(n ?? 0));
}

/** A small, email-safe label/value table for booking & refund details. */
function detailTable(rows: Array<[string, string]>): string {
  const body = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;color:#8a7f88;font-size:13px">${k}</td>` +
        `<td style="padding:6px 0;text-align:right;font-weight:700;font-size:13px">${v}</td></tr>`,
    )
    .join('');
  return `<table style="width:100%;border-collapse:collapse;border-top:1px solid #efe7ee;margin-top:6px">${body}</table>`;
}

function longDate(dateStr: string | null): string {
  if (!dateStr) return 'your event date';
  try {
    return new Date(`${dateStr}T00:00:00+04:00`).toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function renderEmail(row: EmailRow): { subject: string; html: string } | null {
  const first = (row.customer_name || 'there').split(' ')[0];
  const date = longDate(row.event_date);
  const time = row.start_time ? row.start_time.slice(0, 5) : '';
  const where = row.emirate ? ` in ${row.emirate}` : '';
  switch (row.template) {
    case 'booking_confirmation':
      return {
        subject: 'Your Eventana celebration is confirmed 🎉',
        html: shell(first, `<p style="margin:0 0 14px">Your celebration is booked for <b>${date}</b> at <b>${time}</b>${where}. 🎈</p>
          <p style="margin:0 0 14px">Your event reference is <b>${row.event_id}</b>. Our team is already preparing everything — see you soon!</p>`),
      };
    case 'three_day_reminder':
      return {
        subject: 'Your Eventana party is in 3 days 🎈',
        html: shell(first, `<p style="margin:0 0 14px">Just a reminder — your celebration is on <b>${date}</b> at <b>${time}</b>. We can't wait! 💖</p>`),
      };
    case 'event_day':
      return {
        subject: "It's party day! 🎉",
        html: shell(first, `<p style="margin:0 0 14px">Today's the day! Your Eventana celebration starts at <b>${time}</b>. Our team is on the way. 🚚✨</p>`),
      };
    case 'event_cancelled':
      return {
        subject: 'Your Eventana booking was cancelled',
        html: shell(first, `<p style="margin:0 0 14px">Your booking <b>${row.event_id}</b> for ${date} has been cancelled. If this wasn't expected, please reply to this email or contact us on WhatsApp.</p>`),
      };
    case 'cancellation_refund': {
      const ref = row.order_ref || row.event_id;
      const paid = fils(row.total_paid_fils);
      const pct = Number(row.refund_percent ?? 0);
      const refund = fils(row.refund_amount_fils);
      const today = longDate(new Date().toISOString().slice(0, 10));
      return {
        subject: 'Your Eventana booking has been cancelled',
        html: shell(
          first,
          `<p style="margin:0 0 14px">Your booking has been <b>successfully cancelled</b>. We're sorry to see this celebration go. 💛</p>
           ${detailTable([
             ['Order Number', ref],
             ['Event Date', date],
             ['Cancellation Date', today],
             ['Amount Paid', paid],
             ['Refund Percentage', `${pct}%`],
             ['Expected Refund', refund],
           ])}
           <p style="margin:14px 0 0;color:#8a7f88;font-size:13px">Your refund may take approximately <b>7 business days</b> to appear in your account, depending on your bank or payment provider.</p>`,
        ),
      };
    }
    case 'refund_processed': {
      const ref = row.order_ref || row.event_id;
      const refund = fils(row.refund_amount_fils);
      const rows: Array<[string, string]> = [
        ['Order Number', ref],
        ['Refund Amount', refund],
        ['Refund Status', 'Processed'],
      ];
      if (row.refund_reference) rows.push(['Refund Reference', String(row.refund_reference)]);
      return {
        subject: 'Your Eventana refund has been processed',
        html: shell(
          first,
          `<p style="margin:0 0 14px">Good news — your refund has been <b>processed</b>. 💛</p>
           ${detailTable(rows)}
           <p style="margin:14px 0 0;color:#8a7f88;font-size:13px">Please allow approximately <b>7 business days</b> for the amount to appear in your account, depending on your bank or payment provider.</p>`,
        ),
      };
    }
    default:
      return null;
  }
}

/** Deliver all due notifications. Returns how many of each channel were sent. */
export async function deliverPendingNotifications(): Promise<{ emails: number; pushes: number }> {
  let emails = 0;
  let pushes = 0;

  // ---- Email (customer-facing: confirmation, reminders, cancellation) ----
  if (emailEnabled()) {
    const { rows } = await pool.query<EmailRow>(
      `SELECT n.id, n.template, n.event_id,
              e.event_date, e.start_time, e.emirate,
              c.name AS customer_name, c.email AS customer_email,
              cx.order_id AS order_ref, cx.total_paid_fils, cx.refund_percent,
              cx.refund_amount_fils, cx.refund_reference
         FROM notifications n
         JOIN events e ON e.id = n.event_id
         JOIN customers c ON c.id = e.customer_id
         LEFT JOIN cancellations cx ON cx.event_id = e.id
        WHERE n.channel = 'email' AND n.sent_at IS NULL AND n.cancelled_at IS NULL
          AND (n.scheduled_for IS NULL OR n.scheduled_for <= now())
        ORDER BY n.scheduled_for NULLS FIRST
        LIMIT 100`,
    );
    for (const row of rows) {
      const msg = renderEmail(row);
      if (!msg || !row.customer_email) {
        // Unknown template or no recipient — mark done so the queue can't stall.
        await pool.query(`UPDATE notifications SET sent_at = now() WHERE id = $1`, [row.id]);
        continue;
      }
      const res = await sendEmail({ to: row.customer_email, subject: msg.subject, html: msg.html });
      if (res.ok) {
        await pool.query(`UPDATE notifications SET sent_at = now() WHERE id = $1`, [row.id]);
        emails++;
      }
      // Transient failure: leave sent_at NULL — the next sweep retries.
    }
  }

  // ---- Push (staff: a crew tip arrived) ----
  const { rows: pushRows } = await pool.query<{ id: number; template: string; payload: Record<string, unknown> }>(
    `SELECT id, template, payload FROM notifications
      WHERE channel = 'push' AND sent_at IS NULL AND cancelled_at IS NULL
        AND (scheduled_for IS NULL OR scheduled_for <= now())
      ORDER BY created_at
      LIMIT 100`,
  );
  for (const row of pushRows) {
    try {
      if (row.template === 'tip_received') {
        const amt = Number(row.payload?.amountFils ?? 0);
        await pushToStaff('Tip received 💐', `A tip of ${formatAed(amt)} just arrived — thank you!`, {
          eventId: String(row.payload?.eventId ?? ''),
        });
        pushes++;
      }
      // payment_failed / others carry no deliverable recipient — just clear them
      // (the customer already sees the failure on the return screen).
      await pool.query(`UPDATE notifications SET sent_at = now() WHERE id = $1`, [row.id]);
    } catch {
      // Leave for the next sweep.
    }
  }

  return { emails, pushes };
}
