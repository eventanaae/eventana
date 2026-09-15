/**
 * Re-categorise every expense into the owner-approved chart of accounts, using
 * everything we learned from the receipts + supplier memory + the transfer
 * recipient rules the owner confirmed. Transfers are classified by WHO we paid
 * (driver→Transportation, part-timer→Part-Timers, fabrication→Fabrication, …),
 * never by the bank. The real merchant behind a card-terminal ("Network") or the
 * owner's own name ("Eventana") is taken from the expense vendor, not the OCR
 * supplier name. Anything we cannot place with confidence is left "Uncategorised"
 * and reported, never guessed.
 *
 * RECATEGORIZE = 'dry'   → compute + log the full distribution + samples, write nothing.
 *              = 'apply' → write expenses.category (backs up the old one to category_original once).
 */
import { pool } from './pool.js';

// ── Target chart of accounts ────────────────────────────────────────────────
const CAT = {
  TRANSPORT: 'Transportation', PART: 'Part-Timers', FAB: 'Fabrication',
  KIOSKS: 'Kiosks Project', RENT: 'Rentals', PRINT: 'Printing', PURCH: 'Purchases',
  DECOR: 'Decor', BALLOON: 'Balloons', FLOWER: 'Flowers', FOOD: 'Food',
  CONSUM: 'Consumables', GOV: 'Government & Licence', UTIL: 'Utilities',
  MAINT: 'Maintenance', MARKETING: 'Marketing', SALARY: 'Salaries',
  OFFICE: 'Rent & Office', FEES: 'Bank & Fees', UNK: 'Uncategorised',
};

// Fallback: map an expense's EXISTING (owner/QB-assigned) category into the new
// chart. These labels already carry real meaning, so use them when the receipt
// gives no signal. Substring match, first hit wins; 'other'/'uncategorised' stay
// Uncategorised (genuinely unknown).
const EXISTING: [string, string][] = [
  ['part time', CAT.PART], ['part-time', CAT.PART], ['performer', CAT.PART], ['clown', CAT.PART], ['face paint', CAT.PART],
  ['petrol', CAT.TRANSPORT], ['fuel', CAT.TRANSPORT], ['transport', CAT.TRANSPORT], ['taxi', CAT.TRANSPORT],
  ['delivery', CAT.TRANSPORT], ['driver', CAT.TRANSPORT], ['salik', CAT.TRANSPORT], ['van', CAT.TRANSPORT],
  ['equipment rental', CAT.RENT], ['rental', CAT.RENT],
  ['rent', CAT.OFFICE], ['office', CAT.OFFICE],
  ['salar', CAT.SALARY], ['wage', CAT.SALARY], ['payroll', CAT.SALARY],
  ['market', CAT.MARKETING], ['advertis', CAT.MARKETING], ['ads', CAT.MARKETING], ['promo', CAT.MARKETING],
  ['print', CAT.PRINT], ['signage', CAT.PRINT],
  ['balloon', CAT.BALLOON], ['flower', CAT.FLOWER], ['decor', CAT.DECOR],
  ['food', CAT.FOOD], ['cater', CAT.FOOD], ['consumable', CAT.CONSUM],
  ['maintenance', CAT.MAINT], ['repair', CAT.MAINT],
  ['utilit', CAT.UTIL], ['electric', CAT.UTIL], ['water', CAT.UTIL], ['internet', CAT.UTIL],
  ['licen', CAT.GOV], ['government', CAT.GOV], ['legal', CAT.GOV], ['visa', CAT.GOV], ['fee', CAT.GOV], ['insurance', CAT.GOV],
  ['bank', CAT.FEES], ['charge', CAT.FEES], ['commission', CAT.FEES],
  ['purchase', CAT.PURCH], ['supplie', CAT.PURCH], ['supply', CAT.PURCH], ['plush', CAT.PURCH],
  ['inventor', CAT.PURCH], ['material', CAT.PURCH], ['stock', CAT.PURCH], ['gift', CAT.PURCH], ['cost of sale', CAT.PURCH],
];
function mapExisting(cat: string): string | null {
  const c = (cat ?? '').toLowerCase();
  if (!c || /uncategor|other expense|^other$|miscellan/.test(c)) return null;
  for (const [k, v] of EXISTING) if (c.includes(k)) return v;
  return null;
}

// OCR category_guess → chart (used for normal shop purchases).
const OCR2CAT: Record<string, string> = {
  decor: CAT.DECOR, balloons: CAT.BALLOON, flowers: CAT.FLOWER, food: CAT.FOOD,
  consumables: CAT.CONSUM, giveaways: CAT.PURCH, stationery: CAT.PURCH,
  packaging: CAT.PURCH, transport: CAT.TRANSPORT, fuel: CAT.TRANSPORT,
  furniture: CAT.PURCH, electronics: CAT.PURCH, printing: CAT.PRINT,
  toys: CAT.PURCH, salary: CAT.PART,
};

// Name buckets for transfer recipients (owner-confirmed + data-derived).
const DRIVERS = ['zufer', 'arfan', 'abraiz', 'abdul majeed', 'masih', 'muhammad rashid', ' rashid', 'ijaz', 'obaid', 'majid', 'abdulillah', 'shan', 'afzal', 'gulroz', 'external delivery', 'drivers payment'];
const PARTTIMERS = ['lady gonzalez', 'gonzalez', 'dindo', 'boron', 'joeven', 'ignacio', 'norba', 'tumbaga', 'elena', 'miranda', 'jesiah', 'muyco', 'angelica', 'napoleon', 'part timer'];
const FAB_ALAA = ['alaa', 'almouie', 'almouje'];        // Fabrication (stands/kiosks/woodwork)
const RENTALS = ['best moments', 'umbreen'];             // equipment / table-chair rental
// Owner routed these to Marsha — do NOT guess; keep Uncategorised(pending).
const PENDING = ['zeeshan', 'asruddin', 'faraz', 'muneeb', 'al samiah', 'sheem ibrahim'];

// Keyword → chart, checked against a haystack of vendor+supplier+desc+items.
const KW: [string, string][] = [
  // transport
  ['careem', CAT.TRANSPORT], ['uber', CAT.TRANSPORT], ['bolt', CAT.TRANSPORT], ['hala taxi', CAT.TRANSPORT],
  [' taxi', CAT.TRANSPORT], ['taxi ', CAT.TRANSPORT], ['porter', CAT.TRANSPORT], ['salik', CAT.TRANSPORT],
  ['darb', CAT.TRANSPORT], ['rta', CAT.TRANSPORT], ['metro', CAT.TRANSPORT], ['petrol', CAT.TRANSPORT],
  ['adnoc', CAT.TRANSPORT], ['enoc', CAT.TRANSPORT], ['eppco', CAT.TRANSPORT], ['fuel', CAT.TRANSPORT],
  ['zufer', CAT.TRANSPORT], ['external driver', CAT.TRANSPORT], ['2 wheeler', CAT.TRANSPORT],
  // utilities
  ['etisalat', CAT.UTIL], [' du ', CAT.UTIL], ['du telecom', CAT.UTIL], ['internet', CAT.UTIL],
  // government & licence
  ['ministry', CAT.GOV], ['taqeem', CAT.GOV], ['licence', CAT.GOV], ['license', CAT.GOV],
  ['immigration', CAT.GOV], ['labour', CAT.GOV], ['mohre', CAT.GOV], ['tasheel', CAT.GOV],
  ['tas heel', CAT.GOV], ['municipality', CAT.GOV], ['insurance', CAT.GOV], ['ded ', CAT.GOV],
  ['businessmen services', CAT.GOV], ['typing', CAT.GOV], ['documents clearing', CAT.GOV], ['clixx', CAT.GOV],
  ['trade license', CAT.GOV], ['registration', CAT.GOV],
  // printing / signage
  ['blue rhine', CAT.PRINT], ['eon print', CAT.PRINT], ['ebn print', CAT.PRINT], ['adventure sign', CAT.PRINT],
  ['forex', CAT.PRINT], ['printing', CAT.PRINT], ['signage', CAT.PRINT], ['alreem ad', CAT.PRINT], ['maf printing', CAT.PRINT],
  // rentals
  ['best moments', CAT.RENT], ['rental', CAT.RENT], ['equipment rental', CAT.RENT],
  // fabrication
  ['alaa', CAT.FAB], ['almouie', CAT.FAB], ['almouje', CAT.FAB],
  // marketing
  ['facebook', CAT.MARKETING], ['meta platforms', CAT.MARKETING], ['google ads', CAT.MARKETING], ['tiktok', CAT.MARKETING],
  ['snapchat', CAT.MARKETING], ['instagram', CAT.MARKETING], ['advertis', CAT.MARKETING], [' ads', CAT.MARKETING], ['boosting', CAT.MARKETING],
  // transport (delivery)
  ['external delivery', CAT.TRANSPORT],
  // part-timers (vendor tag)
  ['part timer', CAT.PART], ['part-timer', CAT.PART],
  // payment providers / fees
  ['tabby', CAT.FEES], ['ziina', CAT.FEES], ['stripe', CAT.FEES], ['bank charge', CAT.FEES],
  // consumables / food hints
  ['balloon', CAT.BALLOON], ['flower', CAT.FLOWER], ['cake', CAT.FOOD], ['bakery', CAT.FOOD], ['dairy', CAT.FOOD], ['restaurant', CAT.FOOD],
];

// A vendor that looks like a registered company is almost certainly a shop we
// bought from → Purchases (when nothing more specific matched).
function looksLikeCompany(s: string): boolean {
  return /\b(trading|l\.?l\.?c|fzco|fze|fzc|co\.? ?ltd|industry|industries|general trading|est\b|enterprise|dmcc|hypermarket|supermarket|store|mart|shop|textile|stationery)\b/.test(s);
}

function has(hay: string, needles: string[]): boolean { return needles.some((n) => hay.includes(n)); }

type Row = {
  id: string; category: string; vendor: string | null; description: string | null; fils: string;
  supplier_name: string | null; recipient: string | null; payment_type: string | null;
  category_guess: string | null; items: any;
};

function classify(r: Row): { cat: string; why: string } {
  const sup = (r.supplier_name ?? '').toLowerCase();
  const vend = (r.vendor ?? '').toLowerCase();
  const rec = (r.recipient ?? '').toLowerCase();
  const desc = (r.description ?? '').toLowerCase();
  const itemTxt = Array.isArray(r.items) ? r.items.map((i: any) => (i?.name ?? '')).join(' ').toLowerCase() : '';
  const hay = `${vend} ${sup} ${desc} ${itemTxt} ${rec}`;

  // Is this a money transfer we sent (bank/card slip)? Then classify by WHO.
  const isTransfer = (r.payment_type ?? '') === 'transfer'
    || /adib|islamic bank/.test(sup) || /^transfer/.test(itemTxt.trim());
  const who = rec || vend || sup; // counterparty

  if (isTransfer) {
    if (has(who, PENDING) || has(hay, PENDING)) return { cat: CAT.UNK, why: 'pending-marsha' };
    if (has(who, ['zaki'])) return { cat: CAT.KIOSKS, why: 'transfer→Zaki (kiosks project)' };
    if (has(who, FAB_ALAA)) return { cat: CAT.FAB, why: 'transfer→fabrication' };
    if (has(who, RENTALS)) return { cat: CAT.RENT, why: 'transfer→rental' };
    if (has(who, DRIVERS)) return { cat: CAT.TRANSPORT, why: 'transfer→driver' };
    if (has(who, PARTTIMERS)) return { cat: CAT.PART, why: 'transfer→part-timer' };
    // transfer that paid a supplier → use the supplier keyword rules on the vendor name
    for (const [k, c] of KW) if (who.includes(k) || hay.includes(k)) return { cat: c, why: `transfer→supplier (${k})` };
    if (/eventana|sheem|shaima/.test(who)) {
      // owner is the beneficiary → classify by the vendor (real shop) via keywords, else Uncategorised
      for (const [k, c] of KW) if (vend.includes(k)) return { cat: c, why: `owner-beneficiary→${k}` };
    }
    // A company-looking counterparty paid by transfer → a supplier Purchase.
    if (looksLikeCompany(who)) return { cat: CAT.PURCH, why: 'transfer→company' };
    const exT = mapExisting(r.category);
    if (exT) return { cat: exT, why: `transfer→existing:${r.category}` };
    return { cat: CAT.UNK, why: 'transfer, recipient unknown' };
  }

  // Normal purchase. First strong keyword rules (vendor is the real merchant even
  // when the OCR supplier is "Network"/"Eventana").
  if (has(who, ['zaki'])) return { cat: CAT.KIOSKS, why: 'zaki (kiosks project)' };
  for (const [k, c] of KW) if (hay.includes(k)) return { cat: c, why: `kw:${k}` };

  // Then the OCR category guess.
  const g = (r.category_guess ?? '').toLowerCase();
  if (g && OCR2CAT[g]) return { cat: OCR2CAT[g], why: `ocr:${g}` };

  // Then the expense's EXISTING category (owner/QB-assigned) — real signal.
  const ex = mapExisting(r.category);
  if (ex) return { cat: ex, why: `existing:${r.category}` };

  // A real merchant + items → a Purchase.
  if (((sup && !/network|eventana|adib|islamic bank/.test(sup)) || vend) && itemTxt)
    return { cat: CAT.PURCH, why: 'merchant+items' };
  // A company-looking vendor/supplier → a Purchase.
  if (looksLikeCompany(`${vend} ${sup}`)) return { cat: CAT.PURCH, why: 'company-name' };

  return { cat: CAT.UNK, why: 'no signal' };
}

export async function recategorizeExpensesFromEnv(): Promise<void> {
  const mode = String(process.env.RECATEGORIZE ?? '').toLowerCase();
  if (mode !== 'dry' && mode !== 'apply') return;
  const dry = mode === 'dry';
  if (!dry) await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS category_original TEXT`);

  const { rows } = await pool.query<Row>(
    `SELECT e.id, e.category, e.vendor, e.description, e.amount_fils AS fils,
            ro.supplier_name, ro.recipient, ro.payment_type, ro.category_guess, ro.items
       FROM expenses e LEFT JOIN receipt_ocr ro ON ro.expense_id = e.id`,
  );
  console.log(`[recat] mode=${mode} · ${rows.length} expenses`);

  const dist: Record<string, { n: number; fils: number }> = {};
  const unresolved: { id: string; vendor: string; fils: number; why: string }[] = [];
  let changed = 0;
  const BATCH: [string, string][] = [];

  for (const r of rows) {
    const { cat, why } = classify(r);
    dist[cat] = dist[cat] ?? { n: 0, fils: 0 };
    dist[cat].n++; dist[cat].fils += Number(r.fils) || 0;
    if (cat === CAT.UNK) unresolved.push({ id: r.id, vendor: r.vendor ?? r.supplier_name ?? '-', fils: Number(r.fils) || 0, why });
    if (cat !== r.category) { changed++; BATCH.push([r.id, cat]); }
  }

  console.log(`[recat] ── distribution (target categories) ──`);
  for (const [c, v] of Object.entries(dist).sort((a, b) => b[1].fils - a[1].fils))
    console.log(`[recat] ${c.padEnd(22)} ${String(v.n).padStart(4)} · AED ${(v.fils / 100).toFixed(0).padStart(8)}`);
  console.log(`[recat] would change ${changed} of ${rows.length} · unresolved ${unresolved.length}`);

  // Show the biggest unresolved so the owner can decide those.
  console.log(`[recat] ── top unresolved (need a rule / owner) ──`);
  for (const u of unresolved.sort((a, b) => b.fils - a.fils).slice(0, 30))
    console.log(`[recat] UNRESOLVED #${u.id} · AED ${(u.fils / 100).toFixed(0)} · "${u.vendor}" · ${u.why}`);

  if (!dry) {
    // Back up the original category once, then apply in chunks.
    let done = 0;
    for (const [id, cat] of BATCH) {
      await pool.query(
        `UPDATE expenses SET category_original = COALESCE(category_original, category), category = $2 WHERE id = $1`,
        [id, cat],
      );
      done++;
    }
    console.log(`[recat] APPLIED — ${done} expenses recategorised (original saved to category_original)`);
  }
  console.log(`[recat] DONE (${mode})`);
}
