/**
 * One-shot: send Gloria a short correction (in-app + WhatsApp) telling her to
 * ignore the "party themes" task she was pinged about earlier — it was
 * reassigned. Gated NOTIFY_GLORIA_FIX=true. Turn the flag off after it runs.
 */
import { pool } from './pool.js';
import { pushToOwner } from '../integrations/push.js';

export async function notifyGloriaFixFromEnv(): Promise<void> {
  if (String(process.env.NOTIFY_GLORIA_FIX ?? '').toLowerCase() !== 'true') return;
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM team_members WHERE lower(name) = 'gloria' LIMIT 1`);
  const id = rows[0]?.id;
  if (!id) { console.log('[gloria-fix] Gloria not found — skipped'); return; }
  const headline = "Please ignore the earlier ‘party themes’ task 🙏";
  const details = "It was reassigned — you don’t need to do it. Sorry for the mix-up, and enjoy your day off tomorrow! 💛";
  await pushToOwner('staff', id, headline, details, { correction: 'true' });
  console.log(`[gloria-fix] correction sent to Gloria (${id})`);
}
