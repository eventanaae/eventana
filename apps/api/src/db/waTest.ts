/**
 * WhatsApp test send. WA_TEST=<phone> sends the approved `feedback_request`
 * template to that ONE number (normalised to E.164 the same way the delivery
 * path now does) and logs Meta's full response — so we can confirm customer
 * WhatsApp actually works before a batch goes out, and see the exact error if
 * it doesn't. Use the owner's own number; sends nothing to customers.
 */
/**
 * Read-only: log the sending phone number's Meta status (verification, platform,
 * quality) so we can see WHY sends fail (#133010 = not registered on Cloud API).
 * Gated WA_PHONE_STATUS=true.
 */
export async function waPhoneStatusFromEnv(): Promise<void> {
  if (String(process.env.WA_PHONE_STATUS ?? '').toLowerCase() !== 'true') return;
  try {
    const { config } = await import('../config.js');
    const id = config.whatsapp.phoneNumberId;
    const ver = config.meta.graphVersion;
    const url = `https://graph.facebook.com/${ver}/${id}?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating,platform_type,name_status,status,throughput`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${config.whatsapp.accessToken}` } });
    const body = (await res.text()).slice(0, 800);
    console.log(`[wa-phone] status=${res.status} id=${id} body=${body}`);
  } catch (err) {
    console.error('[wa-phone] failed:', (err as Error).message);
  }
}

/**
 * Register the sending phone number on Cloud API so it can actually send
 * (fixes #133010). WA_REGISTER=<6-digit-pin> — the number's two-step
 * verification PIN. If 2FA was never set, any 6-digit value sets it. This is a
 * Meta account setup action on the owner's OWN business number.
 */
export async function waRegisterFromEnv(): Promise<void> {
  const pin = String(process.env.WA_REGISTER ?? '').trim();
  if (!/^\d{6}$/.test(pin)) { if (pin) console.log('[wa-register] WA_REGISTER must be a 6-digit PIN'); return; }
  try {
    const { config } = await import('../config.js');
    const id = config.whatsapp.phoneNumberId;
    const ver = config.meta.graphVersion;
    const url = `https://graph.facebook.com/${ver}/${id}/register`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.whatsapp.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
    });
    const body = (await res.text()).slice(0, 600);
    console.log(`[wa-register] status=${res.status} body=${body}`);
  } catch (err) {
    console.error('[wa-register] failed:', (err as Error).message);
  }
}

export async function waTestFromEnv(): Promise<void> {
  const raw = String(process.env.WA_TEST ?? '').trim();
  if (!raw) return;
  try {
    const { toValidCustomerPhone } = await import('../domain/maintenance.js');
    const { sendWhatsAppTemplate, whatsappCustomerNotifyEnabled } = await import('../integrations/whatsapp.js');
    const e164 = toValidCustomerPhone(raw) ?? raw;
    const to = String(e164).replace(/\D+/g, '');
    console.log(`[wa-test] customerNotify=${whatsappCustomerNotifyEnabled()} · raw="${raw}" → to=${to}`);
    const res = await sendWhatsAppTemplate({
      to,
      name: 'feedback_request',
      language: 'ar',
      params: ['ضيفتنا', 'https://eventanauae.com/'],
      fromStaff: true,
    });
    console.log(`[wa-test] RESULT ok=${res.ok} id=${res.messageId ?? ''} error=${res.error ?? ''}`);
  } catch (err) {
    console.error('[wa-test] failed:', (err as Error).message);
  }
}
