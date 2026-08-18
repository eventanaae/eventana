import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { C, fredoka, Notice, PrimaryButton, Spinner } from '../ui';

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
}: {
  orderId: string;
  onConfirmed: (eventId: string) => void;
  onRetry: () => void;
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
    const heading = isTip
      ? 'Thank you for your tip! 💐'
      : isAddon
        ? 'Added to your event! ✨'
        : 'Your celebration is booked! 🎉';
    const sub = isTip
      ? '100% goes straight to your Eventana crew — they’ve been notified. You’re amazing!'
      : isAddon
        ? 'Payment verified. Your extras are now on your event and the team can see them.'
        : 'Payment verified by your provider. Your Eventana team is already preparing everything.';
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
            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, letterSpacing: 1 }}>EVENT ID</div>
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
            {isTip ? 'Back to My Event' : 'View My Event'}
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
        <div style={{ ...fredoka(22), marginBottom: 10 }}>Payment didn’t go through</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, lineHeight: 1.6, marginBottom: 24 }}>
          No charge was made and nothing is booked. You can try again with another payment method —
          your selections are still here.
        </div>
        <PrimaryButton onClick={onRetry}>Try another method</PrimaryButton>
      </div>
    );
  }

  if (review) {
    return (
      <div style={{ padding: '60px 30px', textAlign: 'center' }}>
        <div style={{ ...fredoka(22), marginBottom: 12 }}>We’re checking this one by hand</div>
        <Notice tone="warn">
          Something about this payment needs a person to look at it. The Eventana team has been
          notified and will contact you shortly — please don’t pay again in the meantime.
        </Notice>
      </div>
    );
  }

  return (
    <div style={{ padding: '80px 30px', textAlign: 'center' }}>
      <Spinner />
      <div style={{ ...fredoka(20), marginBottom: 8 }}>Confirming your payment…</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, lineHeight: 1.6 }}>
        We’re waiting for your payment provider to confirm directly with Eventana. This usually takes
        a few seconds — keep this screen open.
      </div>
      {waited > 20 && (
        <div style={{ marginTop: 20 }}>
          <Notice tone="info">
            Still confirming. Your booking is safe — if the provider is slow, our system checks again
            automatically and we’ll notify you the moment it lands.
          </Notice>
        </div>
      )}
    </div>
  );
}
