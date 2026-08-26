import { useMemo, useState } from 'react';
import type { ScreenProps } from '../App';
import { api } from '../api';
import { trackInitiateCheckout } from '../attribution';
import { C, Field, fredoka, money, Notice, PrimaryButton } from '../ui';
import { quoteShop, SHOP_DRAWING_IDS, SHOP_EMIRATES, SHOP_READY_DAYS } from '@eventana/shared';

/**
 * A UAE mobile number, normalized to 5XXXXXXXX (or null if not valid). Accepts
 * 05XXXXXXXX, +9715XXXXXXXX, 9715XXXXXXXX or 5XXXXXXXX. Used to require a real
 * Emirati number and to compare the primary against the backup.
 */
export function uaeMobile(raw: string): string | null {
  let d = (raw || '').replace(/\D/g, '');
  if (d.startsWith('971')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return /^5\d{8}$/.test(d) ? d : null;
}

/**
 * Checkout for the standalone shop. No party (no date/time/venue/map pin):
 * digital goods are emailed, printed goods ship to an address for a flat fee
 * and are ready in ~2 weeks. Drawing-based items need the guest's picture or a
 * professional drawing we make.
 */
export function ShopCheckout({
  catalogue,
  shopCart,
  go,
  t,
  onOrder,
}: ScreenProps & {
  onOrder: (
    orderId: string,
    embedUrl?: string,
    token?: string,
    stripe?: { clientSecret: string; publishableKey: string },
  ) => void;
}) {
  const services = useMemo(
    () => new Map(catalogue.services.map((s) => [s.id, s])),
    [catalogue],
  );
  const items = Object.entries(shopCart)
    .filter(([, q]) => q > 0)
    .map(([serviceId, quantity]) => ({ serviceId, quantity }));

  const [emirate, setEmirate] = useState<string | null>(null);
  const q = quoteShop(items, emirate, services as never);
  const hasPrinted = q.hasPrinted;
  const needsDrawing = items.some((i) => SHOP_DRAWING_IDS.has(i.serviceId));

  const [reg, setReg] = useState({ name: '', email: '', phone: '', backupPhone: '' });
  const [addr, setAddr] = useState({ area: '', street: '', villa: '', details: '' });
  const [refs, setRefs] = useState<string[]>([]);
  const [wantDraw, setWantDraw] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailOk = /.+@.+\..+/.test(reg.email.trim());
  // Full name must be at least two words (first + last).
  const fullNameOk = reg.name.trim().split(/\s+/).filter((w) => w.length >= 1).length >= 2;
  const phoneN = uaeMobile(reg.phone);
  const backupN = uaeMobile(reg.backupPhone);
  const phonesDiffer = Boolean(phoneN) && Boolean(backupN) && phoneN !== backupN;
  const guestReady =
    fullNameOk && emailOk && Boolean(phoneN) && Boolean(backupN) && phonesDiffer;
  const noDelivery = hasPrinted && Boolean(emirate) && q.problems.some((p) => p.code === 'no_delivery');
  const addressReady = !hasPrinted || (Boolean(emirate) && addr.area.trim().length > 0 && !noDelivery);
  const customizationReady = !needsDrawing || wantDraw || refs.length > 0;
  const canPay = q.bookable && guestReady && addressReady && customizationReady && agreed && !paying;

  const readyBy = new Date(Date.now() + SHOP_READY_DAYS * 86_400_000);
  const readyStr = readyBy.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadBusy(true);
    setError(null);
    try {
      // Commit each image as it uploads, so if a later one fails the earlier
      // successes are kept (and not orphaned on Cloudinary + re-uploaded).
      for (const f of Array.from(files).slice(0, 3 - refs.length)) {
        const url = await api.uploadThemeRef(f);
        setRefs((r) => [...r, url].slice(0, 3));
        setWantDraw(false);
      }
    } catch {
      setError(t('shopco.uploadFailed'));
    } finally {
      setUploadBusy(false);
    }
  };

  const pay = async () => {
    setPaying(true);
    setError(null);
    try {
      const guest = {
        name: reg.name.trim(),
        phone: reg.phone.trim(),
        backupPhone: reg.backupPhone.trim(),
        email: reg.email.trim(),
      };
      const provider =
        catalogue.paymentMethods.find((p) => p.name === 'stripe')?.name ??
        'stripe';
      const result = await api.shopCheckout({
        items,
        emirate: hasPrinted ? emirate : null,
        address: hasPrinted ? addr : null,
        customization: needsDrawing ? { refImages: refs, wantDraw } : null,
        provider,
        termsAccepted: agreed,
        guest,
      });
      if (
        !result.eligible ||
        (!result.checkoutUrl && !result.embeddedUrl && !result.clientSecret)
      ) {
        setError(t('shopco.payUnavailable'));
        setPaying(false);
        return;
      }
      // Reached the payment provider — see the note in Checkout.tsx.
      trackInitiateCheckout(result.totalFils);
      // Keep the cart until the order is CONFIRMED (cleared in onShopDone) so a
      // failed/cancelled payment can be retried with the items still in place.
      if (result.clientSecret && result.publishableKey) {
        onOrder(result.orderId, undefined, result.orderToken, {
          clientSecret: result.clientSecret,
          publishableKey: result.publishableKey,
        });
      } else if (result.checkoutUrl) {
        onOrder(result.orderId, undefined, result.orderToken);
        window.location.href = result.checkoutUrl;
      } else if (result.embeddedUrl) {
        onOrder(result.orderId, result.embeddedUrl, result.orderToken);
      }
    } catch (e: unknown) {
      const err = e as { body?: { message?: string }; message?: string };
      setError(err?.body?.message ?? err?.message ?? t('shopco.network'));
      setPaying(false);
    }
  };

  if (items.length === 0) {
    return (
      <div style={{ padding: '40px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 34, marginBottom: 8 }}>🎁</div>
        <div style={{ ...fredoka(20) }}>{t('shopco.empty')}</div>
        <div style={{ marginTop: 16 }}>
          <PrimaryButton onClick={() => go('shop')}>{t('shopco.browse')}</PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 22px 30px', animation: 'rise .35s ease' }}>
      <button onClick={() => go('shop')} style={backStyle}>{t('common.back')}</button>
      <div style={{ ...fredoka(24), margin: '8px 0 16px' }}>{t('shopco.title')}</div>

      {/* order summary */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>{t('shopco.summary')}</div>
        {q.lines.map((l) => (
          <div key={l.serviceId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
            <span style={{ color: C.ink }}>{l.name} × {l.quantity}</span>
            <span style={{ color: C.ink }}>{t('common.aed')} {money(l.amountFils)}</span>
          </div>
        ))}
        {hasPrinted && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 600, marginTop: 4, color: C.muted }}>
            <span>{t('shopco.delivery')}</span>
            <span>{emirate ? (q.deliveryFils ? `${t('common.aed')} ${money(q.deliveryFils)}` : '—') : t('shopco.pickEmirate')}</span>
          </div>
        )}
        <div style={{ borderTop: `1px solid ${C.pinkLine}`, marginTop: 9, paddingTop: 9, display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 15 }}>
          <span>{t('shopco.total')}</span>
          <span>{t('common.aed')} {money(q.totalFils)}</span>
        </div>
        {hasPrinted && (
          <div style={{ marginTop: 10 }}>
            <Notice tone="info">{t('shopco.readyBy', { date: readyStr })}</Notice>
          </div>
        )}
        {q.hasDigital && (
          <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: C.muted }}>{t('shopco.digitalNote')}</div>
        )}
      </div>

      {/* your details */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>{t('shopco.yourDetails')}</div>
        <Field placeholder={`${t('checkout.phFullName')} *`} value={reg.name} onChange={(v) => setReg((r) => ({ ...r, name: v }))} style={{ marginBottom: 9 }} />
        {reg.name.trim().length > 0 && !fullNameOk && (
          <div style={hintErr}>{t('shopco.nameTwo')}</div>
        )}
        <Field placeholder={`${t('checkout.phEmail')} *`} value={reg.email} onChange={(v) => setReg((r) => ({ ...r, email: v }))} style={{ marginBottom: 9 }} />
        <Field placeholder={`${t('checkout.phMobile')} *`} value={reg.phone} onChange={(v) => setReg((r) => ({ ...r, phone: v }))} style={{ marginBottom: 9 }} />
        <Field placeholder={`${t('checkout.phBackup')} *`} value={reg.backupPhone} onChange={(v) => setReg((r) => ({ ...r, backupPhone: v }))} />
        {reg.phone.trim().length > 0 && !phoneN && (
          <div style={hintErr}>{t('shopco.phoneUae')}</div>
        )}
        {reg.backupPhone.trim().length > 0 && !backupN && (
          <div style={hintErr}>{t('shopco.backupUae')}</div>
        )}
        {phoneN && backupN && !phonesDiffer && (
          <div style={hintErr}>{t('shopco.phonesSame')}</div>
        )}
      </div>

      {/* delivery address (printed only) */}
      {hasPrinted && (
        <div style={cardStyle}>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>{t('shopco.deliveryAddress')}</div>
          <select
            value={emirate ?? ''}
            onChange={(e) => setEmirate(e.target.value || null)}
            style={{ width: '100%', border: `1px solid ${C.pinkLine}`, borderRadius: 14, padding: '12px 14px', fontWeight: 600, fontSize: 12.5, background: '#fff', color: C.ink, outline: 'none', marginBottom: 9 }}
          >
            <option value="">{t('shopco.selectEmirate')}</option>
            {SHOP_EMIRATES.map((em) => (
              <option key={em} value={em}>{em}</option>
            ))}
          </select>
          {noDelivery && (
            <div style={{ marginBottom: 9 }}><Notice tone="error">{t('shopco.noDelivery')}</Notice></div>
          )}
          <Field placeholder={`${t('checkout.phArea')} *`} value={addr.area} onChange={(v) => setAddr((a) => ({ ...a, area: v }))} style={{ marginBottom: 9 }} />
          <Field placeholder={t('checkout.phStreet')} value={addr.street} onChange={(v) => setAddr((a) => ({ ...a, street: v }))} style={{ marginBottom: 9 }} />
          <Field placeholder={t('checkout.phVilla')} value={addr.villa} onChange={(v) => setAddr((a) => ({ ...a, villa: v }))} />
        </div>
      )}

      {/* customization: drawing / photo (drawing items only) */}
      {needsDrawing && (
        <div style={cardStyle}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('shopco.customization')}</div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, margin: '4px 0 12px', lineHeight: 1.5 }}>{t('shopco.customizationSub')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {refs.map((url, i) => (
              <div key={i} style={{ width: 62, height: 62, borderRadius: 12, background: `#f2e7ee url(${url}) center/cover`, position: 'relative' }}>
                <button onClick={() => setRefs((r) => r.filter((_, j) => j !== i))} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: C.ink, color: '#fff', fontSize: 12, cursor: 'pointer' }}>×</button>
              </div>
            ))}
            {refs.length < 3 && !wantDraw && (
              <label style={{ width: 62, height: 62, borderRadius: 12, border: `1.5px dashed ${C.pinkLine}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 22, color: C.pinkDeep }}>
                {uploadBusy ? '…' : '＋'}
                <input type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
              </label>
            )}
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer' }}>
            <input type="checkbox" checked={wantDraw} onChange={(e) => { setWantDraw(e.target.checked); if (e.target.checked) setRefs([]); }} style={{ marginTop: 2, width: 16, height: 16, accentColor: C.pink, flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: C.ink, lineHeight: 1.5 }}>{t('shopco.wantDraw')}</span>
          </label>
        </div>
      )}

      {/* terms */}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer', margin: '4px 2px 12px' }}>
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: C.pink, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: C.ink, lineHeight: 1.5 }}>{t('checkout.agreePre')} {t('checkout.agreeLink')}</span>
      </label>

      {/* payment */}
      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, marginBottom: 10 }}>{t('shopco.payNote')}</div>
      {error && (<div style={{ marginBottom: 10 }}><Notice tone="error">{error}</Notice></div>)}
      <PrimaryButton disabled={!canPay} onClick={pay}>
        {paying ? t('checkout.pleaseWait') : `${t('shopco.pay')} · ${t('common.aed')} ${money(q.totalFils)}`}
      </PrimaryButton>
      {!canPay && !paying && (
        <div style={{ marginTop: 10, fontSize: 11, fontWeight: 700, color: C.red, textAlign: 'center' }}>
          {!guestReady ? t('shopco.needDetails')
            : !addressReady ? t('shopco.needAddress')
            : !customizationReady ? t('shopco.needDrawing')
            : !agreed ? t('shopco.needTerms')
            : ''}
        </div>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 18, padding: '16px 16px', boxShadow: C.shadow, marginBottom: 14,
};
const backStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: C.muted, fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0,
};
const hintErr: React.CSSProperties = {
  color: C.red, fontSize: 11, fontWeight: 700, marginTop: -3, marginBottom: 6, lineHeight: 1.4,
};
