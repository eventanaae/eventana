/**
 * «شيخة» on WhatsApp: the AI team's assistant who talks to Marsha.
 *
 * Owner rule (27 Nov): whenever Marsha writes from the company phone, Sheikha
 * answers right away, in casual English, from real Ops data. If she doesn't know,
 * she says she'll check with the team and logs an open request; the team's
 * scheduled work picks those up (GET /api/team/replies → openRequests).
 * Staff data only: no customer names, phones or addresses go into the prompt.
 */
import { pool } from '../db/pool.js';
import { generateText, anthropicEnabled } from '../integrations/anthropic.js';
import { sendWhatsAppText, type InboundMessage } from '../integrations/whatsapp.js';
import { recordOutboundMessage } from './whatsappLeads.js';

const COMPANY = '971564500777';

export function isCompanyPhone(phone: string): boolean {
  return String(phone ?? '').replace(/\D/g, '').endsWith('564500777');
}

async function facts(): Promise<string> {
  const q = async (sql: string) => (await pool.query(sql).catch(() => ({ rows: [] as any[] }))).rows;
  const parties = await q(`
    SELECT to_char(e.event_date,'Dy DD Mon') AS day, e.start_time AS time, e.emirate, th.name AS theme,
           COALESCE(e.custom_theme,false) AS custom, pk.name AS package,
           (SELECT string_agg(DISTINCT split_part(tm.name,' ',1), ', ') FROM event_staff es JOIN team_members tm ON tm.id = es.assignee_id WHERE es.event_id = e.id) AS crew,
           (SELECT count(*) FROM prep_tasks pt WHERE pt.event_id = e.id AND pt.status = 'completed')::int AS prep_done,
           (SELECT count(*) FROM prep_tasks pt WHERE pt.event_id = e.id)::int AS prep_total,
           (SELECT count(*) FROM prep_tasks pt WHERE pt.event_id = e.id AND pt.category = 'design' AND pt.status <> 'completed')::int AS design_open
      FROM events e LEFT JOIN themes th ON th.id = e.theme_id LEFT JOIN packages pk ON pk.id = e.package_id
     WHERE e.phase <> 'Cancelled' AND NOT COALESCE(e.date_tbd,false)
       AND e.event_date BETWEEN (now() AT TIME ZONE 'Asia/Dubai')::date AND (now() AT TIME ZONE 'Asia/Dubai')::date + 7
     ORDER BY e.event_date, e.start_time LIMIT 25`);
  const issues = await q(`SELECT COALESCE(asset_name, asset_code) AS item, kind, status FROM asset_issues WHERE status <> 'resolved' LIMIT 20`);
  const missing = await q(`SELECT item, quantity, status FROM missing_items WHERE status IN ('requested','ordered') LIMIT 30`);
  const low = await q(`SELECT name, on_hand, reorder_level FROM consumables WHERE active AND on_hand <= reorder_level LIMIT 20`);
  return [
    'PARTIES NEXT 7 DAYS:',
    ...parties.map((p: any) => `- ${p.day} ${String(p.time ?? '').slice(0, 5)} ${p.emirate ?? ''} | theme ${p.theme ?? (p.custom ? 'custom' : '?')} | ${p.package ?? ''} | crew ${p.crew ?? 'none yet'} | prep ${p.prep_done}/${p.prep_total} | designs open ${p.design_open}`),
    'OPEN EQUIPMENT ISSUES:', ...issues.map((i: any) => `- ${i.item}: ${i.kind} (${i.status})`),
    'MISSING ITEMS NOT YET RECEIVED:', ...missing.map((m: any) => `- ${m.item} x${m.quantity} (${m.status})`),
    'CONSUMABLES LOW:', ...(low.length ? low.map((l: any) => `- ${l.name}: ${l.on_hand} left (reorder at ${l.reorder_level})`) : ['- none']),
  ].join('\n');
}

async function thread(): Promise<string> {
  const r = await pool.query<{ direction: string; body: string }>(
    `SELECT direction, body FROM whatsapp_messages WHERE right(phone, 9) = '564500777' AND COALESCE(body,'') <> ''
      ORDER BY created_at DESC LIMIT 16`).catch(() => ({ rows: [] as { direction: string; body: string }[] }));
  return r.rows.reverse().map((m) => `${m.direction === 'in' ? 'Marsha' : 'Sheikha'}: ${m.body}`).join('\n');
}

/** Answer Marsha now. Never throws. */
export async function sheikhaReply(msg: InboundMessage): Promise<void> {
  try {
    if (!isCompanyPhone(msg.phone) || !msg.text.trim() || !anthropicEnabled()) return;
    const today = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM whatsapp_messages WHERE direction = 'out' AND right(phone, 9) = '564500777'
          AND sent_by = 'agent' AND created_at > now() - interval '1 day'`).catch(() => ({ rows: [{ n: 0 }] }));
    if ((today.rows[0]?.n ?? 0) >= 40) return; // safety cap
    const system = [
      "You are Sheikha, the assistant on Eventana's AI team (a kids' party company in the UAE). You are chatting on WhatsApp with Marsha, who runs operations and design. She only speaks English.",
      'Style: casual and warm, like a friendly colleague. Short (1-4 sentences), a little humour or an emoji is fine, never formal, never robotic.',
      'Your jobs: design drafts for each booking (Marsha decides what she wants and approves them, you can not finish a design without her), checking every party 2 days before (designs, prints, crew), and stock (broken, missing, running low).',
      'Use ONLY the facts below. Never invent dates, items, prices or names. Never mention the owner, never say you report to anyone, never talk about customers\' private details.',
      'If she asks something the facts don\'t answer, or asks you to do something you can\'t do from here, say you\'ll check with the team and get back to her.',
      'If she gives an update (e.g. something fixed, ordered, done), thank her and confirm you noted it.',
      'ADMIN matters are never yours to decide: money, payments, salaries, leave/day-off approval, buying or spending, hiring, policies, customer refunds or discounts. For those say you\'ll pass it on and get back to her, and start the team line with "ADMIN:".',
      'Reply with JSON only: {"reply": "<your WhatsApp message>", "team": "<one line for the team if they must act or answer, else empty>"}',
      '', await facts(), '', 'RECENT CHAT:', await thread(),
    ].join('\n');
    const out = await generateText({ system, prompt: `Marsha just wrote: ${msg.text.slice(0, 1500)}`, maxTokens: 400 });
    if (!out) return;
    let reply = '', team = '';
    try {
      const j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
      reply = String(j.reply ?? '').trim(); team = String(j.team ?? '').trim();
    } catch { reply = out.trim(); }
    if (!reply) return;
    const r = await sendWhatsAppText({ to: COMPANY, body: reply.slice(0, 1500), fromStaff: true, allowCompanyPhone: true });
    if (r.ok) await recordOutboundMessage({ phone: COMPANY, body: reply, messageId: r.messageId ?? null, sentBy: 'agent' }).catch(() => {});
    if (team) {
      await pool.query(`INSERT INTO ai_team_requests (source, text, marsha_said) VALUES ('marsha', $1, $2)`,
        [team.slice(0, 500), msg.text.slice(0, 1000)]).catch(() => {});
    }
  } catch (err) {
    console.error('[sheikha] reply failed:', (err as Error).message);
  }
}
