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
import { pool, withTransaction } from '../db/pool.js';
import { pushToOwner } from '../integrations/push.js';
import { uploadBytes } from '../integrations/cloudinary.js';

export interface ParsedAlert {
  amountFils: number;
  direction: 'debit' | 'credit';
  kind: 'purchase' | 'withdrawal' | 'transfer' | 'other';
  merchant: string | null;
  postedOn: string | null; // YYYY-MM-DD
  foreignCurrency?: boolean; // charged in a non-AED currency → amount 0, needs review
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

/**
 * A human-readable reference/receipt/transaction number to SHOW on the row (and
 * carry to the expense), so the owner can see it and duplicates are obvious.
 * Best-effort across providers; display only (de-dup uses stableReference/hash).
 */
function referenceLabel(subject: string, text: string): string | null {
  const hay = stripInvisible(`${subject}\n${text}`);
  const anth = hay.match(/#\s*(\d{4}-\d{4}-\d{4})/);            // Anthropic/Stripe receipt no.
  if (anth) return `#${anth[1]}`;
  const inv = hay.match(/Invoice[-\s]?([A-Z0-9]{5,}-\d{3,})/i); // Stripe invoice no.
  if (inv) return `Invoice-${inv[1].toUpperCase()}`;
  const gen = hay.match(/(?:receipt|invoice|order|payout|reference|txn|transaction)\s*(?:no\.?|number|id|#|:)\s*([A-Z0-9][A-Z0-9\-\/]{4,})/i);
  if (gen) return gen[1].toUpperCase();
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
  // Strip tracking URLs first — a forwarded RAKBANK alert is mostly footer links,
  // and a stray number inside one used to be grabbed as the amount.
  const text = clean(`${subject ?? ''}\n${body ?? ''}`).replace(/https?:\/\/\S+/gi, ' ');

  // Amount in dirhams, in any common shape: "AED 100.00", "AED100", "100.00 AED",
  // "Dhs 100", "100 Dirhams", "د.إ 100", "100 درهم". Currency before OR after.
  const CUR = 'AED|AED\\.|Dhs?|Dirhams?|د\\.?\\s?إ|درهم';
  const num = '([\\d,]+(?:\\.\\d{1,2})?)';
  // PREFER the amount that sits next to the transaction verb ("AED 170.00 is
  // charged / debited / spent"), so a footer/fee number never wins over it.
  // Never read an amount from a running balance ("Available balance AED 5,000.00").
  const amtText = text.replace(new RegExp(`\\bbalance\\b[^\\d\\n]{0,40}?(?:(?:${CUR})\\s*)?[\\d,]+(?:\\.\\d{1,2})?(?:\\s*(?:${CUR}))?`, 'gi'), ' ');
  const charged = amtText.match(new RegExp(`(?:${CUR})\\s*${num}\\s+(?:is|was|has been|been)?\\s*(?:charged|debited|spent|paid|withdrawn)`, 'i'));
  // A charge in a FOREIGN currency ("USD 25.00 is charged") must never be booked
  // at rate 1 (nor replaced by some other AED figure in the email) — amount 0,
  // flagged for review.
  const FX = 'USD|US\\$|EUR|€|GBP|£|SAR|QAR|KWD|BHD|OMR|INR|PKR|EGP|JPY|CNY|CHF|CAD|AUD|SGD|HKD|TRY';
  const fxCharged = amtText.match(new RegExp(`(?:${FX})\\s*${num}\\s+(?:is|was|has been|been)?\\s*(?:charged|debited|spent|paid|withdrawn)`, 'i'))
    ?? amtText.match(new RegExp(`${num}\\s*(?:${FX})\\s+(?:is|was|has been|been)?\\s*(?:charged|debited|spent|paid|withdrawn)`, 'i'));
  const pre = amtText.match(new RegExp(`(?:${CUR})\\s*${num}`, 'i'));
  const post = amtText.match(new RegExp(`${num}\\s*(?:${CUR})`, 'i'));
  // RAKBANK's overdraft/settlement + some card emails label it "Amount: 29.16"
  // with NO currency next to the number — read that too.
  const labeled = amtText.match(/\bamount\b\s*:\s*(?:AED\s*)?([\d,]+(?:\.\d{1,2})?)/i);
  // A bare "AED <n>" (no verb next to it) is only trusted when the email clearly
  // IS a transaction — otherwise a promo/marketing "AED 99" would become a fake
  // charge. The verb-adjacent (`charged`) and labeled ("Amount:") matches are
  // always trusted.
  const hasTxnContext = /\bcharged\b|\bdebited\b|\bspent\b|withdraw|transaction|purchase|settle|date of debit/i.test(text);
  const foreignCurrency = !charged && !!fxCharged;
  const amountMatch = foreignCurrency ? fxCharged : (charged ?? labeled ?? (hasTxnContext ? (pre ?? post) : null));
  if (!amountMatch) return null;
  const amountFils = foreignCurrency ? 0 : Math.round(parseFloat(amountMatch[1].replace(/,/g, '')) * 100);

  const low = text.toLowerCase();
  let direction: ParsedAlert['direction'] = 'debit';
  let kind: ParsedAlert['kind'] = 'purchase';
  // CREDIT only on strong account-context signals — not a bare "received"/"refund"
  // /"deposit" that might just be part of a merchant name. Credits are dropped, so
  // a mislabelled credit = a LOST expense; we bias to debit and require real
  // wording ("credited to your", "inward transfer", "received in your account"…).
  if (/credited to your|has been credited|inward (?:transfer|remittance)|received (?:money|in your|into your)|deposit(?:ed)? (?:to|into|in) your|refund(?:ed)? to your|transferred to your account/.test(low)) {
    direction = 'credit'; kind = 'other';
  }
  if (/withdraw|cash withdrawal|atm/.test(low)) kind = 'withdrawal';
  if (/transfer/.test(low) && direction === 'debit') kind = 'transfer';
  // Explicit OUTGOING signals win over any credit keyword — a settlement / card
  // charge that says "debited", "Date of Debit", "is charged", "spent" or
  // "withdrawn" is money OUT even if a merchant name looked inward.
  if (/\bdebited\b|date of debit|is charged|charged on your|\bspent\b|withdrawn from your|purchase at/.test(low)) {
    direction = 'debit'; if (kind === 'other') kind = 'purchase';
  }

  // Merchant: labeled "Merchant Name: X" (RAKBANK settlement format), else
  // "from <X> on <date>", or "to <X>" for transfers, or "at <X>".
  let merchant: string | null = null;
  const mName = text.match(/merchant name\s*:\s*([^\n]+)/i);
  const m1 = text.match(/\bfrom\s+(.+?)\s+on\s+\d{1,2}[/-]\d{1,2}/i);
  const m2 = text.match(/\b(?:to|at)\s+(.+?)(?:\s+on\s+\d|\.|$)/i);
  merchant = (mName?.[1] ?? m1?.[1] ?? m2?.[1] ?? '').trim() || null;
  if (merchant) {
    // Cut off any following label that ran into it (the HTML had no separator, so
    // "ZED MOBILITYDate of Debit:" — no word boundary to rely on).
    merchant = merchant.split(/date of debit|overdrawn account|amount\s*:|reference\s*:|date of/i)[0]
      .replace(/\s+/g, ' ').trim().slice(0, 120) || null;
  }

  // Date: "Date of Debit: DD-MM-YYYY" (settlement format), else "on DD/MM" or
  // "DD/MM/YYYY". Year defaults to Dubai's current year.
  let postedOn: string | null = null;
  const dm = text.match(/date of debit\s*:\s*(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/i)
    ?? text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/);
  if (dm) {
    const dd = dm[1].padStart(2, '0');
    const mm = dm[2].padStart(2, '0');
    let yyyy = dm[3];
    if (!yyyy) yyyy = dubaiToday().slice(0, 4);
    else if (yyyy.length === 2) yyyy = '20' + yyyy;
    if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) {
      postedOn = `${yyyy}-${mm}-${dd}`;
      // Year rollover: an alert with no year ("on 31/12") read in early January
      // would land ~a year in the FUTURE. A bank debit can't be future-dated, so
      // anything more than 7 days ahead of Dubai today belongs to last year.
      if (!dm[3]) {
        const ahead = (Date.parse(`${postedOn}T00:00:00Z`) - Date.parse(`${dubaiToday()}T00:00:00Z`)) / 86_400_000;
        if (ahead > 7) postedOn = `${Number(yyyy) - 1}-${mm}-${dd}`;
      }
    }
  }
  if (!postedOn) postedOn = dubaiToday();

  return { amountFils, direction, kind, merchant, postedOn, ...(foreignCurrency ? { foreignCurrency: true } : {}) };
}

/** Raw-text flag for a regex-parsed foreign-currency charge (amount left at 0). */
const FX_REVIEW_NOTE = '⚠️ NEEDS REVIEW (foreign currency) — convert it to AED and set the amount before approving.';

/**
 * Cross-feed duplicate check, shared by EVERY path that queues a pending bank row
 * (RAKBANK alert, mailbox, Zoho, Wio/Wafeq, Stripe, manual). The same spend can
 * arrive from several feeds (e.g. a RAKBANK alert AND the Zoho feed, or Wio via
 * Zoho AND Wafeq), so before inserting a DEBIT we look for:
 *   1. a customer refund payout (refunds table, amount ±1 AED, refund recorded
 *      within a week of the bank date) — refunds already reduce cash, so the
 *      payout must NOT also become an expense;
 *   2. another bank row (any status except ignored) of the same amount (±1%)
 *      within ±3 days;
 *   3. an existing expense of the same amount (±1%) within ±3 days.
 * Returns a short description of the match (stored in possible_dup_of), or null.
 * It NEVER drops the row and never auto-approves/ignores — the row is still
 * queued, just flagged for the approver. Best-effort: a failed lookup = no flag.
 */
export type DupVerdict = { kind: 'refund' | 'exact' | 'fuzzy'; text: string } | null;

/**
 * Owner's rule (2026-11-10): Marsha must NOT get extra warnings to review.
 *  - 'refund' : the debit is a customer refund payout (already counted as a refund)
 *  - 'exact'  : the SAME amount on the same day (±1) is already here from ANOTHER
 *               feed, or already entered as an expense
 *  → both are filed automatically as IGNORED (kept, never deleted, with the reason)
 *    and never reach Marsha's approval list.
 *  - 'fuzzy'  : close but not certain (±1% amount, ±3 days) → stays pending but is
 *               shown to the OWNER only, with the reason.
 */
export async function findPossibleDuplicate(
  amountFils: number,
  postedOn: string | null | undefined,
  direction: 'debit' | 'credit',
  source?: string,
): Promise<DupVerdict> {
  if (direction !== 'debit' || !(amountFils > 0)) return null;
  const date = postedOn && /^\d{4}-\d{2}-\d{2}$/.test(postedOn) ? postedOn : dubaiToday();
  try {
    const refund = await pool.query<{ order_id: string }>(
      `SELECT order_id FROM refunds
        WHERE abs(amount_fils - $1) <= 100
          AND (created_at AT TIME ZONE 'Asia/Dubai')::date BETWEEN ($2::date - 7) AND ($2::date + 7)
        ORDER BY abs((created_at AT TIME ZONE 'Asia/Dubai')::date - $2::date), id DESC
        LIMIT 1`,
      [amountFils, date]);
    if (refund.rows[0]) return { kind: 'refund', text: `customer refund (already counted) — order ${refund.rows[0].order_id}` };

    // Exact: same amount, ±1 day, from a DIFFERENT feed (two 44 AED taxis on the
    // same RAKBANK feed are two real trips, not a duplicate).
    const exactBank = await pool.query<{ id: string; source: string; d: string }>(
      `SELECT id, source, to_char(posted_on,'YYYY-MM-DD') AS d FROM bank_transactions
        WHERE status <> 'ignored' AND direction = 'debit' AND amount_fils = $1
          AND posted_on BETWEEN ($2::date - 1) AND ($2::date + 1)
          AND ($3::text IS NULL OR source IS DISTINCT FROM $3)
        ORDER BY abs(posted_on - $2::date), id LIMIT 1`,
      [amountFils, date, source ?? null]);
    if (exactBank.rows[0]) {
      const b = exactBank.rows[0];
      return { kind: 'exact', text: `same payment already in the inbox — bank #${b.id} (${b.source}, ${b.d})` };
    }
    const exactExp = await pool.query<{ id: string; vendor: string | null; d: string }>(
      `SELECT id, vendor, to_char(spent_on,'YYYY-MM-DD') AS d FROM expenses
        WHERE amount_fils = $1 AND spent_on BETWEEN ($2::date - 1) AND ($2::date + 1)
          AND COALESCE(source,'manual') <> 'bank'
        ORDER BY abs(spent_on - $2::date), id LIMIT 1`,
      [amountFils, date]);
    if (exactExp.rows[0]) {
      const e = exactExp.rows[0];
      return { kind: 'exact', text: `already entered as expense #${e.id} (${(e.vendor ?? 'no vendor').slice(0, 40)}, ${e.d})` };
    }

    const lo = Math.floor(amountFils * 0.99);
    const hi = Math.ceil(amountFils * 1.01);
    const bank = await pool.query<{ id: string; source: string; d: string }>(
      `SELECT id, source, to_char(posted_on,'YYYY-MM-DD') AS d FROM bank_transactions
        WHERE status <> 'ignored' AND direction = 'debit'
          AND amount_fils BETWEEN $1 AND $2
          AND posted_on BETWEEN ($3::date - 3) AND ($3::date + 3)
          AND ($4::text IS NULL OR source IS DISTINCT FROM $4)
        ORDER BY abs(posted_on - $3::date), id DESC
        LIMIT 1`,
      [lo, hi, date, source ?? null]);
    if (bank.rows[0]) {
      const b = bank.rows[0];
      return { kind: 'fuzzy', text: `close to bank #${b.id} (${b.source}, ${b.d})` };
    }
    const exp = await pool.query<{ id: string; vendor: string | null; d: string }>(
      `SELECT id, vendor, to_char(spent_on,'YYYY-MM-DD') AS d FROM expenses
        WHERE amount_fils BETWEEN $1 AND $2
          AND spent_on BETWEEN ($3::date - 3) AND ($3::date + 3)
          AND COALESCE(source,'manual') <> 'bank'
        ORDER BY abs(spent_on - $3::date), id DESC
        LIMIT 1`,
      [lo, hi, date]);
    if (exp.rows[0]) {
      const e = exp.rows[0];
      return { kind: 'fuzzy', text: `close to expense #${e.id} (${(e.vendor ?? 'no vendor').slice(0, 40)}, ${e.d})` };
    }
  } catch (err) {
    console.error('[bank-inbox] duplicate check failed:', (err as Error).message);
  }
  return null;
}

/** Status + decision columns for a new bank row given the duplicate verdict. */
function dupStatus(v: DupVerdict): { status: string; decidedBy: string | null; flag: string | null } {
  if (v && (v.kind === 'refund' || v.kind === 'exact')) return { status: 'ignored', decidedBy: 'system (auto: duplicate / refund)', flag: v.text };
  return { status: 'pending', decidedBy: null, flag: v?.text ?? null };
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
  // Money IN (inward transfer / deposit / refund to our account) is NOT an expense
  // — never queue it for approval. (The Zoho feed already skips the money-in side.)
  if (p?.direction === 'credit') return null;
  // Cross-source de-dup: the same debit may already be here from the Zoho feed
  // (or any other source / an expense). Never drop it — queue it FLAGGED so the
  // approver sees "possible duplicate of …" instead of approving it twice.
  const verdict = dupStatus(await findPossibleDuplicate(p?.amountFils ?? 0, p?.postedOn ?? dubaiToday(), p?.direction ?? 'debit', source));
  const possibleDup = verdict.flag;
  const ins = await pool.query<{ id: string }>(
    `INSERT INTO bank_transactions (posted_on, amount_fils, direction, kind, merchant, raw_text, source, dedupe_key, status, possible_dup_of, decided_by, decided_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$10,$9,$11, CASE WHEN $10 = 'ignored' THEN now() END) RETURNING id`,
    [
      p?.postedOn ?? dubaiToday(),
      p?.amountFils ?? 0,
      p?.direction ?? 'debit',
      p?.kind ?? 'other',
      p?.merchant ?? null,
      p?.foreignCurrency ? `${FX_REVIEW_NOTE}\n\n${raw}`.slice(0, 4000) : raw,
      source,
      dedupeKey,
      possibleDup,
      verdict.status,
      verdict.decidedBy,
    ],
  );
  const id = String(ins.rows[0].id);
  // Filed automatically (exact duplicate / customer refund) — nobody is pinged.
  if (verdict.status === 'ignored') return { id };

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
  // Anthropic (Claude) receipts — matched on the ACTUAL receipt markers (sender
  // address or "receipt from Anthropic, PBC"), checked anywhere because a
  // forwarded email carries the original sender in the body. NOT a loose mention
  // of "anthropic"/"claude.ai" (a newsletter that name-drops Claude must not turn
  // into a phantom USD expense).
  if (/invoice\+statements@mail\.anthropic\.com|receipt from anthropic|anthropic,\s*pbc|your receipt from anthropic/.test(all)) return 'anthropic';
  if (/tabby/.test(head)) return 'tabby';
  if (/tamara/.test(head)) return 'tamara';
  // RAKBANK — the bank sender, or the real alert wording. NOT a loose "credit
  // card"/"your card" substring (a marketing/promo mail must not become a fake
  // charge).
  if (/rakbank|rak bank|@rakbank\.ae|is charged on your|debited from your account|withdrawn from your|spent on your (?:debit|credit) card/.test(all)) return 'rakbank';
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
  // Prefer a LABELLED total. We deliberately do NOT fall back to "any $ figure"
  // (that could grab a discount/credit/plan-price line); if no label matches, the
  // bare-decimal MAX fallback below is a safer guess for the real total.
  let usd = dollar('amount paid') ?? dollar('total paid') ?? dollar('\\btotal\\b') ?? dollar('amount due') ?? dollar('amount');
  // Fallback: some Anthropic/Stripe emails render the amount without a "$" next
  // to it in the text (the body is mostly invisible pre-header padding + download
  // links, and the number sits bare, e.g. "310.29"). Strip URLs and long token
  // blobs (base64/ids), then take the largest plain decimal as the USD amount.
  if (usd == null) {
    const stripped = flat
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/[A-Za-z0-9%._+/=-]{18,}/g, ' ');
    const nums = [...stripped.matchAll(/(?<![\d.])(\d{1,3}(?:,\d{3})*\.\d{2})(?!\d)/g)]
      .map((m) => parseFloat(m[1].replace(/,/g, '')))
      .filter((n) => Number.isFinite(n) && n > 0 && n < 100000);
    if (nums.length) usd = Math.max(...nums);
  }
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
export interface InboxEmail { subject: string; from: string; text: string; attachments: InboxAttachment[]; messageId?: string; }

export interface LlmTx {
  isTransaction: boolean;
  direction: 'debit' | 'credit' | null;
  currency: string | null;
  amount: number | null;   // in the stated currency (e.g. 170.00), NOT fils
  merchant: string | null;
  date: string | null;     // YYYY-MM-DD
  confident: boolean;      // true only if amount + direction + merchant are unambiguous
  note: string | null;
}

/**
 * Read ONE transaction out of a bank/receipt email with Claude — far more robust
 * than field regexes for the many RAKBANK/receipt layouts. It returns null when
 * Claude isn't configured or the call fails (caller falls back to regex), and it
 * is told to prefer null + confident:false over GUESSING, so we can flag unclear
 * rows for review instead of saving wrong data. 15s timeout so a hang can't stall
 * the poll cycle.
 */
export async function llmExtractTransaction(subject: string, from: string, text: string): Promise<LlmTx | null> {
  const { generateText, anthropicEnabled } = await import('../integrations/anthropic.js');
  if (!anthropicEnabled()) return null;
  const body = `FROM: ${from}\nSUBJECT: ${subject}\n\nBODY:\n${text}`.replace(/https?:\/\/\S+/g, ' ').slice(0, 6000);
  const system = [
    'You extract ONE bank/payment transaction from a bank-alert or receipt email for a UAE events company\'s expense book.',
    `Today's date in Dubai is ${dubaiToday()}. UAE bank dates are written DD/MM (or DD/MM/YYYY), never MM/DD; a date with no year is in the past, closest to today.`,
    'Return ONLY minified JSON, no prose:',
    '{"isTransaction":bool,"direction":"debit"|"credit"|null,"currency":string|null,"amount":number|null,"merchant":string|null,"date":"YYYY-MM-DD"|null,"confident":bool,"note":string|null}',
    'Rules:',
    '- isTransaction=false for: statement-ready notices, OTP/verification, marketing, beneficiary-added notices, and pending/"Under Process" notices with no settled amount.',
    '- direction: "debit"=money OUT (charged/debited/spent/purchase/paid/settlement fee); "credit"=money IN (credited/received/inward transfer/deposit/refund to your account).',
    '- amount: the transaction amount as a number in its currency (e.g. 170.00). NEVER a fee/VAT line, running balance, card number, phone number, reference or a date. If unsure which number is the amount, set amount=null and confident=false.',
    '- merchant: the payee/merchant/vendor NAME only. NEVER a status ("Under Process"), an account number, or a card number. null if not clearly a name.',
    '- date: the transaction/debit date as YYYY-MM-DD. null if unclear.',
    '- confident: true ONLY if amount, direction AND merchant are clearly and unambiguously present. If ANY is a guess, confident=false and say why in note.',
    '- Never invent values. Prefer null + confident:false over guessing.',
  ].join('\n');
  let out: string | null = null;
  try {
    out = await Promise.race([
      generateText({ system, prompt: body, maxTokens: 300 }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
    ]);
  } catch { return null; }
  if (!out) return null;
  try {
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]) as Record<string, unknown>;
    return {
      isTransaction: Boolean(p.isTransaction),
      direction: p.direction === 'credit' ? 'credit' : p.direction === 'debit' ? 'debit' : null,
      currency: typeof p.currency === 'string' ? p.currency : null,
      amount: Number.isFinite(Number(p.amount)) && Number(p.amount) > 0 ? Number(p.amount) : null,
      merchant: typeof p.merchant === 'string' && p.merchant.trim() ? p.merchant.trim().slice(0, 120) : null,
      date: typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : null,
      confident: Boolean(p.confident),
      note: typeof p.note === 'string' ? p.note.slice(0, 200) : null,
    };
  } catch { return null; }
}

/** Pick the best receipt attachment: prefer a PDF, then any, under Cloudinary's limit. */
function pickReceiptAttachment(atts: InboxAttachment[]): InboxAttachment | null {
  const isPdf = (a: InboxAttachment) => /pdf/i.test(a.contentType) || /\.pdf$/i.test(a.filename);
  const isImage = (a: InboxAttachment) => /^image\/(?:jpe?g|png|webp|gif|hei[cf])$/i.test(a.contentType) || /\.(?:jpe?g|png|webp|gif|hei[cf])$/i.test(a.filename);
  // Only PDFs and images — never an .html/.svg/.exe etc. on our Cloudinary.
  const ok = atts.filter((a) => a.bytes.length > 0 && a.bytes.length <= 10 * 1024 * 1024 && (isPdf(a) || isImage(a)));
  if (ok.length === 0) return null;
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
  // De-dupe key, in order of reliability:
  //  1. a STABLE receipt/transaction reference (Anthropic receipt no.) — so
  //     re-forwarding the same receipt never doubles it, and two different
  //     receipts never collide.
  //  2. the email's Message-ID — unique per email, so a re-read never re-inserts
  //     an email we already captured, YET two genuinely-identical same-day bank
  //     charges (separate emails, different Message-IDs) are BOTH kept.
  //  3. a content hash (last resort, e.g. a forward with no Message-ID).
  const ref = stableReference(provider, subject, text);
  const dedupeBasis = ref ? `ref|${ref}`
    : msg.messageId ? `mid|${msg.messageId}`
    : `${source}|${stripInvisible(raw)}`;
  const dedupeKey = createHash('sha256').update(dedupeBasis).digest('hex');

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
  let needsReview = false; // the LLM read the email but wasn't sure — flag, don't guess

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
  } else if (provider === 'tabby' || provider === 'tamara') {
    // Settlement couldn't be parsed. Do NOT fall through to the generic "AED <n>"
    // grabber — in a Tabby/Tamara payout the first amount is the GROSS SALES
    // figure, and booking that as an expense would massively overstate spend.
    // Capture a zero-amount row so the owner sets the real fee manually.
    amountFils = 0;
    direction = 'debit';
    kind = 'other';
    settlementNote = `${providerLabel(provider, from)} payout — couldn't read the settlement fee automatically, please set it`;
  } else {
    // Generic bank alert — read the fields with Claude first (accurate across the
    // many RAKBANK layouts, and it won't mistake a status like "Under Process" for
    // a merchant, a fee for the amount, or the wrong date). Regex is the fallback
    // when Claude is unavailable. Anything Claude isn't sure about is FLAGGED for
    // review rather than guessed.
    // Only spend an LLM call when the email plausibly IS a transaction (a bank
    // sender, or money/transaction wording) — skip OTP/marketing/newsletters.
    const looksTransactional = provider === 'rakbank'
      || /\baed\b|\bdhs?\b|\$|\bamount\b|charged|debited|\bspent\b|transaction|payment|receipt|invoice|purchase|withdraw/i.test(`${subject}\n${text}`);
    const llm = looksTransactional ? await llmExtractTransaction(subject, from, text) : null;
    if (llm && !llm.isTransaction) {
      // Statement / OTP / marketing / pending-only per the model — but a model
      // misread must not silently LOSE a real charge: capture at amount 0 and let
      // the noise filter / attachment check below decide (owner reviews the rest).
      amountFils = 0;
      kind = 'other';
    } else if (llm) {
      direction = llm.direction ?? 'debit';
      kind = 'purchase';
      // Only AED (1:1) and USD (fixed peg) convert automatically. ANY other
      // currency must NOT be booked at rate 1 (that records the raw foreign number
      // as AED) — leave the amount at 0 (approval is blocked until a real AED
      // amount is entered) and flag it for review.
      const cur = (llm.currency ?? 'AED').toUpperCase();
      const rate = cur === 'USD' ? AED_PER_USD : cur === 'AED' ? 1 : null;
      amountFils = (rate != null && llm.amount != null) ? Math.round(llm.amount * rate * 100) : 0;
      if (rate == null) {
        needsReview = true;
        settlementNote = `⚠️ NEEDS REVIEW — amount is in ${cur}; convert it to AED and set the amount before approving.`;
      }
      if (llm.merchant) merchant = llm.merchant;
      // Only trust the model's date inside a sane window (a DD/MM ↔ MM/DD swap or
      // a hallucinated year lands outside it); else keep the regex-parsed date.
      const regexDate = parseRakbankAlert(subject, text)?.postedOn ?? dubaiToday();
      postedOn = regexDate;
      if (llm.date) {
        const diff = (Date.parse(`${llm.date}T00:00:00Z`) - Date.parse(`${dubaiToday()}T00:00:00Z`)) / 86_400_000;
        if (Number.isFinite(diff) && diff >= -120 && diff <= 1) postedOn = llm.date;
      }
      if (!llm.confident) {
        needsReview = true;
        settlementNote = `⚠️ NEEDS REVIEW — auto-read may be wrong${llm.note ? `: ${llm.note}` : ''}. Check the amount, vendor and date against the email before approving.`;
      }
    } else {
      const p = parseRakbankAlert(subject, text);
      if (p) {
        amountFils = p.amountFils;
        direction = p.direction;
        kind = p.kind;
        postedOn = p.postedOn ?? dubaiToday();
        merchant = p.merchant ?? merchant;
        if (p.foreignCurrency) { needsReview = true; settlementNote = FX_REVIEW_NOTE; }
      }
    }
  }
  merchant = merchant.slice(0, 120);
  if (!Number.isFinite(amountFils) || amountFils < 0) amountFils = 0;

  // The owner's rule: EVERY email that lands in the bank mailbox must appear in
  // the approval queue for review — Tabby, Tamara, Anthropic, a bank charge, or
  // any other receipt — never silently dropped, even if the amount couldn't be
  // read (she sets it or rejects). The ONLY thing we skip is pure system noise
  // (one-time codes, verification, beneficiary/marketing) that has no amount AND
  // no attachment — those are never a transaction.
  const alwaysCapture = provider === 'anthropic' || provider === 'tabby' || provider === 'tamara' || needsReview;
  // INWARD money (a credit — received / deposit / inward remittance) is NOT an
  // expense; don't queue it. Anthropic/Tabby/Tamara are always outgoing; a
  // flagged (needs-review) row is kept so the owner can judge it.
  if (direction === 'credit' && !alwaysCapture) return null;
  const hasAttachment = (msg.attachments ?? []).some((a) => a.bytes && a.bytes.length > 0);
  // NOTE: no generic footer words like "unsubscribe" here — those appear in real
  // receipt emails too, and would silently drop a genuine expense.
  const NOISE_RE = /one[-\s]?time (?:pass|code)|passcode|\botp\b|verification code|verify your|confirm your email|email address has changed|added to apple pay|new beneficiary|you'?re now connected|reset your password|log[-\s]?in attempt|new sign[-\s]?in/i;
  if (amountFils <= 0 && !hasAttachment && !alwaysCapture && NOISE_RE.test(`${subject}\n${text}`)) return null;

  // Keep a readable summary at the top of raw_text (fee/amount note + the
  // reference/receipt number) so it shows in the Bank Inbox and carries into the
  // expense on approval — the reference number also makes any duplicate obvious.
  const refDisplay = referenceLabel(subject, text);
  const head = [settlementNote, refDisplay ? `Ref ${refDisplay}` : ''].filter(Boolean).join(' · ');
  const rawText = head ? `${head}\n\n${raw}`.slice(0, 4000) : raw;

  // Upload the first receipt-like attachment (PDF/CSV/…) to Cloudinary.
  let receiptUrl: string | null = null;
  const att = pickReceiptAttachment(msg.attachments ?? []);
  if (att) {
    receiptUrl = await uploadBytes(new Uint8Array(att.bytes), 'eventana/receipts', att.filename).catch(() => null);
  }

  const verdict = dupStatus(await findPossibleDuplicate(amountFils, postedOn, direction, provider === 'other' ? source : provider));
  const ins = await pool.query<{ id: string }>(
    `INSERT INTO bank_transactions (posted_on, amount_fils, direction, kind, merchant, raw_text, source, dedupe_key, status, receipt_url, possible_dup_of, decided_by, decided_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$11,$9,$10,$12, CASE WHEN $11 = 'ignored' THEN now() END) RETURNING id`,
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
      verdict.flag,
      verdict.status,
      verdict.decidedBy,
    ],
  );
  const id = String(ins.rows[0].id);
  // Filed automatically (exact duplicate / customer refund) — nobody is pinged.
  if (verdict.status === 'ignored') return { id } as any;

  // Ping Marsha + owner when there's real money, a known provider, or a receipt
  // attached. Other captured-for-review rows sit quietly in the Bank Inbox.
  if (amountFils > 0 || alwaysCapture || att) {
    const aed = (amountFils / 100).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const tag = provider === 'other' ? '' : `${providerLabel(provider, from)} · `;
    // Only say "receipt attached" if it actually uploaded (a failed upload leaves
    // receiptUrl null).
    const clip = receiptUrl ? ' 📎 receipt attached' : '';
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
  const verdict = dupStatus(await findPossibleDuplicate(t.amountFils, t.postedOn, t.direction, t.source));
  const ins = await pool.query<{ id: string }>(
    `INSERT INTO bank_transactions (posted_on, amount_fils, direction, kind, merchant, raw_text, source, dedupe_key, status, receipt_url, possible_dup_of, decided_by, decided_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$11,$9,$10,$12, CASE WHEN $11 = 'ignored' THEN now() END) RETURNING id`,
    [t.postedOn, t.amountFils, t.direction, t.kind, (t.merchant ?? '').slice(0, 120) || null, t.raw.slice(0, 4000), t.source, t.dedupeKey, t.receiptUrl ?? null, verdict.flag, verdict.status, verdict.decidedBy],
  );
  return { id: String(ins.rows[0].id) };
}

/**
 * Feed heartbeat: each automatic feed (Zoho, Wafeq/Wio, Stripe) records its last
 * SUCCESSFUL run in app_kv. checkFeedStale() — called on every attempt — warns
 * owner + Marsha with the "bank feed stopped" push when the last success is more
 * than 24h old (at most once a day per feed), so a broken token / API outage
 * can't stop expenses flowing silently.
 */
const FEED_STALE_MS = 24 * 60 * 60 * 1000;
export async function noteFeedSuccess(feed: string): Promise<void> {
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO UPDATE SET v = now()`, [`feed_ok_${feed}`]).catch(() => {});
  await pool.query(`DELETE FROM app_kv WHERE k = $1`, [`feed_stale_alert_${feed}`]).catch(() => {});
}
export async function checkFeedStale(feed: string, label: string): Promise<void> {
  try {
    // First sighting: baseline now, so a feed that NEVER succeeds still alerts.
    await pool.query(`INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [`feed_ok_${feed}`]);
    const r = await pool.query<{ ok: Date; alerted: Date | null }>(
      `SELECT (SELECT v FROM app_kv WHERE k = $1) AS ok, (SELECT v FROM app_kv WHERE k = $2) AS alerted`,
      [`feed_ok_${feed}`, `feed_stale_alert_${feed}`]);
    const ok = r.rows[0]?.ok ? new Date(r.rows[0].ok).getTime() : Date.now();
    const alerted = r.rows[0]?.alerted ? new Date(r.rows[0].alerted).getTime() : 0;
    if (Date.now() - ok <= FEED_STALE_MS || Date.now() - alerted < FEED_STALE_MS) return;
    const hours = Math.floor((Date.now() - ok) / 3_600_000);
    console.warn(`[feed-watch] ${label} has not synced successfully for ${hours}h — alerting owner + Marsha.`);
    const title = '⚠️ Bank feed stopped updating';
    const bodyMsg = `${label} hasn't synced for ${hours} hours. Expenses from it aren't reaching the Bank Inbox — check the connection.`;
    const targets = await pool.query<{ id: string }>(
      `SELECT id FROM team_members WHERE active AND (lower(name) = 'marsha' OR access_level = 'owner')`,
    );
    for (const t of targets.rows) {
      await pushToOwner('staff', t.id, title, bodyMsg, {}).catch(() => {});
    }
    await pool.query(`INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO UPDATE SET v = now()`, [`feed_stale_alert_${feed}`]);
  } catch (err) {
    console.error('[feed-watch] check failed:', (err as Error).message);
  }
}

export interface BankTxRow {
  id: string; posted_on: string | null; amount_fils: number; direction: string;
  kind: string; merchant: string | null; raw_text: string | null; status: string;
  receipt_url: string | null; expense_id: string | null; decided_by: string | null;
  possible_dup_of: string | null;
}

/** Bank Inbox list — pending first, newest first. */
export async function listBankTransactions(status?: string): Promise<BankTxRow[]> {
  const where = status && status !== 'all' ? `WHERE status = $1` : '';
  const params = status && status !== 'all' ? [status] : [];
  const { rows } = await pool.query<BankTxRow>(
    `SELECT id, to_char(posted_on,'YYYY-MM-DD') AS posted_on, amount_fils, direction, kind,
            merchant, raw_text, status, receipt_url, expense_id, decided_by, possible_dup_of
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
  opts: { category?: string; vendor?: string | null; receiptUrl?: string | null; spentOn?: string | null; description?: string | null; paymentMethod?: string | null; amountFils?: number | null; note?: string | null; lineItems?: Array<{ name: string; qty: number; unitFils?: number | null }>; charges?: { vatFils: number; deliveryFils: number; discountFils: number; otherFils: number } },
  actor: string,
): Promise<{ ok: boolean; reason?: string; expenseId?: string }> {
  // EX3: claim + post atomically. Without a lock, two concurrent approvals both
  // pass the pending check and both INSERT the expense (double money/double email).
  // `SELECT … FOR UPDATE` serialises approvers on this row: the second waits for
  // the first to COMMIT, then reads status='approved' and returns early. All the
  // writes (expense INSERT + status flip) commit together or not at all.
  let supplierToAdd: string | null = null;
  const result = await withTransaction<{ ok: boolean; reason?: string; expenseId?: string }>(async (db) => {
    const { rows } = await db.query<any>(`SELECT * FROM bank_transactions WHERE id = $1 LIMIT 1 FOR UPDATE`, [id]);
    const tx = rows[0];
    if (!tx) return { ok: false, reason: 'not_found' };
    if (tx.status !== 'pending') return { ok: false, reason: `already_${tx.status}` };
    // Money IN is never an expense — refuse to post a credit as spend, whatever
    // source queued it (guards against a mis-ingested inward transfer / deposit).
    if (String(tx.direction) === 'credit') return { ok: false, reason: 'not_an_expense' };

    // The amount can be corrected at approval (rows captured with amount 0 when it
    // couldn't be read). A non-positive amount must never post as an expense.
    const amountFils = Math.round(Number(opts.amountFils ?? tx.amount_fils) || 0);
    if (amountFils <= 0) return { ok: false, reason: 'amount_required' };

    const isSettlement = tx.source === 'tabby' || tx.source === 'tamara';
    const isAnthropic = tx.source === 'anthropic' || String(tx.merchant ?? '').toLowerCase() === 'anthropic';
    // For settlement fees, the raw_text starts with the readable fee breakdown.
    const settlementDesc = (isSettlement || isAnthropic)
      ? String(tx.raw_text ?? '').split('\n')[0].slice(0, 300)
      : null;
    const description = (opts.description ?? settlementDesc ?? tx.merchant ?? 'Bank transaction').toString().slice(0, 300);
    const vendor = (opts.vendor ?? tx.merchant ?? '').toString().trim() || null;
    // Vendor is MANDATORY on every expense (owner's rule). Block approval — on any
    // screen — that would create a vendorless expense, so the approver must set one.
    if (!vendor) return { ok: false, reason: 'vendor_required' };
    const isFee = isSettlement || tx.source === 'stripe' || tx.source === 'ziina';
    const defaultCategory = isFee ? 'Payments/Bank fees' : isAnthropic ? 'Dues and Subscriptions' : tx.kind === 'transfer' ? 'transfer' : 'general';
    const category = (opts.category ?? defaultCategory).toString().slice(0, 80);
    const paymentMethod = opts.paymentMethod ?? (isSettlement ? 'settlement' : tx.kind === 'transfer' ? 'bank_transfer' : 'card');
    const spentOn = opts.spentOn ?? tx.posted_on ?? null;
    const receiptUrl = opts.receiptUrl ?? tx.receipt_url ?? null;

    const note = (opts.note ?? '').toString().trim().slice(0, 500) || null;
    const exp = await db.query<{ id: string }>(
      `INSERT INTO expenses (category, description, amount_fils, vendor, spent_on, receipt_url, payment_method, recorded_by, source, note, line_items, extra_charges)
       VALUES ($1,$2,$3,$4,COALESCE($5::date, current_date),$6,$7,$8,'bank',$9,$10::jsonb,$11::jsonb) RETURNING id`,
      [category, description, amountFils, vendor, spentOn, receiptUrl, paymentMethod, actor, note, JSON.stringify(opts.lineItems ?? []), JSON.stringify(opts.charges ?? {})],
    );
    const expenseId = String(exp.rows[0].id);
    // If the amount was corrected at approval, reflect it on the bank row too.
    if (amountFils !== Number(tx.amount_fils)) {
      await db.query(`UPDATE bank_transactions SET amount_fils = $2 WHERE id = $1`, [id, amountFils]);
    }

    await db.query(
      `UPDATE bank_transactions SET status='approved', expense_id=$2, receipt_url=COALESCE($3, receipt_url), decided_by=$4, decided_at=now() WHERE id=$1`,
      [id, expenseId, receiptUrl, actor],
    );
    // Remember the supplier for the best-effort directory upsert AFTER commit (a
    // failure there must not roll back a posted expense, nor poison this tx).
    supplierToAdd = vendor;
    return { ok: true, expenseId };
  });

  // If the supplier chosen at approval isn't in our list yet, add it — so it's
  // reusable and shows in the supplier autocomplete next time. Idempotent, and
  // best-effort: outside the approval transaction so it can never undo the post.
  if (result.ok && supplierToAdd && String(supplierToAdd).trim()) {
    const name = String(supplierToAdd).trim().slice(0, 200);
    await pool.query(
      `INSERT INTO suppliers (name, created_by)
       SELECT $1, $2
       WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE lower(btrim(name)) = lower(btrim($1)))`,
      [name, actor],
    ).catch(() => {});
  }

  return result;
}

/** Ignore a pending transaction (OWNER-ONLY — enforced in the route). */
export async function ignoreBankTransaction(id: string, actor: string): Promise<{ ok: boolean; reason?: string }> {
  const { rows } = await pool.query<{ status: string }>(`SELECT status FROM bank_transactions WHERE id = $1 LIMIT 1`, [id]);
  if (!rows[0]) return { ok: false, reason: 'not_found' };
  if (rows[0].status !== 'pending') return { ok: false, reason: `already_${rows[0].status}` };
  // Conditional on still-pending: a concurrent approve must not be overwritten.
  const r = await pool.query(`UPDATE bank_transactions SET status='ignored', decided_by=$2, decided_at=now() WHERE id=$1 AND status='pending'`, [id, actor]);
  if ((r.rowCount ?? 0) === 0) return { ok: false, reason: 'not_found_or_decided' };
  return { ok: true };
}

/** Attach/replace a receipt on a pending row (before approval). */
export async function setBankTransactionReceipt(id: string, receiptUrl: string | null): Promise<boolean> {
  const r = await pool.query(`UPDATE bank_transactions SET receipt_url=$2 WHERE id=$1 AND status='pending'`, [id, receiptUrl]);
  return (r.rowCount ?? 0) > 0;
}
