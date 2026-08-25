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
  // Party context — for a warmer, personalised confirmation.
  celebration_type?: string | null;
  custom_theme?: boolean | null;
  package_name?: string | null;
  cart?: { eventFor?: string } | null;
  // Itemised invoice for the confirmation (from the paid order's quote).
  quote?: { lines?: Array<{ label: string; quantity: number; amountFils: number }> } | null;
  total_fils?: number | null;
  // Cancellation / refund fields (present only for a cancelled order).
  order_ref?: string | null;
  total_paid_fils?: number | null;
  refund_percent?: number | null;
  refund_amount_fils?: number | null;
  refund_reference?: string | null;
}

// Brand palette — matched to Eventana's Canva email designs: soft-pink ground,
// white rounded cards, a bright-pink pill CTA, pastel-rainbow accents and a
// playful rounded display face.
const BRAND = '#EF5D95'; // bright brand pink (CTA, links)
const INK = '#4A3540'; // soft plum-dark, not pure black
const MUTED = '#9B8A94';
const GROUND = '#FBEAF2'; // soft pink page background
const PANEL = '#FCEEF6'; // detail-card fill
const HAIR = '#F4DDEC';
// Pastel rainbow used for the card's top strip (mint→lime→yellow→peach→pink→lilac).
const RAINBOW = 'linear-gradient(90deg,#7FD8C4,#BFE29A,#F7D06B,#F7A98C,#F080A8,#B79BE0)';
// Rounded, playful display face (Fredoka, same as the app), with safe fallbacks.
const DISPLAY = "'Fredoka','Baloo 2','Segoe UI',Arial,sans-serif";

/** The multicolour "Eventana" wordmark (pastel letters), matching the logo. */
function wordmark(): string {
  const colors = ['#F080A8', '#F7A98C', '#F7CE68', '#8FD6C4', '#6FC7D6', '#B79BE0', '#F080A8', '#F7A98C'];
  return 'Eventana'
    .split('')
    .map((ch, i) => `<span style="color:${colors[i % colors.length]}">${ch}</span>`)
    .join('');
}

/** Deep link into the customer app's "My Event" tab to follow a booking. */
function trackUrl(eventId: string): string | null {
  const base = (config.publicAppUrl || '').replace(/\/$/, '');
  return base ? `${base}/?event=${encodeURIComponent(eventId)}` : null;
}

/** A text link to the app (falls back to plain text if no URL is configured). */
function appLink(label: string): string {
  const base = (config.publicAppUrl || '').replace(/\/$/, '');
  return base
    ? `<a href="${base}" style="color:${BRAND};text-decoration:none;font-weight:700">${label}</a>`
    : label;
}

/**
 * Bulletproof, centred pill button — bright pink with an uppercase, letter-spaced
 * white label, matching the "SHOP NOW" buttons in the brand's email designs.
 */
function button(href: string, label: string): string {
  return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:26px auto 4px">
      <tr><td style="border-radius:999px;background:${BRAND};box-shadow:0 6px 16px rgba(239,93,149,.28)">
        <a href="${href}" style="display:inline-block;padding:14px 32px;font-size:13px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#ffffff;text-decoration:none;border-radius:999px;font-family:${DISPLAY}">${label}</a>
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
  eyebrow: string;
  heading: string;
  bodyHtml: string;
  cta?: { href: string; label: string };
}

function shell({ first, emoji, eyebrow, heading, bodyHtml, cta }: Shell): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&display=swap" rel="stylesheet"></head>
  <body style="margin:0;padding:0;background:${GROUND};font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:${INK};-webkit-font-smoothing:antialiased">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${GROUND}">${heading}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${GROUND}">
      <tr><td align="center" style="padding:30px 16px 44px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
          <tr><td style="text-align:center;padding:2px 0 22px">
            ${
              config.emailLogoUrl
                ? `<img src="${config.emailLogoUrl}" alt="Eventana Events" width="230" style="display:inline-block;width:230px;max-width:72%;height:auto">`
                : `<div style="font-family:${DISPLAY};font-size:30px;font-weight:700;letter-spacing:.5px">${wordmark()}</div>
                   <div style="font-family:${DISPLAY};font-size:13px;font-weight:500;color:${BRAND};letter-spacing:3px;text-transform:uppercase;margin-top:2px">Events</div>`
            }
          </td></tr>
          <tr><td style="background:#ffffff;border-radius:26px;overflow:hidden;border:1px solid #F6E4EF;box-shadow:0 10px 34px rgba(214,49,127,.10)">
            <div style="height:7px;background:${BRAND};background:${RAINBOW}"></div>
            <div style="padding:34px 30px 36px">
              <div style="text-align:center;font-size:48px;line-height:1;margin-bottom:10px">${emoji}</div>
              ${eyebrow ? `<div style="text-align:center;font-size:11.5px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:${BRAND};margin-bottom:8px">${eyebrow}</div>` : ''}
              <h1 style="margin:0;text-align:center;font-family:${DISPLAY};font-size:25px;font-weight:700;color:${INK};line-height:1.25">${heading}</h1>
              <p style="margin:20px 0 14px;font-size:15px;line-height:1.6">Hi ${first} 👋</p>
              ${bodyHtml}
              ${cta ? button(cta.href, cta.label) : ''}
            </div>
          </td></tr>
          <tr><td style="text-align:center;color:#b8a6b0;font-size:11.5px;padding:24px 12px 0;line-height:1.8">
            Eventana Events · Abu Dhabi &amp; Dubai, UAE<br>
            Need to make a change or follow up? Manage everything in the ${appLink('Eventana app')}. 💛<br>
            <span style="color:#cbbcc5">This inbox isn't monitored — please don't reply.</span>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

/** Money for emails — always with the AED prefix (formatAed omits the currency). */
function aed(n: number | null | undefined): string {
  return `AED ${formatAed(Number(n ?? 0))}`;
}

/** "16:00" → "4:00 PM" — friendly 12-hour time for customers. */
function time12(hhmm: string | null | undefined): string {
  if (!hhmm) return '';
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h)) return String(hhmm);
  const suffix = h >= 12 && h < 24 ? 'PM' : 'AM';
  const hr = ((h + 11) % 12) + 1;
  return `${hr}:${String(m || 0).padStart(2, '0')} ${suffix}`;
}

/**
 * An itemised invoice table (each booked line + a Total). Discount lines show a
 * green minus. Used by the booking confirmation so it doubles as a receipt.
 */
function invoiceTable(
  lines: Array<{ label: string; quantity: number; amountFils: number }>,
  totalFils: number,
): string {
  const rows = lines
    .map((l) => {
      const qty = l.quantity > 1 ? `<b>${l.quantity}×</b> ` : '';
      const neg = Number(l.amountFils) < 0;
      const colour = neg ? '#2E9E6B' : INK;
      return (
        `<tr><td style="padding:9px 2px;font-size:14px;color:${INK};border-bottom:1px solid ${HAIR}">${qty}${l.label}</td>` +
        `<td style="padding:9px 2px;text-align:right;font-size:13.5px;font-weight:700;color:${colour};border-bottom:1px solid ${HAIR};white-space:nowrap">${neg ? '−' : ''}${aed(Math.abs(Number(l.amountFils)))}</td></tr>`
      );
    })
    .join('');
  const total =
    `<tr><td style="padding:13px 2px 2px;font-size:15px;font-weight:800;color:${INK}">Total</td>` +
    `<td style="padding:13px 2px 2px;text-align:right;font-size:16px;font-weight:800;color:${BRAND};white-space:nowrap">${aed(totalFils)}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 2px">${rows}${total}</table>`;
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

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function renderEmail(row: EmailRow): { subject: string; html: string } | null {
  // Two distinct people: the booker we greet, and the guest of honour the
  // celebration is for. Plus the event type (Birthday, Gender Reveal, …).
  const first = (row.customer_name || 'there').split(' ')[0];
  const date = longDate(row.event_date);
  const time = time12(row.start_time);
  const place = row.emirate || 'UAE';
  const track = trackUrl(row.event_id);
  const honour = (row.cart?.eventFor || '').trim();
  const eventType = cap((row.celebration_type || '').trim()); // e.g. "Birthday"
  // Natural phrase for sentences: "Sara's Birthday" / "Sara's celebration" / "the celebration".
  const occasionPhrase = honour
    ? eventType
      ? `${honour}'s ${eventType}`
      : `${honour}'s celebration`
    : eventType
      ? `the ${eventType}`
      : 'your celebration';
  // Detail-card "Occasion" value: event type + chosen package/custom theme.
  const occasionLabel = [
    eventType,
    row.package_name || (row.custom_theme ? 'custom theme' : ''),
  ]
    .filter(Boolean)
    .join(' · ');
  // Rows shared by confirmation and the 3-day reminder.
  const partyRows: Array<[string, string]> = [
    ...(honour ? ([['Guest of honour', honour]] as Array<[string, string]>) : []),
    ...(occasionLabel ? ([['Occasion', occasionLabel]] as Array<[string, string]>) : []),
    ['Date', date],
    ['Time', time || '—'],
    ['Location', place],
    ['Reference', row.event_id],
  ];
  // Itemised invoice lines from the paid order's quote (package, add-ons, theme,
  // surcharge, discount, delivery — each carries a label and amount).
  const invoiceLines = (row.quote?.lines ?? []).filter((l) => l && l.label);
  switch (row.template) {
    case 'booking_confirmation':
      return {
        subject: honour
          ? `${honour}'s Eventana celebration is confirmed 🎉`
          : 'Your Eventana celebration is confirmed 🎉',
        html: shell({
          first,
          emoji: '🎉',
          eyebrow: 'Booking Confirmed',
          heading: honour ? `${honour}'s celebration is confirmed!` : 'Your celebration is confirmed!',
          bodyHtml: `<p style="margin:0 0 6px;font-size:15px;line-height:1.6">Yay — it's official! 🎉 We've saved every detail for <b>${occasionPhrase}</b>, and our team is already busy planning the magic. Here's your booking at a glance:</p>
            ${detailCard(partyRows)}
            ${invoiceLines.length ? `<div style="margin-top:22px;font-size:11.5px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BRAND}">Order Summary</div>${invoiceTable(invoiceLines, Number(row.total_fils ?? 0))}` : ''}
            <p style="margin:18px 0 0;font-size:15px;line-height:1.6">Want to add a little extra or check something? You can manage it all in the app. We can't wait to celebrate with you! 💕</p>`,
          cta: track ? { href: track, label: 'Track your booking →' } : undefined,
        }),
      };
    case 'three_day_reminder':
      return {
        subject: honour ? `${honour}'s Eventana party is in 3 days 🎈` : 'Your Eventana party is in 3 days 🎈',
        html: shell({
          first,
          emoji: '🎈',
          eyebrow: '3 Days To Go',
          heading: honour ? `${honour}'s party is in 3 days!` : 'Your party is in 3 days!',
          bodyHtml: `<p style="margin:0 0 6px;font-size:15px;line-height:1.6">The countdown is on — just 3 days until <b>${occasionPhrase}</b>, and we're getting everything ready! 🎉 Here's a quick reminder of your booking:</p>
            ${detailCard(partyRows)}
            <p style="margin:16px 0 0;font-size:15px;line-height:1.6">Need to tweak anything before the day? It's all in the app — quick and easy. See you very soon! 💖</p>`,
          cta: track ? { href: track, label: 'View your booking →' } : undefined,
        }),
      };
    case 'event_day':
      return {
        subject: "It's party day! 🎉",
        html: shell({
          first,
          emoji: '🥳',
          eyebrow: 'Today',
          heading: honour && eventType ? `Today is ${honour}'s ${eventType}!` : "It's party day!",
          bodyHtml: `<p style="margin:0 0 4px;font-size:15px;line-height:1.6">Today's the day and we couldn't be more excited! 🥳 <b>${cap(occasionPhrase)}</b> starts at <b>${time || 'your booked time'}</b>, and our team is already on the way with all the magic. 🚚✨</p>
            <p style="margin:14px 0 0;font-size:15px;line-height:1.6">Everything you need is in the app. Have the most wonderful time — you've earned it! 💛</p>`,
          cta: track ? { href: track, label: 'View your booking →' } : undefined,
        }),
      };
    case 'event_cancelled':
      return {
        subject: 'Your Eventana booking was cancelled',
        html: shell({
          first,
          emoji: '🌸',
          eyebrow: 'Cancelled',
          heading: 'Your booking was cancelled',
          bodyHtml: `<p style="margin:0;font-size:15px;line-height:1.6">We're sorry to see this celebration go. 🌸 Your booking <b>${row.event_id}</b> for ${date} has been cancelled. If anything doesn't look right, you can review your bookings or message our team anytime in the app — we're always here for you. 💛</p>`,
        }),
      };
    case 'cancellation_refund': {
      const ref = row.order_ref || row.event_id;
      const paid = aed(row.total_paid_fils);
      const pct = Number(row.refund_percent ?? 0);
      const refund = aed(row.refund_amount_fils);
      const today = longDate(new Date().toISOString().slice(0, 10));
      return {
        subject: 'Your Eventana booking has been cancelled',
        html: shell({
          first,
          emoji: '🌸',
          eyebrow: 'Cancelled',
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
      const refund = aed(row.refund_amount_fils);
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
          eyebrow: 'Refund Processed',
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

/** A standalone shop order (printed/digital goods) — no event attached. */
export interface ShopEmailRow {
  id: number;
  order_id: string;
  customer_name: string | null;
  customer_email: string | null;
  cart: { emirate?: string | null; readyBy?: string | null } | null;
  quote: { lines?: Array<{ name: string; quantity: number; amountFils: number }>; deliveryFils?: number } | null;
  total_fils: number | null;
}

/** Customer confirmation for a standalone shop order. */
export function renderShopEmail(row: ShopEmailRow): { subject: string; html: string } | null {
  const first = (row.customer_name || 'there').split(' ')[0];
  const lines = row.quote?.lines ?? [];
  const itemsHtml = lines.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 2px">` +
      lines
        .map(
          (l) =>
            `<tr><td style="padding:8px 2px;font-size:14px;color:${INK};border-bottom:1px solid ${HAIR}"><b>${l.quantity}×</b> ${l.name}</td>` +
            `<td style="padding:8px 2px;text-align:right;font-size:13.5px;font-weight:700;color:${INK};border-bottom:1px solid ${HAIR}">${aed(l.amountFils)}</td></tr>`,
        )
        .join('') +
      `</table>`
    : '';
  const delivery = Number(row.quote?.deliveryFils ?? 0);
  const detail: Array<[string, string]> = [['Order Number', row.order_id]];
  if (row.cart?.readyBy) detail.push(['Ready by', longDate(row.cart.readyBy)]);
  if (row.cart?.emirate) detail.push(['Delivering to', row.cart.emirate]);
  if (delivery > 0) detail.push(['Delivery', aed(delivery)]);
  detail.push(['Total', aed(row.total_fils)]);
  const app = (config.publicAppUrl || '').replace(/\/$/, '') || null;
  return {
    subject: 'Your Eventana order is confirmed 🎁',
    html: shell({
      first,
      emoji: '🎁',
      eyebrow: 'Order Confirmed',
      heading: 'Your order is confirmed!',
      bodyHtml: `<p style="margin:0 0 6px;font-size:15px;line-height:1.6">Thank you for your order! 🎁 We've received it and our team is already getting everything ready for you. Here's your summary:</p>
        ${itemsHtml}
        ${detailCard(detail)}
        <p style="margin:16px 0 0;font-size:15px;line-height:1.6">We'll let you know as soon as it's on its way. 💕</p>`,
      cta: app ? { href: app, label: 'Open Eventana →' } : undefined,
    }),
  };
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
              e.celebration_type, e.custom_theme, o.cart, o.quote, o.total_fils, p.name AS package_name,
              c.name AS customer_name, c.email AS customer_email,
              cx.order_id AS order_ref, cx.total_paid_fils, cx.refund_percent,
              cx.refund_amount_fils, cx.refund_reference
         FROM notifications n
         JOIN events e ON e.id = n.event_id
         JOIN customers c ON c.id = e.customer_id
         LEFT JOIN orders o ON o.id = e.order_id
         LEFT JOIN packages p ON p.id = e.package_id
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

  // ---- Email (shop-order confirmations: no event, keyed by order id) ----
  if (emailEnabled()) {
    const { rows } = await pool.query<ShopEmailRow>(
      `SELECT n.id, o.id AS order_id, o.cart, o.quote, o.total_fils,
              c.name AS customer_name, c.email AS customer_email
         FROM notifications n
         JOIN orders o    ON o.id = (n.payload->>'orderId')
         JOIN customers c ON c.id = o.customer_id
        WHERE n.channel = 'email' AND n.template = 'shop_confirmation'
          AND n.sent_at IS NULL AND n.cancelled_at IS NULL
          AND (n.scheduled_for IS NULL OR n.scheduled_for <= now())
        ORDER BY n.created_at
        LIMIT 100`,
    );
    for (const row of rows) {
      const msg = renderShopEmail(row);
      if (!msg || !row.customer_email) {
        await pool.query(`UPDATE notifications SET sent_at = now() WHERE id = $1`, [row.id]);
        continue;
      }
      const res = await sendEmail({ to: row.customer_email, subject: msg.subject, html: msg.html });
      if (res.ok) {
        await pool.query(`UPDATE notifications SET sent_at = now() WHERE id = $1`, [row.id]);
        emails++;
      }
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
