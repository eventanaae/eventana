/**
 * Bank Inbox (#16) — turn RAKBANK transaction alerts into expenses.
 *
 * Flow: a RAKBANK alert email is forwarded to our webhook → parsed into a
 * PENDING bank_transactions row (raw kept, nothing dropped) → Marsha attaches a
 * receipt and approves → it posts to `expenses` (source='bank'). Ignoring a row
 * is OWNER-ONLY (enforced in the route).
 *
 * The owner said the card number is NOT needed for the expense, so we don't
 * surface it — the fields that matter are amount, merchant, date and type.
 */
import { createHash } from 'node:crypto';
import { pool } from '../db/pool.js';
import { pushToOwner } from '../integrations/push.js';
import { uploadBytes } from '../integrations/cloudinary.js';

export interface ParsedAlert {
  amountFils: number;
  direction: 'debit' | 'credit';
  kind: 'purchase' | 'withdrawal' | 'transfer' | 'other';
  merchant: string | null;
  postedOn: string | null; // YYYY-MM-DD
}

const clean = (s: string) => s.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();

/** Strip zero-width / invisible padding (e.g. Stripe email preheaders) so two
 *  forwards of the same receipt normalise to the same text. */
const stripInvisible = (s: string) => s.replace(/[­​‌‍‎‏⁠͏﻿]/g, '');

/**
 * A STABLE reference for de-duplication: a receipt / transaction number that stays
 * the same no matter how many times the email is forwarded, or which client added
 * which "Fwd:"/"Re:" wrapper. This both prevents duplicates (the same receipt
 * re-forwarded) and prevents collisions (two different receipts). Returns null
 * when no reliable id is present — the caller then falls back to a content hash.
 */
function stableReference(provider: EmailProvider, subject: string, text: string): string | null {
  const hay = stripInvisible(`${subject}\n${text}`);
  if (provider === 'anthropic') {
    const r = hay.match(/#\s*(\d{4}-\d{4}-\d{4})/); // Stripe receipt no. "#2500-9350-0530"
    if (r) return `anthropic:receipt:${r[1]}`;
    const inv = hay.match(/Invoice-([A-Z0-9]{5,}-\d{3,})/i); // "Invoice-9MJWOD7D-0003"
    if (inv) return `anthropic:invoice:${inv[1].toUpperCase()}`;
  }
  return null;
}

/** Dubai "today" as YYYY-MM-DD, used when an alert has no year. */
function dubaiToday(): string {
  return new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Parse a RAKBANK alert. Tuned to the real format, e.g.:
 *   "AED 100.00 is charged on your Debit Card 546750******4008
 *    from ENOC SITE 1043 on 14/09."
 * Also handles credits ("credited"), withdrawals ("withdrawn"/"cash") and
 * transfers ("transferred"/"transfer to"). Returns null only if no amount at all.
 */
export function parseRakbankAlert(subject: string, body: string): ParsedAlert | null {
  const text = clean(`${subject ?? ''}\n${body ?? ''}`);

  // Amount in dirhams, in any common shape: "AED 100.00", "AED100", "100.00 AED",
  // "Dhs 100", "100 Dirhams", "د.إ 100", "100 درهم". Currency before OR after.
  const CUR = 'AED|AED\\.|Dhs?|Dirhams?|د\\.?\\s?إ|درهم';
  const num = '([\\d,]+(?:\\.\\d{1,2})?)';
  const pre = text.match(new RegExp(`(?:${CUR})\\s*${num}`, 'i'));
  const post = text.match(new RegExp(`${num}\\s*(?:${CUR})`, 'i'));
  const amountMatch = pre ?? post;
  if (!amountMatch) return null;
  const amountFils = Math.round(parseFloat(amountMatch[1].replace(/,/g, '')) * 100);

  const low = text.toLowerCase();
  let direction: ParsedAlert['direction'] = 'debit';
  let kind: ParsedAlert['kind'] = 'purchase';
  if (/credited|received|refund|deposit/.test(low)) { direction = 'credit'; kind = 'other'; }
  if (/withdraw|cash withdrawal|atm/.test(low)) kind = 'withdrawal';
  if (/transfer/.test(low)) kind = 'transfer';

  // Merchant: "from <X> on <date>", or "to <X>" for transfers, or "at <X>".
  let merchant: string | null = null;
  const m1 = text.match(/\bfrom\s+(.+?)\s+on\s+\d{1,2}[/-]\d{1,2}/i);
  const m2 = text.match(/\b(?:to|at)\s+(.+?)(?:\s+on\s+\d|\.|$)/i);
  merchant = (m1?.[1] ?? m2?.[1] ?? '').trim() || null;
  if (merchant) merchant = merchant.replace(/\s+/g, ' ').slice(0, 120);

  // Date: "on DD/MM" or "DD/MM/YYYY". Year defaults to Dubai's current year.
  let postedOn: string | null = null;
  const dm = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/);
  if (dm) {
    const dd = dm[1].padStart(2, '0');
    const mm = dm[2].padStart(2, '0');
    let yyyy = dm[3];
    if (!yyyy) yyyy = dubaiToday().slice(0, 4);
    else if (yyyy.length === 2) yyyy = '20' + yyyy;
    if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) {
      postedOn = `${yyyy}-${mm}-${dd}`;
    }
  }
  if (!postedOn) postedOn = dubaiToday();

  return { amountFils, direction, kind, merchant, postedOn };
}

/**
 * Ingest one alert: parse, de-dupe (a re-forwarded identical alert is skipped),
 * insert a PENDING row (raw always kept), and notify Marsha + the owner.
 * Returns the row id, or null if it was a duplicate / unparseable.
 */
export async function ingestBankAlert(subject: string, body: string, source = 'rakbank_email'): Promise<{ id: string; duplicate?: boolean } | null> {
  const raw = clean(`${subject ?? ''}\n${body ?? ''}`).slice(0, 4000);
  const dedupeKey = createHash('sha256').update(`${source}|${raw}`).digest('hex');

  const dup = await pool.query<{ id: string }>(`SELECT id FROM bank_transactions WHERE dedupe_key = $1 LIMIT 1`, [dedupeKey]);
  if (dup.rows[0]) return { id: String(dup.rows[0].id), duplicate: true };

  const p = parseRakbankAlert(subject, body);
  const ins = await pool.query<{ id: string }>(
    `INSERT INTO bank_transactions (posted_on, amount_fils, direction, kind, merchant, raw_text, source, dedupe_key, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending') RETURNING id`,
    [
      p?.postedOn ?? dubaiToday(),
      p?.amountFils ?? 0,
      p?.direction ?? 'debit',
      p?.kind ?? 'other',
      p?.merchant ?? null,
      raw,
      source,
      dedupeKey,
    ],
  );
  const id = String(ins.rows[0].id);

  // Notify Marsha (she attaches the receipt) — in-app + WhatsApp — and the owner.
  const aed = ((p?.amountFils ?? 0) / 100).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const where = p?.merchant ? ` at ${p.merchant}` : '';
  const title = '🏦 New bank transaction — needs a receipt';
  const bodyMsg = `AED ${aed}${where}. Open Bank Inbox, attach the receipt and approve.`;
  const targets = await pool.query<{ id: string }>(
    `SELECT id FROM team_members WHERE active AND (lower(name) = 'marsha' OR access_level = 'owner')`,
  );
  for (const t of targets.rows) {
    await pushToOwner('staff', t.id, title, bodyMsg, { bankTxId: id }).catch(() => {});
  }
  return { id };
}

/** A payment provider we can recognise from the sender/subject. */
export type EmailProvider = 'rakbank' | 'tabby' | 'tamara' | 'anthropic' | 'other';

function classifyProvider(from: string, subject: string, text: string): EmailProvider {
  const head = `${from} ${subject}`.toLowerCase();
  const all = `${head} ${text.toLowerCase()}`;
  // Anthropic (Claude) receipts — matched anywhere, because a forwarded email
  // carries the original sender inside the body, not in the From header.
  if (/anthropic|invoice\+statements@mail\.anthropic\.com|receipt from anthropic|claude\.ai/.test(all)) return 'anthropic';
  if (/tabby/.test(head)) return 'tabby';
  if (/tamara/.test(head)) return 'tamara';
  if (/rakbank|rak bank|debit card|credit card|your card|is charged/.test(all)) return 'rakbank';
  return 'other';
}

function providerLabel(provider: EmailProvider, from: string): string {
  if (provider === 'tabby') return 'Tabby';
  if (provider === 'tamara') return 'Tamara';
  if (provider === 'anthropic') return 'Anthropic';
  if (provider === 'rakbank') return 'RAKBANK';
  // Fall back to the sender's display name or email address.
  const name = (from.match(/^\s*"?([^"<]+?)"?\s*</)?.[1] ?? from.match(/<([^>]+)>/)?.[1] ?? from).trim();
  return (name || 'Email').slice(0, 120);
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function fils(s: string | undefined | null): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

const fmtAed = (f: number | null): string =>
  f == null ? '—' : (f / 100).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface Settlement {
  feeFils: number; salesFils: number | null; netFils: number | null;
  postedOn: string | null; description: string;
}

/**
 * Parse a Tabby/Tamara "payout" / settlement email. The expense we record is
 * what THEY deducted from us — the "Total deductions" line (commission + payout
 * fee + VAT). Real Tabby format:
 *   Sales AED 3053.00 · Total deductions − AED 219.39 · Commission − AED 202.94
 *   · Payout fee − AED 6.30 · VAT − AED 10.15 · Payout amount AED 2833.61
 * Returns null if no deduction total can be found (then we fall back to generic).
 */
export function parseSettlement(subject: string, text: string): Settlement | null {
  // Normalise the Unicode minus (−, U+2212) and collapse whitespace.
  const flat = `${subject}\n${text}`.replace(/−/g, '-').replace(/\s+/g, ' ');
  const after = (label: string): number | null => {
    const m = flat.match(new RegExp(`${label}\\D{0,25}?AED\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i'));
    return m ? fils(m[1]) : null;
  };
  const sales = after('\\bsales\\b');
  let deductions = after('total deductions');
  const commission = after('commission');
  const payoutFee = after('payout fee');
  const vat = after('\\bvat\\b');
  const net = after('payout amount') ?? after('you.{0,3}ll receive') ?? after('you will receive');
  if (deductions == null) {
    const parts = [commission, payoutFee, vat].filter((x): x is number => x != null);
    if (parts.length) deductions = parts.reduce((a, b) => a + b, 0);
  }
  if (deductions == null || deductions <= 0) return null;

  let postedOn: string | null = null;
  const md = flat.match(/(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i);
  if (md) postedOn = `${md[3]}-${String(MONTHS[md[2].toLowerCase()]).padStart(2, '0')}-${md[1].padStart(2, '0')}`;
  else { const iso = flat.match(/\b(\d{4})-(\d{2})-(\d{2})\b/); if (iso) postedOn = iso[0]; }

  const bits: string[] = [];
  if (commission != null) bits.push(`commission ${fmtAed(commission)}`);
  if (payoutFee != null) bits.push(`payout fee ${fmtAed(payoutFee)}`);
  if (vat != null) bits.push(`VAT ${fmtAed(vat)}`);
  const breakdown = bits.length ? ` (${bits.join(' + ')})` : '';
  const ctx = [sales != null ? `sales ${fmtAed(sales)}` : '', net != null ? `net payout ${fmtAed(net)}` : '']
    .filter(Boolean).join(', ');
  const description = `Settlement fees ${fmtAed(deductions)}${breakdown}${ctx ? ` — ${ctx}` : ''}`.slice(0, 300);
  return { feeFils: deductions, salesFils: sales, netFils: net, postedOn, description };
}

/** AED is pegged to the US dollar at 3.6725; Anthropic bills in USD. */
const AED_PER_USD = 3.6725;

export interface AnthropicReceipt { amountFils: number; usd: number | null; postedOn: string | null; note: string; }

/**
 * Parse an Anthropic (Claude) receipt. These are Stripe-style receipts in USD,
 * e.g. "Receipt from Anthropic, PBC … Amount paid $21.00 … Date paid September
 * 20, 2026". We read the USD total, convert to AED at the fixed peg, and keep
 * the original dollar figure in the note so the conversion is transparent.
 * Returns amountFils 0 (not null) when no amount is found — the owner asked for
 * ANYTHING from Anthropic to be captured, so we never drop it.
 */
export function parseAnthropicReceipt(subject: string, text: string): AnthropicReceipt {
  const flat = `${subject}\n${text}`.replace(/ /g, ' ').replace(/\s+/g, ' ');
  // Prefer a labelled total, then any dollar amount. Accepts "$21.00", "US$21.00", "USD 21.00".
  const dollar = (label?: string): number | null => {
    const pre = `(?:US\\$|USD|\\$)\\s*([\\d,]+(?:\\.\\d{2})?)`; // $20.00 / US$20.00 / USD 20.00
    const suf = `([\\d,]+(?:\\.\\d{2})?)\\s*(?:USD|US\\$)`;      // 20.00 USD
    const one = (money: string) => {
      const m = flat.match(label ? new RegExp(`${label}\\D{0,20}?${money}`, 'i') : new RegExp(money, 'i'));
      if (!m) return null;
      const n = parseFloat(m[1].replace(/,/g, ''));
      return Number.isFinite(n) ? n : null;
    };
    return one(pre) ?? one(suf);
  };
  const usd = dollar('amount paid') ?? dollar('total paid') ?? dollar('\\btotal\\b') ?? dollar('amount') ?? dollar();
  const amountFils = usd != null ? Math.round(usd * AED_PER_USD * 100) : 0;

  // Date: "September 20, 2026" / "Sep 20, 2026" / "20 September 2026" / ISO.
  let postedOn: string | null = null;
  const mdY = flat.match(/(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\w*\s+(\d{1,2}),?\s+(\d{4})/i);
  const dMy = flat.match(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i);
  const monNum = (s: string): number => MONTHS[s.toLowerCase()] ?? MONTHS[Object.keys(MONTHS).find((k) => k.startsWith(s.toLowerCase())) ?? ''] ?? 0;
  if (mdY) { const mo = monNum(mdY[1]); if (mo) postedOn = `${mdY[3]}-${String(mo).padStart(2, '0')}-${mdY[2].padStart(2, '0')}`; }
  else if (dMy) { const mo = monNum(dMy[2]); if (mo) postedOn = `${dMy[3]}-${String(mo).padStart(2, '0')}-${dMy[1].padStart(2, '0')}`; }
  else { const iso = flat.match(/\b(\d{4})-(\d{2})-(\d{2})\b/); if (iso) postedOn = iso[0]; }

  const note = usd != null
    ? `Anthropic (Claude) — $${usd.toFixed(2)} → AED ${fmtAed(amountFils)} (converted at ${AED_PER_USD})`
    : `Anthropic (Claude) receipt — amount not detected, please set it`;
  return { amountFils, usd, postedOn, note };
}

export interface InboxAttachment { filename: string; contentType: string; bytes: Buffer; }
export interface InboxEmail { subject: string; from: string; text: string; attachments: InboxAttachment[]; }

/** Pick the best receipt attachment: prefer a PDF, then any, under Cloudinary's limit. */
function pickReceiptAttachment(atts: InboxAttachment[]): InboxAttachment | null {
  const ok = atts.filter((a) => a.bytes.length > 0 && a.bytes.length <= 10 * 1024 * 1024);
  if (ok.length === 0) return null;
  const isPdf = (a: InboxAttachment) => /pdf/i.test(a.contentType) || /\.pdf$/i.test(a.filename);
  // Prefer a file that looks like the receipt, then any PDF, then anything.
  return ok.find((a) => /receipt/i.test(a.filename) && isPdf(a))
    ?? ok.find(isPdf)
    ?? ok[0];
}

/**
 * Ingest ANY inbox email (not just RAKBANK): classify the provider, parse an
 * amount where one is present, upload the first receipt-like attachment to
 * Cloudinary, and create a PENDING bank_transactions row. Nothing is dropped —
 * an email with no amount is still captured (amount 0) for the owner to review.
 * Nothing posts to expenses until approved.
 */
export async function ingestInboxEmail(msg: InboxEmail, source = 'privateemail'): Promise<{ id: string; duplicate?: boolean } | null> {
  const subject = msg.subject ?? '';
  const from = msg.from ?? '';
  const text = msg.text ?? '';
  const provider = classifyProvider(from, subject, text);
  const raw = clean(`${subject}\n${from}\n${text}`).slice(0, 4000);
  // De-dupe by a STABLE reference (receipt/transaction number) when we can find
  // one — so re-forwarding the same receipt never double-records it, and two
  // different receipts never collide. Fall back to a content hash (with the
  // invisible forward-padding stripped so two forwards still match).
  const ref = stableReference(provider, subject, text);
  const dedupeKey = createHash('sha256')
    .update(ref ? `ref|${ref}` : `${source}|${stripInvisible(raw)}`)
    .digest('hex');

  const dup = await pool.query<{ id: string }>(`SELECT id FROM bank_transactions WHERE dedupe_key = $1 LIMIT 1`, [dedupeKey]);
  if (dup.rows[0]) return { id: String(dup.rows[0].id), duplicate: true };

  // For Tabby/Tamara payout emails, record what THEY deducted (the fee), not the
  // gross sales. Otherwise parseRakbankAlert doubles as a generic "AED <n>"
  // finder; an email with no amount is still captured (amount 0) for review.
  let amountFils = 0;
  let direction: 'debit' | 'credit' = 'debit';
  let kind: ParsedAlert['kind'] = 'other';
  let postedOn: string = dubaiToday();
  let merchant = providerLabel(provider, from);
  let settlementNote: string | null = null;

  const settle = provider === 'tabby' || provider === 'tamara' ? parseSettlement(subject, text) : null;
  if (settle) {
    amountFils = settle.feeFils;
    direction = 'debit'; // a fee = money out
    kind = 'other';
    postedOn = settle.postedOn ?? dubaiToday();
    settlementNote = settle.description;
  } else if (provider === 'anthropic') {
    // Anthropic receipts are in USD → convert to AED. The owner asked for
    // ANYTHING from Anthropic to be captured, so this never returns null.
    const a = parseAnthropicReceipt(subject, text);
    amountFils = a.amountFils;
    direction = 'debit';
    kind = 'other';
    postedOn = a.postedOn ?? dubaiToday();
    merchant = 'Anthropic';
    settlementNote = a.note;
  } else {
    const p = parseRakbankAlert(subject, text);
    if (p) {
      amountFils = p.amountFils;
      direction = p.direction;
      kind = p.kind;
      postedOn = p.postedOn ?? dubaiToday();
      merchant = p.merchant ?? merchant;
    }
  }
  merchant = merchant.slice(0, 120);

  // Not a real money transaction (statement, OTP, marketing, or an amount our
  // parser couldn't read) → don't create a zero-amount pending row that clutters
  // the review list. Real charges always have a positive amount. EXCEPTION:
  // Anthropic — the owner wants every Anthropic email captured for review even
  // if we couldn't read the amount, so she can set it and approve.
  if ((!Number.isFinite(amountFils) || amountFils <= 0) && provider !== 'anthropic') return null;
  if (!Number.isFinite(amountFils) || amountFils < 0) amountFils = 0;

  // Keep the human-readable fee breakdown at the top of raw_text so it shows in
  // the Bank Inbox and carries into the expense on approval.
  const rawText = settlementNote ? `${settlementNote}\n\n${raw}`.slice(0, 4000) : raw;

  // Upload the first receipt-like attachment (PDF/CSV/…) to Cloudinary.
  let receiptUrl: string | null = null;
  const att = pickReceiptAttachment(msg.attachments ?? []);
  if (att) {
    receiptUrl = await uploadBytes(new Uint8Array(att.bytes), 'eventana/receipts', att.filename).catch(() => null);
  }

  const ins = await pool.query<{ id: string }>(
    `INSERT INTO bank_transactions (posted_on, amount_fils, direction, kind, merchant, raw_text, source, dedupe_key, status, receipt_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9) RETURNING id`,
    [
      postedOn,
      amountFils,
      direction,
      kind,
      merchant,
      rawText,
      provider === 'other' ? source : provider,
      dedupeKey,
      receiptUrl,
    ],
  );
  const id = String(ins.rows[0].id);

  // Only ping Marsha + owner when there's real money to review. Zero-amount
  // emails (statements, OTPs, marketing, or a charge our parser couldn't read)
  // are still captured silently in the Bank Inbox — no notification noise.
  if (amountFils > 0 || provider === 'anthropic') {
    const aed = (amountFils / 100).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const tag = provider === 'other' ? '' : `${providerLabel(provider, from)} · `;
    const clip = att ? ' 📎 receipt attached' : '';
    const title = '🏦 New bank transaction — needs review';
    const amtPart = amountFils > 0 ? `AED ${aed} — ` : 'amount not read — ';
    const bodyMsg = `${tag}${amtPart}${merchant}.${clip} Open Bank Inbox to review and approve.`;
    const targets = await pool.query<{ id: string }>(
      `SELECT id FROM team_members WHERE active AND (lower(name) = 'marsha' OR access_level = 'owner')`,
    );
    for (const t of targets.rows) {
      await pushToOwner('staff', t.id, title, bodyMsg, { bankTxId: id }).catch(() => {});
    }
  }
  return { id };
}

/**
 * Insert a transaction from an external feed (e.g. the Wio bank feed via Wafeq)
 * as a PENDING bank_transactions row. De-duped by the caller-supplied key so a
 * re-poll never double-records. Insert-only (the caller handles notifications).
 */
export async function ingestExternalTxn(t: {
  amountFils: number;
  direction: 'debit' | 'credit';
  kind: ParsedAlert['kind'];
  merchant: string | null;
  postedOn: string;
  raw: string;
  source: string;
  dedupeKey: string;
  receiptUrl?: string | null;
}): Promise<{ id: string; duplicate?: boolean }> {
  const dup = await pool.query<{ id: string }>(`SELECT id FROM bank_transactions WHERE dedupe_key = $1 LIMIT 1`, [t.dedupeKey]);
  if (dup.rows[0]) return { id: String(dup.rows[0].id), duplicate: true };
  const ins = await pool.query<{ id: string }>(
    `INSERT INTO bank_transactions (posted_on, amount_fils, direction, kind, merchant, raw_text, source, dedupe_key, status, receipt_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9) RETURNING id`,
    [t.postedOn, t.amountFils, t.direction, t.kind, (t.merchant ?? '').slice(0, 120) || null, t.raw.slice(0, 4000), t.source, t.dedupeKey, t.receiptUrl ?? null],
  );
  return { id: String(ins.rows[0].id) };
}

export interface BankTxRow {
  id: string; posted_on: string | null; amount_fils: number; direction: string;
  kind: string; merchant: string | null; raw_text: string | null; status: string;
  receipt_url: string | null; expense_id: string | null; decided_by: string | null;
}

/** Bank Inbox list — pending first, newest first. */
export async function listBankTransactions(status?: string): Promise<BankTxRow[]> {
  const where = status && status !== 'all' ? `WHERE status = $1` : '';
  const params = status && status !== 'all' ? [status] : [];
  const { rows } = await pool.query<BankTxRow>(
    `SELECT id, to_char(posted_on,'YYYY-MM-DD') AS posted_on, amount_fils, direction, kind,
            merchant, raw_text, status, receipt_url, expense_id, decided_by
       FROM bank_transactions ${where}
      ORDER BY (status = 'pending') DESC, created_at DESC
      LIMIT 500`,
    params,
  );
  return rows;
}

/**
 * Approve a pending transaction → post it as an expense (source='bank') and mark
 * it approved. Allowed for Marsha + owner/manager (route-enforced).
 */
export async function approveBankTransaction(
  id: string,
  opts: { category?: string; vendor?: string | null; receiptUrl?: string | null; spentOn?: string | null; description?: string | null; paymentMethod?: string | null },
  actor: string,
): Promise<{ ok: boolean; reason?: string; expenseId?: string }> {
  const { rows } = await pool.query<any>(`SELECT * FROM bank_transactions WHERE id = $1 LIMIT 1`, [id]);
  const tx = rows[0];
  if (!tx) return { ok: false, reason: 'not_found' };
  if (tx.status !== 'pending') return { ok: false, reason: `already_${tx.status}` };

  const isSettlement = tx.source === 'tabby' || tx.source === 'tamara';
  const isAnthropic = tx.source === 'anthropic' || String(tx.merchant ?? '').toLowerCase() === 'anthropic';
  // For settlement fees, the raw_text starts with the readable fee breakdown.
  const settlementDesc = (isSettlement || isAnthropic)
    ? String(tx.raw_text ?? '').split('\n')[0].slice(0, 300)
    : null;
  const description = (opts.description ?? settlementDesc ?? tx.merchant ?? 'Bank transaction').toString().slice(0, 300);
  const vendor = (opts.vendor ?? tx.merchant ?? null);
  const defaultCategory = isSettlement ? 'Payment Fees' : isAnthropic ? 'Dues and Subscriptions' : tx.kind === 'transfer' ? 'transfer' : 'general';
  const category = (opts.category ?? defaultCategory).toString().slice(0, 80);
  const paymentMethod = opts.paymentMethod ?? (isSettlement ? 'settlement' : tx.kind === 'transfer' ? 'bank_transfer' : 'card');
  const spentOn = opts.spentOn ?? tx.posted_on ?? null;
  const receiptUrl = opts.receiptUrl ?? tx.receipt_url ?? null;

  const exp = await pool.query<{ id: string }>(
    `INSERT INTO expenses (category, description, amount_fils, vendor, spent_on, receipt_url, payment_method, recorded_by, source)
     VALUES ($1,$2,$3,$4,COALESCE($5::date, current_date),$6,$7,$8,'bank') RETURNING id`,
    [category, description, tx.amount_fils, vendor, spentOn, receiptUrl, paymentMethod, actor],
  );
  const expenseId = String(exp.rows[0].id);

  // If the supplier chosen at approval isn't in our list yet, add it — so it's
  // reusable and shows in the supplier autocomplete next time. Idempotent.
  if (vendor && String(vendor).trim()) {
    const name = String(vendor).trim().slice(0, 200);
    await pool.query(
      `INSERT INTO suppliers (name, created_by)
       SELECT $1, $2
       WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE lower(btrim(name)) = lower(btrim($1)))`,
      [name, actor],
    ).catch(() => {});
  }

  await pool.query(
    `UPDATE bank_transactions SET status='approved', expense_id=$2, receipt_url=COALESCE($3, receipt_url), decided_by=$4, decided_at=now() WHERE id=$1`,
    [id, expenseId, receiptUrl, actor],
  );
  return { ok: true, expenseId };
}

/** Ignore a pending transaction (OWNER-ONLY — enforced in the route). */
export async function ignoreBankTransaction(id: string, actor: string): Promise<{ ok: boolean; reason?: string }> {
  const { rows } = await pool.query<{ status: string }>(`SELECT status FROM bank_transactions WHERE id = $1 LIMIT 1`, [id]);
  if (!rows[0]) return { ok: false, reason: 'not_found' };
  if (rows[0].status !== 'pending') return { ok: false, reason: `already_${rows[0].status}` };
  await pool.query(`UPDATE bank_transactions SET status='ignored', decided_by=$2, decided_at=now() WHERE id=$1`, [id, actor]);
  return { ok: true };
}

/** Attach/replace a receipt on a pending row (before approval). */
export async function setBankTransactionReceipt(id: string, receiptUrl: string | null): Promise<boolean> {
  const r = await pool.query(`UPDATE bank_transactions SET receipt_url=$2 WHERE id=$1 AND status='pending'`, [id, receiptUrl]);
  return (r.rowCount ?? 0) > 0;
}
