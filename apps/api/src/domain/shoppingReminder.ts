/**
 * Two weekly team WhatsApps, both via the staff WhatsApp mirror (so they need
 * WHATSAPP_STAFF_NOTIFY on + the staff_alert template approved), each deduped to
 * once per day:
 *   • TUESDAY — heads-up that tomorrow (Wednesday) is the missing-items shopping
 *     run, with the current list they've reported, so they can finalise it.
 *   • Each member, on THEIR OWN weekly day off — a warm "enjoy your day off"
 *     message (days off are split across the team, so this is per-person).
 * Runs from the reconcile loop. Dow via Postgres/getUTCDay: 0=Sun … 6=Sat.
 */
import { pool } from '../db/pool.js';
import { staffWhatsApp } from '../integrations/push.js';

async function dubaiNow(): Promise<{ dow: number; hr: number }> {
  const { rows } = await pool.query<{ dow: number; hr: number }>(
    `SELECT extract(dow from now() AT TIME ZONE 'Asia/Dubai')::int AS dow,
            extract(hour from now() AT TIME ZONE 'Asia/Dubai')::int AS hr`,
  );
  return rows[0] ?? { dow: -1, hr: -1 };
}

async function sentToday(template: string): Promise<boolean> {
  const dup = await pool.query(
    `SELECT 1 FROM notifications
      WHERE template = $1
        AND (created_at AT TIME ZONE 'Asia/Dubai')::date = (now() AT TIME ZONE 'Asia/Dubai')::date
      LIMIT 1`,
    [template],
  );
  return (dup.rowCount ?? 0) > 0;
}

async function markSent(template: string, payload: Record<string, unknown> = {}): Promise<void> {
  await pool.query(
    `INSERT INTO notifications (channel, template, scheduled_for, payload) VALUES ('ops_alert',$1, now(), $2)`,
    [template, JSON.stringify(payload)],
  ).catch(() => {});
}

/** TUESDAY, late morning: the missing-items shopping heads-up + the current list. */
export async function sweepMissingItemsShoppingReminder(): Promise<number> {
  const { dow, hr } = await dubaiNow();
  if (dow !== 2 || hr < 10 || hr >= 12) return 0; // 2 = Tuesday, 10:00–11:59
  if (await sentToday('missing_shopping_reminder')) return 0;

  const { rows: items } = await pool.query<{ item: string; quantity: number; supplier: string | null }>(
    `SELECT item, quantity, supplier FROM missing_items
      WHERE status NOT IN ('received','cancelled')
      ORDER BY created_at`,
  );
  const list = items.length
    ? items.map((m) => `• ${m.item}${m.quantity > 1 ? ` ×${m.quantity}` : ''}${m.supplier ? ` (${m.supplier})` : ''}`).join('\n')
    : '(nothing on the list yet)';
  const body = `Tomorrow (Wednesday) is the missing-items shopping run 🛒\n\nPlease make sure the list is complete today — add or fix anything you need in the app, with the supplier & location.\n\nHere's the current list:\n${list} 💛`;

  await staffWhatsApp('🛒 Have the shopping list ready — shopping tomorrow', body);
  await markSent('missing_shopping_reminder', { items: items.length });
  console.log(`[shopping-reminder] sent Tuesday reminder with ${items.length} item(s)`);
  return 1;
}

/** A warm break-and-recharge message to each member whose weekly day off is today. */
export async function sweepDayOffMessage(): Promise<number> {
  const { dow, hr } = await dubaiNow();
  if (hr < 9 || hr >= 11) return 0; // morning window, on whichever day
  if (await sentToday('team_dayoff_wellbeing')) return 0;

  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM team_members
      WHERE active AND weekly_day_off = $1 AND phone IS NOT NULL AND phone <> ''`,
    [dow],
  );
  if (rows.length === 0) return 0;

  const body = `Take a real break today — rest, and do something that makes you happy 💛\nA walk, good food, time with people you love… something that fills your cup 🌿\nYou've earned it. See you refreshed! 🌸`;
  for (const m of rows) {
    await staffWhatsApp("🌿 It's your day off — enjoy every moment!", body, m.id);
  }
  await markSent('team_dayoff_wellbeing', { members: rows.length });
  console.log(`[dayoff-message] sent wellbeing to ${rows.length} member(s) off today`);
  return rows.length;
}
