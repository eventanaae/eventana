/**
 * QuickBooks Online integration — OAuth 2.0 (authorization_code) + token storage
 * and refresh, and an authenticated fetch helper for the Accounting API.
 *
 * Endpoints and the flow follow developer.intuit.com (OAuth 2.0). The client
 * secret is read from config (env only) and never logged. Access tokens last ~1h
 * and are refreshed with the ~100-day refresh token before every call when near
 * expiry, so a one-time consent keeps the connection alive.
 */
import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { uploadBytes } from '../integrations/cloudinary.js';

const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
// Minimal scope for reading the books (expenses, invoices, attachments) + who
// connected. Payments are not needed to read the ledger.
const SCOPES = 'com.intuit.quickbooks.accounting openid profile email';

function apiBase(): string {
  return config.quickbooks.environment === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

export function quickbooksConfigured(): boolean {
  return Boolean(config.quickbooks.clientId && config.quickbooks.clientSecret);
}

/** Stateless CSRF: a state value signed with the server's trust anchor. */
export function makeState(): string {
  const nonce = `${Date.now()}.${Math.round(performance.now())}`;
  const sig = createHmac('sha256', config.staffToken).update(nonce).digest('hex').slice(0, 24);
  return `${nonce}.${sig}`;
}
export function verifyState(state: string | undefined): boolean {
  if (!state) return false;
  const i = state.lastIndexOf('.');
  if (i < 0) return false;
  const nonce = state.slice(0, i);
  const sig = state.slice(i + 1);
  const expected = createHmac('sha256', config.staffToken).update(nonce).digest('hex').slice(0, 24);
  return sig === expected;
}

/** The Intuit consent URL to send the owner to. */
export function authorizeUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: config.quickbooks.clientId ?? '',
    response_type: 'code',
    scope: SCOPES,
    redirect_uri: config.quickbooks.redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${p.toString()}`;
}

function basicAuth(): string {
  return Buffer.from(`${config.quickbooks.clientId}:${config.quickbooks.clientSecret}`).toString('base64');
}

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number; x_refresh_token_expires_in?: number };

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`QuickBooks token endpoint ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Exchange the authorization code for tokens and persist the connection. */
export async function exchangeCode(code: string, realmId: string, connectedBy: string): Promise<void> {
  const t = await postToken(new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.quickbooks.redirectUri,
  }));
  await saveTokens(realmId, t, connectedBy);
}

async function saveTokens(realmId: string, t: TokenResponse, connectedBy?: string): Promise<void> {
  const expiresAt = new Date(Date.now() + (t.expires_in - 60) * 1000);
  const refreshExpiresAt = t.x_refresh_token_expires_in
    ? new Date(Date.now() + t.x_refresh_token_expires_in * 1000)
    : null;
  await pool.query(
    `INSERT INTO quickbooks_connection (id, realm_id, access_token, refresh_token, expires_at, refresh_expires_at, environment, connected_by, updated_at)
     VALUES (1,$1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT (id) DO UPDATE SET
       realm_id=EXCLUDED.realm_id, access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token,
       expires_at=EXCLUDED.expires_at, refresh_expires_at=EXCLUDED.refresh_expires_at,
       environment=EXCLUDED.environment,
       connected_by=COALESCE(EXCLUDED.connected_by, quickbooks_connection.connected_by), updated_at=now()`,
    [realmId, t.access_token, t.refresh_token, expiresAt, refreshExpiresAt, config.quickbooks.environment, connectedBy ?? null],
  );
}

type Connection = { realm_id: string; access_token: string; refresh_token: string; expires_at: string };

async function getConnection(): Promise<Connection | null> {
  const { rows } = await pool.query(`SELECT realm_id, access_token, refresh_token, expires_at FROM quickbooks_connection WHERE id=1`);
  return rows[0] ?? null;
}

/** A valid access token, refreshing first if it is at/near expiry. */
async function getAccessToken(): Promise<{ token: string; realmId: string }> {
  const conn = await getConnection();
  if (!conn) throw new Error('QuickBooks is not connected.');
  if (new Date(conn.expires_at).getTime() > Date.now()) {
    return { token: conn.access_token, realmId: conn.realm_id };
  }
  const t = await postToken(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refresh_token }));
  await saveTokens(conn.realm_id, t);
  return { token: t.access_token, realmId: conn.realm_id };
}

/** Authenticated GET against the Accounting API for the connected company. */
export async function qbGet(path: string): Promise<any> {
  const { token, realmId } = await getAccessToken();
  const url = `${apiBase()}/v3/company/${realmId}${path}${path.includes('?') ? '&' : '?'}minorversion=73`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`QuickBooks API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/** Run a QuickBooks SQL-ish query, returning the QueryResponse object. */
async function qbQuery(query: string): Promise<any> {
  const res = await qbGet(`/query?query=${encodeURIComponent(query)}`);
  return res?.QueryResponse ?? {};
}

/** Map a QuickBooks expense account name to one of our category buckets. */
function bucketFor(accountName: string | undefined): string {
  const n = (accountName ?? '').toLowerCase();
  if (/salary|payroll|wage|staff/.test(n)) return 'salaries';
  if (/rent|lease/.test(n)) return 'rent';
  if (/fuel|petrol|gas|transport|vehicle|car/.test(n)) return 'fuel';
  if (/market|advertis|ads|promo|social/.test(n)) return 'marketing';
  if (/maintenance|repair/.test(n)) return 'maintenance';
  if (/util|electric|water|internet|phone|dewa/.test(n)) return 'utilities';
  if (/supply|supplies|material|inventory|stock|purchase|cost of/.test(n)) return 'supplies';
  return 'other';
}

/**
 * Pull all expenses (Purchase entities) from QuickBooks together with their
 * receipt attachments, and upsert them into `expenses` (source='quickbooks',
 * idempotent on qb_id). Attachments are downloaded from Intuit's temporary URL
 * and re-hosted on Cloudinary so the receipt image survives.
 *
 * These rows are for browsing/receipts only — they're excluded from the live
 * profit sum because the imported P&L aggregate already counts them.
 */
export async function syncExpenses(onProgress?: (msg: string) => void): Promise<{ imported: number; withReceipt: number; total: number }> {
  // Log to the server console too, so progress is visible in the Render logs
  // regardless of who kicked the sync off (boot task or dashboard button).
  const log = (m: string) => { console.log(`[qb-sync] ${m}`); try { onProgress?.(m); } catch { /* ignore */ } };

  // Resume support: a receipt image already downloaded on a previous run keeps
  // its Cloudinary URL, so we never fetch + re-host it again. This makes the
  // whole job resumable — a restart (deploy, free-tier sleep) continues from
  // where it stopped instead of downloading the ~1,000+ images from scratch,
  // which is exactly why it never used to finish.
  const doneReceipts = new Set<string>();
  try {
    const r = await pool.query(
      `SELECT qb_id FROM expenses WHERE source='quickbooks' AND qb_id IS NOT NULL AND receipt_url IS NOT NULL`,
    );
    for (const row of r.rows) doneReceipts.add(String(row.qb_id));
    log(`Resuming — ${doneReceipts.size} receipts already downloaded`);
  } catch { /* first run, nothing to resume */ }

  // 1. Map every attachment to the Purchase it's attached to (id -> download URL).
  const attByPurchase = new Map<string, { uri: string; name: string }>();
  try {
    let pos = 1;
    for (;;) {
      const q = await qbQuery(`select * from Attachable startposition ${pos} maxresults 100`);
      const rows: any[] = q.Attachable ?? [];
      for (const a of rows) {
        const uri: string | undefined = a?.TempDownloadUri;
        if (!uri) continue;
        for (const ref of a.AttachableRef ?? []) {
          if (ref?.EntityRef?.type === 'Purchase' && ref?.EntityRef?.value) {
            attByPurchase.set(String(ref.EntityRef.value), { uri, name: a.FileName ?? 'receipt' });
          }
        }
      }
      if (rows.length < 100) break;
      pos += 100;
    }
    log(`Found ${attByPurchase.size} receipt attachments`);
  } catch (e) {
    log(`Attachment scan skipped: ${(e as Error).message}`);
  }

  // 2. Page through Purchases and upsert each.
  let imported = 0;
  let withReceipt = doneReceipts.size;
  let total = 0;
  let pos = 1;
  for (;;) {
    const q = await qbQuery(`select * from Purchase startposition ${pos} maxresults 100`);
    const rows: any[] = q.Purchase ?? [];
    for (const p of rows) {
      total++;
      const qbId = String(p.Id);
      const amountFils = Math.round(Number(p.TotalAmt ?? 0) * 100);
      const spentOn = p.TxnDate ?? null;
      const vendor: string | null = p.EntityRef?.name ?? null;
      // The expense account (the "category" in QuickBooks) lives on a line, and
      // the first line isn't always an AccountBasedExpenseLineDetail — so scan
      // every line for the first account/item reference and line memo.
      let accountName: string | undefined;
      let lineDesc: string | undefined;
      for (const l of (p.Line ?? []) as any[]) {
        if (!lineDesc && l?.Description) lineDesc = l.Description;
        const a =
          l?.AccountBasedExpenseLineDetail?.AccountRef?.name ||
          l?.ItemBasedExpenseLineDetail?.ItemRef?.name;
        if (a && !accountName) accountName = a;
      }
      const description = lineDesc || accountName || p.PrivateNote || 'QuickBooks expense';
      // Show the REAL QuickBooks account name (e.g. "Fuel", "Transportation",
      // "Salaries") instead of collapsing everything into a few buckets that
      // leave most rows as "Other". These rows are browse-only, so the raw
      // account name is what the owner actually wants to see.
      const category = (accountName ?? '').trim().slice(0, 60) || bucketFor(accountName);
      const paymentMethod = (p.PaymentType ?? '').toString().toLowerCase() || null;

      // Download + re-host the receipt image if this purchase has one AND we
      // haven't already fetched it on an earlier run (resume support).
      let receiptUrl: string | null = null;
      const att = attByPurchase.get(qbId);
      if (att && !doneReceipts.has(qbId)) {
        try {
          const r = await fetch(att.uri);
          if (r.ok) {
            const bytes = new Uint8Array(await r.arrayBuffer());
            receiptUrl = await uploadBytes(bytes, 'eventana/receipts', att.name);
            if (receiptUrl) { withReceipt++; doneReceipts.add(qbId); }
          }
        } catch { /* keep the expense even if the image fails */ }
      }

      await pool.query(
        `INSERT INTO expenses (category, description, amount_fils, vendor, spent_on, receipt_url, payment_method, recorded_by, source, qb_id)
         VALUES ($1,$2,$3,$4,COALESCE($5::date, current_date),$6,$7,'quickbooks','quickbooks',$8)
         ON CONFLICT (qb_id) WHERE qb_id IS NOT NULL DO UPDATE SET
           category=EXCLUDED.category, description=EXCLUDED.description, amount_fils=EXCLUDED.amount_fils,
           vendor=EXCLUDED.vendor, spent_on=EXCLUDED.spent_on, payment_method=EXCLUDED.payment_method,
           receipt_url=COALESCE(EXCLUDED.receipt_url, expenses.receipt_url)`,
        [category, description, amountFils, vendor, spentOn, receiptUrl, paymentMethod, qbId],
      );
      imported++;
    }
    log(`Imported ${imported} expenses, ${withReceipt} with receipts…`);
    if (rows.length < 100) break;
    pos += 100;
  }
  return { imported, withReceipt, total };
}

/**
 * Read-only preview: how many expenses / receipt attachments the connected
 * company has, and a small sample — WITHOUT writing anything. Used to validate
 * the pipeline (and show the owner what a sync would pull) before importing.
 */
export async function previewExpenses(): Promise<{ purchases: number; attachments: number; sample: any[] }> {
  const countOf = async (entity: string): Promise<number> => {
    const r = await qbQuery(`select count(*) from ${entity}`);
    return Number(r.totalCount ?? 0);
  };
  const [purchases, attachments] = await Promise.all([countOf('Purchase'), countOf('Attachable')]);
  const q = await qbQuery(`select * from Purchase maxresults 5`);
  const sample = (q.Purchase ?? []).map((p: any) => {
    const firstLine = (p.Line ?? []).find((l: any) => l?.DetailType === 'AccountBasedExpenseLineDetail');
    return {
      date: p.TxnDate ?? null,
      vendor: p.EntityRef?.name ?? null,
      amount: Number(p.TotalAmt ?? 0),
      account: firstLine?.AccountBasedExpenseLineDetail?.AccountRef?.name ?? null,
    };
  });
  return { purchases, attachments, sample };
}

/** Our three real methods: Tabby, Tamara, else Debit (no Cash — owner's rule). */
function labelForQbMethod(name: string | null | undefined): string {
  const n = (name ?? '').toLowerCase();
  if (n.includes('tabby')) return 'Tabby';
  if (n.includes('tamara')) return 'Tamara';
  return 'Debit';
}

/**
 * Read the real payment method for every QuickBooks sales document straight from
 * QuickBooks. A SalesReceipt carries its own PaymentMethodRef; an Invoice's
 * method lives on the linked Payment, so we map Payment → its invoices' DocNumbers.
 * Returns DocNumber → method-name (raw QuickBooks name).
 */
async function fetchQbDocMethods(log: (m: string) => void): Promise<Map<string, string>> {
  const byDoc = new Map<string, string>();
  // 1) SalesReceipt: method is on the document itself. QuickBooks only lets us
  //    project scalar columns, so read the whole entity and pick the fields.
  for (let pos = 1; ; pos += 100) {
    const q = await qbQuery(`select * from SalesReceipt startposition ${pos} maxresults 100`);
    const rows = q.SalesReceipt ?? [];
    for (const r of rows) {
      const doc = String(r.DocNumber ?? '').trim();
      const m = r.PaymentMethodRef?.name;
      if (doc && m) byDoc.set(doc, m);
    }
    if (rows.length < 100) break;
  }
  log(`sales receipts with a method: ${byDoc.size}`);
  // 2) Invoices are paid via Payment entities — map each Payment's method onto
  //    the invoice DocNumbers it settled.
  const invIdToDoc = new Map<string, string>();
  for (let pos = 1; ; pos += 100) {
    const q = await qbQuery(`select * from Invoice startposition ${pos} maxresults 100`);
    const rows = q.Invoice ?? [];
    for (const r of rows) if (r.Id && r.DocNumber) invIdToDoc.set(String(r.Id), String(r.DocNumber).trim());
    if (rows.length < 100) break;
  }
  let payMapped = 0;
  for (let pos = 1; ; pos += 100) {
    const q = await qbQuery(`select * from Payment startposition ${pos} maxresults 100`);
    const rows = q.Payment ?? [];
    for (const p of rows) {
      const m = p.PaymentMethodRef?.name;
      if (!m) continue;
      for (const line of p.Line ?? []) {
        for (const lt of line.LinkedTxn ?? []) {
          if (lt.TxnType === 'Invoice' && invIdToDoc.has(String(lt.TxnId))) {
            const doc = invIdToDoc.get(String(lt.TxnId))!;
            if (!byDoc.has(doc)) { byDoc.set(doc, m); payMapped++; }
          }
        }
      }
    }
    if (rows.length < 100) break;
  }
  log(`invoice methods via payments: ${payMapped}`);
  return byDoc;
}

/** Preview: what payment methods QuickBooks actually holds (logs only). */
export async function previewReceiptMethods(): Promise<void> {
  const log = (m: string) => console.log(`[qb-methods] ${m}`);
  const byDoc = await fetchQbDocMethods(log);
  const tally = new Map<string, number>();
  for (const m of byDoc.values()) tally.set(m, (tally.get(m) ?? 0) + 1);
  log(`distinct QuickBooks payment methods (${tally.size}):`);
  for (const [name, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
    log(`   "${name}" → ${labelForQbMethod(name)} · ${n} doc(s)`);
  }
  // How many of our receipts would actually get updated — and WHICH ones won't
  // (they'll stay Unknown), so the owner can see exactly what's left.
  const nums = await pool.query<{ number: string; customer_name: string; date: any; total_fils: any }>(
    `SELECT number, customer_name, to_char(date,'YYYY-MM-DD') AS date, total_fils
       FROM finance_receipts WHERE source='quickbooks' ORDER BY date`,
  );
  const unmatched = nums.rows.filter((r) => !byDoc.has(String(r.number).trim()));
  log(`our QB receipts: ${nums.rowCount} · matched: ${nums.rows.length - unmatched.length} · NO method in QuickBooks: ${unmatched.length}`);
  log(`receipts with NO payment method in QuickBooks (stay Unknown):`);
  for (const r of unmatched) log(`   #${r.number} · ${r.customer_name} · ${r.date} · AED ${(Number(r.total_fils) / 100).toLocaleString('en-US')}`);
}

/** Apply: set finance_receipts.paid_with from the real QuickBooks method. */
export async function syncReceiptPaymentMethods(): Promise<{ updated: number; matched: number }> {
  const log = (m: string) => console.log(`[qb-methods] ${m}`);
  const byDoc = await fetchQbDocMethods(log);
  const nums = await pool.query<{ number: string }>(`SELECT number FROM finance_receipts WHERE source='quickbooks'`);
  let updated = 0, matched = 0;
  for (const r of nums.rows) {
    const raw = byDoc.get(String(r.number).trim());
    if (!raw) continue;
    matched++;
    const label = labelForQbMethod(raw);
    const res = await pool.query(
      `UPDATE finance_receipts SET paid_with=$2 WHERE number=$1 AND paid_with IS DISTINCT FROM $2`,
      [r.number, label],
    );
    updated += res.rowCount ?? 0;
  }
  log(`matched ${matched}, updated ${updated} receipt payment method(s)`);
  return { updated, matched };
}

/** Boot entry: QB_METHODS=preview logs only; =apply writes the methods. */
export async function qbMethodsFromEnv(): Promise<void> {
  const mode = String(process.env.QB_METHODS ?? '').toLowerCase();
  if (mode !== 'preview' && mode !== 'apply') return;
  try {
    if (!quickbooksConfigured()) { console.log('[qb-methods] QuickBooks not connected — skipping.'); return; }
    if (mode === 'apply') await syncReceiptPaymentMethods();
    else await previewReceiptMethods();
  } catch (err) {
    console.error('[qb-methods] failed:', (err as Error).message);
  }
}

// ── Background sync job (one at a time) ──────────────────────────────────────
type SyncState = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  message: string;
  result: { imported: number; withReceipt: number; total: number } | null;
  error: string | null;
};
let syncState: SyncState = { running: false, startedAt: null, finishedAt: null, message: '', result: null, error: null };

export function syncStatus(): SyncState {
  return syncState;
}

/** Kick off the expense sync in the background. Returns immediately. */
export function startExpenseSync(): { started: boolean; already: boolean } {
  if (syncState.running) return { started: false, already: true };
  syncState = { running: true, startedAt: new Date().toISOString(), finishedAt: null, message: 'Starting…', result: null, error: null };
  (async () => {
    try {
      // Intuit's attachment download URLs are short-lived, so a single long
      // pass loses the receipts that come late in the run (their URL expires
      // before we reach them). Re-run: each pass fetches fresh URLs and retries
      // only the receipts still missing (resume skips the done ones), so the
      // remaining set shrinks and finishes. Stop as soon as a pass adds nothing.
      let prev = -1;
      let result = { imported: 0, withReceipt: 0, total: 0 };
      for (let pass = 0; pass < 8; pass++) {
        result = await syncExpenses((m) => { syncState.message = m; });
        syncState.result = result;
        console.log(`[qb-sync] pass ${pass + 1} done — ${result.withReceipt} receipts`);
        if (result.withReceipt <= prev) break; // no new receipts this pass → converged
        prev = result.withReceipt;
      }
      syncState.message = `Done — ${result.imported} expenses, ${result.withReceipt} with receipts.`;
      console.log(`[qb-sync] ${syncState.message}`);
    } catch (e) {
      syncState.error = (e as Error).message;
      syncState.message = `Failed: ${syncState.error}`;
    } finally {
      syncState.running = false;
      syncState.finishedAt = new Date().toISOString();
    }
  })();
  return { started: true, already: false };
}

/** Connection status for the dashboard (never returns tokens). */
export async function status(): Promise<{ connected: boolean; realmId?: string; environment: string; companyName?: string }> {
  const conn = await getConnection();
  if (!conn) return { connected: false, environment: config.quickbooks.environment };
  let companyName: string | undefined;
  try {
    const info = await qbGet(`/companyinfo/${conn.realm_id}`);
    companyName = info?.CompanyInfo?.CompanyName;
  } catch { /* token may need reconnect */ }
  return { connected: true, realmId: conn.realm_id, environment: config.quickbooks.environment, companyName };
}

/** Disconnect: revoke the refresh token at Intuit and drop the stored row. */
export async function disconnect(): Promise<void> {
  const conn = await getConnection();
  if (conn) {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${basicAuth()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: conn.refresh_token }),
    }).catch(() => {});
  }
  await pool.query(`DELETE FROM quickbooks_connection WHERE id=1`);
}
