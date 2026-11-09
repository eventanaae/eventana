/**
 * Shared by My Event (add-ons, tips) and the guest feedback page (tips).
 */
/** An add-on / tip payment the server opened as an in-page Stripe session. */
export type ExtraPayment = {
  orderId: string;
  orderToken: string | null;
  stripe: { clientSecret: string; publishableKey: string };
};

/**
 * Start an add-on or tip payment from the server's checkout response. The
 * card rail (Stripe) answers with an EMBEDDED session — a clientSecret, no
 * redirect URL — so a client that only followed `checkoutUrl` showed "could not
 * open checkout" every time. Hosted providers (Tabby/Tamara) still redirect.
 * Returns false when the response holds no way to pay.
 */
export function openExtraPayment(res: any, onPay?: (p: ExtraPayment) => void): boolean {
  if (res?.clientSecret && res?.publishableKey && res?.orderId && onPay) {
    onPay({ orderId: res.orderId, orderToken: res.orderToken ?? null, stripe: { clientSecret: res.clientSecret, publishableKey: res.publishableKey } });
    return true;
  }
  if (res?.checkoutUrl) { window.location.href = res.checkoutUrl; return true; }
  if (res?.embeddedUrl) { window.location.href = res.embeddedUrl; return true; }
  return false;
}
