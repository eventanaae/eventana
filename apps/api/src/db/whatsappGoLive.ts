/**
 * WhatsApp customer-notify go-live helpers.
 *
 * The WhatsApp sweep (domain/notify.ts) delivers every eligible `notifications`
 * row whose `whatsapp_sent_at` is still NULL. That column has been NULL for the
 * whole life of the queue (the feature was dormant), so flipping
 * WHATSAPP_CUSTOMER_NOTIFY on without care would fire WhatsApp for every past
 * booking — reminders for parties that already happened.
 *
 * `sealWhatsAppBacklog` closes that hole: it stamps every currently-DUE eligible
 * row as already-sent, so only NEW activity (and future-scheduled reminders for
 * upcoming events, which stay NULL until their time) ever reaches WhatsApp.
 * Runs as a boot task BEFORE the reconcile loop starts — race-free — and only
 * when WHATSAPP_BACKLOG_SEAL=true. Idempotent (a second run seals nothing).
 */
import { pool } from '../db/pool.js';
import { config } from '../config.js';

// The customer-facing templates the WhatsApp sweep sends (mirror of the IN list
// in domain/notify.ts). event_cancelled has no WhatsApp template but is sealed
// too so it never lingers.
const ELIGIBLE = [
  'booking_confirmation', 'three_day_reminder', 'event_day', 'team_on_the_way',
  'team_arrived', 'setup_ready', 'feedback_request', 'event_cancelled', 'cancellation_refund',
];

export async function sealWhatsAppBacklogFromEnv(): Promise<void> {
  if (process.env.WHATSAPP_BACKLOG_SEAL !== 'true') return;
  const res = await pool.query(
    `UPDATE notifications
        SET whatsapp_sent_at = now()
      WHERE channel = 'email'
        AND whatsapp_sent_at IS NULL
        AND cancelled_at IS NULL
        AND template = ANY($1)
        AND (scheduled_for IS NULL OR scheduled_for <= now())`,
    [ELIGIBLE],
  );
  console.log(`[wa-seal] sealed ${res.rowCount} past/due notification(s) — only new + future-scheduled WhatsApp will send`);
}

/**
 * Log the approval status of the WhatsApp templates (read-only), so we can see
 * from the boot log whether Meta has approved them without touching the
 * automation-hostile WhatsApp Manager UI. Runs when WHATSAPP_WABA_ID is set.
 */
export async function logWhatsAppTemplateStatusesFromEnv(): Promise<void> {
  const waba = process.env.WHATSAPP_WABA_ID;
  if (!waba) return;
  const token = config.whatsapp.accessToken;
  if (!token) return;
  try {
    const url = `https://graph.facebook.com/${config.meta.graphVersion}/${waba}/message_templates?fields=name,language,status,category&limit=100`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const json = (await res.json()) as any;
    if (!res.ok) { console.log(`[wa-status] ${res.status} ${JSON.stringify(json).slice(0, 200)}`); return; }
    const rows: any[] = json.data ?? [];
    const approved = rows.filter((r) => r.status === 'APPROVED').length;
    console.log(`[wa-status] ${rows.length} templates: ${approved} approved`);
    for (const r of rows) console.log(`[wa-status] ${r.name} (${r.language}) ${r.status} [${r.category}]`);
  } catch (e) {
    console.log(`[wa-status] error ${(e as Error).message.slice(0, 160)}`);
  }
}
