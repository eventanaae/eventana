/**
 * WhatsApp test send. WA_TEST=<phone> sends the approved `feedback_request`
 * template to that ONE number (normalised to E.164 the same way the delivery
 * path now does) and logs Meta's full response — so we can confirm customer
 * WhatsApp actually works before a batch goes out, and see the exact error if
 * it doesn't. Use the owner's own number; sends nothing to customers.
 */
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
