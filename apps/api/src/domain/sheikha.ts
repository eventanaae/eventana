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

/** Marsha's open Ops tasks (prep + manual), oldest due first. */
export async function marshaTasks(): Promise<Array<{ due: string | null; title: string; status: string; category: string; party: string | null }>> {
  const r = await pool.query(
    `SELECT to_char(pt.due_date,'Dy DD Mon') AS due, pt.title, pt.status, pt.category,
            CASE WHEN e.id IS NULL THEN NULL ELSE to_char(e.event_date,'Dy DD Mon') || ' ' || COALESCE(e.emirate,'') END AS party
       FROM prep_tasks pt JOIN prep_task_staff s ON s.task_id = pt.id JOIN team_members tm ON tm.id = s.member_id
       LEFT JOIN events e ON e.id = pt.event_id
      WHERE lower(split_part(tm.name,' ',1)) = 'marsha' AND pt.status <> 'completed'
        -- only what is still ahead: parties from today on (not cancelled), or tasks with no party
        AND (e.id IS NULL OR (e.event_date >= (now() AT TIME ZONE 'Asia/Dubai')::date AND e.phase <> 'Cancelled'))
        AND (e.id IS NOT NULL OR pt.due_date IS NULL OR pt.due_date >= (now() AT TIME ZONE 'Asia/Dubai')::date - 14)
      ORDER BY pt.due_date NULLS LAST, pt.id LIMIT 60`).catch(() => ({ rows: [] as any[] }));
  return r.rows as any;
}

/** Store a reminder for Marsha. `at` is Dubai local time "YYYY-MM-DD HH:MM". */
export async function addReminder(at: string, text: string): Promise<boolean> {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})$/.exec(String(at ?? '').trim());
  if (!m || !String(text ?? '').trim()) return false;
  const r = await pool.query(
    `INSERT INTO ai_reminders (text, due_at) SELECT $1, ($2::timestamp AT TIME ZONE 'Asia/Dubai')
      WHERE ($2::timestamp AT TIME ZONE 'Asia/Dubai') > now() - interval '5 minutes'
        AND (SELECT count(*) FROM ai_reminders WHERE sent_at IS NULL) < 50`,
    [String(text).slice(0, 500), `${m[1]} ${m[2]}:${m[3]}`]).catch(() => ({ rowCount: 0 }));
  return (r.rowCount ?? 0) > 0;
}

/** Send any due reminders (called from the reconcile sweep). Night guard: 10:00–23:00 Dubai. */
export async function sweepSheikhaReminders(): Promise<void> {
  try {
    const h = new Date(Date.now() + 4 * 3600 * 1000).getUTCHours();
    if (h < 10 || h >= 23) return;
    // Marsha's day off (Tuesday): hold reminders until Wednesday, unless marked URGENT.
    const tuesday = new Date(Date.now() + 4 * 3600 * 1000).getUTCDay() === 2;
    const due = await pool.query<{ id: string; text: string }>(
      `UPDATE ai_reminders SET sent_at = now() WHERE id IN (
         SELECT id FROM ai_reminders WHERE sent_at IS NULL AND due_at <= now()
            AND (NOT $1::boolean OR text ILIKE 'URGENT%') ORDER BY due_at LIMIT 5)
       RETURNING id, text`, [tuesday]);
    if (!due.rows.length) return;
    const open24 = await pool.query(`SELECT 1 FROM whatsapp_messages WHERE direction = 'in' AND right(phone, 9) = '564500777'
        AND created_at > now() - interval '23 hours' LIMIT 1`);
    const { sendWhatsAppTemplate } = await import('../integrations/whatsapp.js');
    for (const r of due.rows) {
      const body = `Reminder ⏰ ${r.text}`;
      const res = open24.rows.length
        ? await sendWhatsAppText({ to: COMPANY, body, fromStaff: true, allowCompanyPhone: true })
        : await sendWhatsAppTemplate({ to: COMPANY, name: 'staff_notify', language: 'en', params: ['Marsha', 'Reminder ⏰', r.text.replace(/\s*\n+\s*/g, ' • ')], fromStaff: true, allowCompanyPhone: true });
      if (res.ok) await recordOutboundMessage({ phone: COMPANY, body, messageId: res.messageId ?? null, sentBy: 'agent' }).catch(() => {});
    }
  } catch (err) {
    console.error('[sheikha] reminders failed:', (err as Error).message);
  }
}

export async function facts(): Promise<string> {
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
  const tasks = await marshaTasks();
  const reminders = await q(`SELECT to_char(due_at AT TIME ZONE 'Asia/Dubai','Dy DD Mon HH24:MI') AS at, text FROM ai_reminders WHERE sent_at IS NULL ORDER BY due_at LIMIT 20`);
  const missing = await q(`SELECT item, quantity, status FROM missing_items WHERE status IN ('requested','ordered') LIMIT 30`);
  const low = await q(`SELECT name, on_hand, reorder_level FROM consumables WHERE active AND on_hand <= reorder_level LIMIT 20`);
  return [
    'PARTIES NEXT 7 DAYS:',
    ...parties.map((p: any) => `- ${p.day} ${String(p.time ?? '').slice(0, 5)} ${p.emirate ?? ''} | theme ${p.theme ?? (p.custom ? 'custom' : '?')} | ${p.package ?? ''} | crew ${p.crew ?? 'none yet'} | prep ${p.prep_done}/${p.prep_total} | designs open ${p.design_open}`),
    'OPEN EQUIPMENT ISSUES:', ...issues.map((i: any) => `- ${i.item}: ${i.kind} (${i.status})`),
    'MISSING ITEMS NOT YET RECEIVED:', ...missing.map((m: any) => `- ${m.item} x${m.quantity} (${m.status})`),
    "MARSHA'S OPEN TASKS IN OPS:", ...(tasks.length ? tasks.map((t) => `- due ${t.due ?? '?'} | ${t.title} | ${t.status}${t.party ? ` | party ${t.party}` : ''}`) : ['- none']),
    'REMINDERS ALREADY SET:', ...(reminders.length ? reminders.map((r: any) => `- ${r.at}: ${r.text}`) : ['- none']),
    'CONSUMABLES LOW:', ...(low.length ? low.map((l: any) => `- ${l.name}: ${l.on_hand} left (reorder at ${l.reorder_level})`) : ['- none']),
  ].join('\n');
}

async function thread(): Promise<string> {
  const r = await pool.query<{ direction: string; body: string }>(
    `SELECT direction, body FROM whatsapp_messages WHERE right(phone, 9) = '564500777' AND COALESCE(body,'') <> ''
      ORDER BY created_at DESC LIMIT 16`).catch(() => ({ rows: [] as { direction: string; body: string }[] }));
  return r.rows.reverse().map((m) => `${m.direction === 'in' ? 'Marsha' : 'Sheikha'}: ${m.body}`).join('\n');
}


/**
 * Stock updates Sheikha may make (owner, 27 Nov: «شيخة لازم تسوي ابديت هي مسؤوله»).
 * Only on Marsha's clear word, matched to an exact item name from Ops. Never deletes.
 */
export async function applyStockUpdate(type: string, item: string): Promise<boolean> {
  const name = String(item ?? '').trim();
  if (!name) return false;
  const by = 'Sheikha (AI team), confirmed by Marsha';
  let r: { rowCount: number | null } = { rowCount: 0 };
  if (type === 'resolve_issue') {
    r = await pool.query(`UPDATE asset_issues SET status = 'resolved', resolved_by = $2, resolved_at = now()
       WHERE status <> 'resolved' AND lower(COALESCE(asset_name, asset_code)) = lower($1)`, [name, by]).catch(() => ({ rowCount: 0 }));
  } else if (type === 'missing_received' || type === 'missing_ordered') {
    const to = type === 'missing_received' ? 'received' : 'ordered';
    const from = type === 'missing_received' ? ['requested', 'ordered'] : ['requested'];
    r = await pool.query(`UPDATE missing_items SET status = $2, actioned_at = now()
       WHERE status = ANY($3) AND lower(item) = lower($1)`, [name, to, from]).catch(() => ({ rowCount: 0 }));
  }
  if ((r.rowCount ?? 0) > 0) console.log(`[sheikha] stock update ${type}: ${name}`);
  return (r.rowCount ?? 0) > 0;
}

/** Answer Marsha now. Never throws. */
export async function sheikhaReply(msg: InboundMessage): Promise<void> {
  try {
    if (!isCompanyPhone(msg.phone) || !msg.text.trim() || !anthropicEnabled()) return;
    const today = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM whatsapp_messages WHERE direction = 'out' AND right(phone, 9) = '564500777'
          AND sent_by = 'agent' AND created_at > now() - interval '1 day'`).catch(() => ({ rows: [{ n: 0 }] }));
    // Safety cap. The count includes the team's own notify messages, so 40 ran out mid-day
    // and Sheikha went silent (28 Nov). Never fail silently.
    if ((today.rows[0]?.n ?? 0) >= 150) { console.error('[sheikha] daily cap reached, not replying'); return; }
    const system = [
      "You are Sheikha, the assistant on Eventana's AI team (a kids' party company in the UAE). You are chatting on WhatsApp with Marsha, who runs operations and design. She only speaks English.",
      'Marsha is OFF every Tuesday. On Tuesdays never push work on her; if she writes, answer kindly and briefly and tell her it can wait till tomorrow unless she says it is urgent.',
      'Style: casual and warm, like a friendly colleague. SHORT: 1-2 sentences, like a real WhatsApp text (no long explanations, no lists), a little humour or an emoji is fine, never formal, never robotic.',
      'Your jobs: design drafts for each booking (Marsha decides what she wants and approves them, you can not finish a design without her), checking every party 2 days before (designs, prints, crew), and stock (broken, missing, running low).',
      'Use ONLY the facts below. Never invent dates, items, prices or names. Never mention the owner, never say you report to anyone, never talk about customers\' private details.',
      'Your own earlier messages in RECENT CHAT (lines starting "Sheikha:") are real asks from the team. If Marsha asks about one of them (what it is, where, how), explain it simply from what that message says, step by step, with the exact button names it gives. Never tell her to ignore it.',
      'You CANNOT read chats on the 0777 WhatsApp yet: it is not connected to the system. If Marsha asks you to read, check or analyse a customer\'s WhatsApp chat, never guess and never give vague answers. Tell her clearly you can\'t see that chat because 0777 isn\'t connected yet, and ask her to finish the step that connects it: on the office laptop open hub.360dialog.com, sign up with the Eventana email, pick the Regular plan (EUR 49/month, owner approved), pay with the company card, then "Connect WhatsApp Business App" and scan the QR with the 0777 phone. After that you can read chats.',
      'If she asks something the facts and the chat don\'t answer, or asks you to do something you can\'t do from here, say you\'ll check with the team and get back to her.',
      'If she gives an update (e.g. something fixed, ordered, done), thank her and confirm you noted it.',
      'Whenever Marsha answers, postpones ("tomorrow", "later", "remind me") or refuses something the team asked her in RECENT CHAT, ALWAYS fill the team line with what she said about which ask (e.g. "Marsha: Microsoft sign-in tomorrow"), even if you also set a reminder.',
      'ADMIN matters are never yours to decide: money, payments, salaries, leave/day-off approval, buying or spending, hiring, policies, customer refunds or discounts. For those say you\'ll pass it on and get back to her, and start the team line with "ADMIN:".',
      'You are responsible for keeping the stock records in Ops up to date. When Marsha CLEARLY says an item with an open issue is fixed, or a missing item was ordered or received, add an action. Use the item name EXACTLY as written in the facts. Never guess.',
      'You can set reminders for Marsha: when she asks to be reminded (or agrees to one), add an action {"type":"remind","at":"YYYY-MM-DD HH:MM" (Dubai time, between 10:00 and 22:59),"text":"<short reminder>"}. Today in Dubai is ' + new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ') + '.',
      'You can message suppliers on WhatsApp for quotes: when Marsha asks you to contact a supplier and gives (or you already have in the chat) its phone number, add {"type":"contact_supplier","phone":"<number>","name":"<company>","need":"<what we need, short, in English>"}. Their reply will be forwarded to Marsha automatically. Never contact anyone else (no customers).',
      'Reply with JSON only: {"reply": "<your WhatsApp message>", "team": "<one line for the team if they must act or answer, else empty>", "actions": [{"type": "resolve_issue|missing_ordered|missing_received", "item": "<exact name>"} or {"type": "remind", "at": "...", "text": "..."}]}',
      '', await facts(), '', 'RECENT CHAT:', await thread(),
    ].join('\n');
    const out = await generateText({ system, prompt: `Marsha just wrote: ${msg.text.slice(0, 1500)}`, maxTokens: 900 });
    if (!out) return;
    let reply = '', team = '';
    try {
      const j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
      reply = String(j.reply ?? '').trim(); team = String(j.team ?? '').trim();
      for (const act of Array.isArray(j.actions) ? j.actions.slice(0, 5) : []) {
        if (act?.type === 'contact_supplier') {
          const { messageSupplier } = await import('./suppliers.js');
          const res = await messageSupplier(String(act?.phone ?? ''), String(act?.name ?? ''), String(act?.need ?? ''));
          if (!res.ok) team = `${team ? team + ' | ' : ''}Could not message supplier ${act?.name ?? ''}: ${res.error}`;
        } else if (act?.type === 'remind') await addReminder(String(act?.at ?? ''), String(act?.text ?? ''));
        else await applyStockUpdate(String(act?.type ?? ''), String(act?.item ?? ''));
      }
    } catch {
      // Never send raw JSON to Marsha: pull the reply field out, or send nothing.
      const m = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(out);
      reply = m ? JSON.parse(`"${m[1]}"`) : (out.trim().startsWith('{') ? '' : out.trim());
      const t = /"team"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(out);
      if (t) team = JSON.parse(`"${t[1]}"`);
    }
    if (reply.trim().startsWith('{')) reply = '';
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
