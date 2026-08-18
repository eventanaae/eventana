import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { C, fredoka, Notice, PrimaryButton, Spinner } from '../ui';
import type { TFn } from '../i18n';

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
  onConfirmed,
  onRetry,
  t,
}: {
  orderId: string;
  onConfirmed: (eventId: string) => void;
  onRetry: () => void;
  t: TFn;
}) {
  const [status, setStatus] = useState<string>('checking');
  const [eventId, setEventId] = useState<string | null>(null);
  const [kind, setKind] = useState<string>('booking');
  const [waited, setWaited] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    let timer: number;
    const poll = async () => {
      try {
        const order = await api.order(orderId);
        setStatus(order.status);
        setKind(order.kind);
        if (order.confirmed && order.eventId) {
          done.current = true;
          setEventId(order.eventId);
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
  }, [orderId]);

  if (eventId) {
    const isTip = kind === 'tip';
    const isAddon = kind === 'addon';
    const heading = isTip ? t('pay.tipThanks') : isAddon ? t('pay.addonAdded') : t('pay.booked');
    const sub = isTip ? t('pay.tipSub') : isAddon ? t('pay.addonSub') : t('pay.bookedSub');
    return (
      <div style={{ padding: '60px 30px 40px', textAlign: 'center', animation: 'rise .4s ease' }}>
        <div
          style={{
            width: 88, height: 88, borderRadius: '50%', background: C.pink, color: '#fff',
            fontSize: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 22px',
          }}
        >
          {isTip ? '💐' : '✓'}
        </div>
        <div style={{ ...fredoka(26), lineHeight: 1.15 }}>{heading}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, margin: '12px 0 26px', lineHeight: 1.5 }}>
          {sub}
        </div>
        {!isTip && (
          <div style={{ background: '#fff', borderRadius: 20, padding: 16, boxShadow: C.shadowLg, display: 'inline-block', minWidth: 220 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, letterSpacing: 1 }}>{t('pay.eventId')}</div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 21, fontWeight: 700, marginTop: 4, letterSpacing: 1 }}>
              {eventId}
            </div>
          </div>
        )}
        <div style={{ marginTop: 30 }}>
          <button
            onClick={() => onConfirmed(eventId)}
            style={{ background: C.ink, color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, padding: '15px 34px', borderRadius: 22, cursor: 'pointer' }}
          >
            {isTip ? t('pay.backToEvent') : t('pay.viewEvent')}
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
        <PrimaryButton onClick={onRetry}>{t('pay.tryAnother')}</PrimaryButton>
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

  return (
    <div style={{ padding: '80px 30px', textAlign: 'center' }}>
      <Spinner />
      <div style={{ ...fredoka(20), marginBottom: 8 }}>{t('pay.confirming')}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, lineHeight: 1.6 }}>
        {t('pay.confirmingBody')}
      </div>
      {waited > 20 && (
        <div style={{ marginTop: 20 }}>
          <Notice tone="info">{t('pay.stillConfirming')}</Notice>
        </div>
      )}
    </div>
  );
}
