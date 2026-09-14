/**
 * Diagnostic: verify the Tamara API token actually authenticates (not just that
 * the env var is present). Calls Tamara's payment-types endpoint with the token
 * and logs the HTTP status. Gated DIAG_TAMARA=true. Read-only. Turn off after.
 *
 *   401/403  → the API token is wrong.
 *   200      → the token works.
 */
import { config } from '../config.js';

export async function diagTamaraFromEnv(): Promise<void> {
  if (String(process.env.DIAG_TAMARA ?? '').toLowerCase() !== 'true') return;
  const cfg = (config.providers as any)?.tamara;
  const token = cfg?.secretKey;
  const base = cfg?.baseUrl;
  console.log(`[diag-tamara] mode=${cfg?.mode} baseUrl=${base} tokenPresent=${!!token} tokenLen=${token ? String(token).length : 0}`);
  if (!token || !base) { console.log('[diag-tamara] no token/baseUrl — nothing to test'); return; }
  const url = `${base}/checkout/payment-types?country=AE&locale=en_US&order_value.amount=100&order_value.currency=AED`;
  try {
    const res = await fetch(url, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
    const body = (await res.text()).slice(0, 300);
    console.log(`[diag-tamara] GET payment-types → HTTP ${res.status}. ${res.ok ? 'TOKEN WORKS ✅' : 'TOKEN REJECTED ❌'} body=${body}`);
  } catch (err) {
    console.log(`[diag-tamara] request failed: ${(err as Error).message}`);
  }
}
