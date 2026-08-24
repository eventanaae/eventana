import { useEffect, useState } from 'react';
import { api } from '../api';
import { toCart, type ScreenProps } from '../App';
import { C, Chip, Field, fredoka, money, Notice, PrimaryButton, timeLabel, isPreOrderCategory } from '../ui';
import { loadAccount, saveAccount, clearAccount, type Account } from '../account';
import { loadProfile } from '../profile';
import { MapPicker } from '../MapPicker';
import { TermsSheet } from './Terms';

/* ---- Payment-method brand marks (small, recognisable, self-contained) ---- */
const brandBox: React.CSSProperties = {
  height: 21, padding: '0 7px', borderRadius: 5, background: '#fff',
  border: '1px solid #e7dbe2', display: 'inline-flex', alignItems: 'center',
  justifyContent: 'center', gap: 2, fontSize: 10, fontWeight: 900, lineHeight: 1,
};
function Visa() {
  return <span style={{ ...brandBox, color: '#1A1F71', fontStyle: 'italic', letterSpacing: '.4px' }}>VISA</span>;
}
function TwoCircles({ a, b }: { a: string; b: string }) {
  return (
    <span style={{ ...brandBox, padding: '0 6px' }}>
      <span style={{ width: 13, height: 13, borderRadius: '50%', background: a }} />
      <span style={{ width: 13, height: 13, borderRadius: '50%', background: b, marginLeft: -5, mixBlendMode: 'multiply' }} />
    </span>
  );
}
function Amex() {
  return <span style={{ ...brandBox, background: '#2E77BC', color: '#fff', border: 'none' }}>AMEX</span>;
}
function CardLogos() {
  return (
    <>
      <Visa />
      <TwoCircles a="#EB001B" b="#F79E1B" />
      <TwoCircles a="#0099DF" b="#ED0006" />
      <Amex />
    </>
  );
}
function ApplePayMark() {
  return (
    <span style={{ ...brandBox, color: '#000' }}>
      <svg viewBox="0 0 384 512" width="11" height="11" fill="currentColor">
        <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
      </svg>
      <span style={{ fontSize: 10.5, fontWeight: 800 }}>Pay</span>
    </span>
  );
}
function TabbyTamara() {
  return (
    <>
      <span style={{ ...brandBox, background: '#c2f5e1', color: '#0a3d2a', border: 'none', letterSpacing: '.2px' }}>tabby</span>
      <span style={{ ...brandBox, background: 'linear-gradient(90deg,#ff7aa8,#8a5cf6)', color: '#fff', border: 'none', letterSpacing: '.2px' }}>tamara</span>
    </>
  );
}

/** Placement photos are offered only for items actually in the booking. */
const PHOTO_ROWS: Array<{ key: string; label: string; match: RegExp }> = [
  { key: 'backdrop', label: 'Main Backdrop', match: /backdrop/i },
  { key: 'inflatable', label: 'Inflatable', match: /castle|bubble|slide|football|inflatable/i },
  { key: 'welcome', label: 'Welcoming Stand', match: /welcom/i },
  { key: 'tables', label: 'Tables & Chairs', match: /table/i },
  { key: 'stations', label: 'Food Stations', match: /station|popcorn|cotton|fountain|nachos|burger|pancake|corn|ice cream|slush|hot dog/i },
];

export function Checkout({
  catalogue,
  draft,
  update,
  quote,
  quoteError,
  retryQuote,
  go,
  onOrder,
  t,
  lang,
}: ScreenProps & { onOrder: (orderId: string, embedUrl?: string | null) => void }) {
  const [times, setTimes] = useState<Array<{ value: string; allowed: boolean }>>([]);
  const [paying, setPaying] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [account, setAccount] = useState<Account | null>(() => loadAccount());
  const [authMode, setAuthMode] = useState<'register' | 'login'>('register');

  // Savings: promo code, store credit, point redemption.
  const [rewards, setRewards] = useState<Awaited<ReturnType<typeof api.rewards>> | null>(null);
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<{ code: string; amountFils: number } | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [useCredit, setUseCredit] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState(false);
  const [reg, setReg] = useState({ name: loadProfile()?.name ?? '', email: '', phone: '', backupPhone: '', password: '', referralCode: '' });
  // Guest checkout is the default; creating an account (for points + a next-
  // booking voucher) is opt-in.
  const [wantAccount, setWantAccount] = useState(false);
  // Visual payment choice. Both Card and Apple Pay settle through the same live
  // wallet rail (Ziina), which presents the chosen method on its secure page.
  const [payChoice, setPayChoice] = useState<'card' | 'applepay'>('applepay');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [forgotMsg, setForgotMsg] = useState<string | null>(null);

  const forgotPassword = async () => {
    if (!emailOk) { setAuthError(t('checkout.forgotEmail')); return; }
    setAuthError(null);
    try { await api.forgotPassword(reg.email.trim()); } catch { /* never reveal */ }
    setForgotMsg(t('checkout.forgotSent'));
  };

  // The booking captures who the party is FOR, separately from the account
  // holder, with wording that fits the celebration.
  const forKeys = ['kids', 'graduation', 'bride', 'baby', 'gender', 'adult'];
  const eventForLabel = t(`checkout.for.${forKeys.includes(draft.celebrationType) ? draft.celebrationType : 'default'}`);

  const emailOk = /.+@.+\..+/.test(reg.email.trim());
  // Guest details needed to book (backup phone + email are mandatory). If they
  // opt into an account, a password is needed too.
  const guestReady =
    reg.name.trim().length >= 2 && emailOk && reg.phone.trim().length >= 6 &&
    reg.backupPhone.trim().length >= 6 && (!wantAccount || reg.password.length >= 6);
  const loginReady = emailOk && reg.password.length >= 1;

  const submitAuth = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const acc =
        authMode === 'register'
          ? await api.register({
              name: reg.name.trim(),
              email: reg.email.trim(),
              phone: reg.phone.trim(),
              password: reg.password,
              referralCode: reg.referralCode.trim() || undefined,
            })
          : await api.login({ email: reg.email.trim(), password: reg.password });
      saveAccount(acc);
      setAccount(acc);
    } catch (e: any) {
      setAuthError(e?.body?.message ?? e?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setAuthBusy(false);
    }
  };

  useEffect(() => {
    api.startTimes().then(setTimes).catch(() => setTimes([]));
  }, []);

  // Make sure a valid, enabled payment method is selected. A saved draft can
  // carry a stale provider (e.g. a disabled BNPL default) that would fail at
  // checkout — snap to the first live method instead.
  useEffect(() => {
    const pms = catalogue.paymentMethods;
    if (pms.length && !pms.some((p) => p.name === draft.provider)) {
      update({ provider: pms[0].name });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogue.paymentMethods, draft.provider]);

  // Load the customer's rewards balance once signed in (for credit + points).
  useEffect(() => {
    if (account) api.rewards().then(setRewards).catch(() => setRewards(null));
    else { setRewards(null); setUseCredit(false); setRedeemPoints(false); }
  }, [account]);

  const subtotalFils = quote?.totalFils ?? 0;

  // Estimated savings, mirroring the server's priority order (promo → credit →
  // points), each capped so at least AED 5 stays payable. The server is
  // authoritative at payment; this is the live preview.
  const MIN_PAYABLE = 500;
  let remaining = subtotalFils;
  const promoFils = promo ? Math.min(promo.amountFils, Math.max(0, remaining - MIN_PAYABLE)) : 0;
  remaining -= promoFils;
  const creditFils = useCredit && rewards ? Math.min(rewards.creditFils, Math.max(0, remaining - MIN_PAYABLE)) : 0;
  remaining -= creditFils;
  const pointsFils = redeemPoints && rewards ? Math.min(rewards.redeemableFils, Math.max(0, remaining - MIN_PAYABLE)) : 0;
  remaining -= pointsFils;
  const savingsFils = promoFils + creditFils + pointsFils;
  const estTotalFils = Math.max(0, subtotalFils - savingsFils);

  const applyPromo = async () => {
    const code = promoInput.trim();
    if (!code) return;
    setPromoBusy(true);
    setPromoError(null);
    try {
      const r = await api.checkPromo(code, subtotalFils);
      if (r.ok && r.code) { setPromo({ code: r.code, amountFils: r.amountFils ?? 0 }); setPromoError(null); }
      else { setPromo(null); setPromoError(r.reason ?? 'This code isn’t valid.'); }
    } catch {
      setPromoError('Couldn’t check that code. Try again.');
    } finally {
      setPromoBusy(false);
    }
  };

  const zone = catalogue.deliveryZones.find((z) => z.emirate === draft.emirate);
  const blocked = zone && (!zone.available || zone.feeFils === null);

  // Made-to-order keepsakes need ~2 weeks; warn if the event is sooner.
  const hasPreOrder = Object.keys(draft.services).some((id) => {
    const s = catalogue.services.find((x) => x.id === id);
    return s ? isPreOrderCategory(s.categoryId) : false;
  });
  const daysToEvent = Math.ceil((new Date(`${draft.eventDate}T00:00:00`).getTime() - Date.now()) / 86_400_000);
  const preOrderRisk = hasPreOrder && daysToEvent < 14;

  // A package always runs 4 hours, so any 6-hour add-on (inflatables, machines,
  // décor) booked alongside a package runs for the party window, not its own 6h.
  const sixHourInPackage =
    Boolean(draft.packageId) &&
    Object.keys(draft.services).some((id) => {
      const c = catalogue.services.find((x) => x.id === id)?.categoryId;
      return c === 'inflatables' || c === 'machines' || c === 'backdrop';
    });

  // Which placement-photo rows apply to what is actually booked.
  const bookedLabels = [
    ...(draft.packageId
      ? (catalogue.packages.find((p) => p.id === draft.packageId)?.items ?? []).map((i) => i.name)
      : []),
    ...Object.keys(draft.services).map(
      (id) => catalogue.services.find((s) => s.id === id)?.name ?? '',
    ),
  ].join(' | ');
  const photoRows = PHOTO_ROWS.filter((r) => r.match.test(bookedLabels));

  const pay = async () => {
    setPaying(true);
    setError(null);
    try {
      // Not signed in: either create the opt-in account first (so this booking
      // is under it and earns points + a voucher), or check out as a guest.
      let guest: { name: string; phone: string; backupPhone: string; email: string } | undefined;
      if (!account) {
        const g = {
          name: reg.name.trim(), phone: reg.phone.trim(),
          backupPhone: reg.backupPhone.trim(), email: reg.email.trim(),
        };
        if (wantAccount) {
          const acc = await api.register({ ...g, password: reg.password, referralCode: reg.referralCode.trim() || undefined });
          saveAccount(acc);
          setAccount(acc);
        } else {
          guest = g;
        }
      }
      const result = await api.checkout(toCart(draft), draft.provider, {
        promoCode: promo?.code ?? null,
        useCredit,
        redeemPoints,
      }, agreed, guest);
      if (!result.eligible || (!result.embeddedUrl && !result.checkoutUrl)) {
        setError(t('checkout.providerUnavailable', { provider: draft.provider }));
        setPaying(false);
        return;
      }
      // Use the provider's hosted checkout (redirect) — the reliable path.
      // Ziina's embedded iframe widget returns "Forbidden" for this account
      // (embedded/iframe payments are not enabled), so only fall back to the
      // embedded widget when no redirect URL is available. Nothing is confirmed
      // here — the app returns and waits for the server's webhook view.
      if (result.checkoutUrl) {
        onOrder(result.orderId);
        window.location.href = result.checkoutUrl;
      } else if (result.embeddedUrl) {
        onOrder(result.orderId, result.embeddedUrl);
      }
    } catch (e: any) {
      // A thrown fetch (no server body) is a connection problem — show a clear,
      // localised message instead of the browser's raw "Load failed".
      setError(e?.body?.message ?? (e?.body ? e.message : t('checkout.network')));
      setPaying(false);
    }
  };

  const canPay =
    Boolean(quote?.bookable) && Boolean(draft.mapPin) && !blocked && !paying && agreed &&
    (Boolean(account) || (authMode === 'register' && guestReady));

  // The live wallet rail (Card + Apple Pay both settle through it).
  const walletName =
    catalogue.paymentMethods.find((p) => p.name === 'ziina')?.name ??
    catalogue.paymentMethods[0]?.name ??
    'ziina';

  return (
    <div style={{ padding: '8px 22px 30px', animation: 'rise .35s ease' }}>
      <button onClick={() => go('theme')} style={backStyle}>{t('common.back')}</button>
      <div style={{ ...fredoka(24), margin: '8px 0 16px' }}>{t('checkout.title')}</div>

      {/* --------- who the celebration is for (not the account holder) --------- */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>{t('checkout.forWho')}</div>
        <Field
          placeholder={eventForLabel}
          value={draft.eventFor}
          onChange={(v) => update({ eventFor: v })}
        />
      </div>

      {/* ---------------- location ---------------- */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>{t('checkout.location')}</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 9 }}>
          {t('checkout.deliveryAuto')}
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {catalogue.deliveryZones.map((z) => (
            <Chip
              key={z.emirate}
              label={z.emirate}
              active={draft.emirate === z.emirate}
              onClick={() => update({ emirate: z.emirate })}
            />
          ))}
        </div>

        {blocked ? (
          <div style={{ marginTop: 10 }}>
            <Notice tone="error">{zone?.specialConditions ?? catalogue.notices.alGharbia}</Notice>
          </div>
        ) : (
          zone?.feeFils != null && (
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: C.green }}>
              {t('checkout.deliveryTo', { zone: zone.zoneName, aed: `${t('common.aed')} ${money(zone.feeFils)}` })}
            </div>
          )
        )}

        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <Field
            placeholder={t('checkout.phArea')}
            value={draft.address.area}
            onChange={(v) => update({ address: { ...draft.address, area: v } })}
          />
          <div style={{ display: 'flex', gap: 9 }}>
            <Field
              placeholder={t('checkout.phStreet')}
              value={draft.address.street}
              onChange={(v) => update({ address: { ...draft.address, street: v } })}
            />
            <Field
              placeholder={t('checkout.phVilla')}
              value={draft.address.villa}
              onChange={(v) => update({ address: { ...draft.address, villa: v } })}
            />
          </div>
          <Field
            placeholder={t('checkout.phDetails')}
            value={draft.address.details}
            onChange={(v) => update({ address: { ...draft.address, details: v } })}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, color: C.pinkDeep, marginBottom: 7 }}>
            {t('checkout.pinRequired')}
          </div>
          <MapPicker
            mapsKey={catalogue.mapsKey}
            value={draft.mapPin}
            onChange={(pin, addr) =>
              update({
                mapPin: pin,
                address: addr ? { ...draft.address, details: draft.address.details || addr } : draft.address,
              })
            }
          />
          {draft.mapPin && (
            <div style={{ fontSize: 10.5, fontWeight: 600, color: '#6fae95', marginTop: 6 }}>
              {t('checkout.pinUsed')}
            </div>
          )}
        </div>
      </div>

      {/* Placement photos are captured for real in My Event (with upload) once
          the booking exists — not here, where there is no event to attach them
          to yet. A short heads-up sets the expectation. */}
      {photoRows.length > 0 && (
        <div style={{ ...cardStyle, background: C.mintSoft }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{t('checkout.setupSpotTitle')}</div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: '#5f8f86', margin: '4px 0 0', lineHeight: 1.5 }}>
            {t('checkout.setupSpotBody')}
          </div>
        </div>
      )}

      {/* ---------------- date & time ---------------- */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>{t('checkout.eventTime')}</div>

        {/* 1) Date first — a clear, obviously-tappable picker. */}
        <div style={{ fontSize: 11.5, fontWeight: 700, color: C.ink, marginBottom: 6 }}>{t('checkout.eventDate')}</div>
        <input
          type="date"
          value={draft.eventDate}
          min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
          onChange={(e) => update({ eventDate: e.target.value })}
          style={{
            width: '100%', border: `1px solid ${C.pinkLine}`, borderRadius: 14, padding: '12px 14px',
            fontWeight: 700, fontSize: 13.5, background: '#fff', color: C.ink, outline: 'none', marginBottom: 10,
          }}
        />
        {quote?.problems.some((p) => p.code === 'too_soon') && (
          <div style={{ marginBottom: 12 }}>
            <Notice tone="error">{t('checkout.tooSoon')}</Notice>
          </div>
        )}
        {quote?.problems.some((p) => p.code === 'item_needs_lead') && (
          <div style={{ marginBottom: 12 }}>
            <Notice tone="error">{t('checkout.itemNeedsLead')}</Notice>
          </div>
        )}
        {quote?.lines.some((l) => l.kind === 'surcharge') && (
          <div style={{ marginBottom: 12 }}>
            <Notice tone="warn">{t('checkout.rushNote')}</Notice>
          </div>
        )}

        {/* 2) Then the start time. */}
        <div style={{ fontSize: 11.5, fontWeight: 700, color: C.ink, marginBottom: 3 }}>{t('checkout.startTimeLabel')}</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 9 }}>
          {t('checkout.pickStart')}
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {(times.length ? times : catalogue.startTimes.map((v) => ({ value: v, allowed: true }))).map((t) => (
            <Chip
              key={t.value}
              label={timeLabel(t.value)}
              active={draft.startTime === t.value}
              disabled={!t.allowed}
              onClick={() => update({ startTime: t.value })}
            />
          ))}
        </div>
        {quote?.problems.some((p) => p.code === 'end_after_midnight') && (
          <div style={{ marginTop: 10 }}>
            <Notice tone="error">{catalogue.notices.midnight}</Notice>
          </div>
        )}
        {draft.startTime && quote?.endTime && (
          <div style={{ marginTop: 12, textAlign: 'center', fontSize: 12.5, fontWeight: 700, color: C.pinkDeep }}>
            {timeLabel(draft.startTime)} – {quote.endTime}
          </div>
        )}
        {/* Number of children only matters for Build-Your-Own (per-child
            pricing). Packages have a fixed capacity, so we never ask. */}
        {!draft.packageId && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 6 }}>
              {t('checkout.numChildren')}
            </div>
            <Field
              placeholder="25"
              value={String(draft.childrenCount)}
              onChange={(v) => update({ childrenCount: Math.max(0, Number(v.replace(/\D/g, '')) || 0) })}
            />
          </div>
        )}
      </div>

      {preOrderRisk && (
        <div style={{ marginBottom: 14 }}>
          <Notice tone="warn">{t('build.preOrderWarn')}</Notice>
        </div>
      )}

      {sixHourInPackage && (
        <div style={{ marginBottom: 14 }}>
          <Notice tone="info">{t('checkout.pkgDurationNote')}</Notice>
        </div>
      )}

      {/* Live availability: the server's quote flags any booked asset that is
          already taken for the chosen date/time. */}
      {quote && quote.unavailable && quote.unavailable.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <Notice tone="error">{t('checkout.unavailable')}</Notice>
        </div>
      )}

      {/* Weather forecast for the chosen day + location (free, keyless). */}
      <WeatherCard pin={draft.mapPin} date={draft.eventDate} t={t} />

      {/* ---------------- cross-sell: popular add-ons ---------------- */}
      {(() => {
        // A ready-made package already includes the party — so its add-ons are a
        // curated, package-appropriate set (owner request), not just any service.
        const PACKAGE_ADDON_IDS = ['invite-image', 'invite-video', 'slush', 'tables-chairs'];
        // Socks are required whenever an inflatable is booked — surface them
        // first in the add-ons so the customer is prompted to add a pair.
        const hasInflatable = catalogue.services.some(
          (s) => s.categoryId === 'inflatables' && s.id !== 'socks' && (draft.services[s.id] ?? 0) > 0,
        );
        const picks = draft.packageId
          ? PACKAGE_ADDON_IDS
              .map((id) => catalogue.services.find((s) => s.id === id))
              .filter((s): s is NonNullable<typeof s> => Boolean(s) && !draft.services[s!.id])
          : catalogue.services
              .filter((s) => s.celebrationTypes.includes(draft.celebrationType) && !draft.services[s.id])
              .sort((a, b) => {
                const rank = (s: typeof a) =>
                  hasInflatable && s.id === 'socks' ? 2 : Number(Boolean(s.isFoodStation || s.badge));
                return rank(b) - rank(a);
              })
              .slice(0, 4);
        if (picks.length === 0) return null;
        return (
          <div style={cardStyle}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('checkout.alsoLike')}</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, margin: '3px 0 12px' }}>{t('checkout.alsoLikeSub')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {picks.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: s.gradient, flex: 'none' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.pinkDeep }}>{t('common.aed')} {money(s.priceFils)}</div>
                  </div>
                  <button
                    onClick={() => {
                      const min = s.pricing.kind === 'per_child' ? draft.childrenCount : (s.pricing.minQuantity ?? 1);
                      update({ services: { ...draft.services, [s.id]: min } });
                    }}
                    style={{ border: 'none', background: C.pinkSoft, color: C.pinkDeep, fontWeight: 700, fontSize: 12, padding: '8px 14px', borderRadius: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    ＋ {t('checkout.add')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ---------------- summary ---------------- */}
      <div style={cardStyle}>
        {quote?.lines.map((line, i) => (
          <div
            key={i}
            style={{
              display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '5px 0',
              color: line.kind === 'discount' ? C.green : C.ink,
              fontWeight: line.kind === 'discount' ? 700 : 600,
            }}
          >
            <span>{line.label}</span>
            <span style={{ whiteSpace: 'nowrap' }}>
              {line.amountFils < 0 ? '−' : ''}AED {money(Math.abs(line.amountFils))}
            </span>
          </div>
        ))}
        <div style={{ borderTop: '1px solid #f6e7ef', margin: '9px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700 }}>
          <span>{t('checkout.total')}</span>
          <span>{t('common.aed')} {quote ? money(quote.totalFils) : '—'}</span>
        </div>
        {quoteError && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: C.pinkSoft, borderRadius: 12, padding: '9px 12px' }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: C.red, lineHeight: 1.4 }}>{t('checkout.priceLoadFailed')}</span>
            <button
              type="button"
              onClick={retryQuote}
              style={{ flex: 'none', border: 'none', background: C.pink, color: '#fff', borderRadius: 10, padding: '7px 14px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
            >
              {t('checkout.retry')}
            </button>
          </div>
        )}
        {quote?.discountUnlocked && (
          <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: C.green }}>
            {t('checkout.saved', { aed: `${t('common.aed')} ${money(quote.discountFils)}` })}
          </div>
        )}
      </div>

      {/* ---------------- your details / account (guest checkout allowed) ---------------- */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>
          {account || authMode === 'login' ? t('checkout.yourAccount') : t('checkout.yourDetails')}
        </div>
        {account ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>
              {t('checkout.signedInAs', { name: account.name })}
              <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 2 }}>
                {account.email} · {account.phone}
              </div>
            </div>
            <button
              onClick={() => {
                clearAccount();
                setAccount(null);
              }}
              style={{ background: 'none', border: 'none', color: C.muted, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
            >
              {t('checkout.signOut')}
            </button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 10 }}>
              {authMode === 'login' ? t('checkout.signinSub') : t('checkout.guestSub')}
            </div>

            {authMode === 'login' ? (
              <>
                <Field placeholder={t('checkout.phEmail')} value={reg.email} onChange={(v) => setReg((r) => ({ ...r, email: v }))} style={{ marginBottom: 9 }} />
                <input
                  type="password"
                  placeholder={t('checkout.phPassword')}
                  value={reg.password}
                  onChange={(e) => setReg((r) => ({ ...r, password: e.target.value }))}
                  style={{ border: `1px solid ${C.pinkLine}`, borderRadius: 14, padding: '12px 14px', fontWeight: 600, fontSize: 12.5, background: '#fff', color: C.ink, outline: 'none', width: '100%', marginBottom: 9 }}
                />
                {authError && (<div style={{ marginBottom: 9 }}><Notice tone="error">{authError}</Notice></div>)}
                <PrimaryButton disabled={!loginReady || authBusy} onClick={submitAuth}>
                  {authBusy ? t('checkout.pleaseWait') : t('checkout.signin')}
                </PrimaryButton>
                {!forgotMsg && (
                  <div style={{ textAlign: 'center', marginTop: 8 }}>
                    <a onClick={forgotPassword} style={{ cursor: 'pointer', color: C.muted, fontSize: 11.5, fontWeight: 700 }}>{t('checkout.forgot')}</a>
                  </div>
                )}
                {forgotMsg && (<div style={{ marginTop: 10 }}><Notice tone="ok">{forgotMsg}</Notice></div>)}
              </>
            ) : (
              <>
                <Field placeholder={`${t('checkout.phFullName')} *`} value={reg.name} onChange={(v) => setReg((r) => ({ ...r, name: v }))} style={{ marginBottom: 9 }} />
                <Field placeholder={`${t('checkout.phEmail')} *`} value={reg.email} onChange={(v) => setReg((r) => ({ ...r, email: v }))} style={{ marginBottom: 9 }} />
                <Field placeholder={`${t('checkout.phMobile')} *`} value={reg.phone} onChange={(v) => setReg((r) => ({ ...r, phone: v }))} style={{ marginBottom: 9 }} />
                <Field placeholder={`${t('checkout.phBackup')} *`} value={reg.backupPhone} onChange={(v) => setReg((r) => ({ ...r, backupPhone: v }))} style={{ marginBottom: 9 }} />

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer', margin: '4px 0 0' }}>
                  <input type="checkbox" checked={wantAccount} onChange={(e) => setWantAccount(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: C.pink, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.ink, lineHeight: 1.5 }}>{t('checkout.createAccountOpt')}</span>
                </label>
                {wantAccount && (
                  <div style={{ marginTop: 9 }}>
                    <input
                      type="password"
                      placeholder={t('checkout.phPassword')}
                      value={reg.password}
                      onChange={(e) => setReg((r) => ({ ...r, password: e.target.value }))}
                      style={{ border: `1px solid ${C.pinkLine}`, borderRadius: 14, padding: '12px 14px', fontWeight: 600, fontSize: 12.5, background: '#fff', color: C.ink, outline: 'none', width: '100%', marginBottom: 9 }}
                    />
                    <Field placeholder={t('checkout.phReferral')} value={reg.referralCode} onChange={(v) => setReg((r) => ({ ...r, referralCode: v.toUpperCase() }))} />
                  </div>
                )}
                {authError && (<div style={{ marginTop: 9 }}><Notice tone="error">{authError}</Notice></div>)}
              </>
            )}

            <div style={{ textAlign: 'center', marginTop: 10, fontSize: 12, fontWeight: 700 }}>
              <span style={{ color: C.muted }}>{authMode === 'login' ? t('checkout.newHere') : t('checkout.haveAccount')}</span>{' '}
              <a
                onClick={() => { setAuthMode((m) => (m === 'register' ? 'login' : 'register')); setAuthError(null); setForgotMsg(null); }}
                style={{ cursor: 'pointer', color: C.pinkDeep }}
              >
                {authMode === 'login' ? t('checkout.createOne') : t('checkout.signin')}
              </a>
            </div>
          </>
        )}
      </div>

      {/* ---------------- savings & rewards ---------------- */}
      {account && (
        <div style={cardStyle}>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>{t('checkout.rewardsTitle')}</div>

          {/* promo code */}
          {promo ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: C.green }}>
                {t('checkout.promoApplied', { code: promo.code, aed: `${t('common.aed')} ${money(promoFils)}` })}
              </span>
              <button
                onClick={() => { setPromo(null); setPromoInput(''); }}
                style={{ background: 'none', border: 'none', color: C.muted, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
              >✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
              <input
                placeholder={t('checkout.promoPh')}
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                style={{
                  flex: 1, minWidth: 0, border: `1px solid ${C.pinkLine}`, borderRadius: 12, padding: '10px 12px',
                  fontWeight: 700, fontSize: 12.5, background: '#fff', color: C.ink, outline: 'none', letterSpacing: '.5px',
                }}
              />
              <button
                onClick={applyPromo}
                disabled={promoBusy || !promoInput.trim()}
                style={{
                  border: 'none', background: C.pinkSoft, color: C.pinkDeep, fontWeight: 700, fontSize: 12.5,
                  padding: '0 16px', borderRadius: 12, cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >{promoBusy ? '…' : t('checkout.apply')}</button>
            </div>
          )}
          {promoError && <div style={{ fontSize: 11, fontWeight: 600, color: C.red, marginBottom: 6 }}>{promoError}</div>}

          {/* store credit */}
          {rewards && rewards.creditFils > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', padding: '8px 0' }}>
              <input type="checkbox" checked={useCredit} onChange={(e) => setUseCredit(e.target.checked)} />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                {t('checkout.useCredit', { aed: `${t('common.aed')} ${money(rewards.creditFils)}` })}
              </span>
            </label>
          )}

          {/* points redemption */}
          {rewards && rewards.redeemableFils > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', padding: '8px 0' }}>
              <input type="checkbox" checked={redeemPoints} onChange={(e) => setRedeemPoints(e.target.checked)} />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                {t('checkout.redeem', { points: rewards.points.toLocaleString('en-US'), aed: `${t('common.aed')} ${money(rewards.redeemableFils)}` })}
              </span>
            </label>
          )}

          {savingsFils > 0 && (
            <div style={{ borderTop: `1px solid ${C.pinkLine}`, marginTop: 8, paddingTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 13.5, fontWeight: 700 }}>
              <span>{t('checkout.estTotal')}</span>
              <span style={{ color: C.green }}>{t('common.aed')} {money(estTotalFils)}</span>
            </div>
          )}
        </div>
      )}

      {/* ---------------- payment (radio list) ---------------- */}
      <div style={{ fontWeight: 700, fontSize: 14, margin: '18px 0 10px' }}>{t('checkout.payWith')}</div>
      <div style={{ background: '#fff', borderRadius: 16, border: `1px solid ${C.pinkLine}`, overflow: 'hidden' }}>
        {[
          { key: 'card', label: t('checkout.pmCard'), logos: <CardLogos />, disabled: false },
          { key: 'applepay', label: 'Apple Pay', logos: <ApplePayMark />, disabled: false },
          { key: 'bnpl', label: t('checkout.bnpl'), logos: <TabbyTamara />, disabled: true },
        ].map((row, i) => {
          const selected = !row.disabled && payChoice === row.key;
          return (
            <div
              key={row.key}
              onClick={row.disabled ? undefined : () => { setPayChoice(row.key as 'card' | 'applepay'); update({ provider: walletName }); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px',
                cursor: row.disabled ? 'default' : 'pointer', opacity: row.disabled ? 0.55 : 1,
                borderTop: i === 0 ? 'none' : `1px solid ${C.pinkLine}`,
              }}
            >
              <span
                style={{
                  width: 20, height: 20, borderRadius: '50%', flex: 'none',
                  border: `2px solid ${selected ? C.pink : '#d5c6ce'}`,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {selected && <span style={{ width: 10, height: 10, borderRadius: '50%', background: C.pink }} />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 13.5 }}>{row.label}</span>
                  {row.disabled && (
                    <span style={{ fontSize: 9, fontWeight: 800, color: C.pinkDeep, background: C.pinkSoft, borderRadius: 6, padding: '2px 6px' }}>
                      {t('checkout.comingSoon')}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 5, marginTop: 7, flexWrap: 'wrap', alignItems: 'center' }}>{row.logos}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, marginTop: 8, textAlign: 'center' }}>{t('checkout.pmSecure')}</div>
      <div style={{ marginTop: 10 }}>
        <Notice tone="info">{t('checkout.cashNote')}</Notice>
      </div>

      {error && (
        <div style={{ marginTop: 12 }}>
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {!draft.mapPin && (
        <div style={{ marginTop: 10, fontSize: 11, fontWeight: 700, color: C.red, textAlign: 'center' }}>
          {t('checkout.mapPinRequired')}
        </div>
      )}
      {!account && authMode === 'register' && !guestReady && (
        <div style={{ marginTop: 10, fontSize: 11, fontWeight: 700, color: C.red, textAlign: 'center' }}>
          {t('checkout.detailsRequired')}
        </div>
      )}
      {!account && authMode === 'login' && (
        <div style={{ marginTop: 10, fontSize: 11, fontWeight: 700, color: C.red, textAlign: 'center' }}>
          {t('checkout.signinToConfirm')}
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 10.5, fontWeight: 600, color: C.faint, textAlign: 'center' }}>
        {catalogue.notices.holdWindow}
      </div>

      {/* Terms & Conditions — must be accepted to pay. */}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer', marginTop: 16 }}>
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          style={{ marginTop: 2, width: 17, height: 17, accentColor: C.pink, flexShrink: 0 }}
        />
        <span style={{ fontSize: 12, fontWeight: 600, color: C.ink, lineHeight: 1.5 }}>
          {t('checkout.agreePre')}{' '}
          <span
            role="button"
            onClick={(e) => { e.preventDefault(); setShowTerms(true); }}
            style={{ color: C.pinkDeep, fontWeight: 800, textDecoration: 'underline' }}
          >
            {t('checkout.agreeLink')}
          </span>
        </span>
      </label>

      <div style={{ marginTop: 14 }}>
        <PrimaryButton disabled={!canPay} onClick={pay}>
          {paying ? t('checkout.opening') : t('checkout.pay', { aed: `${t('common.aed')} ${quote ? money(estTotalFils) : '—'}` })}
        </PrimaryButton>
      </div>

      {showTerms && <TermsSheet lang={lang} onClose={() => setShowTerms(false)} />}
    </div>
  );
}

/** Live weather forecast for the picked day + location. Free & keyless. */
function WeatherCard({ pin, date, t }: { pin: { lat: number; lng: number } | null; date: string; t: import('../i18n').TFn }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.weather>> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pin || !date) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    api
      .weather(pin.lat, pin.lng, date)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pin?.lat, pin?.lng, date]);

  if (!pin || !date) return null;

  return (
    <div style={{ ...cardStyle, background: 'linear-gradient(135deg,#EAF6FF,#F3ECFB)' }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>{t('checkout.weatherTitle')}</div>
      {loading ? (
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>{t('checkout.weatherChecking')}</div>
      ) : !data?.available ? (
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.5 }}>
          {data?.reason === 'too_far'
            ? t('checkout.weatherTooFar')
            : data?.reason === 'past'
              ? t('checkout.weatherPast')
              : t('checkout.weatherUnavailable')}
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 38, lineHeight: 1 }}>{data.emoji}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 20 }}>
                {data.tempMax}° <span style={{ color: C.muted, fontWeight: 700, fontSize: 14 }}>/ {data.tempMin}°</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>{data.label}</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 11, fontWeight: 700, color: C.muted }}>
              <div>🌧️ {data.precipMm} mm</div>
              <div>💨 {data.windMax} km/h</div>
            </div>
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: '#5b6b8a', marginTop: 8, lineHeight: 1.5 }}>
            {data.outdoorNote}
          </div>
        </div>
      )}
    </div>
  );
}

const backStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: C.muted, fontWeight: 700,
  fontSize: 13, cursor: 'pointer', padding: 0,
};

const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 20, padding: '16px 18px',
  boxShadow: C.shadow, marginBottom: 14,
};
