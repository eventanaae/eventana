/**
 * One-shot READ-ONLY audit: dump every email_campaign with its real status +
 * send info, so we can tell the owner EXACTLY what was sent and what wasn't
 * (she believed Teacher's Day / Halloween were sent, but they show as drafts).
 *
 * Triggered by reusing SET_SHAN_LEADER='campaudit' (Render 300 env-var cap).
 * Blank the env after. Logs only — changes nothing.
 */
import { pool } from './pool.js';

export async function campaignAuditFromEnv(): Promise<void> {
  if (process.env.SET_SHAN_LEADER !== 'campaudit') return;
  const { rows } = await pool.query<{
    id: string; subject: string; audience: string; status: string;
    recipient_count: number; sent_count: number; sent_at: string | null;
    scheduled_for: string | null; created_at: string; source: string | null;
  }>(
    `SELECT id, subject, audience, status, recipient_count, sent_count,
            to_char(sent_at,'YYYY-MM-DD HH24:MI') AS sent_at,
            to_char(scheduled_for,'YYYY-MM-DD HH24:MI') AS scheduled_for,
            to_char(created_at,'YYYY-MM-DD') AS created_at, source
       FROM email_campaigns ORDER BY created_at DESC LIMIT 60`,
  ).catch((e) => { console.error('[camp-audit] query failed:', e); return { rows: [] as any[] }; });

  const counts = await pool.query<{ status: string; c: string }>(
    `SELECT status, count(*)::int c FROM email_campaigns GROUP BY status ORDER BY status`,
  ).catch(() => ({ rows: [] as { status: string; c: string }[] }));

  console.log(`[camp-audit] ==== STATUS TOTALS ====`);
  for (const r of counts.rows) console.log(`[camp-audit]   ${r.status}: ${r.c}`);
  console.log(`[camp-audit] ==== CAMPAIGNS (newest 60) ====`);
  for (const r of rows) {
    const aud = r.audience?.startsWith('corp') ? `COMPANY(${r.audience})` : r.audience;
    console.log(`[camp-audit] #${r.id} [${r.status}] sent=${r.sent_count}/${r.recipient_count} sent_at=${r.sent_at ?? '-'} sched=${r.scheduled_for ?? '-'} created=${r.created_at} aud=${aud} :: ${String(r.subject).slice(0, 60)}`);
  }
  console.log(`[camp-audit] DONE — blank SET_SHAN_LEADER now.`);
}
