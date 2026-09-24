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
import { parseInbound, parseStatuses, verifyWebhookSignature, sendWhatsAppText } from '../integrations/whatsapp.js';
import { recordInboundMessage, normalizePhone } from '../domain/whatsappLeads.js';
import { respondToLead } from '../domain/whatsappAgent.js';

/**
 * A booking customer replied to our automated WhatsApp (a confirmation/reminder
 * from the notification number, which isn't monitored). Reply to them EVERY time
 * they write, pointing them to the real contact number so they reach us instead
 * of talking to an unwatched line. Only for a KNOWN customer who has an order
 * (fresh ad enquiries are handled by the leads flow). Our reply is outbound, so
 * it never re-triggers this — no loop.
 */
async function autoReplyKnownCustomer(msg: { phone: string }): Promise<void> {
  try {
    const phone = normalizePhone(msg.phone);
    const last9 = phone.slice(-9);
    if (last9.length < 9) return;
    const known = await pool.query(
      `SELECT 1 FROM customers c
        WHERE right(regexp_replace(COALESCE(c.phone,''), '\\D', '', 'g'), 9) = $1
          AND EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)
        LIMIT 1`,
      [last9],
    );
    if (!known.rows[0]) return;
    const body = `شكراً لتواصلك معنا 💛\nهذا رقم آلي للإشعارات فقط. لأي استفسار أو مساعدة كلّمنا على ${config.contact.phoneDisplay} (واتساب/اتصال) وبنردّ عليك فوراً 🌸`;
    await sendWhatsAppText({ to: phone, body, fromStaff: true }).catch(() => {});
  } catch { /* non-fatal */ }
}

export async function webhookRoutes(app: FastifyInstance) {
  /* ---------------- WhatsApp Cloud API ---------------------------- */

  /**
   * Meta's one-time webhook handshake: it calls with a token we chose and
   * expects the challenge echoed back verbatim as plain text.
   *
   * Registered before the generic `/api/webhooks/:provider` route below —
   * Fastify prefers the static segment, so "whatsapp" never reaches the
   * payment-provider lookup.
   */
  app.get('/api/webhooks/whatsapp', async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const expected = config.whatsapp.verifyToken;
    if (expected && q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === expected) {
      return reply.type('text/plain').send(q['hub.challenge'] ?? '');
    }
    return reply.status(403).send({ error: 'verification_failed' });
  });

  /**
   * Inbound messages.
   *
   * Meta retries anything it doesn't get a fast 200 for, so this
   * acknowledges immediately and does the work after — the same shape as
   * the payment webhook above. Every step downstream is idempotent on
   * Meta's message id, so a retry changes nothing.
   */
  app.post('/api/webhooks/whatsapp', async (request, reply) => {
    const rawBody = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
    const signature = request.headers['x-hub-signature-256'];

    // Unverifiable means untrusted: anyone can POST here, only Meta can sign.
    if (!verifyWebhookSignature(typeof signature === 'string' ? signature : undefined, rawBody)) {
      request.log.warn('whatsapp webhook rejected: bad or missing signature');
      return reply.status(401).send({ error: 'bad_signature' });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return reply.status(400).send({ error: 'unparseable' });
    }

    // Delivery/read receipts + FAILURES for messages we sent. A failed status
    // carries Meta's real reason (e.g. 131049 engagement throttling, 131026
    // undeliverable) — the only place it's visible, since the send call returns
    // ok before delivery. Log every failure so a "sent but never arrived" is
    // no longer silent.
    for (const st of parseStatuses(body)) {
      if (st.status === 'failed') {
        request.log.error(
          { messageId: st.messageId, recipient: st.recipient, code: st.errorCode, title: st.errorTitle, detail: st.errorDetail },
          `[wa-delivery] FAILED to ${st.recipient}: (#${st.errorCode ?? '?'}) ${st.errorTitle ?? ''} — ${st.errorDetail ?? ''}`,
        );
      } else if (st.status === 'delivered' || st.status === 'read') {
        request.log.info({ messageId: st.messageId, recipient: st.recipient }, `[wa-delivery] ${st.status} to ${st.recipient}`);
      }
    }

    const messages = parseInbound(body);
    reply.status(200).send({ received: messages.length });

    for (const msg of messages) {
      setImmediate(() => {
        void (async () => {
          try {
            const result = await recordInboundMessage(msg);
            if (!result) return; // replayed delivery — already handled
            request.log.info(
              {
                lead: result.lead.phone,
                status: result.lead.status,
                eventDate: result.lead.eventDate,
                ad: result.lead.sourceAdId,
                isNew: result.isNew,
              },
              'whatsapp lead updated',
            );
            await respondToLead(msg, result);
            // Auto-reply a booking customer who replied to our automated line.
            await autoReplyKnownCustomer(msg);
          } catch (err) {
            request.log.error({ err }, 'whatsapp webhook processing failed');
          }
        })();
      });
    }
    return reply;
  });

  /* ---------------- Resend delivery events (marketing tracking) ---------- */

  /**
   * Resend webhook: delivered / opened / clicked / bounced / complained. Each
   * marketing send is tagged with its campaign id, so we roll the events up into
   * per-campaign counters, and add hard-bounce / complaint addresses to the
   * suppression list so we never email them again. Configure the endpoint URL in
   * the Resend dashboard (Webhooks). Returns 200 fast; processing is best-effort.
   */
  app.post('/api/webhooks/resend', async (request, reply) => {
    reply.status(200).send({ ok: true });
    try {
      const body = request.body as any;
      const type = String(body?.type ?? '');
      const data = body?.data ?? {};
      let campaignId: number | null = null;
      const tags = data.tags;
      if (Array.isArray(tags)) { const t = tags.find((x: any) => x?.name === 'campaign'); if (t) campaignId = Number(t.value); }
      else if (tags && typeof tags === 'object' && tags.campaign) campaignId = Number(tags.campaign);
      const toList: string[] = Array.isArray(data.to) ? data.to : data.to ? [data.to] : [];
      const bump = async (col: string) => { if (campaignId) await pool.query(`UPDATE email_campaigns SET ${col} = ${col} + 1 WHERE id = $1`, [campaignId]).catch(() => {}); };
      if (type === 'email.delivered') await bump('delivered_count');
      else if (type === 'email.opened') await bump('opened_count');
      else if (type === 'email.clicked') await bump('clicked_count');
      else if (type === 'email.bounced' || type === 'email.complained') {
        await bump('bounced_count');
        for (const e of toList) {
          await pool.query(
            `INSERT INTO email_suppression (email, reason) VALUES (lower($1), $2) ON CONFLICT (email) DO NOTHING`,
            [e, type === 'email.complained' ? 'complaint' : 'bounce'],
          ).catch(() => {});
        }
      }
    } catch (err) {
      request.log.error({ err }, 'resend webhook processing failed');
    }
    return reply;
  });

  /* ---------------- bank alerts (RAKBANK) ------------------------- */

  /**
   * Bank Inbox ingestion (#16). A forwarded RAKBANK transaction alert is POSTed
   * here (by the owner's mail auto-forward script) as JSON { subject, text }.
   * Protected by a shared secret in the `x-bank-secret` header. Registered as a
   * static segment so it beats the generic `:provider` route below.
   */
  app.post('/api/webhooks/bank-alert', async (request, reply) => {
    const secret = process.env.BANK_ALERT_SECRET ?? '';
    if (!secret) return reply.status(503).send({ error: 'bank_alerts_not_configured' });
    const given = String(request.headers['x-bank-secret'] ?? '');
    if (given !== secret) return reply.status(401).send({ error: 'unauthorized' });
    let payload: { subject?: string; text?: string; body?: string } = {};
    try { payload = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body as any) ?? {}; }
    catch { return reply.status(400).send({ error: 'invalid_json' }); }
    const subject = String(payload.subject ?? '');
    const text = String(payload.text ?? payload.body ?? '');
    if (!subject && !text) return reply.status(400).send({ error: 'empty' });
    const { ingestBankAlert } = await import('../domain/bankInbox.js');
    const res = await ingestBankAlert(subject, text).catch((err) => { request.log.error({ err }, 'bank-alert ingest failed'); return null; });
    if (!res) return reply.status(422).send({ error: 'not_ingested' });
    return reply.status(res.duplicate ? 200 : 201).send({ id: res.id, duplicate: !!res.duplicate });
  });

  /* ---------------- payment providers ----------------------------- */

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
      // TEMP DIAG (Tabby cert): capture the exact static secret Tabby echoes so we
      // can align TABBY_WEBHOOK_SECRET to it, then remove this. Our own shared
      // secret, private logs only.
      if (provider === 'tabby') {
        const sig = request.headers['x-eventana-signature'];
        const cfg = (config.providers as any).tabby?.webhookSecret ?? '';
        console.log('[tabby-diag] sent=', JSON.stringify(sig), 'cfgLen=', String(cfg).length, 'match=', sig === cfg);
      }
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
