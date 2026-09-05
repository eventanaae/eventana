/**
 * Log the signed "My Event / feedback" deep link for one or more events, so the
 * owner can send it to a customer (e.g. over WhatsApp) to test the rating + tip
 * page. Gated by FEEDBACK_LINK=<eventId>[,<eventId>...]. Reads only.
 */
import { pool } from './pool.js';
import { config } from '../config.js';
import { issueFeedbackToken } from '../domain/customerAuth.js';

const P = (s: string) => console.log(`[feedback-link] ${s}`);

export async function feedbackLinkFromEnv(): Promise<void> {
  const raw = String(process.env.FEEDBACK_LINK ?? '').trim();
  if (!raw) return;
  const base = (config.publicAppUrl || '').replace(/\/$/, '');
  if (!base) { P('no publicAppUrl configured — cannot build link'); return; }
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  for (const eventId of ids) {
    try {
      const { rows } = await pool.query(
        `SELECT c.name, c.email, c.phone, to_char(e.event_date,'YYYY-MM-DD') AS d
           FROM events e JOIN customers c ON c.id = e.customer_id WHERE e.id = $1`, [eventId]);
      const r = rows[0];
      if (!r) { P(`${eventId}: not found`); continue; }
      const link = `${base}/?event=${encodeURIComponent(eventId)}&fb=${encodeURIComponent(issueFeedbackToken(eventId))}`;
      P(`${eventId} "${r.name}" <${r.email ?? 'no-email'}> ph=${r.phone ?? '—'} date=${r.d ?? 'TBD'}`);
      P(`  LINK: ${link}`);
    } catch (err) {
      P(`${eventId} failed: ${(err as Error).message}`);
    }
  }
  P('DONE');
}
