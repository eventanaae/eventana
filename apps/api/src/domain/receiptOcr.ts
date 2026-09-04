/**
 * Receipt OCR via Google Gemini (Generative Language API).
 *
 * Given a hosted receipt image (the Cloudinary URL we just uploaded), ask
 * Gemini to read the total, supplier, date and a rough account, so the New
 * Expense form can pre-fill and the owner only edits + saves. Everything the
 * model returns is treated as a SUGGESTION — the owner always reviews before
 * saving, and a null/failed read simply leaves the form manual.
 *
 * The key is server-side only (config.gemini.apiKey); absent → returns
 * { available:false } and the caller keeps the form fully manual.
 */
import { config } from '../config.js';

export interface ReceiptFields {
  amountFils: number | null;
  vendor: string | null;
  spentOn: string | null; // YYYY-MM-DD
  category: string | null;
  description: string | null;
}

export function receiptOcrAvailable(): boolean {
  return Boolean(config.gemini.apiKey);
}

const PROMPT =
  'You are reading a purchase/expense receipt for a UAE events company. ' +
  'The receipt may be in Arabic or English. Extract these fields and return ONLY a JSON object, no prose:\n' +
  '{"amount": number|null,  // the TOTAL amount paid, in AED (numbers only)\n' +
  ' "vendor": string|null,  // the shop / supplier / company name\n' +
  ' "date": string|null,    // the receipt date as "YYYY-MM-DD"\n' +
  ' "account": string|null, // one short expense category, e.g. Transportation, Materials, Printing, Food Beverage, Utilities, Staff, Rent, Maintenance, Marketing\n' +
  ' "description": string|null } // a short memo (a few words)\n' +
  'If a field is unclear, use null. Never invent values.';

/** Read a receipt image and return best-guess expense fields (all optional). */
export async function scanReceipt(imageUrl: string): Promise<{ available: boolean; fields?: ReceiptFields; error?: string }> {
  const key = config.gemini.apiKey;
  if (!key) return { available: false };

  // Pull the hosted image and inline it as base64 for Gemini.
  let mime = 'image/jpeg';
  let b64 = '';
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return { available: true, error: 'could not fetch receipt image' };
    mime = imgRes.headers.get('content-type') || mime;
    b64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');
  } catch {
    return { available: true, error: 'could not fetch receipt image' };
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: b64 } }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
      },
    );
    if (!res.ok) return { available: true, error: `Gemini ${res.status}` };
    const j: any = await res.json();
    const text: string | undefined = j?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return { available: true, fields: blank() };

    let parsed: any = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = /\{[\s\S]*\}/.exec(text);
      if (m) { try { parsed = JSON.parse(m[0]); } catch { /* leave blank */ } }
    }

    const amount = Number(String(parsed?.amount ?? '').toString().replace(/[^\d.]/g, ''));
    return {
      available: true,
      fields: {
        amountFils: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null,
        vendor: parsed?.vendor ? String(parsed.vendor).slice(0, 200) : null,
        spentOn: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed?.date)) ? String(parsed.date) : null,
        category: parsed?.account ? String(parsed.account).slice(0, 60) : null,
        description: parsed?.description ? String(parsed.description).slice(0, 300) : null,
      },
    };
  } catch (e) {
    return { available: true, error: (e as Error).message };
  }
}

function blank(): ReceiptFields {
  return { amountFils: null, vendor: null, spentOn: null, category: null, description: null };
}
