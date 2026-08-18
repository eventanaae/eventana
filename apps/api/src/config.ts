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
  name: 'tabby' | 'tamara' | 'ziina';
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
  },

  /**
   * Cloudinary image storage. Accepts a single CLOUDINARY_URL
   * (cloudinary://key:secret@cloud) or the three parts separately. The API
   * secret stays server-side; clients upload directly with a signed request.
   */
  cloudinary: parseCloudinary(),

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
  };
}

/**
 * Guard rail: a simulated provider must never quietly serve real
 * customers. Called at boot so the mistake surfaces at deploy time
 * rather than at someone's checkout.
 */
export function assertProductionReady(): void {
  if (config.nodeEnv !== 'production') return;

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
