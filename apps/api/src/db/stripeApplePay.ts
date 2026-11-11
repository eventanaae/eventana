/**
 * Apple Pay / Google Pay on the embedded Stripe form (SET_SHAN_LEADER=applepay).
 * Wallets only appear in Embedded Checkout on a domain registered with Stripe
 * ("Payment method domains"). This lists the account's registered domains, adds
 * the customer-site domains if missing, re-validates them, and LOGS each
 * domain's Apple Pay / Google Pay status. Touches nothing else.
 */
import { config } from '../config.js';

const L = (s: string) => console.log(`[applepay] ${s}`);

async function stripe(path: string, method: 'GET' | 'POST' = 'GET', body?: Record<string, string>): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${config.providers.stripe.secretKey}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${j?.error?.message ?? ''}`);
  return j;
}

const show = (d: any) =>
  `${d.domain_name} enabled=${d.enabled} apple_pay=${d.apple_pay?.status}${d.apple_pay?.status_details?.error_message ? ` (${d.apple_pay.status_details.error_message})` : ''} google_pay=${d.google_pay?.status} link=${d.link?.status}`;

export async function stripeApplePayFromEnv(): Promise<void> {
  if (!config.providers.stripe.secretKey) { L('no Stripe key — skipped'); return; }
  try {
    const host = (() => { try { return new URL(config.publicAppUrl).hostname; } catch { return ''; } })();
    const wanted = [...new Set(['eventanauae.com', 'www.eventanauae.com', host].filter((h) => h && !/localhost|onrender\.com$/.test(h)))];
    const list = await stripe('payment_method_domains?limit=100');
    const have = new Map<string, any>((list.data ?? []).map((d: any) => [String(d.domain_name).toLowerCase(), d]));
    L(`registered before: ${[...have.values()].map(show).join(' | ') || 'none'}`);
    for (const dom of wanted) {
      let d = have.get(dom);
      if (!d) {
        d = await stripe('payment_method_domains', 'POST', { domain_name: dom });
        L(`registered ${dom}`);
      } else if (!d.enabled) {
        d = await stripe(`payment_method_domains/${d.id}`, 'POST', { enabled: 'true' });
        L(`enabled ${dom}`);
      }
      try { d = await stripe(`payment_method_domains/${d.id}/validate`, 'POST'); } catch (e) { L(`validate ${dom}: ${(e as Error).message}`); }
      L(`now: ${show(d)}`);
    }
  } catch (e) { L(`failed: ${(e as Error).message}`); }
}
