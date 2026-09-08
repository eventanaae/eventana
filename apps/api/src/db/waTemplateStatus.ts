/**
 * READ-ONLY: ask Meta for the approval status of every WhatsApp template, so we
 * know exactly what's APPROVED / PENDING / REJECTED. Gated by WA_STATUS=true.
 */
import { config } from '../config.js';

export async function waTemplateStatusFromEnv(): Promise<void> {
  if (String(process.env.WA_STATUS ?? '').toLowerCase() !== 'true') return;
  const waba = process.env.WHATSAPP_WABA_ID;
  const token = config.whatsapp.accessToken;
  if (!waba || !token) { console.log('[wa-status] missing WABA id or token — skipping'); return; }
  const url = `https://graph.facebook.com/${config.meta.graphVersion}/${waba}/message_templates?fields=name,status,category,language,components&limit=200`;
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const json = (await res.json()) as any;
    if (!res.ok) { console.log(`[wa-status] ${res.status}: ${JSON.stringify(json).slice(0, 240)}`); return; }
    const rows = (json.data ?? []) as Array<{ name: string; status: string; language: string; category: string; components?: any[] }>;
    console.log(`[wa-status] ${rows.length} template(s):`);
    for (const t of rows.sort((a, b) => a.name.localeCompare(b.name))) {
      // Count the {{n}} variables in the BODY so we can verify the code passes the
      // matching number of params (a mismatch fails the send).
      const bodyText = String((t.components ?? []).find((c: any) => c?.type === 'BODY')?.text ?? '');
      const vars = new Set((bodyText.match(/\{\{\s*\d+\s*\}\}/g) ?? []).map((s) => s.replace(/\D/g, ''))).size;
      console.log(`[wa-status] ${t.name} (${t.language}) = ${t.status} [${t.category}] vars=${vars}`);
    }
  } catch (e) {
    console.log(`[wa-status] error: ${(e as Error).message.slice(0, 160)}`);
  }
}
