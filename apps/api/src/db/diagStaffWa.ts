/**
 * Tiny diagnostic: report whether staff WhatsApp notifications are switched on,
 * so we know if a "new task" ping could have reached a staff member's WhatsApp.
 * Gated DIAG_STAFF_WA=true. Read-only. Turn the flag off after.
 */
import { config } from '../config.js';
import { pool } from './pool.js';
import { pushEnabled } from '../integrations/push.js';

export async function diagStaffWaFromEnv(): Promise<void> {
  if (String(process.env.DIAG_STAFF_WA ?? '').toLowerCase() !== 'true') return;
  const staffNotify = config.whatsapp.staffNotify;
  console.log(`[diag-wa] staffNotify(WHATSAPP_STAFF_NOTIFY)=${staffNotify} · fcmPush=${pushEnabled()}`);
  const { rows } = await pool.query<{ name: string; phone: string | null }>(
    `SELECT name, phone FROM team_members WHERE lower(name) = 'gloria'`,
  );
  const g = rows[0];
  console.log(`[diag-wa] Gloria phone on file=${g?.phone ? 'yes' : 'no'} → staff WhatsApp would ${staffNotify && g?.phone ? 'SEND' : 'NOT send'}`);
}
