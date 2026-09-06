/**
 * Feedback reminders.
 *
 * When a party ends the customer is asked for feedback right away (the
 * `feedback_request` email + WhatsApp that fire on completion). If they don't
 * rate it, we send a gentle reminder every 3 days for up to two weeks — then
 * stop. The moment they submit any rating the reminders stop instantly
 * (cancelPendingFeedbackNotifications, called from the rating routes).
 *
 * Reuses the SAME approved `feedback_request` template, so the reminder carries
 * the owner's exact Arabic WhatsApp wording and the same signed feedback link —
 * one `channel='email'` notification row drives BOTH the email and the WhatsApp
 * send (each stamped independently by deliverPendingNotifications).
 *
 * Safe by construction:
 *  - only events completed 3–14 days ago (never a mass blast to old history),
 *  - never more than 4 reminders per event, and at most one every 3 days,
 *  - never stacks on a feedback ask that hasn't been delivered yet,
 *  - the team's own test bookings are excluded,
 *  - `list` mode sends NOTHING — it just returns who WOULD be reminded, so the
 *    owner can approve the recipients before a single message goes out.
 */
import { pool } from '../db/pool.js';
import { config } from '../config.js';

// Names that are the team's own test accounts, never real customers.
const INTERNAL_NAME_PARTS = ['sheem', 'shaima', 'gloria', 'dindo', 'jane', 'diana', 'marsha', 'razan', 'noon', 'shan', 'test', 'qa', 'demo'];

function maskEmail(e: string | null): string {
  const [u, d] = String(e ?? '').split('@');
  if (!d) return '(no email)';
  return `${u.slice(0, 2)}•••@${d}`;
}

export interface FeedbackReminderCandidate {
  eventId: string;
  customerId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  eventDate: string;
  reminderCount: number;
}

/**
 * Events that should get a feedback reminder right now — completed 3–14 days
 * ago, still unrated, fewer than 4 reminders sent, and none sent in the last 3
 * days. The team's own test bookings are filtered out in JS below.
 */
export async function findFeedbackReminderDue(): Promise<FeedbackReminderCandidate[]> {
  const { rows } = await pool.query(
    `SELECT e.id AS event_id, to_char(e.event_date,'YYYY-MM-DD') AS event_date,
            e.feedback_reminder_count,
            c.id AS customer_id, c.name, c.email, c.phone
       FROM events e
       JOIN customers c ON c.id = e.customer_id
      WHERE e.cancelled_at IS NULL
        AND e.phase = 'Event Completed'
        AND e.date_tbd IS NOT TRUE
        -- The party is over (≥3 days ago) but still recent (≤14 days) — the
        -- two-week reminder window. Older events are left alone forever.
        AND e.event_date <= current_date - interval '3 days'
        AND e.event_date >= current_date - interval '14 days'
        -- No rating yet. A single event_ratings row (guest 3-step OR signed-in)
        -- means feedback was given → they drop out immediately.
        AND NOT EXISTS (SELECT 1 FROM event_ratings r WHERE r.event_id = e.id)
        -- Cap at 4 reminders, one every 3 days.
        AND e.feedback_reminder_count < 4
        AND (e.feedback_reminded_at IS NULL OR e.feedback_reminded_at < now() - interval '3 days')
        -- Don't stack on a feedback ask that still hasn't been e-mailed out.
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
           WHERE n.event_id = e.id AND n.template = 'feedback_request'
             AND n.channel = 'email' AND n.cancelled_at IS NULL AND n.sent_at IS NULL)
        -- Need at least one way to reach them.
        AND ((c.email IS NOT NULL AND btrim(c.email) <> '')
          OR (c.phone IS NOT NULL AND btrim(c.phone) <> ''))
      ORDER BY e.event_date ASC
      LIMIT 200`,
  );

  const staff = await pool.query<{ e: string }>(
    `SELECT lower(btrim(email)) e FROM team_members WHERE email IS NOT NULL AND btrim(email) <> ''`,
  );
  const staffEmails = new Set(staff.rows.map((r) => r.e));
  const ownerEmail = String(config.email.financeReportTo?.[0] ?? '').toLowerCase();

  const out: FeedbackReminderCandidate[] = [];
  for (const r of rows) {
    const name = String(r.name ?? '').toLowerCase();
    const email = String(r.email ?? '').toLowerCase();
    if (email && staffEmails.has(email)) continue;          // a staff member's own try-out
    if (email && email === ownerEmail) continue;            // the owner's test account
    if (email && (email.includes('test') || email.includes('example.'))) continue;
    if (INTERNAL_NAME_PARTS.some((w) => name.includes(w))) continue;
    out.push({
      eventId: r.event_id,
      customerId: r.customer_id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      eventDate: r.event_date,
      reminderCount: Number(r.feedback_reminder_count),
    });
  }
  return out;
}

/**
 * Queue one feedback reminder (email + WhatsApp, from a single row) for every
 * due event and stamp the cadence. deliverPendingNotifications does the actual
 * sending on this/the next sweep. Idempotent per 3-day window per event.
 */
export async function sendFeedbackReminders(): Promise<{ due: number; queued: number }> {
  const due = await findFeedbackReminderDue();
  let queued = 0;
  for (const d of due) {
    try {
      await pool.query(
        `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
         VALUES ($1, 'email', 'feedback_request', now(),
                 jsonb_build_object('eventId', $1::text, 'reminder', true))`,
        [d.eventId],
      );
      await pool.query(
        `UPDATE events
            SET feedback_reminded_at = now(),
                feedback_reminder_count = feedback_reminder_count + 1
          WHERE id = $1`,
        [d.eventId],
      );
      queued++;
    } catch (err) {
      console.error(`[feedback-reminder] queue failed for ${d.eventId}:`, (err as Error).message);
    }
  }
  return { due: due.length, queued };
}

/**
 * Stop every pending feedback ask/reminder for an event — called the instant a
 * rating is submitted. Cancels any feedback_request row that hasn't fully gone
 * out yet (either channel still pending), so no further email OR WhatsApp fires.
 */
export async function cancelPendingFeedbackNotifications(eventId: string): Promise<void> {
  await pool.query(
    `UPDATE notifications
        SET cancelled_at = now()
      WHERE event_id = $1 AND template = 'feedback_request'
        AND cancelled_at IS NULL
        AND (sent_at IS NULL OR whatsapp_sent_at IS NULL)`,
    [eventId],
  ).catch((err) => console.error(`[feedback-reminder] cancel failed for ${eventId}:`, (err as Error).message));
}

/**
 * Recurring sweep for the reconcile loop. Only sends once the owner switches it
 * on with FEEDBACK_REMINDERS=send; off/unset means nothing is sent.
 */
export async function sweepFeedbackReminders(): Promise<void> {
  if (String(process.env.FEEDBACK_REMINDERS ?? '').toLowerCase() !== 'send') return;
  const res = await sendFeedbackReminders();
  if (res.queued) console.log(`[feedback-reminder] sweep queued ${res.queued} reminder(s)`);
}

/**
 * Boot entry. FEEDBACK_REMINDERS=list logs who WOULD be reminded (sends
 * nothing). FEEDBACK_REMINDERS=send queues due reminders once now (and the
 * recurring sweep keeps them going). Anything else is a no-op.
 */
export async function feedbackRemindersFromEnv(): Promise<void> {
  const mode = String(process.env.FEEDBACK_REMINDERS ?? '').toLowerCase();
  if (mode !== 'list' && mode !== 'send') return;
  try {
    const due = await findFeedbackReminderDue();
    console.log(`[feedback-reminder] events awaiting feedback, due for a reminder now: ${due.length}`);
    for (const d of due) {
      console.log(`[feedback-reminder]   ${d.eventId} · party ${d.eventDate} · reminders so far ${d.reminderCount} · ${d.name ?? '(no name)'} · ${maskEmail(d.email)} · ${d.phone ? 'has WhatsApp' : 'no phone'}`);
    }
    if (mode === 'send') {
      const res = await sendFeedbackReminders();
      console.log(`[feedback-reminder] QUEUED: ${res.queued} of ${res.due} (delivery happens on the next notify sweep)`);
    } else {
      console.log('[feedback-reminder] list mode — nothing queued. Set FEEDBACK_REMINDERS=send to start reminders.');
    }
  } catch (err) {
    console.error('[feedback-reminder] failed:', (err as Error).message);
  }
}
