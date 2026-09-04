/**
 * Read-only TASK-PROBLEM audit, logged to the boot log (no DB console needed).
 * Gated by TASK_AUDIT=true. Sends NOTHING, changes NOTHING — pure SELECTs.
 *
 * Diana reported: a problem raised on a task still shows after the task is
 * completed. The code clears every surface on completion, so this proves whether
 * any stale rows actually exist:
 *   1. prep_issue alerts whose task is already completed (orphaned alerts)
 *   2. event_tasks marked done/open that still carry a blocked_reason
 *   3. the prep tasks currently flagged as an issue (genuinely open)
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[task-audit] ${s}`);

export async function taskAuditFromEnv(): Promise<void> {
  if (process.env.TASK_AUDIT !== 'true') return;
  try {
    // 1) prep_issue notifications that point at a task which is now completed.
    const orphan = await pool.query(
      `SELECT n.id, n.event_id, n.payload->>'taskId' AS task_id, n.payload->>'title' AS title
         FROM notifications n
         JOIN prep_tasks pt ON pt.id::text = n.payload->>'taskId'
        WHERE n.template = 'prep_issue' AND pt.status = 'completed'`,
    );
    P(`orphaned prep_issue alerts (task already completed): ${orphan.rowCount}`);
    for (const r of orphan.rows.slice(0, 20)) P(`  alert#${r.id} event ${r.event_id} task ${r.task_id} · ${r.title}`);

    // 1b) prep_issue notifications whose task no longer exists at all.
    const ghost = await pool.query(
      `SELECT count(*)::int c FROM notifications n
        WHERE n.template = 'prep_issue'
          AND NOT EXISTS (SELECT 1 FROM prep_tasks pt WHERE pt.id::text = n.payload->>'taskId')`,
    );
    P(`prep_issue alerts whose task no longer exists: ${ghost.rows[0].c}`);

    // 2) event_tasks that are done/open but still carry a blocked_reason.
    const staleBlocked = await pool.query(
      `SELECT id, event_id, department, title, status, blocked_reason
         FROM event_tasks
        WHERE status <> 'blocked' AND blocked_reason IS NOT NULL AND btrim(blocked_reason) <> ''`,
    );
    P(`event_tasks not blocked but still carrying a reason: ${staleBlocked.rowCount}`);
    for (const r of staleBlocked.rows.slice(0, 20)) P(`  task#${r.id} event ${r.event_id} [${r.status}] ${r.title} · reason: ${r.blocked_reason}`);

    // 3) genuinely open prep issues right now (for context).
    const openIssues = await pool.query(
      `SELECT pt.id, pt.event_id, pt.title, pt.notes
         FROM prep_tasks pt WHERE pt.status = 'issue' ORDER BY pt.event_id`,
    );
    P(`prep tasks currently flagged 'issue' (genuinely open): ${openIssues.rowCount}`);
    for (const r of openIssues.rows.slice(0, 20)) P(`  task ${r.id} event ${r.event_id} · ${r.title} · ${r.notes ?? ''}`);
    P('done.');
  } catch (err) {
    console.error('[task-audit] failed:', (err as Error).message);
  }
}
