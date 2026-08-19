import { useEffect, useState } from 'react';
import { api } from '../api';
import { toCart, type ScreenProps } from '../App';
import { C, Chip, Field, fredoka, money, Notice, PrimaryButton, timeLabel } from '../ui';
import { loadAccount, saveAccount, clearAccount, type Account } from '../account';
import { loadProfile } from '../profile';
import { MapPicker } from '../MapPicker';

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
}: ScreenProps & { onOrder: (orderId: string) => void }) {
  const [times, setTimes] = useState<Array<{ value: string; allowed: boolean }>>([]);
  const [paying, setPaying] = useState(false);
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
  const [reg, setReg] = useState({ name: loadProfile()?.name ?? '', email: '', phone: '', password: '', referralCode: '' });
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
  const authReady =
    authMode === 'register'
      ? reg.name.trim().length >= 2 && emailOk && reg.phone.trim().length >= 6 && reg.password.length >= 6
      : emailOk && reg.password.length >= 1;

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
      const result = await api.checkout(toCart(draft), draft.provider, {
        promoCode: promo?.code ?? null,
        useCredit,
        redeemPoints,
      });
      if (!result.eligible || !result.checkoutUrl) {
        setError(t('checkout.providerUnavailable', { provider: draft.provider }));
        setPaying(false);
        return;
      }
      // Hand off to the provider's hosted checkout. Nothing is confirmed
      // here — the app comes back and waits for the server's own view.
      onOrder(result.orderId);
      window.location.href = result.checkoutUrl;
    } catch (e: any) {
      // A thrown fetch (no server body) is a connection problem — show a clear,
      // localised message instead of the browser's raw "Load failed".
      setError(e?.body?.message ?? (e?.body ? e.message : t('checkout.network')));
      setPaying(false);
    }
  };

  const canPay =
    Boolean(quote?.bookable) && Boolean(draft.mapPin) && !blocked && !paying && Boolean(account);

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

      {/* ---------------- time ---------------- */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>{t('checkout.eventTime')}</div>
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
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
          <input
            type="date"
            value={draft.eventDate}
            onChange={(e) => update({ eventDate: e.target.value })}
            style={{ border: 'none', background: 'none', fontWeight: 600, color: C.muted, fontSize: 12.5, outline: 'none' }}
          />
          <span style={{ fontWeight: 700 }}>
            {draft.startTime && quote?.endTime
              ? `${timeLabel(draft.startTime)} – ${quote.endTime}`
              : '—'}
          </span>
        </div>
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
        const picks = catalogue.services
          .filter((s) => s.celebrationTypes.includes(draft.celebrationType) && !draft.services[s.id])
          .sort((a, b) => Number(Boolean(b.isFoodStation || b.badge)) - Number(Boolean(a.isFoodStation || a.badge)))
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

      {/* ---------------- account (required to confirm) ---------------- */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>{t('checkout.yourAccount')}</div>
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
              {t('checkout.createOrSignin')}
            </div>
            {authMode === 'register' && (
              <Field placeholder={t('checkout.phFullName')} value={reg.name} onChange={(v) => setReg((r) => ({ ...r, name: v }))} style={{ marginBottom: 9 }} />
            )}
            <Field placeholder={t('checkout.phEmail')} value={reg.email} onChange={(v) => setReg((r) => ({ ...r, email: v }))} style={{ marginBottom: 9 }} />
            {authMode === 'register' && (
              <Field placeholder={t('checkout.phMobile')} value={reg.phone} onChange={(v) => setReg((r) => ({ ...r, phone: v }))} style={{ marginBottom: 9 }} />
            )}
            {authMode === 'register' && (
              <Field placeholder={t('checkout.phReferral')} value={reg.referralCode} onChange={(v) => setReg((r) => ({ ...r, referralCode: v.toUpperCase() }))} style={{ marginBottom: 9 }} />
            )}
            <input
              type="password"
              placeholder={t('checkout.phPassword')}
              value={reg.password}
              onChange={(e) => setReg((r) => ({ ...r, password: e.target.value }))}
              style={{
                border: `1px solid ${C.pinkLine}`, borderRadius: 14, padding: '12px 14px',
                fontWeight: 600, fontSize: 12.5, background: '#fff', color: C.ink, outline: 'none',
                width: '100%', marginBottom: 9,
              }}
            />
            {authError && (
              <div style={{ marginBottom: 9 }}>
                <Notice tone="error">{authError}</Notice>
              </div>
            )}
            <PrimaryButton disabled={!authReady || authBusy} onClick={submitAuth}>
              {authBusy ? t('checkout.pleaseWait') : authMode === 'register' ? t('checkout.createAccount') : t('checkout.signin')}
            </PrimaryButton>
            <div style={{ textAlign: 'center', marginTop: 10, fontSize: 12, fontWeight: 700 }}>
              <span style={{ color: C.muted }}>
                {authMode === 'register' ? t('checkout.haveAccount') : t('checkout.newHere')}
              </span>{' '}
              <a
                onClick={() => {
                  setAuthMode((m) => (m === 'register' ? 'login' : 'register'));
                  setAuthError(null);
                  setForgotMsg(null);
                }}
                style={{ cursor: 'pointer', color: C.pinkDeep }}
              >
                {authMode === 'register' ? t('checkout.signin') : t('checkout.createOne')}
              </a>
            </div>
            {authMode === 'login' && !forgotMsg && (
              <div style={{ textAlign: 'center', marginTop: 8 }}>
                <a onClick={forgotPassword} style={{ cursor: 'pointer', color: C.muted, fontSize: 11.5, fontWeight: 700 }}>
                  {t('checkout.forgot')}
                </a>
              </div>
            )}
            {forgotMsg && (
              <div style={{ marginTop: 10 }}>
                <Notice tone="ok">{forgotMsg}</Notice>
              </div>
            )}
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

      {/* ---------------- payment ---------------- */}
      <div style={{ fontWeight: 700, fontSize: 14, margin: '18px 0 10px' }}>{t('checkout.payWith')}</div>
      <div style={{ display: 'flex', gap: 9 }}>
        {catalogue.paymentMethods.map((pm) => {
          const active = draft.provider === pm.name;
          return (
            <div
              key={pm.name}
              onClick={() => update({ provider: pm.name })}
              style={{
                flex: 1, textAlign: 'center', background: '#fff',
                border: `2px solid ${active ? C.pink : C.pinkLine}`,
                borderRadius: 16, padding: '13px 4px', cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{pm.label}</div>
              <div style={{ fontSize: 9.5, fontWeight: 600, color: C.muted, marginTop: 2 }}>{pm.tagline}</div>
              {pm.mode === 'simulated' && (
                <div style={{ fontSize: 8.5, fontWeight: 700, color: C.yellowInk, marginTop: 3, letterSpacing: '.3px' }}>
                  SANDBOX
                </div>
              )}
            </div>
          );
        })}
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
      {!account && (
        <div style={{ marginTop: 10, fontSize: 11, fontWeight: 700, color: C.red, textAlign: 'center' }}>
          {t('checkout.createToConfirm')}
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 10.5, fontWeight: 600, color: C.faint, textAlign: 'center' }}>
        {catalogue.notices.holdWindow}
      </div>

      <div style={{ marginTop: 14 }}>
        <PrimaryButton disabled={!canPay} onClick={pay}>
          {paying ? t('checkout.opening') : t('checkout.pay', { aed: `${t('common.aed')} ${quote ? money(estTotalFils) : '—'}` })}
        </PrimaryButton>
      </div>
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
