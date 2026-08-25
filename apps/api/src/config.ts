/**
 * Runtime configuration.
 *
 * Every provider secret is read from the process environment and nowhere
 * else. Nothing here is ever written to the database, returned by an API
 * route, logged, or shipped to the mobile app (Tabby spec §1.4).
 *
 * A provider whose secret is absent runs in SIMULATED mode: the checkout
 * flow, webhook handling, state machine and inventory rules all execute
 * for real against a local fake of the provider, so the engine is fully
 * testable before Eventana holds any merchant account. Simulated mode is
 * reported honestly through /api/admin/integrations and refuses to start
 * in production.
 */
import 'dotenv/config';

const env = process.env;

export type ProviderMode = 'live' | 'sandbox' | 'simulated' | 'disabled';

export interface ProviderConfig {
  name: 'tabby' | 'tamara' | 'ziina' | 'stripe';
  mode: ProviderMode;
  publicKey: string | null;
  secretKey: string | null;
  merchantCode: string | null;
  webhookSecret: string | null;
  baseUrl: string;
  /** Human-readable list of what is still missing to go live. */
  missing: string[];
}

function providerConfig(
  name: ProviderConfig['name'],
  opts: {
    publicKey?: string;
    secretKey?: string;
    merchantCode?: string;
    webhookSecret?: string;
    sandboxUrl: string;
    liveUrl: string;
    requires: Array<'publicKey' | 'secretKey' | 'merchantCode' | 'webhookSecret'>;
  },
): ProviderConfig {
  const values = {
    publicKey: opts.publicKey ?? null,
    secretKey: opts.secretKey ?? null,
    merchantCode: opts.merchantCode ?? null,
    webhookSecret: opts.webhookSecret ?? null,
  };
  const missing = opts.requires.filter((k) => !values[k]);
  const declared = (env.EVENTANA_PAYMENT_MODE ?? 'sandbox').toLowerCase();

  // A provider only ever handles REAL money with a complete set of
  // NON-TEST credentials. Tabby issues sk_test_/pk_test_ keys; those must
  // never run in a live deployment.
  const looksTest = [values.publicKey, values.secretKey, values.merchantCode].some(
    (v) => typeof v === 'string' && /^(sk|pk)_test_/i.test(v),
  );

  let mode: ProviderMode;
  if (declared === 'live') {
    // Live deployment: activate providers that are genuinely
    // production-ready; disable the rest rather than blocking the whole app.
    mode = missing.length > 0 || looksTest ? 'disabled' : 'live';
  } else {
    // Sandbox / development: a provider with no secrets runs simulated.
    mode = missing.length > 0 ? 'simulated' : 'sandbox';
  }

  return {
    name,
    mode,
    ...values,
    baseUrl: mode === 'live' ? opts.liveUrl : opts.sandboxUrl,
    missing,
  };
}

/**
 * Accepts either a full URL or a bare hostname.
 *
 * Render blueprints can only pass another service's `host`
 * (`eventana-api.onrender.com`), not a full URL, so the scheme is added
 * here. Taking the host rather than hardcoding a URL matters: if a
 * subdomain is already taken Render appends a suffix, and a hardcoded
 * URL would then point at nothing.
 */
function toUrl(value: string | undefined, fallback: string): string {
  const raw = (value ?? '').trim().replace(/\/+$/, '');
  if (!raw) return fallback;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/** Cloudinary creds from CLOUDINARY_URL or the three separate vars. */
function parseCloudinary(): { cloudName: string | null; apiKey: string | null; apiSecret: string | null } {
  const url = env.CLOUDINARY_URL;
  if (url) {
    const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(url.trim());
    if (m && !m[1].startsWith('<') && !m[2].startsWith('<')) {
      return { apiKey: m[1], apiSecret: m[2], cloudName: m[3] };
    }
  }
  return {
    cloudName: env.CLOUDINARY_CLOUD_NAME ?? null,
    apiKey: env.CLOUDINARY_API_KEY ?? null,
    apiSecret: env.CLOUDINARY_API_SECRET ?? null,
  };
}

export const config = {
  port: Number(env.PORT ?? 4000),
  host: env.HOST ?? '0.0.0.0',
  nodeEnv: env.NODE_ENV ?? 'development',
  databaseUrl:
    env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/eventana',

  /** Public base URL of this API — used for provider return/webhook URLs. */
  publicApiUrl: toUrl(env.PUBLIC_API_URL ?? env.PUBLIC_API_HOST, 'http://localhost:4000'),
  /** Public base URL of the customer app — used for provider redirects. */
  publicAppUrl: toUrl(env.PUBLIC_APP_URL ?? env.PUBLIC_APP_HOST, 'http://localhost:5173'),
  /** Public base URL of the internal dashboard. */
  publicDashboardUrl: toUrl(
    env.PUBLIC_DASHBOARD_URL ?? env.PUBLIC_DASHBOARD_HOST,
    'http://localhost:5174',
  ),

  /**
   * Allowed browser origins. The two app URLs are always allowed (a
   * deployment where the API rejects its own front ends is never what is
   * wanted), plus anything listed explicitly in CORS_ORIGINS.
   */
  corsOrigins: [
    ...new Set(
      [
        toUrl(env.PUBLIC_APP_URL ?? env.PUBLIC_APP_HOST, 'http://localhost:5173'),
        toUrl(env.PUBLIC_DASHBOARD_URL ?? env.PUBLIC_DASHBOARD_HOST, 'http://localhost:5174'),
        ...(env.CORS_ORIGINS ?? '').split(',').map((s) => toUrl(s, '')),
      ]
        .map((s) => s.trim().replace(/\/$/, ''))
        .filter(Boolean),
    ),
  ],

  /** Staff token for dashboard/admin routes. Replace with real SSO. */
  staffToken: env.STAFF_TOKEN ?? 'dev-staff-token',

  /** How often the reconciliation sweep runs, ms. */
  reconcileIntervalMs: Number(env.RECONCILE_INTERVAL_MS ?? 5 * 60_000),
  /** An order Processing longer than this is chased via retrieve-payment. */
  reconcileStuckAfterMs: Number(env.RECONCILE_STUCK_AFTER_MS ?? 10 * 60_000),
  /** Unresolved beyond this and operations is alerted. */
  reconcileAlertAfterMs: Number(env.RECONCILE_ALERT_AFTER_MS ?? 30 * 60_000),

  googleMapsApiKey: env.GOOGLE_MAPS_API_KEY ?? null,

  /**
   * Google Calendar sync (service-account model). Paste the whole service
   * account JSON key into GOOGLE_SERVICE_ACCOUNT_JSON and share the target
   * calendar with that account's email; GOOGLE_CALENDAR_ID is the calendar
   * every confirmed booking is written to. Absent → sync is a silent no-op.
   */
  googleCalendar: {
    // Accept the raw JSON, or (preferred) a base64 of it — base64 is a single
    // clean token with no quotes/newlines to corrupt in an env var.
    serviceAccountJson:
      env.GOOGLE_SERVICE_ACCOUNT_JSON ??
      (env.GOOGLE_SERVICE_ACCOUNT_B64
        ? Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8')
        : null),
    calendarId: env.GOOGLE_CALENDAR_ID ?? null,
  },

  /**
   * Transactional/marketing email (Resend). RESEND_API_KEY enables real
   * sending; EMAIL_FROM is the verified sender. Absent → campaigns can be
   * composed and queued but sending is a no-op (mode 'disabled').
   */
  email: {
    resendApiKey: env.RESEND_API_KEY ?? null,
    from: env.EMAIL_FROM ?? 'Eventana <onboarding@resend.dev>',
    publicBaseUrl: toUrl(env.PUBLIC_API_URL ?? env.PUBLIC_API_HOST, 'http://localhost:4000'),
    // Extra recipients for the monthly finance report, comma-separated. Owner
    // and manager team members with an email on file also receive it.
    financeReportTo: (env.FINANCE_REPORT_TO ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  /**
   * Cloudinary image storage. Accepts a single CLOUDINARY_URL
   * (cloudinary://key:secret@cloud) or the three parts separately. The API
   * secret stays server-side; clients upload directly with a signed request.
   */
  cloudinary: parseCloudinary(),

  /**
   * Apple Wallet passes. Signing material (base64 PEMs) + the Pass Type ID
   * and Team ID. Absent → the pass endpoint reports unavailable.
   */
  wallet: {
    certPem: env.PASS_CERT_B64 ? Buffer.from(env.PASS_CERT_B64, 'base64').toString('utf8') : null,
    keyPem: env.PASS_KEY_B64 ? Buffer.from(env.PASS_KEY_B64, 'base64').toString('utf8') : null,
    wwdrPem: env.PASS_WWDR_B64 ? Buffer.from(env.PASS_WWDR_B64, 'base64').toString('utf8') : null,
    typeId: env.PASS_TYPE_ID ?? null,
    teamId: env.PASS_TEAM_ID ?? null,
  },

  /**
   * Push notifications via Firebase Cloud Messaging (HTTP v1). A Firebase
   * service-account JSON (raw or base64) + the project id enable real pushes;
   * absent → registration works but sends are a no-op.
   */
  fcm: {
    serviceAccountJson:
      env.FCM_SERVICE_ACCOUNT_JSON ??
      (env.FCM_SERVICE_ACCOUNT_B64
        ? Buffer.from(env.FCM_SERVICE_ACCOUNT_B64, 'base64').toString('utf8')
        : null),
    projectId: env.FCM_PROJECT_ID ?? null,
  },

  /**
   * Meta Conversions API — the server half of ad attribution.
   *
   * Every ad Eventana runs is click-to-WhatsApp, so Ads Manager can only
   * ever report "a conversation started"; it has never known which ad
   * produced a BOOKING. Posting a server-side Purchase closes that gap:
   * the ad account starts optimising for paid bookings and reporting a
   * real ROAS instead of a chat count.
   *
   * META_PIXEL_ID is the dataset (Events Manager → Data sources) and
   * META_CAPI_ACCESS_TOKEN the token generated against it. Either absent
   * → sending is a silent no-op, exactly like email and calendar sync.
   * META_TEST_EVENT_CODE routes events to the Test Events tab instead of
   * production; set it only while verifying, never in a live deployment.
   */
  meta: {
    pixelId: env.META_PIXEL_ID ?? null,
    capiAccessToken: env.META_CAPI_ACCESS_TOKEN ?? null,
    testEventCode: env.META_TEST_EVENT_CODE ?? null,
    /** Graph API version the CAPI endpoint is called on. */
    graphVersion: env.META_GRAPH_VERSION ?? 'v21.0',
  },

  /**
   * WhatsApp Cloud API — the business number the ads point at.
   *
   * WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN come from the Meta
   * app's WhatsApp product; WHATSAPP_VERIFY_TOKEN is a string of your own
   * choosing that Meta echoes back when it registers the webhook, and
   * WHATSAPP_APP_SECRET is what proves an inbound payload really came from
   * Meta. Absent → the webhook rejects everything and nothing is sent.
   *
   * agentMode is the safety switch, and it defaults to OFF: with no value
   * the agent reads and records leads but never messages a customer.
   *   off   — silent (default)
   *   greet — one automatic reply to a first-time enquiry
   *   full  — also answers catalogue questions
   */
  whatsapp: {
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? null,
    accessToken: env.WHATSAPP_ACCESS_TOKEN ?? null,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN ?? null,
    appSecret: env.WHATSAPP_APP_SECRET ?? null,
    agentMode: env.WHATSAPP_AGENT_MODE ?? 'off',
  },

  providers: {
    tabby: providerConfig('tabby', {
      publicKey: env.TABBY_PUBLIC_KEY,
      secretKey: env.TABBY_SECRET_KEY,
      merchantCode: env.TABBY_MERCHANT_CODE,
      webhookSecret: env.TABBY_WEBHOOK_SECRET,
      sandboxUrl: 'https://api.tabby.ai/api',
      liveUrl: 'https://api.tabby.ai/api',
      requires: ['secretKey', 'merchantCode', 'webhookSecret'],
    }),
    tamara: providerConfig('tamara', {
      publicKey: env.TAMARA_PUBLIC_KEY,
      secretKey: env.TAMARA_API_TOKEN,
      webhookSecret: env.TAMARA_NOTIFICATION_TOKEN,
      sandboxUrl: 'https://api-sandbox.tamara.co',
      liveUrl: 'https://api.tamara.co',
      requires: ['secretKey', 'webhookSecret'],
    }),
    ziina: providerConfig('ziina', {
      secretKey: env.ZIINA_API_KEY,
      webhookSecret: env.ZIINA_WEBHOOK_SECRET,
      sandboxUrl: 'https://api-v2.ziina.com/api',
      liveUrl: 'https://api-v2.ziina.com/api',
      requires: ['secretKey'],
    }),
    stripe: providerConfig('stripe', {
      publicKey: env.STRIPE_PUBLISHABLE_KEY,
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      // Stripe uses one base URL for both test and live — the key decides.
      sandboxUrl: 'https://api.stripe.com',
      liveUrl: 'https://api.stripe.com',
      requires: ['secretKey', 'webhookSecret'],
    }),
  },
} as const;

export type ProviderName = keyof typeof config.providers;

/**
 * Whether this deployment is allowed to run with simulated payments.
 *
 * Deliberately opt-in and deliberately loud. It exists so Eventana can
 * put a real, reviewable deployment in front of stakeholders before the
 * merchant accounts exist — NOT so real customers can be taken through a
 * checkout that cannot charge them. The customer app labels every method
 * as sandbox, /health reports it, and the dashboard shows it.
 */
export const allowSimulatedPayments =
  (env.ALLOW_SIMULATED_PAYMENTS ?? '').toLowerCase() === 'true';

/** True when this deployment can actually take a customer's money. */
export function acceptsRealPayments(): boolean {
  // Real money can move as soon as at least one provider is live. Providers
  // that are not production-ready are 'disabled', never 'live'.
  return Object.values(config.providers).some((p) => p.mode === 'live');
}

/** Summary for /health and the dashboard — never includes any secret. */
export function readinessSummary() {
  return {
    environment: config.nodeEnv,
    acceptsRealPayments: acceptsRealPayments(),
    simulatedPaymentsAllowed: allowSimulatedPayments,
    providers: Object.values(config.providers).map((p) => ({ name: p.name, mode: p.mode })),
    mapsConfigured: Boolean(config.googleMapsApiKey),
    calendarConfigured: Boolean(
      config.googleCalendar.serviceAccountJson && config.googleCalendar.calendarId,
    ),
    emailConfigured: Boolean(config.email.resendApiKey),
    uploadsConfigured: Boolean(
      config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret,
    ),
    pushConfigured: Boolean(config.fcm.serviceAccountJson && config.fcm.projectId),
    walletConfigured: Boolean(
      config.wallet.certPem && config.wallet.keyPem && config.wallet.wwdrPem &&
      config.wallet.typeId && config.wallet.teamId,
    ),
  };
}

/**
 * Guard rail: a simulated provider must never quietly serve real
 * customers. Called at boot so the mistake surfaces at deploy time
 * rather than at someone's checkout.
 */
export function assertProductionReady(): void {
  if (config.nodeEnv !== 'production') return;

  // STAFF_TOKEN is the single HMAC/trust anchor for admin auth AND customer
  // session/reset/order-view tokens. The default is public knowledge, so a
  // production deploy that ships it is fully compromised — refuse to start.
  if (!env.STAFF_TOKEN || env.STAFF_TOKEN === 'dev-staff-token') {
    throw new Error(
      'Refusing to start: STAFF_TOKEN is unset or the public default. ' +
        'Set a strong, random STAFF_TOKEN in the environment.',
    );
  }

  const providers = Object.values(config.providers);
  const declaredLive = (env.EVENTANA_PAYMENT_MODE ?? '').toLowerCase() === 'live';

  // Live deployment: at least one provider must be genuinely production-ready.
  // Providers without complete, non-test credentials are 'disabled' (not
  // offered) rather than blocking the whole app.
  if (declaredLive) {
    const live = providers.filter((p) => p.mode === 'live');
    const disabled = providers.filter((p) => p.mode === 'disabled');
    if (live.length === 0) {
      throw new Error(
        'Refusing to start: EVENTANA_PAYMENT_MODE=live but no provider has complete, ' +
          'non-test production credentials. Provide real keys for at least one provider, ' +
          'or set EVENTANA_PAYMENT_MODE=sandbox.',
      );
    }
    console.warn(
      `\n${'='.repeat(72)}\n` +
        `  LIVE PAYMENTS ENABLED — REAL MONEY WILL MOVE\n` +
        `  Live:     ${live.map((p) => p.name).join(', ')}\n` +
        `  Disabled: ${
          disabled
            .map((p) => `${p.name} (${p.missing.join(', ') || 'test credentials'})`)
            .join('; ') || '(none)'
        }\n` +
        `${'='.repeat(72)}\n`,
    );
    return;
  }

  const simulated = providers.filter((p) => p.mode === 'simulated');
  if (simulated.length === 0) return;

  const detail = simulated
    .map((p) => `${p.name} is missing ${p.missing.join(', ')}`)
    .join('; ');

  if (allowSimulatedPayments) {
    // Allowed, but never silent.
    console.warn(
      `\n${'='.repeat(72)}\n` +
        `  PREVIEW DEPLOYMENT — PAYMENTS ARE SIMULATED, NO MONEY MOVES\n` +
        `  ${detail}\n` +
        `  Bookings made here are NOT real. Do not send paying customers to\n` +
        `  this deployment. Set the provider secrets and remove\n` +
        `  ALLOW_SIMULATED_PAYMENTS to go truly live.\n` +
        `${'='.repeat(72)}\n`,
    );
    return;
  }

  throw new Error(
    `Refusing to start in production: ${detail}. Set the provider secrets in the ` +
      `server environment, or set ALLOW_SIMULATED_PAYMENTS=true to run a clearly ` +
      `labelled preview deployment that cannot take real money.`,
  );
}
