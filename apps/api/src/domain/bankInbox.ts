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

export interface ParsedAlert {
  amountFils: number;
  direction: 'debit' | 'credit';
  kind: 'purchase' | 'withdrawal' | 'transfer' | 'other';
  merchant: string | null;
  postedOn: string | null; // YYYY-MM-DD
}

const clean = (s: string) => s.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();

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

  const amountMatch = text.match(/AED\s*([\d,]+(?:\.\d{1,2})?)/i);
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

  const description = (opts.description ?? tx.merchant ?? 'Bank transaction').toString().slice(0, 300);
  const vendor = (opts.vendor ?? tx.merchant ?? null);
  const category = (opts.category ?? (tx.kind === 'transfer' ? 'transfer' : 'general')).toString().slice(0, 80);
  const paymentMethod = opts.paymentMethod ?? (tx.kind === 'transfer' ? 'bank_transfer' : 'card');
  const spentOn = opts.spentOn ?? tx.posted_on ?? null;
  const receiptUrl = opts.receiptUrl ?? tx.receipt_url ?? null;

  const exp = await pool.query<{ id: string }>(
    `INSERT INTO expenses (category, description, amount_fils, vendor, spent_on, receipt_url, payment_method, recorded_by, source)
     VALUES ($1,$2,$3,$4,COALESCE($5::date, current_date),$6,$7,$8,'bank') RETURNING id`,
    [category, description, tx.amount_fils, vendor, spentOn, receiptUrl, paymentMethod, actor],
  );
  const expenseId = String(exp.rows[0].id);
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
