import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { MapPicker } from '../MapPicker';
import { mountStripeCheckout } from '../stripe';
import { uaeMobile } from './ShopCheckout';
import { TermsSheet } from './Terms';
import { C, fredoka, Notice, PrimaryButton, Spinner } from '../ui';
import type { Lang, TFn } from '../i18n';

/**
 * Manual-order payment link. A customer opens this from a link the Eventana team
 * sent over WhatsApp (?pay=<id>&t=<token>). They see the agreed order, complete
 * the details we still need (guest of honour, contact, exact location), accept
 * the Terms, and pay by card / Apple Pay through Stripe embedded in the page.
 * On payment, Stripe returns to /?order=… and the normal confirming screen takes
 * over — the booking then appears in the system exactly like an app booking.
 */
export function PayLink({
  orderId,
  token,
  mapsKey,
  lang,
}: {
  orderId: string;
  token: string;
  mapsKey: string | null;
  lang: Lang;
  t: TFn;
}) {
  const ar = lang === 'ar';
  const [data, setData] = useState<any>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [eventFor, setEventFor] = useState('');
  const [area, setArea] = useState('');
  const [street, setStreet] = useState('');
  const [villa, setVilla] = useState('');
  const [details, setDetails] = useState('');
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stripe, setStripe] = useState<{ clientSecret: string; publishableKey: string } | null>(null);

  useEffect(() => {
    api
      .payLinkLoad(orderId, token)
      .then((d) => {
        setData(d);
        if (d.customer?.name) setFullName(d.customer.name);
        if (d.customer?.phone) setPhone(d.customer.phone);
        if (d.customer?.email) setEmail(d.customer.email);
        if (d.prefill?.eventFor) setEventFor(d.prefill.eventFor);
        if (d.prefill?.address) {
          setArea(d.prefill.address.area ?? '');
          setStreet(d.prefill.address.street ?? '');
          setVilla(d.prefill.address.villa ?? '');
          setDetails(d.prefill.address.details ?? '');
        }
        if (d.prefill?.mapPin) setPin(d.prefill.mapPin);
      })
      .catch(() => setLoadErr(ar ? 'الرابط غير صالح أو منتهي.' : 'This link is invalid or has expired.'));
  }, [orderId, token]);

  const isAddon = data?.kind === 'addon';
  const nameOk = fullName.trim().split(/\s+/).filter(Boolean).length >= 2;
  const phoneOk = Boolean(uaeMobile(phone));
  const emailOk = /.+@.+\..+/.test(email.trim());
  const ready = isAddon
    ? !busy
    : nameOk && phoneOk && emailOk && eventFor.trim().length > 0 && pin && agreed && !busy;

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      // An add-on attaches to an existing booking — no details to complete.
      if (!isAddon) {
        await api.payLinkSave(orderId, token, {
          eventFor: eventFor.trim(),
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          address: { area, street, villa, details },
          mapPin: pin,
          termsAccepted: true,
        });
      }
      const res = await api.payLinkPay(orderId, token);
      if (res.alreadyPaid) {
        window.location.href = `/?order=${orderId}&t=${encodeURIComponent(token)}`;
        return;
      }
      if (res.clientSecret && res.publishableKey) {
        setStripe({ clientSecret: res.clientSecret, publishableKey: res.publishableKey });
      } else {
        setError(ar ? 'تعذّر بدء الدفع. حاول مرة ثانية.' : 'Could not start payment. Please try again.');
        setBusy(false);
      }
    } catch (e: any) {
      setError(e?.body?.message ?? (ar ? 'صار خطأ. حاول مرة ثانية.' : 'Something went wrong. Please try again.'));
      setBusy(false);
    }
  };

  if (loadErr) {
    return (
      <div style={{ padding: 24, maxWidth: 480, margin: '0 auto' }} dir={ar ? 'rtl' : 'ltr'}>
        <Notice tone="error">{loadErr}</Notice>
      </div>
    );
  }
  if (!data) return <Spinner label={ar ? 'جاري التحميل…' : 'Loading…'} />;

  if (data.confirmed) {
    return (
      <div style={{ padding: 30, maxWidth: 480, margin: '0 auto', textAlign: 'center' }} dir={ar ? 'rtl' : 'ltr'}>
        <div style={{ fontSize: 44 }}>🎉</div>
        <div style={{ ...fredoka(20), margin: '8px 0' }}>{ar ? 'تم الدفع والتأكيد!' : "You're all set!"}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>{ar ? 'وصلك إيميل التأكيد. نراك قريباً 💕' : 'Your confirmation email is on its way. See you soon 💕'}</div>
      </div>
    );
  }

  if (stripe) {
    return <StripeEmbed clientSecret={stripe.clientSecret} publishableKey={stripe.publishableKey} onError={(m) => { setError(m); setStripe(null); setBusy(false); }} ar={ar} />;
  }

  return (
    <div className="scroll" style={{ height: '100%', overflowY: 'auto', background: C.cream }} dir={ar ? 'rtl' : 'ltr'}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '22px 18px 40px' }}>
        <div style={{ ...fredoka(22), color: C.pinkDeep }}>
          {isAddon ? (ar ? 'إضافة على حجزك' : 'Add to your order') : (ar ? 'إتمام الحجز والدفع' : 'Complete & pay')}
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, marginTop: 4, marginBottom: 14 }}>
          {isAddon
            ? (ar ? 'هذي إضافة على حجزك الحالي — راجعها وادفع.' : "This adds to your existing booking — review and pay.")
            : (ar ? 'راجع طلبك، عبّي بياناتك، وادفع بأمان.' : 'Review your order, add your details, and pay securely.')}
        </div>

        {/* Order summary */}
        <div style={{ background: '#fff', border: `1px solid ${C.pinkLine}`, borderRadius: 18, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: C.pinkDeep, marginBottom: 8 }}>{ar ? 'طلبك' : 'Your order'}</div>
          {(data.items ?? []).map((it: any, i: number) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '5px 0' }}>
              <span style={{ fontWeight: 600 }}>{it.quantity > 1 ? `${it.quantity}× ` : ''}{it.label}</span>
              <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>AED {it.amountDisplay}</span>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${C.pinkLine}`, marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 800 }}>{ar ? 'الإجمالي' : 'Total'}</span>
            <span style={{ ...fredoka(17), color: C.pinkDeep }}>AED {data.totalDisplay}</span>
          </div>
          {(data.event?.eventDate || data.event?.emirate) && (
            <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 8 }}>
              {[data.event.eventDate, data.event.startTime, data.event.emirate].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>

        {/* Customer details — only for a full manual booking, not an add-on. */}
        {!isAddon && (<>
        <label style={lbl}>{ar ? 'اسم صاحب الحفلة' : 'Guest of honour'} *</label>
        <input value={eventFor} onChange={(e) => setEventFor(e.target.value)} style={field} placeholder={ar ? 'مثال: سارة' : 'e.g. Sara'} />
        <label style={lbl}>{ar ? 'اسمك الكامل (اسمين على الأقل)' : 'Your full name (2 names)'} *</label>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} style={field} />
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>{ar ? 'الجوال (إماراتي)' : 'Mobile (UAE)'} *</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" style={field} placeholder="05XXXXXXXX" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>{ar ? 'الإيميل' : 'Email'} *</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" inputMode="email" style={field} />
          </div>
        </div>

        <label style={lbl}>{ar ? 'العنوان' : 'Address'}</label>
        <div style={{ display: 'flex', gap: 10 }}>
          <input value={area} onChange={(e) => setArea(e.target.value)} style={field} placeholder={ar ? 'المنطقة' : 'Area'} />
          <input value={street} onChange={(e) => setStreet(e.target.value)} style={field} placeholder={ar ? 'الشارع' : 'Street'} />
          <input value={villa} onChange={(e) => setVilla(e.target.value)} style={field} placeholder={ar ? 'فيلا/مبنى' : 'Villa/Bldg'} />
        </div>
        <input value={details} onChange={(e) => setDetails(e.target.value)} style={field} placeholder={ar ? 'تفاصيل إضافية (اختياري)' : 'Extra directions (optional)'} />

        <label style={lbl}>{ar ? 'حدّد موقع الحفلة على الخريطة' : 'Pin the exact event location'} *</label>
        <MapPicker
          mapsKey={mapsKey}
          value={pin}
          lang={ar ? 'ar' : 'en'}
          onChange={(p, addr) => { setPin(p); if (addr && !street) setStreet(addr); }}
        />

        <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', margin: '16px 0 6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 3 }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: C.ink, lineHeight: 1.5 }}>
            {ar ? 'أوافق على ' : 'I agree to the '}
            <a onClick={(e) => { e.preventDefault(); setShowTerms(true); }} style={{ color: C.pinkDeep, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>
              {ar ? 'الشروط والأحكام' : 'Terms & Conditions'}
            </a>
          </span>
        </label>
        </>)}

        {error && <div style={{ margin: '8px 0' }}><Notice tone="error">{error}</Notice></div>}

        <PrimaryButton disabled={!ready} onClick={pay} style={{ marginTop: 10 }}>
          {busy ? (ar ? 'جاري التحضير…' : 'Preparing…') : `${ar ? 'الدفع' : 'Pay'} AED ${data.totalDisplay}`}
        </PrimaryButton>

        {showTerms && <TermsSheet lang={lang} onClose={() => setShowTerms(false)} />}
      </div>
    </div>
  );
}

function StripeEmbed({ clientSecret, publishableKey, onError, ar }: { clientSecret: string; publishableKey: string; onError: (m: string) => void; ar: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let handle: { destroy: () => void } | null = null;
    if (ref.current) {
      mountStripeCheckout({ el: ref.current, publishableKey, clientSecret, onError }).then((h) => { handle = h; });
    }
    return () => { handle?.destroy(); };
  }, [clientSecret, publishableKey]);
  return (
    <div className="scroll" style={{ height: '100%', overflowY: 'auto', background: C.cream }} dir={ar ? 'rtl' : 'ltr'}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px 40px' }}>
        <div style={{ ...fredoka(19), color: C.pinkDeep, marginBottom: 12 }}>{ar ? 'الدفع' : 'Payment'}</div>
        <div ref={ref} />
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: C.muted2, margin: '10px 0 5px' };
const field: React.CSSProperties = {
  width: '100%', border: `1px solid ${C.pinkLine}`, borderRadius: 14, padding: '12px 14px',
  fontWeight: 600, fontSize: 13, background: '#fff', color: C.ink, outline: 'none', marginBottom: 2,
};
