/**
 * Main-number sync for WhatsApp "coexistence" (the company phone +971 56 450 0777
 * keeps the WhatsApp Business app AND is linked to the API).
 *
 * Owner (27 Nov): keep every chat; the assistant only LISTENS and LEARNS on the
 * main number at first. So this file only records:
 *   - smb_message_echoes: messages Marsha sends from the phone app (sent_by 'staff')
 *   - history: the past chats Meta shares at onboarding (up to ~6 months)
 * Nothing here ever sends a message. Payload shapes follow Meta's coexistence
 * webhooks; unknown shapes are skipped (and logged once), never thrown.
 */
import { pool } from '../db/pool.js';

const d = (s: unknown) => String(s ?? '').replace(/\D+/g, '');
const textOf = (m: any): string =>
  String(m?.text?.body ?? m?.button?.text ?? m?.interactive?.button_reply?.title ?? m?.image?.caption ?? m?.video?.caption ?? '');

async function save(phone: string, id: string, direction: 'in' | 'out', body: string, at: Date | null): Promise<void> {
  if (!phone || !id) return;
  await pool.query(
    `INSERT INTO whatsapp_messages (phone, wa_message_id, direction, body, sent_by, created_at)
     VALUES ($1,$2,$3,$4,$5, COALESCE($6, now()))
     ON CONFLICT (wa_message_id) DO NOTHING`,
    [phone, id, direction, body, direction === 'out' ? 'staff' : null, at],
  ).catch((e) => console.error('[wa-sync] save failed:', (e as Error).message));
}

let warned = false;

/** Record echoes and history from a webhook body. Returns how many messages were stored. */
export async function syncCoexistence(body: unknown): Promise<number> {
  let n = 0;
  try {
    for (const entry of ((body as any)?.entry ?? []) as any[]) {
      for (const change of (entry?.changes ?? []) as any[]) {
        const v = change?.value ?? {};
        const biz = d(v?.metadata?.display_phone_number);
        // Messages sent from the phone app by our team.
        for (const m of (Array.isArray(v.message_echoes) ? v.message_echoes : []) as any[]) {
          const to = d(m?.to);
          if (!to || !m?.id) continue;
          await save(to, String(m.id), 'out', textOf(m), m.timestamp ? new Date(Number(m.timestamp) * 1000) : null);
          n++;
        }
        // Past chats shared by Meta at onboarding.
        for (const h of (Array.isArray(v.history) ? v.history : []) as any[]) {
          for (const t of (Array.isArray(h?.threads) ? h.threads : []) as any[]) {
            const customer = d(t?.id);
            for (const m of (Array.isArray(t?.messages) ? t.messages : []) as any[]) {
              const from = d(m?.from);
              const out = !!biz ? from === biz || (from !== '' && from !== customer) : from !== customer;
              await save(customer || d(out ? m?.to : from), String(m?.id ?? ''), out ? 'out' : 'in', textOf(m),
                m?.timestamp ? new Date(Number(m.timestamp) * 1000) : null);
              n++;
            }
          }
        }
      }
    }
  } catch (e) {
    if (!warned) { warned = true; console.error('[wa-sync] unexpected payload:', (e as Error).message); }
  }
  if (n) console.log(`[wa-sync] stored ${n} coexistence message(s)`);
  return n;
}
