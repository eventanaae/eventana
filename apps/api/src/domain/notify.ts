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
import { createHmac } from 'node:crypto';
import { formatAed, celebrationLabel } from '@eventana/shared';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';
import { pushToStaff, pushToOwner } from '../integrations/push.js';
import { whatsappCustomerNotifyEnabled, whatsappDriverNotifyEnabled, sendWhatsAppTemplate } from '../integrations/whatsapp.js';
import { issueFeedbackToken } from './customerAuth.js';
import { toValidCustomerPhone } from './maintenance.js';
import { orderViewToken } from './orders.js';
import { imageToPdf } from './imagePdf.js';

export interface EmailRow {
  id: number;
  template: string;
  event_id: string;
  // Linked sales-receipt number (finance_receipts.number) for this event, if any.
  // The customer-facing booking reference is EV-<receipt_number>, falling back to
  // the internal event_id when the event has no receipt yet.
  receipt_number?: number | string | null;
  event_date: string | null;
  start_time: string | null;
  base_end_time?: string | null;
  emirate: string | null;
  eta?: string | null;
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
// Fredoka carries Latin; Baloo Bhaijaan 2 gives Arabic the same rounded feel.
const DISPLAY = "'Fredoka','Baloo Bhaijaan 2','Baloo 2','Segoe UI',Arial,sans-serif";

/** The multicolour "Eventana" wordmark (pastel letters), matching the logo. */
function wordmark(): string {
  const colors = ['#F080A8', '#F7A98C', '#F7CE68', '#8FD6C4', '#6FC7D6', '#B79BE0', '#F080A8', '#F7A98C'];
  return 'Eventana'
    .split('')
    .map((ch, i) => `<span style="color:${colors[i % colors.length]}">${ch}</span>`)
    .join('');
}

/** Deep link into the customer app's "My Event" tab to follow a booking. Carries
 *  the signed event token so a customer WITHOUT an account can open their
 *  booking straight from the email (the app reads the token; the event GET
 *  accepts it as read-only access, and login/register can then claim it). */
function trackUrl(eventId: string): string | null {
  const base = (config.publicAppUrl || '').replace(/\/$/, '');
  return base ? `${base}/?event=${encodeURIComponent(eventId)}&fb=${encodeURIComponent(issueFeedbackToken(eventId))}` : null;
}

/**
 * The feedback deep link — the "My Event" link plus a signed, event-scoped token
 * so a customer WITHOUT an account can rate from the link (see the /api/public/
 * feedback routes). Falls back to the plain track link when no app URL is set.
 */
function feedbackUrl(eventId: string): string | null {
  const base = (config.publicAppUrl || '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}/?event=${encodeURIComponent(eventId)}&fb=${encodeURIComponent(issueFeedbackToken(eventId))}&rate=1`;
}

/** Deep link that opens the Terms & Conditions sheet in the customer app. */
function termsUrl(): string | null {
  const base = (config.publicAppUrl || '').replace(/\/$/, '');
  return base ? `${base}/?terms=1` : null;
}

/** A small "you agree to our Terms" line, linked to the app's Terms sheet. */
function termsNote(): string {
  const url = termsUrl();
  const terms = url
    ? `<a href="${url}" style="color:${BRAND};font-weight:700;text-decoration:none">Terms &amp; Conditions</a>`
    : 'Terms &amp; Conditions';
  return `<p style="margin:14px 0 0;font-size:12px;color:${MUTED};line-height:1.6">By booking with Eventana you agree to our ${terms}, including our cancellation &amp; refund policy.</p>`;
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
  /** Overrides the default "Hi {first} 👋" greeting (e.g. an Arabic one). */
  greeting?: string;
}

function shell({ first, emoji, eyebrow, heading, bodyHtml, cta, greeting }: Shell): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Baloo+Bhaijaan+2:wght@500;600;700;800&display=swap" rel="stylesheet"></head>
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
              <p style="margin:20px 0 14px;font-size:15px;line-height:1.6">${greeting ?? `Hi ${first} 👋`}</p>
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

/**
 * Abandoned-cart recovery: a warm, on-brand "you didn't finish your booking —
 * your celebration is waiting" email plus a best-effort app push, with a one-tap
 * link back to the saved checkout. Returns true if the email was accepted.
 */
export async function sendAbandonedCartReminder(o: {
  orderId: string;
  customerId: string;
  firstName: string;
  email: string;
  amountFils: number;
  occasionPhrase?: string | null;
}): Promise<boolean> {
  const base = (config.publicAppUrl || '').replace(/\/$/, '');
  const resumeUrl = base ? `${base}/?pay=${o.orderId}&t=${orderViewToken(o.orderId)}` : '';
  const rows: Array<[string, string]> = [
    ...(o.occasionPhrase ? ([['Celebration', o.occasionPhrase]] as Array<[string, string]>) : []),
    ['Amount', aed(o.amountFils)],
    ['Reference', o.orderId],
  ];
  const occ = o.occasionPhrase ? `your <b>${o.occasionPhrase}</b>` : 'your celebration';
  const html = shell({
    first: o.firstName,
    emoji: '🎈',
    eyebrow: 'Don’t miss out',
    heading: 'Your celebration is waiting! 🎈',
    bodyHtml: `<p style="margin:0 0 10px;font-size:15.5px;line-height:1.65">You're just <b>one step away</b> from something magical! ✨ You started planning ${occ} with us — and we've lovingly saved every little detail, ready and waiting for you.</p>
      <p style="margin:0 0 6px;font-size:15.5px;line-height:1.65">🗓️ Our favourite dates get booked up <b>fast</b> — so grab yours before someone else does and let the countdown to a day full of smiles begin! 🎉</p>
      ${detailCard(rows)}
      <p style="margin:16px 0 0;font-size:15.5px;line-height:1.65">It only takes a minute — tap below and we'll take care of <i>all</i> the magic. We can't wait to celebrate with you! 💕</p>`,
    cta: resumeUrl ? { href: resumeUrl, label: 'Complete my booking →' } : undefined,
  });
  const res = await sendEmail({ to: o.email, subject: `${o.firstName}, your Eventana celebration is waiting 🎈✨`, html });
  // App push — best-effort; a no-op if the customer has no registered device.
  await pushToOwner(
    'customer',
    o.customerId,
    'Your celebration is waiting 🎈',
    "You didn't finish your booking — tap to complete it and let's celebrate!",
    { orderId: o.orderId, kind: 'abandoned_cart' },
  ).catch(() => {});
  return res.ok;
}

/** A cute boy in a party hat + balloons/confetti, in brand colours. Inline SVG
 *  renders in Apple Mail and previews; Gmail may drop it, so a hosted PNG can be
 *  swapped in later without touching the copy. */
const WINBACK_ART = `<div style="text-align:center"><svg width="200" height="172" viewBox="0 0 320 272" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ولد بقبعة احتفال">
<rect x="40" y="40" width="9" height="9" rx="2" fill="#F7C948" transform="rotate(20 44 44)"/><rect x="270" y="30" width="9" height="9" rx="2" fill="#5BCFC5" transform="rotate(-15 274 34)"/><circle cx="30" cy="120" r="5" fill="#EF5D95"/><circle cx="292" cy="150" r="5" fill="#F7C948"/><path d="M96 44 l3 9 l9 3 l-9 3 l-3 9 l-3 -9 l-9 -3 l9 -3 z" fill="#F7C948"/><path d="M232 60 l2.5 7 l7 2.5 l-7 2.5 l-2.5 7 l-2.5 -7 l-7 -2.5 l7 -2.5 z" fill="#F9C6DC"/>
<path d="M60 150 q6 24 0 44" stroke="#d9a7bf" stroke-width="2" fill="none"/><ellipse cx="60" cy="118" rx="30" ry="36" fill="#F58FB8"/><path d="M60 154 l-6 8 l12 0 z" fill="#F58FB8"/>
<path d="M262 140 q-7 24 0 46" stroke="#e0c68a" stroke-width="2" fill="none"/><ellipse cx="262" cy="108" rx="27" ry="33" fill="#F7C948"/><path d="M262 141 l-6 8 l12 0 z" fill="#F7C948"/>
<path d="M124 272 q0 -60 36 -60 q36 0 36 60 z" fill="#5BCFC5"/><rect x="150" y="196" width="20" height="20" rx="8" fill="#F0B98A"/><circle cx="160" cy="168" r="42" fill="#F6C79B"/><circle cx="120" cy="170" r="8" fill="#F6C79B"/><circle cx="200" cy="170" r="8" fill="#F6C79B"/><path d="M126 150 q34 -26 68 0 q-14 -8 -34 -8 q-20 0 -34 8 z" fill="#5b3d2e"/><circle cx="138" cy="180" r="9" fill="#F79BC0" opacity=".6"/><circle cx="182" cy="180" r="9" fill="#F79BC0" opacity=".6"/><circle cx="145" cy="168" r="5" fill="#3B3641"/><circle cx="175" cy="168" r="5" fill="#3B3641"/><path d="M146 186 q14 16 28 0" stroke="#B4632F" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M160 74 L133 138 Q160 150 187 138 Z" fill="#EF5D95"/><path d="M141 122 q19 8 38 0 l-3 -12 q-16 6 -32 0 z" fill="#F7C948"/><circle cx="160" cy="72" r="9" fill="#F7C948"/>
</svg></div>`;

/**
 * The win-back "come back and celebrate" email — an AED 600 code (+ free
 * delivery) for the customer's next booking, on the official Eventana template
 * (shell). Warm Emirati-Arabic copy. BCCs the monitor inbox like every send.
 * Sends nothing on its own — called by the owner-approved campaign / +3-day flow.
 */
export async function sendWinbackEmail(o: {
  firstName: string;
  email: string;
  code: string;
  expiresAt?: Date | string | null;
  /** Customer id — used to build a one-click unsubscribe link (bulk marketing). */
  customerId?: string;
}): Promise<boolean> {
  const expiry = o.expiresAt
    ? new Date(o.expiresAt).toLocaleDateString('ar-AE', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  // One-click unsubscribe — deterministic HMAC token, matching /api/unsubscribe.
  const base = (config.email.publicBaseUrl || config.publicAppUrl || 'https://eventanauae.com').replace(/\/$/, '');
  const unsubUrl = o.customerId
    ? `${base}/api/unsubscribe?c=${encodeURIComponent(o.customerId)}&t=${createHmac('sha256', config.staffToken).update(o.customerId).digest('hex').slice(0, 24)}`
    : null;
  const bodyHtml = `${WINBACK_ART}
    <p style="margin:16px 0 14px;font-size:15px;line-height:1.95">كل حفلة نجهّزها نحطّ فيها قلبنا… وفرحتكم عندنا ذكرى ما تُنسى. واليوم جهّزنا لكم هدية صغيرة عشان نرجع نصنع لكم لحظة سحرية تليق بكم 🥹</p>
    <div style="background:${PANEL};border:2px dashed #F3B6D2;border-radius:18px;padding:22px 18px;text-align:center;margin:18px 0">
      <div style="font-size:12px;font-weight:700;color:#c98bb0;letter-spacing:1px;margin-bottom:8px">🎁 هديتكم الخاصة</div>
      <div style="font-family:${DISPLAY};font-size:38px;font-weight:800;color:${BRAND};line-height:1.25">600 درهم خصم</div>
      <div style="font-size:13px;font-weight:500;color:${MUTED};margin-top:2px">على أي حفلة جاية 🎉</div>
      <div style="margin:16px auto 4px">
        <span style="display:inline-block;background:#EAF8F6;color:#2f9488;border-radius:14px;padding:9px 16px;font-size:14px;font-weight:700;margin:4px">🚚 توصيل مجاني</span>
        <span style="display:inline-block;background:#FFF4DA;color:#c79218;border-radius:14px;padding:9px 16px;font-size:14px;font-weight:700;margin:4px">💛 لكم وحدكم</span>
      </div>
      <div style="margin:16px auto 0;max-width:300px;background:linear-gradient(135deg,#FFEFD4,#FFDCEA);border-radius:16px;padding:13px">
        <div style="font-size:11.5px;font-weight:700;color:#b3679a;letter-spacing:1px;margin-bottom:4px">كودكم</div>
        <div style="font-family:${DISPLAY};font-size:25px;font-weight:800;color:${BRAND};letter-spacing:1.5px;direction:ltr">${o.code}</div>
      </div>
    </div>
    <p style="margin:0 0 6px;font-size:14.5px;line-height:1.95">استخدموه لأي مناسبة على قلبكم — <b style="color:#c0356f">عيد ميلاد 🎂</b>، <b style="color:#c0356f">برايد تو بي 👰</b>، <b style="color:#c0356f">تخرّج 🎓</b> وغيرها ✨</p>
    <p style="margin:6px 0 0;font-size:13.5px;line-height:1.9;color:${MUTED}">على أي حجز فوق <b style="color:${BRAND}">3,000 درهم</b> — صالح <b style="color:${BRAND}">3 شهور</b>${expiry ? ` (حتى ${expiry})` : ''}، ويُستخدم مرة وحدة 🌸</p>
    <p style="margin:12px 0 0;font-size:13px;line-height:1.9;color:${MUTED}">✨ سجّلي دخول أو أنشئي حساب بنفس إيميلك، وبتلقين <b>كل حفلاتكم السابقة ونقاطكم محفوظة</b> — دايماً معكم.</p>${
      unsubUrl
        ? `<p style="margin:18px 0 0;font-size:11px;line-height:1.6;color:#c2b4bb;text-align:center">لا تبين تستقبلين عروضنا؟ <a href="${unsubUrl}" style="color:#c2b4bb">إلغاء الاشتراك</a></p>`
        : ''
    }`;
  const html = shell({
    first: o.firstName || 'حبيبتنا',
    emoji: '🎈',
    eyebrow: 'هدية لكم 💕',
    heading: `اشتقنا لكم يا ${o.firstName || ''}!`.trim(),
    greeting: `هلا ${o.firstName || ''} 👋`.replace('  ', ' ').trim(),
    bodyHtml: `<div dir="rtl" style="text-align:right">${bodyHtml}</div>`,
    cta: { href: (config.publicAppUrl || 'https://eventanauae.com').replace(/\/$/, ''), label: 'نبدأ الاحتفال 🎉' },
  });
  // A bulk win-back blast: don't copy the monitor inbox on every one (owner's call).
  const res = await sendEmail({ to: o.email, subject: `هديتكم من إيفنتانا 🎁 خصم 600 درهم + توصيل مجاني`, html, skipMonitorBcc: true });
  return res.ok;
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
  // Format at NOON UTC so no timezone can roll the calendar day forward/back,
  // and render explicitly in Dubai time so the weekday + day never depend on the
  // server's own timezone (Render runs UTC; this must be correct regardless).
  const d = iso ? new Date(`${iso}T12:00:00Z`) : new Date(NaN);
  if (Number.isNaN(d.getTime())) return typeof value === 'string' ? value : 'your event date';
  return d.toLocaleDateString('en-GB', {
    timeZone: 'Asia/Dubai',
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * A sales receipt / invoice email in the SAME branded design as the booking
 * emails (logo, rainbow strip, itemised invoice table, pill CTA) — used by the
 * Finance module's "Email" action so what the customer gets matches the samples.
 */
export function renderFinanceDocEmail(
  doc: {
    number: string; customer_name?: string | null; date?: unknown; issue_date?: unknown; due_date?: unknown;
    lineItems?: Array<{ name: string; qty: number; priceFils: number }>;
    discount_fils?: number; shipping_fils?: number; total_fils: number; message?: string | null;
    event_for?: string | null; theme?: string | null; age?: string | null; event_time?: string | null;
    date_tbd?: boolean; paid_with?: string | null;
    refundedFils?: number; netTotalFils?: number;
    refundedItems?: Array<{ label?: string | null; amountFils?: number }>;
  },
  kind: 'receipt' | 'invoice',
  // When set, the receipt is re-sent as a REFUND email: 'apology' for a quality
  // issue / missing item (our fault), 'confirmation' for a customer's own
  // cancellation or a plain refund. Only valid for kind='receipt'.
  opts: { refundMode?: 'apology' | 'confirmation' } = {},
): { subject: string; html: string } {
  const first = cap(String(doc.customer_name ?? 'there').trim().split(/\s+/)[0] || 'there');
  const lines = (doc.lineItems ?? []).map((l) => ({ label: l.name, quantity: Number(l.qty), amountFils: Math.round(Number(l.qty) * Number(l.priceFils)) }));
  if (Number(doc.discount_fils) > 0) lines.push({ label: 'Discount', quantity: 1, amountFils: -Number(doc.discount_fils) });
  if (Number(doc.shipping_fils) > 0) lines.push({ label: 'Shipping & delivery', quantity: 1, amountFils: Number(doc.shipping_fils) });

  const refunded = Number(doc.refundedFils ?? 0) || 0;
  const isRefund = !!opts.refundMode && refunded > 0;
  const apology = opts.refundMode === 'apology';

  const detailRows: Array<[string, string]> = [
    // A sales receipt IS the customer's booking reference, shown as EV-<number>
    // everywhere (dashboard, emails, app). An invoice keeps its plain #<number>.
    [kind === 'receipt' ? 'Reference' : 'Invoice no.', kind === 'receipt' ? `EV-${doc.number}` : `#${doc.number}`],
    ['Date', doc.date_tbd ? 'To be confirmed' : longDate(doc.date ?? doc.issue_date)],
  ];
  if (doc.event_time) detailRows.push(['Time', time12(String(doc.event_time))]);
  if (doc.event_for) detailRows.push(['Celebration for', String(doc.event_for)]);
  if (doc.age) detailRows.push(['Age', String(doc.age)]);
  if (doc.theme) detailRows.push(['Theme', String(doc.theme)]);
  if (kind === 'receipt') {
    if (doc.paid_with) detailRows.push(['Paid with', String(doc.paid_with)]);
    detailRows.push(['Status', isRefund ? 'Refunded ↩︎' : 'Paid ✓']);
  } else if (doc.due_date) detailRows.push(['Payment due', longDate(doc.due_date)]);

  // The refunded items shown as green minus lines under the receipt, plus the
  // new net total the customer effectively paid.
  const refundLines = (doc.refundedItems ?? [])
    .filter((r) => Number(r.amountFils) > 0)
    .map((r) => ({ label: `Refunded — ${r.label && String(r.label).trim() ? String(r.label).trim() : 'item'}`, quantity: 1, amountFils: -Number(r.amountFils) }));
  const refundBlock = isRefund
    ? `<div style="margin:16px 0 4px;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${MUTED}">Refund</div>` +
      invoiceTable(
        (refundLines.length ? refundLines : [{ label: 'Refunded', quantity: 1, amountFils: -refunded }])
          .concat([{ label: 'Net total', quantity: 1, amountFils: Number(doc.netTotalFils ?? (Number(doc.total_fils) - refunded)) }]),
        Number(doc.netTotalFils ?? (Number(doc.total_fils) - refunded)),
      )
    : '';

  const intro = isRefund
    ? (apology
        ? `We're truly sorry this part of your celebration didn't meet the Eventana standard. 💛 We've refunded you for it — the details are below, and your updated receipt is attached to this note.`
        : `Your refund has been processed. 💛 Here's your updated receipt with the refunded item and your new total.`)
    : (kind === 'receipt'
        ? `Thank you so much! Here's your receipt for your celebration with Eventana. 💛`
        : `Here's your invoice — we can't wait to celebrate with you! 🎀`);
  const body =
    `<p style="margin:0 0 8px;font-size:15px;line-height:1.6">${intro}</p>` +
    detailCard(detailRows) +
    `<div style="margin:20px 0 4px;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${MUTED}">${kind === 'receipt' ? 'Receipt' : 'Invoice'}</div>` +
    invoiceTable(lines, Number(doc.total_fils)) +
    refundBlock +
    (isRefund ? `<p style="margin:16px 0 0;color:${MUTED};font-size:13px;line-height:1.6">Your refund may take approximately <b>7 business days</b> to appear, depending on your bank or payment provider.</p>` : '') +
    (doc.message ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:${INK}">${doc.message}</p>` : '') +
    termsNote();

  const appBase = (config.publicAppUrl || '').replace(/\/$/, '');
  const cta = appBase ? { href: appBase, label: 'Open in the App' } : undefined;
  const html = shell({
    first,
    emoji: isRefund ? (apology ? '💛' : '↩︎') : (kind === 'receipt' ? '🧾' : '🎀'),
    eyebrow: isRefund ? 'Refund' : (kind === 'receipt' ? 'Sales Receipt' : 'Invoice'),
    heading: isRefund ? (apology ? 'With our apologies' : 'Your refund is processed') : (kind === 'receipt' ? 'Your receipt is ready' : 'Here’s your invoice'),
    bodyHtml: body,
    cta,
  });
  const subject = isRefund
    ? (apology ? `Our apologies — your Eventana refund (EV-${doc.number})` : `Your Eventana refund — receipt EV-${doc.number}`)
    : (kind === 'receipt' ? `Your Eventana receipt EV-${doc.number} 🎉` : `Invoice #${doc.number} from Eventana`);
  return { subject, html };
}

export function renderEmail(row: EmailRow): { subject: string; html: string } | null {
  // Two distinct people: the booker we greet, and the guest of honour the
  // celebration is for. Plus the event type (Birthday, Gender Reveal, …).
  const first = (row.customer_name || 'there').split(' ')[0];
  const date = longDate(row.event_date);
  const time = [time12(row.start_time), time12(row.base_end_time ?? null)].filter(Boolean).join(' – ');
  const place = row.emirate || 'UAE';
  const track = trackUrl(row.event_id);
  // Customer-facing booking reference: EV-<sales-receipt number>, falling back to
  // the internal event_id when the event has no linked receipt yet.
  const ref = row.receipt_number ? `EV-${row.receipt_number}` : row.event_id;
  const honour = (row.cart?.eventFor || '').trim();
  // Proper label for the stored type id ('gender' → 'Gender Reveal', 'customc' →
  // 'Custom Celebration', 'kids' → 'Kids Birthday', …). Never a raw id.
  const eventType = celebrationLabel(row.celebration_type);
  // Prose phrase, kept grammatically safe for EVERY type (incl. "Bride to Be",
  // "Custom Celebration"): always "<name>'s celebration" / "your celebration".
  // The precise type is shown in the Occasion row instead.
  const occasionPhrase = honour ? `${honour}'s celebration` : 'your celebration';
  // Detail-card "Occasion" value: exact event type + chosen package/custom theme.
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
    ['Reference', ref],
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
            ${invoiceLines.length ? `<div style="margin-top:22px;font-size:11.5px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BRAND}">Order Summary</div>${invoiceTable(invoiceLines, Number(row.total_fils ?? 0))}${termsNote()}` : ''}
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
          heading: honour ? `Today is ${honour}'s big day!` : "It's party day!",
          bodyHtml: `<p style="margin:0 0 4px;font-size:15px;line-height:1.6">Today's the day and we couldn't be more excited! 🥳 <b>${cap(occasionPhrase)}</b> starts at <b>${time || 'your booked time'}</b>. 🎈✨</p>
            <p style="margin:14px 0 0;font-size:15px;line-height:1.6">Everything you need is in the app. Have the most wonderful time — you've earned it! 💛</p>`,
          cta: track ? { href: track, label: 'View your booking →' } : undefined,
        }),
      };
    case 'booking_updated':
      return {
        subject: honour ? `${honour}'s Eventana booking — updated ✏️` : 'Your Eventana booking — updated ✏️',
        html: shell({
          first,
          emoji: '✏️',
          eyebrow: 'Booking Updated',
          heading: honour ? `${honour}'s booking has been updated` : 'Your booking has been updated',
          bodyHtml: `<p style="margin:0 0 6px;font-size:15px;line-height:1.6">We've updated the details of ${honour ? `<b>${honour}'s celebration</b>` : 'your celebration'} — here's the latest:</p>
            ${detailCard(partyRows)}
            <p style="margin:16px 0 0;font-size:15px;line-height:1.6">If anything doesn't look right, just message us in the app — we're always here for you. 💛</p>`,
          cta: track ? { href: track, label: 'View your booking →' } : undefined,
        }),
      };
    case 'feedback_request':
      return {
        subject: honour ? `How was ${honour}'s celebration? ⭐` : 'How was your Eventana celebration? ⭐',
        html: shell({
          first,
          emoji: '⭐',
          eyebrow: 'We would love your feedback',
          heading: honour ? `How was ${honour}'s big day?` : 'How was your celebration?',
          bodyHtml: `<p style="margin:0 0 4px;font-size:15px;line-height:1.6">We hope everyone had the most wonderful time! 💕 Your feedback means the world to us and helps us make every Eventana celebration even better. It only takes a minute:</p>`,
          cta: (feedbackUrl(row.event_id) || track) ? { href: (feedbackUrl(row.event_id) || track)!, label: 'Leave your feedback →' } : undefined,
        }),
      };
    case 'team_on_the_way':
      return {
        subject: 'Your Eventana team is on the way! 🚐',
        html: shell({
          first,
          emoji: '🚐',
          eyebrow: 'On the way',
          heading: 'Your team is on the way!',
          bodyHtml: `<p style="margin:0;font-size:15px;line-height:1.6">Our Eventana crew is heading to you now${row.eta ? ` — estimated arrival around <b>${row.eta}</b>` : ''} to set up ${honour ? `${honour}'s` : 'your'} celebration. 🎈 See you very soon!</p>`,
          cta: track ? { href: track, label: 'View your booking →' } : undefined,
        }),
      };
    case 'team_arrived':
      return {
        subject: 'Your Eventana team has arrived! 🎉',
        html: shell({
          first,
          emoji: '📍',
          eyebrow: 'Arrived',
          heading: 'Your team has arrived!',
          bodyHtml: `<p style="margin:0;font-size:15px;line-height:1.6">Our crew is at your location and starting the magic now. ✨ Everything will be ready shortly — thank you for choosing Eventana! 💕</p>`,
        }),
      };
    case 'setup_ready':
      return {
        subject: 'Everything is ready — enjoy! ✨',
        html: shell({
          first,
          emoji: '✨',
          eyebrow: 'Ready',
          heading: 'Everything is set up and ready!',
          bodyHtml: `<p style="margin:0;font-size:15px;line-height:1.6">${honour ? `${honour}'s` : 'Your'} celebration is all set up and ready to go. 🎉 Have the most wonderful time — we can't wait to hear how it went! 💕</p>`,
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
          bodyHtml: `<p style="margin:0;font-size:15px;line-height:1.6">We're sorry to see this celebration go. 🌸 Your booking <b>${ref}</b> for ${date} has been cancelled. If anything doesn't look right, you can review your bookings or message our team anytime in the app — we're always here for you. 💛</p>`,
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

/**
 * The WhatsApp version of a customer notification — the same events as the email
 * templates, rendered as concise plain text (WhatsApp has no HTML). Returns null
 * for templates we don't mirror to WhatsApp. The link is the customer app's
 * "My Event" deep link, which is where the feedback form lives (auto-tied to the
 * order + event, so a feedback reply is always attached to the right booking).
 */
export function renderWhatsApp(row: EmailRow): string | null {
  const first = (row.customer_name || 'there').split(' ')[0];
  const honour = (row.cart?.eventFor || '').trim();
  const who = honour ? `${honour}'s` : 'your';
  const date = longDate(row.event_date);
  const time = [time12(row.start_time), time12(row.base_end_time ?? null)].filter(Boolean).join(' – ');
  const place = row.emirate || 'UAE';
  const link = trackUrl(row.event_id);
  // Customer-facing booking reference: EV-<sales-receipt number>, event_id fallback.
  const ref = row.receipt_number ? `EV-${row.receipt_number}` : row.event_id;
  const track = link ? `\n\nTrack it here: ${link}` : '';
  const feedbackLink = link ? `\n\nShare your feedback: ${link}` : '';
  switch (row.template) {
    case 'booking_confirmation': {
      const details =
        (honour ? `\n\n🎈 Guest of honour: ${honour}` : '') +
        `\n📅 ${date}` + (time ? `\n🕒 ${time}` : '') + `\n📍 ${place}` +
        `\n🔖 Ref: ${ref}` +
        (row.total_fils != null ? `\n💳 Total: ${aed(row.total_fils)}` : '');
      return `🎉 ${honour ? `${honour}'s` : 'Your'} Eventana celebration is confirmed!\n\nHi ${first} 👋 We've saved every detail for ${who} celebration and our team is already planning the magic.${details}\n\n📧 Your full itemised invoice is in your email.${track}\n\nCan't wait to celebrate with you! 💕`;
    }
    case 'three_day_reminder':
      return `🎈 Just 3 days to go!\n\nHi ${first} 👋 The countdown is on for ${who} Eventana celebration on ${date}${time ? ` at ${time}` : ''} in ${place}.\n\nNeed to tweak anything? It's all in the app.${track}\n\nSee you very soon! 💖`;
    case 'event_day':
      return `🥳 It's party day!\n\nHi ${first}! Today's the day — ${who} celebration${time ? ` starts at ${time}` : ''}, and our team is on the way with all the magic. 🚐✨${track}\n\nHave the most wonderful time! 💛`;
    case 'team_on_the_way':
      return `🚐 Your Eventana team is on the way${row.eta ? ` — ETA around ${row.eta}` : ''}!\n\nWe're heading to you now to set up ${who} celebration. 🎈 See you very soon!`;
    case 'team_arrived':
      return `📍 Your Eventana team has arrived!\n\nOur crew is at your location and starting the magic now. ✨ Everything will be ready shortly — thank you for choosing Eventana! 💕`;
    case 'setup_ready':
      return `✨ Everything is set up and ready!\n\n${cap(who)} celebration is all ready to go. 🎉 Have the most wonderful time — we can't wait to hear how it went! 💕`;
    case 'feedback_request':
      return `⭐ How was ${who} celebration?\n\nHi ${first} 💕 We hope everyone had the most wonderful time! Your feedback means the world to us and helps us make every Eventana celebration even better — it only takes a minute.${feedbackLink}\n\nThank you! 🌸`;
    case 'event_cancelled':
      return `🌸 Your Eventana booking ${ref} for ${date} has been cancelled.\n\nIf anything doesn't look right, message our team anytime in the app — we're always here for you. 💛`;
    case 'cancellation_refund': {
      const ref = row.order_ref || row.event_id;
      return `🌸 Your Eventana booking has been cancelled.\n\n🔖 Order: ${ref}\n📅 Event date: ${date}\n💳 Paid: ${aed(row.total_paid_fils)}\n↩️ Refund: ${aed(row.refund_amount_fils)} (${Number(row.refund_percent ?? 0)}%)\n\nYour refund may take ~7 business days to appear, depending on your bank. 💛`;
    }
    case 'refund_processed': {
      const ref = row.order_ref || row.event_id;
      return `💸 Your Eventana refund has been processed.\n\n🔖 Order: ${ref}\n↩️ Amount: ${aed(row.refund_amount_fils)}` +
        (row.refund_reference ? `\n📄 Reference: ${row.refund_reference}` : '') +
        `\n\nPlease allow ~7 business days for it to appear. 💛`;
    }
    default:
      return null;
  }
}

/**
 * Maps a customer notification to its approved WhatsApp template name + ordered
 * body parameters (matching the {{1}}, {{2}}… in the templates seeded to Meta).
 * Every param is non-empty and single-line, as Meta requires. Returns null for
 * templates we don't send over WhatsApp.
 */
export function whatsAppTemplateFor(row: EmailRow): { name: string; params: string[] } | null {
  // The WhatsApp templates go out in Arabic (most customers are Arabic), so the
  // fallbacks for any missing field are Arabic too.
  const first = (row.customer_name || 'حبيبتنا').split(' ')[0];
  const honour = (row.cart?.eventFor || '').trim();
  const date = longDate(row.event_date);
  const time = [time12(row.start_time), time12(row.base_end_time ?? null)].filter(Boolean).join(' – ');
  const place = row.emirate || 'الإمارات';
  const link = trackUrl(row.event_id) || (config.publicAppUrl || 'https://ops.eventanauae.com');
  const total = row.total_fils != null ? aed(row.total_fils) : '—';
  // Customer-facing booking reference: EV-<sales-receipt number>, event_id fallback.
  const ref = row.receipt_number ? `EV-${row.receipt_number}` : row.event_id;
  switch (row.template) {
    case 'booking_confirmation':
      return { name: 'booking_confirmation', params: [first, honour || 'ضيف الشرف', date, time || 'الوقت المحجوز', place, ref, total] };
    case 'three_day_reminder':
      return { name: 'three_day_reminder', params: [first, `${date}${time ? ` الساعة ${time}` : ''}`, place] };
    case 'booking_updated':
      return { name: 'booking_updated', params: [first, `${date}${time ? ` · ${time}` : ''}`, place] };
    case 'event_day':
      return { name: 'event_day', params: [first, time || 'بالوقت المحجوز'] };
    case 'team_on_the_way':
      return { name: 'team_on_the_way', params: [row.eta ? ` — تقريباً الساعة ${row.eta}` : ' — نوصل قريب'] };
    case 'team_arrived':
      return { name: 'team_arrived', params: [] };
    case 'setup_ready':
      return { name: 'setup_ready', params: [] };
    case 'feedback_request':
      return { name: 'feedback_request', params: [first, feedbackUrl(row.event_id) || link] };
    case 'cancellation_refund':
      return { name: 'cancellation_refund', params: [first, row.order_ref || row.event_id, date, aed(row.total_paid_fils), aed(row.refund_amount_fils), String(Number(row.refund_percent ?? 0))] };
    case 'refund_processed':
      return { name: 'refund_processed', params: [first, row.order_ref || row.event_id, aed(row.refund_amount_fils)] };
    default:
      return null; // e.g. event_cancelled — email only, no WhatsApp template
  }
}

/** One notification row joined to the event's delivery details + the assigned
 *  driver's phone — the input to the driver WhatsApp templates. */
export interface DriverRow {
  id: number;
  template: string;
  event_id: string;
  event_date: string | null; // to_char'd YYYY-MM-DD
  start_time: string | null;
  base_end_time?: string | null;
  emirate: string | null;
  address: { area?: string; building?: string; notes?: string } | null;
  map_lat: number | null;
  map_lng: number | null;
  celebration_type: string | null;
  package_name: string | null;
  cart: { eventFor?: string } | null;
  location_note: string | null;
  driver_phone: string | null;
}

/** A driving-directions link to the event's pin (falls back to an emirate
 *  search). Never empty — Meta rejects an empty template parameter. */
function driverMapLink(row: DriverRow): string {
  const lat = Number(row.map_lat), lng = Number(row.map_lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  }
  // No pin, but the team may have pasted a full Google Maps link — use it directly.
  const note = (row.location_note || '').trim();
  if (/^https?:\/\//i.test(note)) return note;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.emirate || 'UAE')}`;
}

/** A short place label for the driver: emirate + area/building when present. */
function driverPlace(row: DriverRow): string {
  const note = (row.location_note || '').trim();
  // A written address (not a URL) is the most useful place label when present.
  const noteText = note && !/^https?:\/\//i.test(note) ? note : null;
  const parts = [row.emirate, noteText, row.address?.area, row.address?.building].filter(Boolean);
  return parts.length ? parts.join(' — ') : (row.emirate || 'UAE');
}

/** A one-line description of what the delivery is (celebration · guest · package). */
function driverDetails(row: DriverRow): string {
  const honour = (row.cart?.eventFor || '').trim();
  const bits = [
    row.celebration_type ? celebrationLabel(row.celebration_type) : null,
    honour || null,
    row.package_name || null,
  ].filter(Boolean);
  return bits.length ? bits.join(' · ') : 'Event setup';
}

/**
 * Maps a driver notification to its approved WhatsApp template + params (English
 * — the driver reads English). Every param is non-empty and single-line.
 */
export function driverTemplateFor(row: DriverRow): { name: string; params: string[] } | null {
  const date = longDate(row.event_date);
  const time = time12(row.start_time) || 'your booked time';
  const place = driverPlace(row);
  const link = driverMapLink(row);
  const ref = row.event_id;
  switch (row.template) {
    case 'driver_new_order':
      return { name: 'driver_new_order', params: [date, time, place, link, ref, driverDetails(row)] };
    case 'driver_order_updated':
      return { name: 'driver_order_updated', params: [date, time, place, link, ref, driverDetails(row)] };
    case 'driver_order_cancelled':
      return { name: 'driver_order_cancelled', params: [date, place, ref] };
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
  if (row.cart?.readyBy) detail.push(['Estimated delivery', longDate(row.cart.readyBy)]);
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
        ${termsNote()}
        <p style="margin:16px 0 0;font-size:15px;line-height:1.6">We'll let you know as soon as it's on its way. 💕</p>`,
      cta: app ? { href: app, label: 'Open Eventana →' } : undefined,
    }),
  };
}

/** A paid add-on attached to an existing event — an "updated invoice" email. */
export interface AddonEmailRow {
  id: number;
  event_id: string;
  // Linked sales-receipt number for the booking reference (EV-<number>), if any.
  receipt_number?: number | string | null;
  event_date: unknown;
  start_time: string;
  emirate: string | null;
  event_cart: { eventFor?: string | null } | null;
  package_name: string | null;
  customer_name: string | null;
  customer_email: string | null;
  addon_quote: { lines?: Array<{ label: string; quantity: number; amountFils: number }> } | null;
  addon_total: number | null;
  new_total: number | null;
}

/** Updated-invoice email after a customer (or the team) adds to a booking. */
export function renderAddonEmail(row: AddonEmailRow): { subject: string; html: string } | null {
  const first = (row.customer_name || 'there').split(' ')[0];
  const honour = (row.event_cart?.eventFor || '').trim();
  const track = trackUrl(row.event_id);
  // Customer-facing booking reference: EV-<sales-receipt number>, event_id fallback.
  const ref = row.receipt_number ? `EV-${row.receipt_number}` : row.event_id;
  const lines = (row.addon_quote?.lines ?? []).filter((l) => l && l.label && Number(l.amountFils) !== 0);
  const itemsHtml = lines.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 2px">` +
      lines
        .map(
          (l) =>
            `<tr><td style="padding:8px 2px;font-size:14px;color:${INK};border-bottom:1px solid ${HAIR}"><b>${l.quantity}×</b> ${l.label}</td>` +
            `<td style="padding:8px 2px;text-align:right;font-size:13.5px;font-weight:700;color:${INK};border-bottom:1px solid ${HAIR}">${aed(l.amountFils)}</td></tr>`,
        )
        .join('') +
      `</table>`
    : '';
  const detail: Array<[string, string]> = [];
  if (honour) detail.push(['Guest of honour', honour]);
  detail.push(['Date', longDate(row.event_date)]);
  detail.push(['Time', time12(row.start_time) || '—']);
  if (row.emirate) detail.push(['Location', row.emirate]);
  detail.push(['Reference', ref]);
  detail.push(['Added now', aed(row.addon_total)]);
  detail.push(['New booking total', aed(row.new_total)]);
  return {
    subject: honour
      ? `${honour}'s Eventana booking — updated invoice 🧾`
      : 'Your Eventana booking — updated invoice 🧾',
    html: shell({
      first,
      emoji: '🧾',
      eyebrow: 'Booking Updated',
      heading: honour ? `${honour}'s booking has been updated!` : 'Your booking has been updated!',
      bodyHtml: `<p style="margin:0 0 6px;font-size:15px;line-height:1.6">Great news — we've added a little more magic to ${honour ? `<b>${honour}'s celebration</b>` : 'your celebration'}! 🎉 Here's what was just added:</p>
        ${itemsHtml}
        <div style="margin-top:18px;font-size:11.5px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BRAND}">Updated Booking</div>
        ${detailCard(detail)}
        ${termsNote()}
        <p style="margin:16px 0 0;font-size:15px;line-height:1.6">Everything is saved to your booking — no need to do a thing. We can't wait to celebrate with you! 💕</p>`,
      cta: track ? { href: track, label: 'View your booking →' } : undefined,
    }),
  };
}

/** Deliver all due notifications. Returns how many of each channel were sent. */
let deliveringNow = false;
/**
 * Single-runner guard. deliverPendingNotifications has no per-row claim (it
 * SELECTs sent_at IS NULL, sends, then stamps), so two OVERLAPPING callers — the
 * 5-minute reconcile sweep and a manual "send now" from a route (Event Complete,
 * receipt→event conversion) — would grab the same un-sent rows and email/WhatsApp
 * the customer twice. Serialise all callers in-process. (The API runs a single
 * instance; a future multi-instance deployment would also need a DB advisory lock.)
 */
export async function deliverPendingNotifications(): Promise<{ emails: number; pushes: number; whatsapps: number }> {
  if (deliveringNow) return { emails: 0, pushes: 0, whatsapps: 0 };
  deliveringNow = true;
  try {
    return await _deliverPendingNotifications();
  } finally {
    deliveringNow = false;
  }
}

async function _deliverPendingNotifications(): Promise<{ emails: number; pushes: number; whatsapps: number }> {
  let emails = 0;
  let pushes = 0;
  let whatsapps = 0;

  // ---- WhatsApp (customer-facing, in parallel to email) ----
  // Same customer templates as the email sweep, delivered to the customer's
  // WhatsApp. Gated: sends nothing unless the API is connected AND the owner's
  // master switch is on. Stamped separately (whatsapp_sent_at) so a WhatsApp
  // failure never blocks the email, and vice-versa.
  if (whatsappCustomerNotifyEnabled()) {
    const { rows } = await pool.query<EmailRow & { customer_phone: string | null }>(
      `SELECT n.id, n.template, n.event_id,
              -- Booking reference the customer sees: the linked sales-receipt
              -- number (EV-<number>), matching the dashboard; event_id fallback.
              (SELECT fr.number FROM finance_receipts fr
                WHERE fr.event_id = e.id OR (e.order_id IS NOT NULL AND fr.order_id = e.order_id)
                ORDER BY (fr.event_id = e.id) DESC, fr.id LIMIT 1) AS receipt_number,
              e.event_date, e.start_time, e.base_end_time, e.emirate, e.eta,
              e.celebration_type, e.custom_theme, o.cart, o.total_fils, p.name AS package_name,
              c.name AS customer_name, c.phone AS customer_phone,
              cx.order_id AS order_ref, cx.total_paid_fils, cx.refund_percent, cx.refund_amount_fils
         FROM notifications n
         JOIN events e ON e.id = n.event_id
         JOIN customers c ON c.id = e.customer_id
         LEFT JOIN orders o ON o.id = e.order_id
         LEFT JOIN packages p ON p.id = e.package_id
         LEFT JOIN cancellations cx ON cx.event_id = e.id
        WHERE n.channel = 'email' AND n.whatsapp_sent_at IS NULL AND n.cancelled_at IS NULL
          AND n.template IN ('booking_confirmation','three_day_reminder','event_day',
                             'team_on_the_way','team_arrived','setup_ready','feedback_request',
                             'booking_updated','event_cancelled','cancellation_refund')
          -- No dated customer WhatsApp while the event date is unconfirmed (TBD).
          AND (e.date_tbd IS NOT TRUE OR n.template IN ('event_cancelled','cancellation_refund'))
          -- SAFETY: never blast a pre-event message for an event that has already
          -- happened (e.g. a QuickBooks-converted or back-dated event whose row
          -- ends up due immediately). Fails safe — the worst case is a skipped
          -- send, never a wrong one. Pre-event templates require a today/future
          -- date; feedback only within a recent window; cancellations any time.
          AND (
                e.event_date >= current_date
             OR n.template IN ('event_cancelled','cancellation_refund')
             OR (n.template = 'feedback_request' AND e.event_date >= current_date - interval '95 days')
          )
          -- Feedback WhatsApp only during civil hours (10:00–20:00 Dubai), same
          -- as the email — no midnight feedback pings.
          AND (n.template <> 'feedback_request'
               OR extract(hour from now() AT TIME ZONE 'Asia/Dubai') BETWEEN 10 AND 19)
          AND (n.scheduled_for IS NULL OR n.scheduled_for <= now())
        ORDER BY n.scheduled_for NULLS FIRST
        LIMIT 100`,
    );
    for (const row of rows) {
      const tpl = whatsAppTemplateFor(row);
      // Meta needs the number in E.164 (9715XXXXXXXX). A UAE mobile stored as a
      // local 05X — common for older/QuickBooks-migrated customers — is promoted
      // first. A number that ISN'T a recognisable, well-formed mobile (e.g. a
      // truncated "054003230") is skipped, NOT sent raw — sending it just fails at
      // Meta and, with whatsapp_sent_at left NULL, retries + errors on every sweep
      // forever. Stamp it handled (the email already went out) and move on.
      const e164 = toValidCustomerPhone(row.customer_phone);
      const to = e164 ? String(e164).replace(/\D+/g, '') : '';
      if (!tpl || !to || to.length < 11 || to.length > 15) {
        await pool.query(`UPDATE notifications SET whatsapp_sent_at = now() WHERE id = $1`, [row.id]);
        continue;
      }
      // Arabic templates — most of our customers are Arabic. Fall back to the
      // English variant if the 'ar' template isn't approved, so a missing Arabic
      // template doesn't leave the customer with NO WhatsApp (retrying forever).
      let res = await sendWhatsAppTemplate({ to, name: tpl.name, language: 'ar', params: tpl.params, fromStaff: true });
      if (!res.ok) {
        res = await sendWhatsAppTemplate({ to, name: tpl.name, language: 'en', params: tpl.params, fromStaff: true });
      }
      if (res.ok) {
        await pool.query(`UPDATE notifications SET whatsapp_sent_at = now() WHERE id = $1`, [row.id]);
        whatsapps++;
      } else {
        // Surface WHY a customer WhatsApp didn't go out (bad number, template
        // issue, Meta limit) instead of silently retrying forever.
        console.error(`[notify] whatsapp send FAILED template=${row.template} event=${row.event_id} to=${to}: ${res.error}`);
      }
      // Transient failure: leave whatsapp_sent_at NULL so the next sweep retries.
    }
  }

  // ---- WhatsApp (refund: apology for a quality issue, plain otherwise) ----
  // Order-keyed like the refund email, off the SAME email row (whatsapp_sent_at).
  // Quality issue / missing item → the apology template; a customer's own
  // cancellation or plain refund → the plain refund template. If the apology
  // template isn't approved yet, it falls back to the plain one so the customer
  // still gets a WhatsApp (and we don't retry forever).
  if (whatsappCustomerNotifyEnabled()) {
    const { rows } = await pool.query<any>(
      `SELECT n.id, o.id AS order_id,
              (n.payload->>'amountFils')     AS amount_fils,
              (n.payload->>'reasonCategory') AS reason_category,
              (n.payload->>'itemLabel')      AS item_label,
              COALESCE(o.event_id, n.event_id) AS event_ref,
              c.name AS customer_name, c.phone AS customer_phone
         FROM notifications n
         JOIN orders o    ON o.id = (n.payload->>'orderId')
         JOIN customers c ON c.id = o.customer_id
        WHERE n.channel = 'email' AND n.template = 'refund_processed'
          AND n.whatsapp_sent_at IS NULL AND n.cancelled_at IS NULL
          AND (n.scheduled_for IS NULL OR n.scheduled_for <= now())
        ORDER BY n.created_at LIMIT 100`,
    );
    for (const row of rows) {
      const e164 = toValidCustomerPhone(row.customer_phone);
      const to = e164 ? String(e164).replace(/\D+/g, '') : '';
      if (!to || to.length < 11 || to.length > 15) {
        await pool.query(`UPDATE notifications SET whatsapp_sent_at = now() WHERE id = $1`, [row.id]);
        continue;
      }
      const first = (row.customer_name || 'حبيبتنا').split(' ')[0];
      const amount = aed(Number(row.amount_fils ?? 0));
      const orderRef = row.event_ref || row.order_id;
      const apology = row.reason_category === 'quality_issue' || row.reason_category === 'missing_item';
      const item = (row.item_label && String(row.item_label).trim()) ? String(row.item_label).trim() : 'الخدمة';
      // Preferred template first, then a fallback template, each ar→en.
      const attempts: Array<{ name: string; params: string[] }> = apology
        ? [{ name: 'refund_apology', params: [first, item, amount] }, { name: 'refund_processed', params: [first, orderRef, amount] }]
        : [{ name: 'refund_processed', params: [first, orderRef, amount] }];
      let ok = false;
      for (const a of attempts) {
        let res = await sendWhatsAppTemplate({ to, name: a.name, language: 'ar', params: a.params, fromStaff: true });
        if (!res.ok) res = await sendWhatsAppTemplate({ to, name: a.name, language: 'en', params: a.params, fromStaff: true });
        if (res.ok) { ok = true; break; }
      }
      if (ok) {
        await pool.query(`UPDATE notifications SET whatsapp_sent_at = now() WHERE id = $1`, [row.id]);
        whatsapps++;
      } else {
        console.error(`[notify] refund whatsapp FAILED order=${row.order_id} to=${to}`);
      }
    }
  }

  // ---- Driver WhatsApp (operational: new order, change, cancellation) ----
  // The driver assigned to the event (event_staff role='driver') gets the
  // delivery details on WhatsApp. Only for events today or later; a row for an
  // event with no driver yet is left NULL and retried once assignment lands.
  if (whatsappDriverNotifyEnabled()) {
    const { rows } = await pool.query<DriverRow>(
      `SELECT n.id, n.template, n.event_id,
              to_char(e.event_date,'YYYY-MM-DD') AS event_date, e.start_time,
              e.emirate, e.address, e.map_lat, e.map_lng, e.location_note,
              e.celebration_type, o.cart, p.name AS package_name,
              drv.phone AS driver_phone,
              (SELECT COALESCE(es2.part_time_name, tm2.name)
                 FROM event_staff es2 LEFT JOIN team_members tm2 ON tm2.id = es2.assignee_id
                WHERE es2.event_id = e.id AND es2.role = 'driver' LIMIT 1) AS driver_assigned_name
         FROM notifications n
         JOIN events e ON e.id = n.event_id
         LEFT JOIN orders o ON o.id = e.order_id
         LEFT JOIN packages p ON p.id = e.package_id
         LEFT JOIN LATERAL (
           -- The assigned driver's phone. Resolve via the drivers roster by name
           -- (the typed part-timer name, or the internal assignee's name — so the
           -- auto-assigned Shan is covered by his roster row), falling back to the
           -- team member's own phone column.
           SELECT COALESCE(d.phone, tm.phone) AS phone
             FROM event_staff es
             LEFT JOIN team_members tm ON tm.id = es.assignee_id
             LEFT JOIN drivers d ON lower(d.name) = lower(COALESCE(es.part_time_name, tm.name))
            WHERE es.event_id = e.id AND es.role = 'driver'
              AND COALESCE(d.phone, tm.phone) IS NOT NULL
            LIMIT 1
         ) drv ON true
        WHERE n.channel = 'driver' AND n.whatsapp_sent_at IS NULL AND n.cancelled_at IS NULL
          AND e.event_date >= current_date
          AND (n.scheduled_for IS NULL OR n.scheduled_for <= now())
        ORDER BY n.scheduled_for NULLS FIRST
        LIMIT 100`,
    );
    for (const row of rows) {
      const tpl = driverTemplateFor(row);
      if (!tpl) {
        await pool.query(`UPDATE notifications SET whatsapp_sent_at = now() WHERE id = $1`, [row.id]);
        continue;
      }
      const to = String(row.driver_phone ?? '').replace(/\D+/g, '');
      if (!to) {
        const assignedName = (row as any).driver_assigned_name;
        if (assignedName) {
          // A driver IS assigned but has no phone on file (not in the drivers
          // roster / team_members) — nothing more we can do, so give up + log.
          console.error(`[driver-notify] no phone for driver "${assignedName}" on event ${row.event_id} (notif ${row.id}, ${tpl.name}) — giving up (add the driver's name+phone to DRIVERS_SEED if they should be notified)`);
          await pool.query(`UPDATE notifications SET whatsapp_sent_at = now() WHERE id = $1`, [row.id]);
        }
        // Else: NO driver assigned yet (e.g. a part-timer the manager assigns
        // later). Leave whatsapp_sent_at NULL so the next sweep sends it once a
        // driver lands — bounded because the query only selects future events, so
        // it naturally stops once the event date passes.
        continue;
      }
      const res = await sendWhatsAppTemplate({ to, name: tpl.name, language: 'en', params: tpl.params, fromStaff: true });
      if (res.ok) {
        await pool.query(`UPDATE notifications SET whatsapp_sent_at = now() WHERE id = $1`, [row.id]);
        whatsapps++;
      } else {
        // Previously failed silently and retried forever — now the failure is
        // logged (e.g. template not approved by Meta, or a bad number).
        console.error(`[driver-notify] send FAILED for notification ${row.id} (template ${tpl.name}): ${(res as any)?.error ?? 'unknown'}`);
      }
    }
  }

  // ---- Email (customer-facing: confirmation, reminders, cancellation) ----
  if (emailEnabled()) {
    const { rows } = await pool.query<EmailRow>(
      `SELECT n.id, n.template, n.event_id,
              -- Booking reference the customer sees: the linked sales-receipt
              -- number (EV-<number>), matching the dashboard; event_id fallback.
              (SELECT fr.number FROM finance_receipts fr
                WHERE fr.event_id = e.id OR (e.order_id IS NOT NULL AND fr.order_id = e.order_id)
                ORDER BY (fr.event_id = e.id) DESC, fr.id LIMIT 1) AS receipt_number,
              e.event_date, e.start_time, e.base_end_time, e.emirate, e.eta,
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
          AND n.template NOT IN ('addon_invoice', 'refund_processed')
          -- No dated customer email while the event date is unconfirmed (TBD):
          -- a confirmation/reminder with a placeholder date must never go out.
          AND (e.date_tbd IS NOT TRUE OR n.template IN ('event_cancelled','cancellation_refund'))
          -- SAFETY: same guard as the WhatsApp sweep — a pre-event email is never
          -- sent for a past/back-dated event (QuickBooks-converted history, etc.).
          -- Fails safe: a skipped send, never a wrong blast to an old customer.
          AND (
                e.event_date >= current_date
             OR n.template IN ('event_cancelled','cancellation_refund')
             OR (n.template = 'feedback_request' AND e.event_date >= current_date - interval '95 days')
          )
          -- Never send a feedback email in the middle of the night: only between
          -- 10:00 and 20:00 Dubai. A row that comes due outside that window is
          -- held and sent on the next sweep inside civil hours.
          AND (n.template <> 'feedback_request'
               OR extract(hour from now() AT TIME ZONE 'Asia/Dubai') BETWEEN 10 AND 19)
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
      } else {
        // Surface WHY a customer email didn't go out (Resend rate/cap, bad
        // address, disabled key) instead of silently retrying forever.
        console.error(`[notify] email send FAILED template=${row.template} event=${row.event_id} to=${row.customer_email}: ${res.error}`);
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

  // ---- Email (shop design ready: the finished artwork, keyed by order id) ----
  if (emailEnabled()) {
    const { rows } = await pool.query<{ id: number; order_id: string; customer_name: string | null; customer_email: string | null; image_url: string }>(
      `SELECT n.id, o.id AS order_id,
              c.name AS customer_name, c.email AS customer_email,
              (n.payload->>'imageUrl') AS image_url
         FROM notifications n
         JOIN orders o    ON o.id = (n.payload->>'orderId')
         JOIN customers c ON c.id = o.customer_id
        WHERE n.channel = 'email' AND n.template = 'shop_design_ready'
          AND n.sent_at IS NULL AND n.cancelled_at IS NULL
          AND (n.scheduled_for IS NULL OR n.scheduled_for <= now())
        ORDER BY n.created_at LIMIT 100`,
    );
    for (const row of rows) {
      if (!row.customer_email || !row.image_url) {
        await pool.query(`UPDATE notifications SET sent_at = now() WHERE id = $1`, [row.id]);
        continue;
      }
      const first = (row.customer_name || 'there').split(' ')[0];
      const html = shell({
        first, emoji: '🎨', eyebrow: 'Your Design',
        heading: 'Your design is ready!',
        bodyHtml: `<p style="margin:0 0 10px;font-size:15px;line-height:1.6">Thank you for your order! 💛 Your design is ready — here it is:</p>
          <img src="${row.image_url}" alt="Your Eventana design" style="max-width:100%;border-radius:14px;border:1px solid ${HAIR};margin:6px 0" />
          <p style="margin:14px 0 0;font-size:15px;line-height:1.6">We hope you love it! If you need anything, just reply to this email. 💕</p>`,
      });
      // Best-effort: also attach the design as downloadable files (the image
      // itself, plus a PDF wrapping it for JPEGs). Any failure here must NEVER
      // block the email — fall back to the inline-only send below.
      let attachments: Array<{ filename: string; content: string; contentType?: string }> | undefined;
      try {
        const resp = await fetch(row.image_url);
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          const ct = (resp.headers.get('content-type') || '').toLowerCase();
          const urlLower = row.image_url.toLowerCase();
          const isPng = ct.includes('png') || /\.png(?:[?#]|$)/.test(urlLower);
          const kind: 'jpeg' | 'png' = isPng ? 'png' : 'jpeg';
          const imgContentType = isPng ? 'image/png' : 'image/jpeg';
          const imgExt = isPng ? 'png' : 'jpg';
          attachments = [
            { filename: `Eventana-invitation.${imgExt}`, content: buf.toString('base64'), contentType: imgContentType },
          ];
          const pdf = imageToPdf(buf, kind);
          if (pdf) {
            attachments.push({ filename: 'Eventana-invitation.pdf', content: pdf.toString('base64'), contentType: 'application/pdf' });
          }
        }
      } catch {
        attachments = undefined; // fall back to inline-only
      }
      const res = await sendEmail({ to: row.customer_email, subject: 'Your Eventana design is ready 🎨', html, ...(attachments ? { attachments } : {}) });
      if (res.ok) {
        await pool.query(`UPDATE notifications SET sent_at = now() WHERE id = $1`, [row.id]);
        // Design delivered — the order is done; mark it completed so it drops
        // off Home's "Upcoming" shop list (which filters status = 'paid').
        await pool.query(`UPDATE orders SET status = 'completed' WHERE id = $1`, [row.order_id]);
        emails++;
      }
    }
  }

  // ---- Email (add-on updated invoice: keyed by the add-on order id) ----
  if (emailEnabled()) {
    const { rows } = await pool.query<AddonEmailRow>(
      `SELECT n.id, e.id AS event_id, to_char(e.event_date,'YYYY-MM-DD') AS event_date,
              -- Booking reference the customer sees: the linked sales-receipt
              -- number (EV-<number>), matching the dashboard; event_id fallback.
              (SELECT fr.number FROM finance_receipts fr
                WHERE fr.event_id = e.id OR (e.order_id IS NOT NULL AND fr.order_id = e.order_id)
                ORDER BY (fr.event_id = e.id) DESC, fr.id LIMIT 1) AS receipt_number,
              e.start_time, e.emirate, oc.cart AS event_cart, p.name AS package_name,
              c.name AS customer_name, c.email AS customer_email,
              ao.quote AS addon_quote, ao.total_fils AS addon_total,
              (SELECT COALESCE(SUM(x.total_fils),0) FROM orders x
                 WHERE x.status IN ('paid','captured','confirmed','succeeded')
                   AND (x.id = e.order_id OR (x.kind = 'addon' AND x.event_id = e.id))) AS new_total
         FROM notifications n
         JOIN orders ao   ON ao.id = (n.payload->>'orderId')
         JOIN events e    ON e.id = n.event_id
         JOIN customers c ON c.id = e.customer_id
         LEFT JOIN orders oc   ON oc.id = e.order_id
         LEFT JOIN packages p  ON p.id = e.package_id
        WHERE n.channel = 'email' AND n.template = 'addon_invoice'
          AND n.sent_at IS NULL AND n.cancelled_at IS NULL
          AND (n.scheduled_for IS NULL OR n.scheduled_for <= now())
        ORDER BY n.created_at
        LIMIT 100`,
    );
    for (const row of rows) {
      const msg = renderAddonEmail(row);
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

  // ---- Email (refund processed: keyed by ORDER, works with or without an
  //      event/cancellation — a plain refund and a shop refund both land here) ----
  if (emailEnabled()) {
    const { rows } = await pool.query<any>(
      `SELECT n.id, o.id AS order_id,
              (n.payload->>'amountFils')      AS amount_fils,
              (n.payload->>'reference')       AS reference,
              (n.payload->>'reasonCategory')  AS reason_category,
              COALESCE(o.event_id, n.event_id) AS event_ref,
              c.name AS customer_name, c.email AS customer_email,
              fr.number AS r_number, fr.line_items AS r_line_items,
              fr.discount_fils AS r_discount, fr.shipping_fils AS r_shipping, fr.total_fils AS r_total,
              fr.paid_with AS r_paid_with, fr.event_for AS r_event_for, fr.theme AS r_theme,
              fr.age AS r_age, fr.event_time AS r_event_time, fr.date AS r_date, fr.date_tbd AS r_date_tbd,
              fr.refunded_fils AS r_refunded, fr.refunded_items AS r_refunded_items
         FROM notifications n
         JOIN orders o    ON o.id = (n.payload->>'orderId')
         JOIN customers c ON c.id = o.customer_id
         LEFT JOIN finance_receipts fr ON fr.order_id = o.id
        WHERE n.channel = 'email' AND n.template = 'refund_processed'
          AND n.sent_at IS NULL AND n.cancelled_at IS NULL
          AND (n.scheduled_for IS NULL OR n.scheduled_for <= now())
        ORDER BY n.created_at LIMIT 100`,
    );
    for (const row of rows) {
      // Our fault (quality issue / missing item) → apology; customer's own
      // cancellation or a plain refund → confirmation, no apology wording.
      const apology = row.reason_category === 'quality_issue' || row.reason_category === 'missing_item';
      let msg: { subject: string; html: string } | null;
      if (row.r_number) {
        // Send the updated branded RECEIPT (with the refunded item + net total).
        const total = Number(row.r_total ?? 0);
        const refunded = Number(row.r_refunded ?? 0) || 0;
        msg = renderFinanceDocEmail({
          number: String(row.r_number), customer_name: row.customer_name,
          date: row.r_date, date_tbd: row.r_date_tbd,
          lineItems: Array.isArray(row.r_line_items) ? row.r_line_items : [],
          discount_fils: Number(row.r_discount ?? 0), shipping_fils: Number(row.r_shipping ?? 0),
          total_fils: total, paid_with: row.r_paid_with,
          event_for: row.r_event_for, theme: row.r_theme, age: row.r_age, event_time: row.r_event_time,
          refundedFils: refunded, netTotalFils: total - refunded,
          refundedItems: Array.isArray(row.r_refunded_items) ? row.r_refunded_items : [],
        }, 'receipt', { refundMode: apology ? 'apology' : 'confirmation' });
      } else {
        // No linked receipt (e.g. a shop order) → the plain refund card.
        msg = renderEmail({
          template: 'refund_processed',
          customer_name: row.customer_name,
          order_ref: row.event_ref || row.order_id,
          event_id: row.event_ref || row.order_id,
          refund_amount_fils: Number(row.amount_fils ?? 0),
          refund_reference: row.reference,
        } as unknown as EmailRow);
      }
      if (!msg || !row.customer_email) {
        await pool.query(`UPDATE notifications SET sent_at = now() WHERE id = $1`, [row.id]);
        continue;
      }
      const res = await sendEmail({ to: row.customer_email, subject: msg.subject, html: msg.html });
      if (res.ok) { await pool.query(`UPDATE notifications SET sent_at = now() WHERE id = $1`, [row.id]); emails++; }
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
        const memberId = row.payload?.memberId ? String(row.payload.memberId) : '';
        const data = { eventId: String(row.payload?.eventId ?? '') };
        if (memberId) {
          // A tip aimed at one crew member — notify only THEM ("you received…").
          await pushToOwner('staff', memberId, 'You received a tip! 💐', `A ${formatAed(amt)} tip just arrived for you — thank you!`, data);
        } else {
          // A whole-team tip goes to everyone.
          await pushToStaff('Team tip received 💐', `A tip of ${formatAed(amt)} just arrived for the team — thank you!`, data);
        }
        pushes++;
      }
      // payment_failed / others carry no deliverable recipient — just clear them
      // (the customer already sees the failure on the return screen).
      await pool.query(`UPDATE notifications SET sent_at = now() WHERE id = $1`, [row.id]);
    } catch {
      // Leave for the next sweep.
    }
  }

  return { emails, pushes, whatsapps };
}

/** A firm balance-due reminder email for an unpaid / part-paid invoice. */
export function renderInvoiceReminder(doc: {
  number: string; customerName?: string | null; balanceFils: number;
  issueDate?: unknown; lineItems?: unknown; payUrl?: string | null;
}): { subject: string; html: string } {
  const first = cap(String(doc.customerName ?? 'there').trim().split(/\s+/)[0] || 'there');
  const since = longDate(doc.issueDate);
  const items = (Array.isArray(doc.lineItems) ? doc.lineItems : [])
    .map((l: any) => String(l?.name ?? '').trim()).filter(Boolean);
  const orderLine = items.length ? items.join(', ') : 'your order';
  const rows: Array<[string, string]> = [
    ['Invoice', `#${doc.number}`],
    ['For', orderLine],
    ['Outstanding since', since],
    ['Balance due', aed(doc.balanceFils)],
  ];
  const body =
    `<p style="margin:0 0 10px;font-size:15px;line-height:1.6">This is a reminder that <b>${aed(doc.balanceFils)}</b> remains outstanding on <b>Invoice #${doc.number}</b>, unpaid since <b>${since}</b> for ${orderLine}. Please settle the balance now to avoid any legal complaint.</p>` +
    detailCard(rows) +
    (doc.payUrl
      ? `<p style="margin:16px 0 6px;font-size:14px;line-height:1.6">You can pay the balance securely here:</p>`
      : `<p style="margin:16px 0 6px;font-size:14px;line-height:1.6">Please arrange payment at your earliest convenience.</p>`) +
    `<p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:${MUTED}">This is an automated daily reminder and will continue until the balance is cleared.</p>`;
  const html = shell({
    first, emoji: '🧾', eyebrow: 'Payment reminder', heading: 'Your balance is due',
    bodyHtml: body,
    cta: doc.payUrl ? { href: doc.payUrl, label: 'Pay the balance' } : undefined,
  });
  return { subject: `Payment reminder: balance due on Invoice #${doc.number}`, html };
}

/**
 * Daily dunning sweep: email the outstanding balance to every invoice the owner
 * opted into (remind_daily = true), at most once per day, until it is paid.
 * WhatsApp business-initiated messages need an approved Meta template, so that
 * channel is skipped until one exists — email goes out now.
 */
export async function sendInvoiceBalanceReminders(): Promise<{ sent: number }> {
  const { rows } = await pool.query(`
    SELECT i.id, i.number, i.customer_name, i.total_fils, i.amount_paid_fils, i.issue_date,
           i.line_items, i.pay_url, hc.email
      FROM finance_invoices i
      LEFT JOIN historical_customers hc ON hc.id = i.customer_id
     WHERE i.remind_daily = TRUE
       AND i.total_fils > i.amount_paid_fils
       AND (i.last_reminded_at IS NULL OR i.last_reminded_at < date_trunc('day', now()))
     LIMIT 50`);
  let sent = 0;
  for (const inv of rows as any[]) {
    try {
      const balance = Number(inv.total_fils) - Number(inv.amount_paid_fils ?? 0);
      if (balance <= 0) continue;
      if (inv.email && emailEnabled()) {
        const msg = renderInvoiceReminder({
          number: inv.number, customerName: inv.customer_name, balanceFils: balance,
          issueDate: inv.issue_date, lineItems: inv.line_items, payUrl: inv.pay_url,
        });
        const res = await sendEmail({ to: inv.email, subject: msg.subject, html: msg.html });
        if (res.ok) sent += 1;
      }
      // Throttle to once per day regardless of the channel outcome.
      await pool.query(`UPDATE finance_invoices SET last_reminded_at = now() WHERE id = $1`, [inv.id]);
    } catch (e) {
      console.error('[invoice-reminder] failed for', inv.id, (e as Error).message);
    }
  }
  return { sent };
}
