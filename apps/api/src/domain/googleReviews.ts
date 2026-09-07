/**
 * Google Business Profile — automatic review replies.
 *
 * Reads the Eventana listing's reviews through the Business Profile API and
 * answers them in the owner's warm voice:
 *   • 4–5★  → a thank-you is posted automatically, in the review's language.
 *   • 1–3★  → a draft reply is prepared and the OWNER is emailed; nothing is
 *             published until she approves it in the dashboard. A public
 *             apology is never posted on her behalf without a human yes.
 *
 * Auth mirrors the QuickBooks integration exactly: OAuth 2.0 authorization_code,
 * a single-row token table, and lazy refresh-before-use so one consent keeps the
 * connection alive. The client secret is read from config (env only), never
 * logged. Everything is a graceful no-op until GOOGLE_OAUTH_CLIENT_ID/SECRET are
 * set, the owner has connected, and GOOGLE_REVIEWS=poll is switched on — so this
 * ships dark and publishes nothing until deliberately enabled.
 *
 * Reviews API note: the reply endpoint lives in the legacy Google My Business
 * API (v4); listing accounts/locations uses the newer Business Profile APIs. Both
 * require the project to be granted Business Profile API access by Google and the
 * `business.manage` OAuth scope.
 */
import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { sendEmail } from '../integrations/email.js';
import { generateText } from '../integrations/anthropic.js';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
// business.manage is the single scope that grants reading + replying to reviews.
const SCOPE = 'https://www.googleapis.com/auth/business.manage';

// Account/location discovery uses the new Business Profile APIs; the review list
// + reply endpoints only exist on the legacy v4 host.
const ACCOUNT_MGMT = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const BUSINESS_INFO = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const MYBUSINESS_V4 = 'https://mybusiness.googleapis.com/v4';

// Don't hammer the API on every 5-minute reconcile tick — reviews trickle in.
const MIN_POLL_INTERVAL_MS = 12 * 60_000;
let lastPollAt = 0;

const P = (s: string) => console.log(`[google-reviews] ${s}`);

export function googleConfigured(): boolean {
  return Boolean(config.google.clientId && config.google.clientSecret);
}

// ── OAuth (mirrors domain/quickbooks.ts) ─────────────────────────────────────

/** Stateless CSRF: a state value signed with the server's trust anchor. */
export function makeState(): string {
  const nonce = `g.${Date.now()}.${Math.round(performance.now())}`;
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

/** The Google consent URL to send the owner to. */
export function authorizeUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: config.google.clientId ?? '',
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: SCOPE,
    // offline + consent forces Google to return a refresh_token (it only sends
    // one on the first grant otherwise), so a single consent keeps us connected.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTHORIZE_URL}?${p.toString()}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string };

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google token endpoint ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Exchange the authorization code for tokens and persist the connection. */
export async function exchangeCode(code: string, connectedBy: string): Promise<void> {
  const t = await postToken(new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.google.clientId ?? '',
    client_secret: config.google.clientSecret ?? '',
    redirect_uri: config.google.redirectUri,
  }));
  await saveTokens(t, connectedBy);
}

async function saveTokens(t: TokenResponse, connectedBy?: string): Promise<void> {
  const expiresAt = new Date(Date.now() + (t.expires_in - 60) * 1000);
  await pool.query(
    `INSERT INTO google_oauth_connection (id, access_token, refresh_token, expires_at, scope, connected_by, updated_at)
     VALUES (1,$1,$2,$3,$4,$5,now())
     ON CONFLICT (id) DO UPDATE SET
       access_token=EXCLUDED.access_token,
       -- Google only returns a refresh_token on the first consent; keep the old one on refresh.
       refresh_token=COALESCE(NULLIF(EXCLUDED.refresh_token,''), google_oauth_connection.refresh_token),
       expires_at=EXCLUDED.expires_at,
       scope=COALESCE(EXCLUDED.scope, google_oauth_connection.scope),
       connected_by=COALESCE(EXCLUDED.connected_by, google_oauth_connection.connected_by),
       updated_at=now()`,
    [t.access_token, t.refresh_token ?? '', expiresAt, t.scope ?? null, connectedBy ?? null],
  );
}

type Connection = { access_token: string; refresh_token: string; expires_at: string; location_name: string | null };

async function getConnection(): Promise<Connection | null> {
  const { rows } = await pool.query(
    `SELECT access_token, refresh_token, expires_at, location_name FROM google_oauth_connection WHERE id=1`,
  );
  return rows[0] ?? null;
}

export async function isConnected(): Promise<boolean> {
  return Boolean(await getConnection());
}

/** A valid access token, refreshing first if it is at/near expiry. */
async function getAccessToken(): Promise<string> {
  const conn = await getConnection();
  if (!conn) throw new Error('Google Business Profile is not connected.');
  if (new Date(conn.expires_at).getTime() > Date.now()) return conn.access_token;
  const t = await postToken(new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: conn.refresh_token,
    client_id: config.google.clientId ?? '',
    client_secret: config.google.clientSecret ?? '',
  }));
  await saveTokens({ ...t, refresh_token: t.refresh_token ?? conn.refresh_token });
  return t.access_token;
}

async function gbGet(url: string): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${url} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/** Publish (or update) the business's reply to one review. */
async function putReply(reviewName: string, comment: string): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(`${MYBUSINESS_V4}/${reviewName}/reply`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ comment }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`reply ${reviewName} → ${res.status}: ${text.slice(0, 300)}`);
  }
}

// ── Location discovery ───────────────────────────────────────────────────────

/**
 * The listing whose reviews we manage, as `accounts/{a}/locations/{l}`.
 * Comes from GOOGLE_BUSINESS_LOCATION, else the value stored on the connection
 * (set by the discover task), else null (nothing polls until it's known).
 */
async function resolveLocationName(): Promise<string | null> {
  if (config.google.businessLocation) return config.google.businessLocation;
  const conn = await getConnection();
  return conn?.location_name ?? null;
}

/**
 * List accounts + locations to the log so the owner/operator can pick the right
 * listing and pin it in GOOGLE_BUSINESS_LOCATION. Read-only.
 */
export async function discoverLocations(): Promise<void> {
  const accounts = await gbGet(`${ACCOUNT_MGMT}/accounts?pageSize=50`);
  const list: Array<{ name: string; accountName?: string }> = accounts.accounts ?? [];
  P(`accounts: ${list.length}`);
  for (const acc of list) {
    P(`  account ${acc.name} — ${acc.accountName ?? '(no name)'}`);
    try {
      const locs = await gbGet(
        `${BUSINESS_INFO}/${acc.name}/locations?pageSize=100&readMask=name,title,storefrontAddress`,
      );
      for (const loc of locs.locations ?? []) {
        // loc.name is `locations/{id}`; the reviews API needs `accounts/{a}/locations/{id}`.
        const full = `${acc.name}/${loc.name}`;
        P(`    location ${full} — ${loc.title ?? '(no title)'}`);
      }
    } catch (err) {
      P(`    locations failed for ${acc.name}: ${(err as Error).message}`);
    }
  }
  P('DONE — set GOOGLE_BUSINESS_LOCATION to the "accounts/…/locations/…" of the Eventana listing.');
}

// ── Review fetch ─────────────────────────────────────────────────────────────

const STAR_TO_INT: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

type GoogleReview = {
  name: string;
  reviewer?: { displayName?: string };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string };
};

/** Fetch the most recent reviews for the managed location (newest first). */
async function fetchReviews(location: string, pageSize = 50): Promise<GoogleReview[]> {
  const data = await gbGet(
    `${MYBUSINESS_V4}/${location}/reviews?orderBy=updateTime desc&pageSize=${pageSize}`,
  );
  return data.reviews ?? [];
}

// ── Reply copy (template-based, warm Eventana voice) ─────────────────────────

const ARABIC = /[؀-ۿ]/;
function detectLang(comment: string | undefined): 'ar' | 'en' {
  // Star-only or Arabic text → Arabic (the brand is Arabic-first, UAE audience).
  if (!comment || !comment.trim()) return 'ar';
  return ARABIC.test(comment) ? 'ar' : 'en';
}

function firstName(displayName: string | undefined): string {
  const n = (displayName ?? '').trim().split(/\s+/)[0] ?? '';
  // Skip anonymised / generic Google names.
  if (!n || /^(a|an|google)$/i.test(n)) return '';
  return n;
}

const POSITIVE = {
  ar: [
    (n: string) => `${n ? n + ' ' : ''}يسلمو 🤍 سعدنا إننا كنا جزء من مناسبتكم، ووجودكم شرف لنا. نتشرّف نخدمكم مرة ثانية 🌸 — فريق ايفينتانا`,
    (n: string) => `الله يسعدكم${n ? ' ' + n : ''} 🤍 كلماتكم أثلجت قلوبنا! شكراً لثقتكم فينا، وبانتظاركم لكل مناسبة حلوة 🌸`,
    (n: string) => `تسلمون على الكلام الحلو${n ? ' يا ' + n : ''} 🤍 نفرح وايد لما نشوف رضاكم، ونوعدكم نستمر بنفس الاهتمام 🌸 — ايفينتانا`,
    (n: string) => `من القلب مشكورين${n ? ' ' + n : ''} 🤍 مناسبتكم كانت فرحة لنا قبل لكم، وننتظر نحتفل معكم من جديد 🌸`,
  ],
  en: [
    (n: string) => `Thank you so much${n ? ', ' + n : ''} 🤍 It was a joy to be part of your celebration. We can't wait to host you again! — The Eventana team 🌸`,
    (n: string) => `This truly warmed our hearts${n ? ', ' + n : ''} 🤍 Thank you for trusting Eventana — we're always here for your next special moment 🌸`,
    (n: string) => `We're so grateful${n ? ', ' + n : ''} 🤍 Seeing your happiness is exactly why we do this. See you at the next celebration! — Team Eventana 🌸`,
  ],
};

const NEGATIVE = {
  ar: [
    (n: string) => `نعتذر منك${n ? ' ' + n : ''} إذا تجربتكم ما كانت بالمستوى اللي تستاهلونه 🤍 رأيك يهمنا وايد ونبي نفهم ونصحّح. ياليت تتواصلون معنا على 0566069616 أو sheem@eventanauae.com ونهتم فيه شخصياً. — ايفينتانا`,
    (n: string) => `شكراً لصراحتك${n ? ' ' + n : ''} 🤍 نأسف إن التجربة ما كانت زينة، وهذا مب اللي نتمناه لكم. تواصلوا معنا (0566069616 / sheem@eventanauae.com) عشان نعوّضكم ونطوّر. — فريق ايفينتانا`,
  ],
  en: [
    (n: string) => `We're truly sorry to hear this${n ? ', ' + n : ''} 🤍 This isn't the experience we want for you. Please reach us at 0566069616 or sheem@eventanauae.com so we can make it right. — Eventana`,
    (n: string) => `Thank you for your honesty${n ? ', ' + n : ''} 🤍 We'd like the chance to understand and improve. Kindly contact us at sheem@eventanauae.com / 0566069616. — Team Eventana`,
  ],
};

/** A deterministic variant index so re-runs pick the same reply for a review. */
function variantIndex(reviewName: string, count: number): number {
  let h = 0;
  for (let i = 0; i < reviewName.length; i++) h = (h * 31 + reviewName.charCodeAt(i)) >>> 0;
  return h % count;
}

/** The fixed-template reply — the fallback when Claude isn't available. */
function templateReply(review: GoogleReview, rating: number, lang: 'ar' | 'en', name: string): string {
  const bank = (rating >= 4 ? POSITIVE : NEGATIVE)[lang];
  return bank[variantIndex(review.name, bank.length)](name);
}

/**
 * Ask Claude to write a reply that actually reads THIS review and responds to
 * what the customer said — warm, in the review's language, in Eventana's voice.
 * Returns null on any problem so the caller falls back to a template.
 */
async function draftWithClaude(
  review: GoogleReview,
  rating: number,
  lang: 'ar' | 'en',
  name: string,
): Promise<string | null> {
  const positive = rating >= 4;
  const system = [
    'You write the public reply that Eventana Events (a warm, upscale kids-party & celebrations company in the UAE, Arabic-first, run by women) posts under a Google review.',
    'Voice: warm, genuine, feminine, a little affectionate — like a real person from the team, not a corporate bot.',
    lang === 'ar'
      ? 'Write in warm Gulf/Emirati Arabic dialect (khaleeji), the way the owner speaks (e.g. "يسلمو", "ياقلبي", "وايد", "مشكورين"). NOT formal MSA.'
      : 'Write in warm, natural English.',
    'READ the specific review and respond to what they actually said — mention the detail they praised (the setup, the team, the theme, their child\'s joy, etc.). Never generic. Never repeat their words back verbatim.',
    positive
      ? 'This is a happy review. Thank them warmly and specifically, and warmly invite them back.'
      : 'This is a critical review. Apologise sincerely, do not argue or make excuses, and invite them to reach us privately at 0566069616 or sheem@eventanauae.com so we can make it right.',
    'Keep it short: 1–3 sentences. At most one or two soft emoji (🤍 🌸). You may sign "— ايفينتانا" / "— Eventana".',
    'If the review has no text (star rating only), write a short warm thank-you that fits the rating.',
    'Output ONLY the reply text itself — no quotes, no preamble, no explanation.',
  ].join('\n');
  const prompt = [
    `Rating: ${rating} out of 5 stars.`,
    `Reviewer first name: ${name || '(unknown — do not invent one)'}.`,
    `Reply language: ${lang === 'ar' ? 'Arabic (Gulf dialect)' : 'English'}.`,
    `Review text: ${review.comment?.trim() ? review.comment.trim() : '(no written comment — stars only)'}`,
  ].join('\n');
  const out = await generateText({ system, prompt, maxTokens: 400 });
  if (!out) return null;
  // Guard against a stray wrapping quote the model might add.
  return out.replace(/^["'“”]+|["'“”]+$/g, '').trim() || null;
}

async function generateReply(review: GoogleReview): Promise<{ text: string; positive: boolean; lang: 'ar' | 'en' }> {
  const rating = STAR_TO_INT[review.starRating ?? ''] ?? 0;
  const lang = detectLang(review.comment);
  const name = firstName(review.reviewer?.displayName);
  const positive = rating >= 4;
  const llm = await draftWithClaude(review, rating, lang, name).catch(() => null);
  const text = llm ?? templateReply(review, rating, lang, name);
  return { text, positive, lang };
}

// ── Owner notification for a negative-review draft ───────────────────────────

async function notifyOwnerOfDraft(row: {
  review_id: string;
  reviewer_name: string | null;
  rating: number | null;
  comment: string | null;
  reply_text: string | null;
}): Promise<void> {
  const dash = config.publicDashboardUrl.replace(/\/$/, '');
  const stars = '★'.repeat(row.rating ?? 0) + '☆'.repeat(Math.max(0, 5 - (row.rating ?? 0)));
  const html = `<!doctype html><html><body style="margin:0;background:#FBEAF2;font-family:'Segoe UI',Arial,sans-serif;color:#4A3540">
    <div style="max-width:560px;margin:0 auto;padding:24px">
      <div style="text-align:center;padding:8px 0 16px"><span style="font-size:22px;font-weight:800;color:#EF5D95">Eventana</span></div>
      <div style="background:#fff;border-radius:18px;padding:24px;line-height:1.7;font-size:15px">
        <p style="margin:0 0 6px;font-weight:700">تقييم جديد يحتاج ردّك ✍️</p>
        <p style="margin:0 0 14px;color:#9B8A94;font-size:13px">A new ${row.rating ?? '?'}-star Google review needs your approval before we reply.</p>
        <div style="background:#FCEEF6;border-radius:12px;padding:14px 16px;margin:0 0 14px">
          <div style="color:#EF5D95;font-size:18px">${stars}</div>
          <div style="font-weight:600;margin:4px 0">${row.reviewer_name ?? 'Google user'}</div>
          <div style="color:#4A3540">${(row.comment ?? '(no comment)').replace(/</g, '&lt;')}</div>
        </div>
        <p style="margin:0 0 6px;font-weight:700">الرد المقترح — Suggested reply</p>
        <div style="background:#FFF7FB;border:1px dashed #F4DDEC;border-radius:12px;padding:14px 16px;margin:0 0 18px;white-space:pre-wrap">${(row.reply_text ?? '').replace(/</g, '&lt;')}</div>
        <a href="${dash}/?view=reviews" style="display:inline-block;background:#EF5D95;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:999px">مراجعة والموافقة — Review &amp; approve</a>
        <p style="margin:16px 0 0;color:#9B8A94;font-size:12px">لن يُنشر أي رد على تقييم سلبي إلا بعد موافقتك. The reply is NOT posted until you approve it.</p>
      </div>
    </div>
  </body></html>`;
  const recipients = Array.from(new Set(['sheem@eventanauae.com', ...config.email.financeReportTo]));
  for (const to of recipients) {
    await sendEmail({ to, subject: `⭐ تقييم قوقل ${row.rating ?? ''}★ يحتاج موافقتك — new Google review`, html }).catch(() => {});
  }
}

// ── The sweep: fetch, auto-reply positives, draft negatives ──────────────────

export type ReviewSweepResult = { fetched: number; inserted: number; autoReplied: number; drafted: number; alreadyReplied: number };

/**
 * Poll Google for new reviews and act on them. Idempotent: a review is only
 * acted on once (INSERT … ON CONFLICT DO NOTHING claims it; only freshly-inserted
 * 'new' rows are handled). Gated by GOOGLE_REVIEWS=poll and a live connection.
 */
export async function sweepGoogleReviews(force = false): Promise<ReviewSweepResult> {
  const empty: ReviewSweepResult = { fetched: 0, inserted: 0, autoReplied: 0, drafted: 0, alreadyReplied: 0 };
  if (String(process.env.GOOGLE_REVIEWS ?? '').toLowerCase() !== 'poll') return empty;
  if (!googleConfigured()) return empty;
  if (!force && Date.now() - lastPollAt < MIN_POLL_INTERVAL_MS) return empty;
  lastPollAt = Date.now();

  const location = await resolveLocationName();
  if (!location) { P('no location set — set GOOGLE_BUSINESS_LOCATION (run GOOGLE_REVIEWS=discover first)'); return empty; }
  if (!(await isConnected())) { P('not connected — owner must authorise first'); return empty; }

  const reviews = await fetchReviews(location);
  const result: ReviewSweepResult = { ...empty, fetched: reviews.length };

  for (const rv of reviews) {
    const rating = STAR_TO_INT[rv.starRating ?? ''] ?? 0;
    const lang = detectLang(rv.comment);
    const alreadyReplied = Boolean(rv.reviewReply?.comment);
    // Claim the review. A row already present (any status) is skipped — we never
    // re-reply. A review Google shows as already-replied is recorded as handled.
    const ins = await pool.query(
      `INSERT INTO google_reviews
         (review_id, reviewer_name, rating, comment, lang, review_created_at, review_updated_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (review_id) DO NOTHING`,
      [
        rv.name,
        rv.reviewer?.displayName ?? null,
        rating || null,
        rv.comment ?? null,
        lang,
        rv.createTime ?? null,
        rv.updateTime ?? null,
        alreadyReplied ? 'already_replied' : 'new',
      ],
    );
    if (ins.rowCount === 0) continue; // seen before — leave it alone
    result.inserted += 1;
    if (alreadyReplied) { result.alreadyReplied += 1; continue; }

    const { text, positive } = await generateReply(rv);
    if (positive) {
      // 4–5★: publish the thank-you now.
      try {
        await putReply(rv.name, text);
        await pool.query(
          `UPDATE google_reviews SET reply_text=$2, status='auto_posted', reply_posted_at=now(), updated_at=now() WHERE review_id=$1`,
          [rv.name, text],
        );
        result.autoReplied += 1;
      } catch (err) {
        await pool.query(
          `UPDATE google_reviews SET reply_text=$2, status='failed', updated_at=now() WHERE review_id=$1`,
          [rv.name, text],
        );
        P(`auto-reply failed for ${rv.name}: ${(err as Error).message}`);
      }
    } else {
      // 1–3★: prepare a draft and email the owner. Never posted automatically.
      await pool.query(
        `UPDATE google_reviews SET reply_text=$2, status='draft_pending', updated_at=now() WHERE review_id=$1`,
        [rv.name, text],
      );
      await notifyOwnerOfDraft({
        review_id: rv.name, reviewer_name: rv.reviewer?.displayName ?? null, rating, comment: rv.comment ?? null, reply_text: text,
      }).then(() => pool.query(`UPDATE google_reviews SET notified_at=now() WHERE review_id=$1`, [rv.name]))
        .catch((err) => P(`owner notify failed for ${rv.name}: ${(err as Error).message}`));
      result.drafted += 1;
    }
  }

  if (result.inserted) {
    P(`fetched ${result.fetched}, new ${result.inserted}: auto-replied ${result.autoReplied}, drafted ${result.drafted}, already-replied ${result.alreadyReplied}`);
  }
  return result;
}

// ── Dashboard-facing helpers (drafts + status) ───────────────────────────────

export async function status(): Promise<{
  configured: boolean; connected: boolean; locationSet: boolean; polling: boolean;
  pendingDrafts: number; autoRepliedTotal: number;
}> {
  const connected = await isConnected();
  const location = await resolveLocationName();
  const counts = await pool.query(
    `SELECT
       count(*) FILTER (WHERE status='draft_pending')  AS drafts,
       count(*) FILTER (WHERE status IN ('auto_posted','posted')) AS replied
     FROM google_reviews`,
  );
  return {
    configured: googleConfigured(),
    connected,
    locationSet: Boolean(location),
    polling: String(process.env.GOOGLE_REVIEWS ?? '').toLowerCase() === 'poll',
    pendingDrafts: Number(counts.rows[0]?.drafts ?? 0),
    autoRepliedTotal: Number(counts.rows[0]?.replied ?? 0),
  };
}

export type ReviewRow = {
  review_id: string; reviewer_name: string | null; rating: number | null; comment: string | null;
  lang: string | null; reply_text: string | null; status: string;
  review_created_at: string | null; reply_posted_at: string | null;
};

/** The list the dashboard shows: pending drafts first, then recent history. */
export async function listReviews(limit = 100): Promise<ReviewRow[]> {
  const { rows } = await pool.query<ReviewRow>(
    `SELECT review_id, reviewer_name, rating, comment, lang, reply_text, status,
            review_created_at, reply_posted_at
       FROM google_reviews
      ORDER BY (status='draft_pending') DESC, coalesce(review_updated_at, review_created_at) DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

/** Owner edits a pending draft's wording (does not post). */
export async function editDraft(reviewId: string, text: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE google_reviews SET reply_text=$2, updated_at=now() WHERE review_id=$1 AND status='draft_pending'`,
    [reviewId, text],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Owner approves a draft → publish it to Google. */
export async function postDraft(reviewId: string): Promise<{ ok: boolean; error?: string }> {
  const { rows } = await pool.query(
    `SELECT reply_text FROM google_reviews WHERE review_id=$1 AND status IN ('draft_pending','failed')`,
    [reviewId],
  );
  const text = rows[0]?.reply_text as string | undefined;
  if (!text) return { ok: false, error: 'no_draft' };
  try {
    await putReply(reviewId, text);
    await pool.query(
      `UPDATE google_reviews SET status='posted', reply_posted_at=now(), updated_at=now() WHERE review_id=$1`,
      [reviewId],
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message.slice(0, 200) };
  }
}

/** Owner decides not to reply — dismiss the draft. */
export async function skipDraft(reviewId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE google_reviews SET status='skipped', updated_at=now() WHERE review_id=$1 AND status IN ('draft_pending','failed')`,
    [reviewId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function disconnect(): Promise<void> {
  const conn = await getConnection();
  if (conn?.refresh_token) {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(conn.refresh_token)}`, { method: 'POST' }).catch(() => {});
  }
  await pool.query(`DELETE FROM google_oauth_connection WHERE id=1`);
}

// ── Boot task (env-gated preview / discovery) ────────────────────────────────

/**
 * GOOGLE_REVIEWS=discover → log accounts+locations so the owner can pin
 *                            GOOGLE_BUSINESS_LOCATION.
 * GOOGLE_REVIEWS=list     → fetch current reviews and log them (posts nothing).
 * GOOGLE_REVIEWS=poll     → the live sweep runs on the reconcile loop (handled
 *                            in reconcile.ts, not here). This boot task no-ops.
 */
export async function googleReviewsFromEnv(): Promise<void> {
  const mode = String(process.env.GOOGLE_REVIEWS ?? '').toLowerCase();
  if (!mode) return;
  if (!googleConfigured()) { P('GOOGLE_OAUTH_CLIENT_ID/SECRET not set — skipping'); return; }
  if (!(await isConnected())) { P('not connected — owner must authorise at /api/admin/google/connect first'); return; }
  try {
    if (mode === 'discover') { await discoverLocations(); return; }
    if (mode === 'list') {
      const location = await resolveLocationName();
      if (!location) { P('no location set — run GOOGLE_REVIEWS=discover first'); return; }
      const reviews = await fetchReviews(location, 20);
      P(`${reviews.length} recent review(s) for ${location}:`);
      for (const rv of reviews) {
        const rating = STAR_TO_INT[rv.starRating ?? ''] ?? 0;
        P(`  ${rating}★ ${rv.reviewer?.displayName ?? '?'} — ${(rv.comment ?? '(no text)').slice(0, 80)} ${rv.reviewReply ? '[replied]' : ''}`);
      }
      return;
    }
    // mode === 'poll' → nothing to do at boot; the reconcile sweep drives it.
  } catch (err) {
    P(`failed: ${(err as Error).message}`);
  }
}
