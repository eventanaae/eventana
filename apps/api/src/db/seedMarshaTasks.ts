/**
 * Seed the owner's first batch of manual tasks for Marsha (tm-marsha), dictated
 * 2026-09-08. Gated by SEED_MARSHA_TASKS=true. Idempotent: skips any task whose
 * title is already assigned to Marsha. Seeds SILENTLY (notify=false) so she isn't
 * pinged for all six at once — she sees them in her dashboard "My tasks".
 */
import { pool } from './pool.js';
import { createManualTask } from '../domain/prep.js';

const MARSHA = 'tm-marsha';
const TASKS = [
  'Follow up: Dubai TV payment',
  'Renew licence on iSupply (Emirates NBD)',
  'Renew van registration (mulkiya)',
  'Pay van traffic fines',
  'Top up Salik',
  'Register Darb (Abu Dhabi toll)',
];

export async function seedMarshaTasksFromEnv(): Promise<void> {
  if (String(process.env.SEED_MARSHA_TASKS ?? '').toLowerCase() !== 'true') return;
  // Which of these titles does Marsha already have (any status)? Skip those.
  const existing = await pool.query<{ title: string }>(
    `SELECT DISTINCT pt.title FROM prep_tasks pt
       JOIN prep_task_staff pts ON pts.task_id = pt.id
      WHERE pts.member_id = $1 AND pt.category = 'manual' AND pt.title = ANY($2)`,
    [MARSHA, TASKS],
  );
  const have = new Set(existing.rows.map((r) => r.title));
  let created = 0;
  for (const title of TASKS) {
    if (have.has(title)) continue;
    const r = await createManualTask({ title, memberIds: [MARSHA], actor: 'Owner', notify: false });
    if (r) created++;
  }
  console.log(`[seed-marsha-tasks] created ${created} task(s), skipped ${TASKS.length - created} already present`);
}
