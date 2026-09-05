/**
 * Set an event's phase (owner/testing). Gated by SET_EVENT_PHASE="<eventId>=<phase>".
 * e.g. SET_EVENT_PHASE="EV-2026-0208=Event Completed" — makes the rate & tip
 * section appear (canReview needs 'Party Started' or 'Event Completed').
 */
import { pool } from './pool.js';

export async function setEventPhaseFromEnv(): Promise<void> {
  const raw = String(process.env.SET_EVENT_PHASE ?? '').trim();
  if (!raw) return;
  const [id, ...rest] = raw.split('=');
  const phase = rest.join('=').trim();
  if (!id || !phase) { console.log('[set-phase] expected "<eventId>=<phase>"'); return; }
  try {
    const r = await pool.query(`UPDATE events SET phase = $2 WHERE id = $1 RETURNING id`, [id.trim(), phase]);
    console.log(`[set-phase] ${id.trim()} → "${phase}" (${r.rowCount ? 'ok' : 'not found'})`);
  } catch (err) {
    console.error('[set-phase] failed:', (err as Error).message);
  }
}
