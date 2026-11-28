/**
 * The owner «شيم» on WhatsApp (owner, 28 Nov): Shamma (the secretary) talks to her on
 * +971 56 606 9616. Her messages are never answered by the customer bot; they are queued
 * for the AI team (openRequests) so Shamma can act and reply.
 */
import { pool } from '../db/pool.js';
import type { InboundMessage } from '../integrations/whatsapp.js';

export const OWNER_PHONE = '971566069616';
const tail = (p: string) => String(p ?? '').replace(/\D/g, '').slice(-9);
export const isOwnerPhone = (p: string) => tail(p) === OWNER_PHONE.slice(-9);

/** The owner wrote to us: queue it for the team. Never throws. */
export async function ownerInbound(msg: InboundMessage): Promise<void> {
  try {
    if (!msg.text.trim()) return;
    await pool.query(`INSERT INTO ai_team_requests (source, text, marsha_said) VALUES ('owner', $1, $2)`,
      ['OWNER: ' + msg.text.slice(0, 480), msg.text.slice(0, 1000)]);
  } catch (err) {
    console.error('[owner] queue failed:', (err as Error).message);
  }
}
