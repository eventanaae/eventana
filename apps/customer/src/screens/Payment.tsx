import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { C, fredoka, Notice, PrimaryButton, Spinner } from '../ui';
import type { TFn } from '../i18n';
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
  t,
}: {
  orderId: string;
  /** The unguessable order-view token (from the provider return URL). */
  token?: string | null;
  /** When set, pay inside the app via this embedded widget (no redirect). */
  embedUrl?: string | null;
  /** When set, mount Stripe's in-page embedded checkout (no redirect). */
  stripe?: { clientSecret: string; publishableKey: string } | null;
  onConfirmed: (eventId: string) => void;
  /** A confirmed standalone shop order has no event — just finish. */
  onShopDone: () => void;
  onRetry: (kind: string) => void;
  t: TFn;
}) {
  const [status, setStatus] = useState<string>('checking');
  const [eventId, setEventId] = useState<string | null>(null);
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
    const heading = isShop ? t('pay.shopThanks') : isTip ? t('pay.tipThanks') : isAddon ? t('pay.addonAdded') : t('pay.booked');
    const sub = isShop ? t('pay.shopSub') : isTip ? t('pay.tipSub') : isAddon ? t('pay.addonSub') : t('pay.bookedSub');
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
        {!isTip && !isShop && eventId && (
          <div style={{ background: '#fff', borderRadius: 20, padding: 16, boxShadow: C.shadowLg, display: 'inline-block', minWidth: 220 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, letterSpacing: 1 }}>{t('pay.eventId')}</div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 21, fontWeight: 700, marginTop: 4, letterSpacing: 1 }}>
              {eventId}
            </div>
          </div>
        )}
        <div style={{ marginTop: 30 }}>
          <button
            onClick={() => (isShop || !eventId ? onShopDone() : onConfirmed(eventId))}
            style={{ background: C.ink, color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, padding: '15px 34px', borderRadius: 22, cursor: 'pointer' }}
          >
            {isShop ? t('pay.shopDone') : isTip ? t('pay.backToEvent') : t('pay.viewEvent')}
          </button>
        </div>
      </div>
    );
  }

  const failed = status === 'failed' || status === 'cancelled';
  const review = status === 'needs_review';

  if (failed) {
    return (
      <div style={{ padding: '60px 30px', textAlign: 'center' }}>
        <div style={{ ...fredoka(22), marginBottom: 10 }}>{t('pay.failedTitle')}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, lineHeight: 1.6, marginBottom: 24 }}>
          {t('pay.failedBody')}
        </div>
        <PrimaryButton onClick={() => onRetry(kind)}>{t('pay.tryAnother')}</PrimaryButton>
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
    return <StripeEmbed stripe={stripe} t={t} onCancel={() => onRetry(kind)} />;
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
  onCancel,
}: {
  stripe: { clientSecret: string; publishableKey: string };
  t: TFn;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, [stripe.clientSecret, stripe.publishableKey]);

  return (
    <div style={{ padding: '10px 12px 24px', animation: 'rise .3s ease' }}>
      <div style={{ ...fredoka(18), textAlign: 'center', margin: '4px 0 12px' }}>{t('pay.securePay')}</div>
      {error ? (
        <div style={{ textAlign: 'center' }}>
          <Notice tone="error">{error}</Notice>
          <PrimaryButton onClick={onCancel} style={{ marginTop: 14 }}>{t('pay.tryAnother')}</PrimaryButton>
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
