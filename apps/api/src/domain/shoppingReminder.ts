/**
 * Weekly shopping-day reminder. Every Tuesday (Dubai time), WhatsApp the team a
 * heads-up that tomorrow is the missing-items shopping run, together with the
 * current outstanding list they've already reported in the system — so they can
 * add or fix anything before Wednesday. Runs from the reconcile loop; deduped to
 * once per Tuesday. Uses the same staff WhatsApp mirror, so it needs
 * WHATSAPP_STAFF_NOTIFY on and the staff_alert template approved.
 */
import { pool } from '../db/pool.js';
import { staffWhatsApp } from '../integrations/push.js';

export async function sweepMissingItemsShoppingReminder(): Promise<number> {
  // Tuesday, late morning Dubai — one send, deduped by day.
  const { rows: t } = await pool.query<{ dow: number; hr: number }>(
    `SELECT extract(dow from now() AT TIME ZONE 'Asia/Dubai')::int AS dow,
            extract(hour from now() AT TIME ZONE 'Asia/Dubai')::int AS hr`,
  );
  const { dow, hr } = t[0] ?? { dow: -1, hr: -1 };
  if (dow !== 2 || hr < 10 || hr >= 12) return 0; // 2 = Tuesday, 10:00–11:59

  const dup = await pool.query(
    `SELECT 1 FROM notifications
      WHERE template = 'missing_shopping_reminder'
        AND (created_at AT TIME ZONE 'Asia/Dubai')::date = (now() AT TIME ZONE 'Asia/Dubai')::date
      LIMIT 1`,
  );
  if (dup.rowCount) return 0;

  const { rows: items } = await pool.query<{ item: string; quantity: number; supplier: string | null }>(
    `SELECT item, quantity, supplier FROM missing_items
      WHERE status NOT IN ('received','cancelled')
      ORDER BY created_at`,
  );
  const list = items.length
    ? items.map((m) => `• ${m.item}${m.quantity > 1 ? ` ×${m.quantity}` : ''}${m.supplier ? ` (${m.supplier})` : ''}`).join('\n')
    : '(nothing on the list yet)';

  const body = `Tomorrow is the missing-items shopping run 🛒\n\nHere's the current list:\n${list}\n\nIf anything needs adding or fixing, please update it in the app today — with the supplier & location. 💛`;

  await staffWhatsApp('🛒 Tomorrow is shopping day!', body);

  // Mark it sent so we don't repeat within the same Tuesday.
  await pool.query(
    `INSERT INTO notifications (channel, template, scheduled_for, payload)
     VALUES ('ops_alert','missing_shopping_reminder', now(), $1)`,
    [JSON.stringify({ items: items.length })],
  ).catch(() => {});
  console.log(`[shopping-reminder] sent Tuesday reminder with ${items.length} item(s)`);
  return 1;
}
