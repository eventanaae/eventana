/**
 * Provider webhook endpoints, plus the local checkout simulator that
 * stands in for a provider's hosted page while Eventana has no merchant
 * accounts.
 *
 * The webhook route reads the RAW body — signature schemes sign bytes,
 * and re-serialising parsed JSON changes them.
 */
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { getProvider } from '../payments/index.js';
import { SimulatedProvider } from '../payments/simulated.js';
import { receiveWebhook } from '../domain/webhooks.js';
import { pool } from '../db/pool.js';
import { formatAed } from '@eventana/shared';

export async function webhookRoutes(app: FastifyInstance) {
  app.post('/api/webhooks/:provider', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const rawBody = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);

    const result = await receiveWebhook({
      providerName: provider,
      headers: request.headers as Record<string, string | string[] | undefined>,
      rawBody,
    });

    if (result.httpStatus === 401) {
      request.log.warn({ provider }, 'webhook rejected: bad signature');
    }
    return reply.status(result.httpStatus).send({ outcome: result.outcome });
  });

  /* ---------------- local checkout simulator ---------------------- */

  /**
   * Only mounted while a provider is in simulated mode. It plays the part
   * of the provider's hosted checkout: the customer chooses an outcome,
   * and the simulator delivers a properly signed webhook back to this API
   * — the same endpoint the real provider would call.
   */
  app.get('/simulator/:provider/:paymentId', async (request, reply) => {
    const { provider: name, paymentId } = request.params as {
      provider: string;
      paymentId: string;
    };
    const provider = getProvider(name);
    if (!(provider instanceof SimulatedProvider)) {
      return reply.status(404).send({ error: 'not_simulated' });
    }

    const { rows } = await pool.query(
      `SELECT o.id, o.total_fils FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE p.provider = $1 AND p.provider_payment_id = $2`,
      [name, paymentId],
    );
    const order = rows[0];

    reply.type('text/html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${provider.label} — simulated checkout</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#FFFDFA;
       font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#3B3641}
  .card{width:min(420px,92vw);background:#fff;border-radius:24px;padding:28px;
        box-shadow:0 8px 30px rgba(233,79,156,.12)}
  .tag{display:inline-block;background:#FFF3D6;color:#8a5f1e;font-size:12px;font-weight:700;
       padding:5px 11px;border-radius:12px;margin-bottom:14px}
  h1{font-size:21px;margin:0 0 4px}
  .sub{color:#b3a8a0;font-size:13px;font-weight:600;margin-bottom:20px}
  .amt{font-size:30px;font-weight:700;color:#E94F9C;margin-bottom:22px}
  button{width:100%;border:0;border-radius:16px;padding:15px;font-size:15px;font-weight:700;
         cursor:pointer;margin-bottom:10px;font-family:inherit}
  .ok{background:#F06CA8;color:#fff}.no{background:#FCE9E5;color:#c2453a}
  .note{font-size:11.5px;color:#b3a8a0;line-height:1.5;margin-top:14px}
  #out{font-size:13px;font-weight:700;margin-top:14px;text-align:center}
</style></head><body>
<div class="card">
  <span class="tag">SIMULATED — no real money moves</span>
  <h1>${provider.label} checkout</h1>
  <div class="sub">Order ${order?.id ?? 'unknown'}</div>
  <div class="amt">AED ${order ? formatAed(Number(order.total_fils)) : '—'}</div>
  <button class="ok" onclick="go('success')">Approve payment</button>
  <button class="no" onclick="go('rejected')">Decline payment</button>
  <div id="out"></div>
  <div class="note">This page stands in for ${provider.label}'s hosted checkout. Choosing an
  outcome sends a signed webhook to Eventana's real webhook endpoint — the booking is
  confirmed by that webhook, never by this page.</div>
</div>
<script>
async function go(outcome){
  document.getElementById('out').textContent = 'Sending webhook…';
  const res = await fetch(${JSON.stringify(`/simulator/${name}/${paymentId}/advance`)},
    {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({outcome})});
  const data = await res.json();
  document.getElementById('out').textContent =
    data.outcome === 'accepted' ? 'Confirmed — you can return to the app.' :
    'Webhook outcome: ' + data.outcome;
  if (outcome === 'success') {
    setTimeout(()=>{ location.href = ${JSON.stringify(config.publicAppUrl)} +
      '/pay/return?order=' + ${JSON.stringify(order?.id ?? '')}; }, 900);
  }
}
</script></body></html>`);
  });

  /** Advances a simulated payment and delivers the signed webhook. */
  app.post('/simulator/:provider/:paymentId/advance', async (request, reply) => {
    const { provider: name, paymentId } = request.params as {
      provider: string;
      paymentId: string;
    };
    const { outcome } = (request.body ?? {}) as { outcome?: string };
    const provider = getProvider(name);
    if (!(provider instanceof SimulatedProvider)) {
      return reply.status(404).send({ error: 'not_simulated' });
    }

    const target =
      outcome === 'rejected' ? 'rejected' : outcome === 'expired' ? 'expired' : 'success';
    if (!provider.advance(paymentId, target)) {
      return reply.status(404).send({ error: 'unknown_payment' });
    }

    const body = JSON.stringify(provider.webhookBody(paymentId));
    const result = await receiveWebhook({
      providerName: name,
      headers: { 'x-eventana-signature': provider.webhookSecret },
      rawBody: body,
      async: false,
    });

    return reply.status(200).send(result);
  });
}
