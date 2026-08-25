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
import { config } from '../config.js';
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

// Brand palette — kept in sync with the customer app.
const BRAND = '#E94F9C';
const DEEP = '#C026A6';
const INK = '#3B3641';
const MUTED = '#9a8f97';
const CREAM = '#FAF6F2';
const PANEL = '#FDF4FA';
const HAIR = '#F4E1EF';

/** Deep link into the customer app's "My Event" tab to follow a booking. */
function trackUrl(eventId: string): string | null {
  const base = (config.publicAppUrl || '').replace(/\/$/, '');
  return base ? `${base}/?event=${encodeURIComponent(eventId)}` : null;
}

/** Bulletproof, centred pill button (solid colour — no gradient, for Outlook). */
function button(href: string, label: string): string {
  return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:24px auto 4px">
      <tr><td style="border-radius:999px;background:${BRAND}">
        <a href="${href}" style="display:inline-block;padding:14px 34px;font-size:15px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:999px">${label}</a>
      </td></tr></table>`;
}

/** A soft, rounded label/value detail card for booking & refund details. */
function detailCard(rows: Array<[string, string]>): string {
  const body = rows
    .map(([k, v], i) => {
      const line = i < rows.length - 1 ? `border-bottom:1px solid ${HAIR}` : '';
      return (
        `<tr><td style="padding:12px 18px;color:${MUTED};font-size:13px;${line}">${k}</td>` +
        `<td style="padding:12px 18px;text-align:right;font-weight:700;font-size:13.5px;color:${INK};${line}">${v}</td></tr>`
      );
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL};border:1px solid ${HAIR};border-radius:16px;margin:8px 0 2px">${body}</table>`;
}

interface Shell {
  first: string;
  emoji: string;
  heading: string;
  bodyHtml: string;
  cta?: { href: string; label: string };
  accent?: string;
}

function shell({ first, emoji, heading, bodyHtml, cta, accent = BRAND }: Shell): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:${CREAM};font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:${INK};-webkit-font-smoothing:antialiased">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${CREAM}">${heading}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}">
      <tr><td align="center" style="padding:28px 16px 42px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
          <tr><td style="text-align:center;padding:4px 0 22px">
            <span style="font-size:25px;font-weight:800;color:${BRAND};letter-spacing:.4px">Eventana</span>
          </td></tr>
          <tr><td style="background:#ffffff;border-radius:22px;overflow:hidden;border:1px solid #F3E7EF">
            <div style="height:6px;background:${accent};background:linear-gradient(90deg,#F9A8D4,${BRAND},${DEEP})"></div>
            <div style="padding:32px 30px 34px">
              <div style="text-align:center;font-size:46px;line-height:1;margin-bottom:8px">${emoji}</div>
              <h1 style="margin:0;text-align:center;font-size:21px;font-weight:800;color:${INK};line-height:1.3">${heading}</h1>
              <p style="margin:20px 0 14px;font-size:15px;line-height:1.6">Hi ${first} 👋</p>
              ${bodyHtml}
              ${cta ? button(cta.href, cta.label) : ''}
            </div>
          </td></tr>
          <tr><td style="text-align:center;color:#b8ada6;font-size:11.5px;padding:22px 12px 0;line-height:1.8">
            Eventana Events · Abu Dhabi &amp; Dubai, UAE<br>
            Questions? Just reply to this email — we're happy to help. 💌
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

function fils(n: number | null | undefined): string {
  return formatAed(Number(n ?? 0));
}

/**
 * Format an events.event_date to a long English date. node-postgres hands DATE
 * columns back as JS Date objects, so `${value}` in a template becomes
 * `"Fri Aug 30 2026 …"` and `new Date(that + "T00:00…")` is Invalid Date —
 * which is exactly what customers saw. Normalise to YYYY-MM-DD first.
 */
function longDate(value: unknown): string {
  if (!value) return 'your event date';
  const iso =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : /^\d{4}-\d{2}-\d{2}/.test(String(value))
        ? String(value).slice(0, 10)
        : '';
  const d = iso ? new Date(`${iso}T00:00:00+04:00`) : new Date(NaN);
  if (Number.isNaN(d.getTime())) return typeof value === 'string' ? value : 'your event date';
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

export function renderEmail(row: EmailRow): { subject: string; html: string } | null {
  const first = (row.customer_name || 'there').split(' ')[0];
  const date = longDate(row.event_date);
  const time = row.start_time ? row.start_time.slice(0, 5) : '';
  const place = row.emirate || 'UAE';
  const track = trackUrl(row.event_id);
  switch (row.template) {
    case 'booking_confirmation':
      return {
        subject: 'Your Eventana celebration is confirmed 🎉',
        html: shell({
          first,
          emoji: '🎉',
          heading: 'Your celebration is confirmed!',
          bodyHtml: `<p style="margin:0 0 4px;font-size:15px;line-height:1.6">Everything's set — here are your booking details. Our team is already getting ready to make it magical. ✨</p>
            ${detailCard([
              ['Date', date],
              ['Time', time || '—'],
              ['Location', place],
              ['Reference', row.event_id],
            ])}`,
          cta: track ? { href: track, label: 'Track your booking →' } : undefined,
        }),
      };
    case 'three_day_reminder':
      return {
        subject: 'Your Eventana party is in 3 days 🎈',
        html: shell({
          first,
          emoji: '🎈',
          heading: 'Your party is in 3 days!',
          bodyHtml: `<p style="margin:0 0 4px;font-size:15px;line-height:1.6">Just a little reminder — the big day is almost here. We can't wait! 💖</p>
            ${detailCard([
              ['Date', date],
              ['Time', time || '—'],
              ['Location', place],
              ['Reference', row.event_id],
            ])}`,
          cta: track ? { href: track, label: 'View your booking →' } : undefined,
        }),
      };
    case 'event_day':
      return {
        subject: "It's party day! 🎉",
        html: shell({
          first,
          emoji: '🥳',
          heading: "It's party day!",
          bodyHtml: `<p style="margin:0 0 4px;font-size:15px;line-height:1.6">Today's the day! Your Eventana celebration starts at <b>${time || 'your booked time'}</b> and our team is on the way. 🚚✨</p>`,
          cta: track ? { href: track, label: 'View your booking →' } : undefined,
        }),
      };
    case 'event_cancelled':
      return {
        subject: 'Your Eventana booking was cancelled',
        html: shell({
          first,
          emoji: '🌸',
          heading: 'Your booking was cancelled',
          bodyHtml: `<p style="margin:0;font-size:15px;line-height:1.6">Your booking <b>${row.event_id}</b> for ${date} has been cancelled. If this wasn't expected, just reply to this email or message us on WhatsApp and we'll sort it out.</p>`,
        }),
      };
    case 'cancellation_refund': {
      const ref = row.order_ref || row.event_id;
      const paid = fils(row.total_paid_fils);
      const pct = Number(row.refund_percent ?? 0);
      const refund = fils(row.refund_amount_fils);
      const today = longDate(new Date().toISOString().slice(0, 10));
      return {
        subject: 'Your Eventana booking has been cancelled',
        html: shell({
          first,
          emoji: '🌸',
          heading: 'Your booking has been cancelled',
          bodyHtml: `<p style="margin:0 0 4px;font-size:15px;line-height:1.6">Your booking has been <b>successfully cancelled</b>. We're sorry to see this celebration go. 💛</p>
           ${detailCard([
             ['Order Number', ref],
             ['Event Date', date],
             ['Cancellation Date', today],
             ['Amount Paid', paid],
             ['Refund Percentage', `${pct}%`],
             ['Expected Refund', refund],
           ])}
           <p style="margin:16px 0 0;color:${MUTED};font-size:13px;line-height:1.6">Your refund may take approximately <b>7 business days</b> to appear, depending on your bank or payment provider.</p>`,
        }),
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
        html: shell({
          first,
          emoji: '💸',
          heading: 'Your refund has been processed',
          bodyHtml: `<p style="margin:0 0 4px;font-size:15px;line-height:1.6">Good news — your refund has been <b>processed</b>. 💛</p>
           ${detailCard(rows)}
           <p style="margin:16px 0 0;color:${MUTED};font-size:13px;line-height:1.6">Please allow approximately <b>7 business days</b> for the amount to appear, depending on your bank or payment provider.</p>`,
        }),
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
