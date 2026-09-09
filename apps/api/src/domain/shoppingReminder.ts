/**
 * Team WhatsApps around the Wednesday shopping run + days off, via the staff
 * WhatsApp mirror (needs WHATSAPP_STAFF_NOTIFY on + staff_alert approved). Each
 * is deduped once per day and targeted to specific people:
 *   • The day BEFORE each person's day off, remind them to finalise the missing-
 *     items list — so it's ready for Wednesday's shopping and nothing's forgotten
 *     while they're off. (Mon → the Tuesday-off crew; Tue → the Wednesday-off crew.)
 *   • On each person's OWN day off, a warm "enjoy your day off" message.
 * The driver (Shan) doesn't report items, so he's skipped for the list reminder
 * (but still gets the day-off message). Dow via Postgres/getUTCDay: 0=Sun … 6=Sat.
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

async function currentList(): Promise<{ text: string; count: number }> {
  const { rows } = await pool.query<{ item: string; quantity: number; supplier: string | null }>(
    `SELECT item, quantity, supplier FROM missing_items
      WHERE status NOT IN ('received','cancelled') ORDER BY created_at`,
  );
  const text = rows.length
    ? rows.map((m) => `• ${m.item}${m.quantity > 1 ? ` ×${m.quantity}` : ''}${m.supplier ? ` (${m.supplier})` : ''}`).join('\n')
    : '(nothing on the list yet)';
  return { text, count: rows.length };
}

/**
 * Remind the crew going off tomorrow to finalise the missing-items list. Runs on
 * Monday (for the Tuesday-off crew) and Tuesday (for the Wednesday-off crew).
 * Skips the driver, who doesn't report items.
 */
export async function sweepShoppingListReminders(): Promise<number> {
  const { dow, hr } = await dubaiNow();
  if ((dow !== 1 && dow !== 2) || hr < 10 || hr >= 12) return 0; // Mon/Tue, 10:00–11:59
  const template = dow === 1 ? 'shop_reminder_mon' : 'shop_reminder_tue';
  if (await sentToday(template)) return 0;

  const tomorrow = (dow + 1) % 7;
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM team_members
      WHERE active AND weekly_day_off = $1
        AND phone IS NOT NULL AND phone <> ''
        AND COALESCE(access_level,'') <> 'driver' AND name NOT ILIKE 'shan%'`,
    [tomorrow],
  );
  if (rows.length === 0) return 0;

  const { text, count } = await currentList();
  const title = dow === 1 ? '🛒 Update missing items before your day off' : '🛒 Last chance — we shop tomorrow';
  const body = dow === 1
    ? `Tomorrow is your day off 🌴\nIf anything's missing, please update it now — we buy everything on Wednesday.\n\nCurrent list:\n${text} 💛`
    : `Please update the list today — tomorrow (Wednesday) is shopping day, there's no time left ⏳\n\nCurrent list:\n${text} 💛`;

  for (const m of rows) await staffWhatsApp(title, body, m.id);
  await markSent(template, { members: rows.length, items: count });
  console.log(`[shopping-reminder] ${template} → ${rows.length} member(s), ${count} item(s)`);
  return rows.length;
}

/**
 * WEDNESDAY (shopping day): send the driver the full list to buy, organised by
 * supplier + location (emirate) so his run is efficient — with the supplier name
 * and where to go for each.
 */
export async function sweepDriverShoppingList(): Promise<number> {
  const { dow, hr } = await dubaiNow();
  if (dow !== 3 || hr < 9 || hr >= 11) return 0; // Wednesday, 09:00–10:59
  if (await sentToday('driver_shopping_list')) return 0;

  const { rows: items } = await pool.query<{ item: string; quantity: number; supplier: string | null; location: string | null }>(
    `SELECT item, quantity, supplier, location FROM missing_items
      WHERE status NOT IN ('received','cancelled')
      ORDER BY supplier NULLS LAST, location NULLS LAST, created_at`,
  );
  if (items.length === 0) return 0;

  const drv = await pool.query<{ id: string }>(`SELECT id FROM team_members WHERE active AND name ILIKE 'shan%' LIMIT 1`);
  if (!drv.rows[0]) return 0;

  // Group by supplier + location so each stop is one block.
  const groups = new Map<string, { supplier: string; location: string | null; lines: string[] }>();
  for (const it of items) {
    const supplier = it.supplier?.trim() || 'Supplier not set';
    const key = `${supplier}||${it.location ?? ''}`;
    const g = groups.get(key) ?? { supplier, location: it.location ?? null, lines: [] };
    g.lines.push(`• ${it.item}${it.quantity > 1 ? ` ×${it.quantity}` : ''}`);
    groups.set(key, g);
  }
  const details = [...groups.values()]
    .map((g) => `🏬 ${g.supplier}${g.location ? ` (📍 ${g.location})` : ''}\n${g.lines.join('\n')}`)
    .join('\n\n');
  const headline = `🛒 Today's shopping run — ${items.length} item(s), sorted by shop & location:`;

  await staffWhatsApp(headline, details, drv.rows[0].id);
  await markSent('driver_shopping_list', { items: items.length });
  console.log(`[driver-shopping] sent Shan the organised list (${items.length} item(s))`);
  return 1;
}

/** A warm break-and-recharge message to each member whose day off is today. */
export async function sweepDayOffMessage(): Promise<number> {
  const { dow, hr } = await dubaiNow();
  if (hr < 9 || hr >= 11) return 0;
  if (await sentToday('team_dayoff_wellbeing')) return 0;

  const { rows } = await pool.query<{ id: string; name: string; phone: string }>(
    `SELECT id, name, phone FROM team_members WHERE active AND weekly_day_off = $1 AND phone IS NOT NULL AND phone <> ''`,
    [dow],
  );
  if (rows.length === 0) return 0;

  // Dedicated warm template (clean, no repeated name), sent directly — a day-off
  // wellbeing note is always welcome, like the birthday one.
  const { whatsappEnabled, sendWhatsAppTemplate } = await import('../integrations/whatsapp.js');
  const { STAFF_DAYOFF_TEMPLATE } = await import('../db/seedStaffDayoff.js');
  if (!whatsappEnabled()) return 0;
  for (const m of rows) {
    const first = String(m.name || '').trim().split(/\s+/)[0] || 'there';
    const to = String(m.phone || '').replace(/\D+/g, '');
    if (!to) continue;
    await sendWhatsAppTemplate({ to, name: STAFF_DAYOFF_TEMPLATE, language: 'en', params: [first], fromStaff: true }).catch(() => null);
  }
  await markSent('team_dayoff_wellbeing', { members: rows.length });
  console.log(`[dayoff-message] sent wellbeing to ${rows.length} member(s) off today`);
  return rows.length;
}

