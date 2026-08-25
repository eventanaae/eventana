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
              c.name AS customer_name, c.email AS customer_email
         FROM notifications n
         JOIN events e ON e.id = n.event_id
         JOIN customers c ON c.id = e.customer_id
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
