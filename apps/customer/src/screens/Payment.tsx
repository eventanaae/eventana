import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { C, fredoka, Notice, PrimaryButton, Spinner } from '../ui';
import type { Lang, TFn } from '../i18n';
import { mountStripeCheckout } from '../stripe';
import { trackGooglePurchase } from '../googleTag';

/**
 * The return screen.
 *
 * Coming back from the provider proves nothing — the booking is confirmed
 * by a webhook the provider sends to Eventana's server. So this screen
 * shows a neutral waiting state and polls Eventana's own order endpoint
 * until the SERVER says it is confirmed (spec §4.7).
 */
export function PaymentReturn({
  orderId,
  token,
  embedUrl,
  stripe,
  onConfirmed,
  onShopDone,
  onRetry,
  returnState,
  lang = 'en',
  t,
}: {
  orderId: string;
  /** The unguessable order-view token (from the provider return URL). */
  token?: string | null;
  /** When set, pay inside the app via this embedded widget (no redirect). */
  embedUrl?: string | null;
  /** When set, mount Stripe's in-page embedded checkout (no redirect). */
  stripe?: { clientSecret: string; publishableKey: string } | null;
  /** Called with the order kind so the app only clears the party draft after
   *  a real booking — never after an add-on or tip payment. */
  onConfirmed: (eventId: string, kind: string) => void;
  /** A confirmed order with no event to open (shop order, invoice) — finish. */
  onShopDone: (kind: string) => void;
  onRetry: (kind: string) => void;
  /** How the provider sent the customer back, when it says so: a cancelled or
   *  failed Tabby/Tamara/Stripe attempt must not sit on an endless spinner. */
  returnState?: 'cancel' | 'failure' | null;
  lang?: Lang;
  t: TFn;
}) {
  const ar = lang === 'ar';
  const [status, setStatus] = useState<string>('checking');
  const [eventId, setEventId] = useState<string | null>(null);
  // The number shown to the customer: EV-<receipt> (matches My Event, the receipt
  // and every email) — never the raw internal event id.
  const [reference, setReference] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [kind, setKind] = useState<string>('booking');
  const [waited, setWaited] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    let timer: number;
    const poll = async () => {
      try {
        const order = await api.order(orderId, token ?? undefined);
        setStatus(order.status);
        setKind(order.kind);
        if (order.confirmed) {
          done.current = true;
          setConfirmed(true);
          setEventId(order.eventId ?? null);
          setReference((order as any).reference ?? order.eventId ?? null);
          // The server has confirmed the money — the only moment a Purchase is
          // true. Google Ads learns about the booking here; Meta's copy is
          // posted server-side from the payment webhook. Reporting is
          // de-duplicated by order id, so a refresh cannot count twice.
          trackGooglePurchase(order.orderId, order.totalFils, order.kind);
          return;
        }
      } catch {
        // A transient network error is not a failed payment; keep polling.
      }
      if (!done.current) {
        setWaited((w) => w + 2);
        timer = window.setTimeout(poll, 2000);
      }
    };
    poll();
    return () => {
      done.current = true;
      clearTimeout(timer);
    };
  }, [orderId, token]);

  if (confirmed) {
    const isShop = kind === 'shop';
    const isTip = kind === 'tip';
    const isAddon = kind === 'addon';
    // An invoice-balance payment settles money owed on an existing booking — it
    // must not read "Your celebration is booked!".
    const isInvoice = kind === 'invoice_pay';
    const heading = isShop ? t('pay.shopThanks') : isTip ? t('pay.tipThanks') : isAddon ? t('pay.addonAdded')
      : isInvoice ? (ar ? 'تم دفع الفاتورة ✓' : 'Invoice paid ✓') : t('pay.booked');
    const sub = isShop ? t('pay.shopSub') : isTip ? t('pay.tipSub') : isAddon ? t('pay.addonSub')
      : isInvoice ? (ar ? 'تم تأكيد الدفع. بيوصلك إيصال على الإيميل — شكراً لك 💕' : 'Payment verified. Your receipt is on its way by email — thank you 💕')
      : t('pay.bookedSub');
    return (
      <div style={{ padding: '60px 30px 40px', textAlign: 'center', animation: 'rise .4s ease' }}>
        <div
          style={{
            width: 88, height: 88, borderRadius: '50%', background: C.pink, color: '#fff',
            fontSize: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 22px',
          }}
        >
          {isTip ? '💐' : isShop ? '🎁' : '✓'}
        </div>
        <div style={{ ...fredoka(26), lineHeight: 1.15 }}>{heading}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, margin: '12px 0 26px', lineHeight: 1.5 }}>
          {sub}
        </div>
        {!isTip && !isShop && !isInvoice && eventId && (
          <div style={{ background: '#fff', borderRadius: 20, padding: 16, boxShadow: C.shadowLg, display: 'inline-block', minWidth: 220 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, letterSpacing: 1 }}>{t('pay.eventId')}</div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 21, fontWeight: 700, marginTop: 4, letterSpacing: 1 }}>
              {reference ?? eventId}
            </div>
          </div>
        )}
        <div style={{ marginTop: 30 }}>
          <button
            onClick={() => (isShop || isInvoice || !eventId ? onShopDone(kind) : onConfirmed(eventId, kind))}
            style={{ background: C.ink, color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, padding: '15px 34px', borderRadius: 22, cursor: 'pointer' }}
          >
            {isShop || isInvoice || !eventId ? t('pay.shopDone') : isTip || isAddon ? t('pay.backToEvent') : t('pay.viewEvent')}
          </button>
        </div>
      </div>
    );
  }

  const review = status === 'needs_review';
  // The provider told us the attempt was cancelled/declined (return URL), or the
  // server already marked it failed. A server 'paid'/'processing' wins: polling
  // continues underneath and flips to the confirmed screen if money did land.
  const returnedUnpaid = Boolean(returnState) && status !== 'processing' && status !== 'paid' && !review;
  const failed = status === 'failed' || status === 'cancelled' || returnedUnpaid;
  const isPartyBooking = kind === 'booking';

  if (failed) {
    return (
      <div style={{ padding: '60px 30px', textAlign: 'center' }}>
        <div style={{ ...fredoka(22), marginBottom: 10 }}>
          {returnState === 'cancel' && status !== 'failed'
            ? (ar ? 'تم إلغاء الدفع' : 'Payment cancelled')
            : t('pay.failedTitle')}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, lineHeight: 1.6, marginBottom: 24 }}>
          {isPartyBooking || kind === 'shop'
            ? t('pay.failedBody')
            : (ar ? 'لم يُخصم أي مبلغ. تقدر تحاول مرة ثانية.' : 'No charge was made. You can try again.')}
        </div>
        <PrimaryButton onClick={() => onRetry(kind)}>{isPartyBooking ? t('pay.tryAnother') : t('common.tryAgain')}</PrimaryButton>
      </div>
    );
  }

  if (review) {
    return (
      <div style={{ padding: '60px 30px', textAlign: 'center' }}>
        <div style={{ ...fredoka(22), marginBottom: 12 }}>{t('pay.reviewTitle')}</div>
        <Notice tone="warn">{t('pay.reviewBody')}</Notice>
      </div>
    );
  }

  // Stripe embedded checkout — the card / Apple Pay form renders in-page. On
  // completion Stripe returns the page to our /?order=… screen, which polls
  // until the server confirms. The customer never leaves the app to pay.
  if (stripe) {
    return <StripeEmbed stripe={stripe} t={t} ar={ar} onCancel={() => onRetry(kind)} />;
  }

  // In-app payment: show the provider's embedded widget in an iframe and keep
  // polling our server underneath. The customer never leaves the app.
  if (embedUrl) {
    return (
      <div style={{ padding: '10px 12px 20px', animation: 'rise .3s ease' }}>
        <div style={{ ...fredoka(18), textAlign: 'center', margin: '4px 0 10px' }}>{t('pay.securePay')}</div>
        <iframe
          src={embedUrl}
          title={t('pay.securePay')}
          allow="payment *; clipboard-write"
          style={{ width: '100%', height: '68vh', border: `1px solid ${C.pinkLine}`, borderRadius: 16, background: '#fff' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 }}>
          <Spinner />
          <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>{t('pay.confirmingBody')}</span>
        </div>
        {waited > 25 && (
          <div style={{ marginTop: 14 }}>
            <Notice tone="info">{t('pay.stillConfirming')}</Notice>
          </div>
        )}
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button
            onClick={() => onRetry(kind)}
            style={{ background: 'none', border: 'none', color: C.muted, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' }}
          >
            {t('pay.cancelPay')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '80px 30px', textAlign: 'center' }}>
      <Spinner />
      <div style={{ ...fredoka(20), marginBottom: 8 }}>{t('pay.confirming')}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, lineHeight: 1.6 }}>
        {t('pay.confirmingBody')}
      </div>
      {waited > 20 && waited <= 60 && (
        <div style={{ marginTop: 20 }}>
          <Notice tone="info">{t('pay.stillConfirming')}</Notice>
        </div>
      )}
      {/* A customer who closed / backed out of Tabby, Tamara or the card page
          lands here too, and the order then never confirms. Don't trap them on a
          spinner: after a short wait offer a way back to try again (polling keeps
          running, so a payment that does land still confirms). */}
      {waited >= 30 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 10 }}>
            {ar ? 'ما كملت الدفع أو ألغيته؟' : "Didn't finish paying, or cancelled?"}
          </div>
          <button
            onClick={() => onRetry(kind)}
            style={{ background: '#fff', color: C.pinkDeep, border: `1.5px solid ${C.pink}`, fontWeight: 700, fontSize: 13, padding: '11px 24px', borderRadius: 16, cursor: 'pointer' }}
          >
            {t('common.tryAgain')}
          </button>
        </div>
      )}
      {waited > 60 && (
        <div style={{ marginTop: 20 }}>
          <Notice tone="warn">{t('pay.takingLong')}</Notice>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginTop: 12, letterSpacing: 1 }}>{t('pay.orderRef')}</div>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 16, fontWeight: 700, marginTop: 2 }}>{orderId}</div>
          <a
            href="https://wa.me/971564500777"
            style={{ display: 'inline-block', marginTop: 14, background: C.ink, color: '#fff', fontWeight: 700, fontSize: 13, padding: '12px 24px', borderRadius: 18, textDecoration: 'none' }}
          >
            {t('pay.contactUs')}
          </a>
        </div>
      )}
    </div>
  );
}

/** Mounts Stripe's in-page embedded checkout (card / Apple Pay / Google Pay). */
function StripeEmbed({
  stripe,
  t,
  ar,
  onCancel,
}: {
  stripe: { clientSecret: string; publishableKey: string };
  t: TFn;
  ar: boolean;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by "Try again" to re-run the mount (the loader no longer caches a
  // failed Stripe.js download, so a retry really re-fetches it).
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let handle: { destroy: () => void } | null = null;
    let alive = true;
    if (ref.current) {
      void mountStripeCheckout({
        el: ref.current,
        publishableKey: stripe.publishableKey,
        clientSecret: stripe.clientSecret,
        onError: (m) => { if (alive) setError(m); },
      }).then((h) => { if (alive) handle = h; else h.destroy(); });
    }
    return () => { alive = false; handle?.destroy(); };
  }, [stripe.clientSecret, stripe.publishableKey, attempt]);

  return (
    <div style={{ padding: '10px 12px 24px', animation: 'rise .3s ease' }}>
      <div style={{ ...fredoka(18), textAlign: 'center', margin: '4px 0 12px' }}>{t('pay.securePay')}</div>
      {error ? (
        <div style={{ textAlign: 'center' }}>
          <Notice tone="error">
            {ar ? 'تعذّر تحميل نموذج الدفع. تأكد من الاتصال بالإنترنت وحاول مرة ثانية.' : 'The payment form could not load. Check your connection and try again.'}
          </Notice>
          <PrimaryButton onClick={() => { setError(null); setAttempt((n) => n + 1); }} style={{ marginTop: 14 }}>{t('common.tryAgain')}</PrimaryButton>
          <button
            onClick={onCancel}
            style={{ marginTop: 12, background: 'none', border: 'none', color: C.muted, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' }}
          >
            {t('pay.cancelPay')}
          </button>
        </div>
      ) : (
        <>
          <div ref={ref} style={{ minHeight: '58vh' }} />
          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <button
              onClick={onCancel}
              style={{ background: 'none', border: 'none', color: C.muted, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' }}
            >
              {t('pay.cancelPay')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
