/**
 * Receipt OCR reader. For each expense that has a receipt image and hasn't been
 * read yet, sends the image to Claude vision and extracts structured data:
 * supplier name/phone/location, currency, total, line items (name/qty/unit
 * price), and a category guess. Stored in receipt_ocr (resumable — done rows are
 * skipped). Uses a cheap vision model to control cost.
 *
 * RECEIPT_OCR       = 'run'   → process a batch.
 * RECEIPT_OCR_LIMIT = N       → how many to read this run (default 8).
 * RECEIPT_OCR_MODEL = model   → default claude-haiku-4-5 (cheap, good at OCR).
 * Needs ANTHROPIC_API_KEY (already used by the WhatsApp bot / review replies).
 */
import { pool } from './pool.js';
import { config } from '../config.js';

const PROMPT = `You are reading a receipt/invoice image for a kids-events company in the UAE.
Return STRICT JSON only, no prose, with this exact shape:
{"payment_type": "purchase"|"transfer"|"other",
 "supplier_name": string|null, "recipient": string|null,
 "supplier_phone": string|null, "supplier_location": string|null,
 "invoice_number": string|null, "currency": string|null, "tax": number|null, "total": number|null,
 "items": [{"name": string, "qty": number|null, "unit_price": number|null}],
 "category": one of ["decor","balloons","flowers","food","consumables","giveaways","stationery","packaging","transport","fuel","furniture","electronics","printing","toys","salary","bank","other"]}
IMPORTANT: Some images are BANK TRANSFER confirmations (e.g. an ADIB or other bank app screenshot) — money we SENT to a person, NOT a shop purchase. For those set "payment_type":"transfer", put the BENEFICIARY / recipient person's name in "recipient" (this is who we paid — often a part-timer or a driver), leave items empty, and supplier_name = the bank. For a normal shop purchase set "payment_type":"purchase" and recipient=null.
Rules: read the shop/supplier name, any phone number, address/area, the invoice/receipt number and VAT/tax amount if shown. List every line item with its unit price if shown. Amounts are numbers only. If a field is missing use null. Respond with JSON only.`;

function extractJson(text: string): any | null {
  const a = text.indexOf('{'); const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

export async function receiptOcrFromEnv(): Promise<void> {
  if (String(process.env.RECEIPT_OCR ?? '').toLowerCase() !== 'run') return;
  const apiKey = config.anthropic.apiKey;
  if (!apiKey) { console.log('[receipt-ocr] ANTHROPIC_API_KEY not set — cannot run'); return; }
  const limit = Math.max(1, Math.min(2000, Number(process.env.RECEIPT_OCR_LIMIT ?? 8)));
  const model = process.env.RECEIPT_OCR_MODEL || 'claude-haiku-4-5-20251001';
  // One-time re-read of everything with the improved prompt (cheap).
  if (String(process.env.RECEIPT_OCR_RESET ?? '').toLowerCase() === 'true') {
    await pool.query(`TRUNCATE receipt_ocr`);
    console.log('[receipt-ocr] RESET — cleared previous OCR, re-reading all');
  }

  const { rows } = await pool.query<{ id: string; receipt_url: string; vendor: string }>(
    `SELECT e.id, e.receipt_url, e.vendor
       FROM expenses e
      WHERE COALESCE(btrim(e.receipt_url),'') <> ''
        AND NOT EXISTS (SELECT 1 FROM receipt_ocr r WHERE r.expense_id = e.id)
      ORDER BY e.id
      LIMIT $1`,
    [limit],
  );
  console.log(`[receipt-ocr] model=${model} · batch=${rows.length}`);
  let ok = 0, nojson = 0, failed = 0;
  for (const e of rows) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model, max_tokens: 800,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'url', url: e.receipt_url } },
            { type: 'text', text: PROMPT },
          ] }],
        }),
      });
      if (!res.ok) {
        const t = (await res.text()).slice(0, 200);
        await pool.query(`INSERT INTO receipt_ocr (expense_id, status, raw, model) VALUES ($1,'failed',$2,$3) ON CONFLICT (expense_id) DO NOTHING`, [e.id, `HTTP ${res.status}: ${t}`, model]);
        failed++; console.log(`[receipt-ocr] #${e.id} HTTP ${res.status} ${t}`);
        continue;
      }
      const json = (await res.json()) as any;
      const text = (json?.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      const data = extractJson(text);
      if (!data) {
        await pool.query(`INSERT INTO receipt_ocr (expense_id, status, raw, model) VALUES ($1,'no_json',$2,$3) ON CONFLICT (expense_id) DO NOTHING`, [e.id, text.slice(0, 500), model]);
        nojson++; continue;
      }
      const totalFils = typeof data.total === 'number' ? Math.round(data.total * 100) : null;
      const taxFils = typeof data.tax === 'number' ? Math.round(data.tax * 100) : null;
      await pool.query(
        `INSERT INTO receipt_ocr (expense_id, payment_type, supplier_name, recipient, supplier_phone, supplier_location, invoice_number, currency, tax_fils, total_fils, category_guess, items, raw, status, model)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'ok',$14) ON CONFLICT (expense_id) DO NOTHING`,
        [e.id, data.payment_type ?? 'purchase', data.supplier_name ?? null, data.recipient ?? null,
         data.supplier_phone ?? null, data.supplier_location ?? null,
         data.invoice_number ?? null, data.currency ?? null, taxFils, totalFils, data.category ?? null,
         JSON.stringify(data.items ?? []), text.slice(0, 1000), model],
      );
      ok++;
      const items = Array.isArray(data.items) ? data.items.length : 0;
      const who = data.payment_type === 'transfer' ? `TRANSFER→${data.recipient ?? '?'}` : `${data.supplier_name ?? e.vendor ?? '?'} · ${items} items`;
      console.log(`[receipt-ocr] #${e.id} ✓ ${who} · cat=${data.category ?? '-'} · ph=${data.supplier_phone ?? '-'} · loc=${data.supplier_location ?? '-'}`);
    } catch (err) {
      failed++; console.error(`[receipt-ocr] #${e.id} error`, (err as Error).message);
    }
  }
  const remain = await pool.query<{ n: number }>(
    `SELECT count(*)::int n FROM expenses e WHERE COALESCE(btrim(e.receipt_url),'') <> '' AND NOT EXISTS (SELECT 1 FROM receipt_ocr r WHERE r.expense_id = e.id)`,
  );
  console.log(`[receipt-ocr] DONE batch — ok=${ok} no_json=${nojson} failed=${failed} · remaining=${remain.rows[0].n}`);
}
