/**
 * On-demand booking diagnostic. Gated by DIAG_EVENTS=<eventId>[,<eventId>...].
 * For each event prints: its phase; every notification row (template / channel /
 * scheduled / sent / whatsapp-sent) so we can see what actually went out and
 * whether the link that was sent carried the signed token; and any saved rating.
 * Read-only.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[diag] ${s}`);

export async function diagFromEnv(): Promise<void> {
  const raw = String(process.env.DIAG_EVENTS ?? '').trim();
  if (!raw) return;
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  for (const id of ids) {
    try {
      const ev = await pool.query(
        `SELECT e.id, e.phase, e.customer_id, to_char(e.event_date,'YYYY-MM-DD') AS d,
                c.name, c.email
           FROM events e LEFT JOIN customers c ON c.id = e.customer_id WHERE e.id = $1`, [id]);
      if (!ev.rowCount) { P(`${id}: NOT FOUND`); continue; }
      const r = ev.rows[0];
      P(`${id} "${r.name}" <${r.email ?? '—'}> phase=${r.phase} account=${r.customer_id ?? 'NONE'} date=${r.d}`);

      const notes = await pool.query(
        `SELECT template, channel,
                to_char(scheduled_for,'MM-DD HH24:MI') AS sched,
                to_char(sent_at,'MM-DD HH24:MI') AS sent,
                to_char(whatsapp_sent_at,'MM-DD HH24:MI') AS wa,
                to_char(cancelled_at,'MM-DD HH24:MI') AS cancelled
           FROM notifications WHERE event_id = $1 ORDER BY scheduled_for`, [id]);
      if (!notes.rowCount) P(`  notifications: NONE`);
      for (const n of notes.rows) {
        P(`  notif ${n.template}/${n.channel} sched=${n.sched ?? '—'} sent=${n.sent ?? '—'} wa=${n.wa ?? '—'}${n.cancelled ? ` CANCELLED=${n.cancelled}` : ''}`);
      }

      const rating = await pool.query(
        `SELECT stars, left(coalesce(feedback,''),80) AS feedback,
                to_char(created_at,'YYYY-MM-DD HH24:MI') AS at
           FROM event_ratings WHERE event_id = $1 ORDER BY created_at DESC`, [id]);
      if (!rating.rowCount) P(`  rating: NONE saved`);
      for (const g of rating.rows) P(`  rating: ${g.stars}★ "${g.feedback}" at ${g.at}`);
    } catch (err) {
      P(`${id} failed: ${(err as Error).message}`);
    }
  }
  P('DONE');
}
