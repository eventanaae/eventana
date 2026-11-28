/**
 * The owner «شيم» on WhatsApp (owner, 28 Nov): Shamma (the secretary) talks to her on
 * +971 56 606 9616. Shamma answers at once in short Gulf Arabic from real Ops data; anything
 * the team must do is queued (openRequests, «OWNER:») for the AI team. Never the customer bot.
 */
import { pool } from '../db/pool.js';
import { generateText, anthropicEnabled } from '../integrations/anthropic.js';
import { sendWhatsAppText, type InboundMessage } from '../integrations/whatsapp.js';
import { recordOutboundMessage } from './whatsappLeads.js';

export const OWNER_PHONE = '971566069616';
const tail = (p: string) => String(p ?? '').replace(/\D/g, '').slice(-9);
export const isOwnerPhone = (p: string) => tail(p) === OWNER_PHONE.slice(-9);

async function chat(): Promise<string> {
  const r = await pool.query<{ direction: string; body: string }>(
    `SELECT direction, body FROM whatsapp_messages WHERE right(phone, 9) = '566069616' AND COALESCE(body,'') <> ''
      ORDER BY created_at DESC LIMIT 12`).catch(() => ({ rows: [] as { direction: string; body: string }[] }));
  return r.rows.reverse().map((m) => `${m.direction === 'in' ? 'شيم' : 'شمّا'}: ${m.body}`).join('\n');
}

/** The owner wrote to us: Shamma answers now and queues work for the team. Never throws. */
export async function ownerInbound(msg: InboundMessage): Promise<void> {
  try {
    if (!msg.text.trim()) return;
    let reply = '', team = '';
    if (anthropicEnabled()) {
      const { facts } = await import('./sheikha.js');
      const month = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM events WHERE phase <> 'Cancelled'
          AND (created_at AT TIME ZONE 'Asia/Dubai')::date >= date_trunc('month', (now() AT TIME ZONE 'Asia/Dubai'))::date`).catch(() => ({ rows: [{ n: 0 }] }));
      const system = [
        'انتي «شمّا»، سكرتيرة فريق إيفنتانا (شركة حفلات أطفال في الإمارات). تكلمين صاحبة الشركة «شيم» على الواتساب.',
        'اكتبي بالخليجي بس، بدون ولا كلمة إنجليزية، قصير: سطر أو سطرين، ودودة وواضحة.',
        'جاوبي بس من المعلومات تحت. لا تخترعين أرقام ولا أسماء ولا مواعيد. إذا ما تعرفين، قولي إنج بتشيّكين مع الفريق وترجعين لها.',
        'إذا طلبت شي ينسوى (تعديل، رسالة، تصميم، إعلان، أي شغل): قولي «وصل، الفريق بيسويه وأخبرج» واكتبي الطلب في خانة team بجملة وحدة.',
        'لا تطلبين منها شي إلا إذا ضروري، ولا تكثرين أسئلة.',
        'رجّعي JSON بس: {"reply":"<رسالتج لها>","team":"<الطلب للفريق أو فاضي>"}',
        '', `حجوزات هالشهر: ${month.rows[0]?.n ?? 0}`, await facts(), '', 'آخر المحادثة:', await chat(),
      ].join('\n');
      const out = await generateText({ system, prompt: `شيم كتبت: ${msg.text.slice(0, 1500)}`, maxTokens: 600 });
      if (out) {
        try { const j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); reply = String(j.reply ?? '').trim(); team = String(j.team ?? '').trim(); }
        catch { const m = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(out); reply = m ? JSON.parse(`"${m[1]}"`) : ''; }
      }
    }
    if (!reply || reply.startsWith('{')) { reply = 'وصلت رسالتج، بخبر الفريق وأرجع لج 🌸'; team = team || msg.text.slice(0, 480); }
    const r = await sendWhatsAppText({ to: OWNER_PHONE, body: reply.slice(0, 1200), fromStaff: true });
    if (r.ok) await recordOutboundMessage({ phone: OWNER_PHONE, body: reply, messageId: r.messageId ?? null, sentBy: 'agent' }).catch(() => {});
    if (team) await pool.query(`INSERT INTO ai_team_requests (source, text, marsha_said) VALUES ('owner', $1, $2)`,
      ['OWNER: ' + team.slice(0, 480), msg.text.slice(0, 1000)]);
  } catch (err) {
    console.error('[owner] reply failed:', (err as Error).message);
  }
}
