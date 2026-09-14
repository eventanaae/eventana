/**
 * One-shot: assign Marsha a manual task (from the owner) to get Tabby & Tamara
 * live, with today's deadline, and notify her (in-app + WhatsApp). Gated by
 * ADD_MARSHA_TASK=true. Idempotent: skips if the same title is already assigned
 * to Marsha. Turn the flag off after it runs.
 */
import { pool } from './pool.js';
import { createManualTask } from '../domain/prep.js';

const MARSHA = 'tm-marsha';
const TITLE = 'Activate Tabby & Tamara — get production API keys, send to Shaima';
const NOTE = 'Contact Tabby and Tamara through their merchant portal / support (ready messages are in your email) to activate our LIVE accounts and get the PRODUCTION API credentials — Tabby: Secret Key, Merchant Code, Webhook Secret · Tamara: API Token, Notification Token. Then send them to Shaima. Must be production (not test) keys.';

export async function addMarshaTaskFromEnv(): Promise<void> {
  if (String(process.env.ADD_MARSHA_TASK ?? '').toLowerCase() !== 'true') return;
  const dup = await pool.query(
    `SELECT 1 FROM prep_tasks pt JOIN prep_task_staff pts ON pts.task_id = pt.id
      WHERE pts.member_id = $1 AND pt.category = 'manual' AND pt.title = $2 LIMIT 1`,
    [MARSHA, TITLE],
  );
  if (dup.rows[0]) { console.log('[add-marsha-task] already assigned — skipped'); return; }
  const today = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10); // Dubai
  const r = await createManualTask({ title: TITLE, memberIds: [MARSHA], dueDate: today, note: NOTE, actor: 'Sheem', notify: true });
  console.log(`[add-marsha-task] ${r ? `created task ${r.id}, deadline ${today}, Marsha notified` : 'FAILED to create'}`);
}
