import { useEffect, useState } from 'react';
import { api } from '../api';
import { toCart, type ScreenProps } from '../App';
import { C, Chip, Field, fredoka, money, Notice, PrimaryButton, timeLabel } from '../ui';
import { loadAccount, saveAccount, clearAccount, type Account } from '../account';
import { loadProfile } from '../profile';

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
  go,
  onOrder,
}: ScreenProps & { onOrder: (orderId: string) => void }) {
  const [times, setTimes] = useState<Array<{ value: string; allowed: boolean }>>([]);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});

  const [account, setAccount] = useState<Account | null>(() => loadAccount());
  const [authMode, setAuthMode] = useState<'register' | 'login'>('register');
  const [reg, setReg] = useState({ name: loadProfile()?.name ?? '', email: '', phone: '', password: '' });
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // The booking captures who the party is FOR, separately from the account
  // holder, with wording that fits the celebration.
  const eventForLabel =
    (
      {
        kids: "Child's name",
        graduation: "Graduate's name",
        bride: "Bride's name",
        baby: "Baby's name",
        gender: 'Parents / baby name',
        adult: 'Guest of honour name',
        customc: 'Guest of honour / celebration name',
      } as Record<string, string>
    )[draft.celebrationType] ?? 'Guest of honour name';

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
      const result = await api.checkout(toCart(draft), draft.provider);
      if (!result.eligible || !result.checkoutUrl) {
        setError(
          `${draft.provider} isn’t available for this booking. Please choose another payment method.`,
        );
        setPaying(false);
        return;
      }
      // Hand off to the provider's hosted checkout. Nothing is confirmed
      // here — the app comes back and waits for the server's own view.
      onOrder(result.orderId);
      window.location.href = result.checkoutUrl;
    } catch (e: any) {
      setError(e?.body?.message ?? e.message);
      setPaying(false);
    }
  };

  const canPay =
    Boolean(quote?.bookable) && Boolean(draft.mapPin) && !blocked && !paying && Boolean(account);

  return (
    <div style={{ padding: '8px 22px 30px', animation: 'rise .35s ease' }}>
      <button onClick={() => go('theme')} style={backStyle}>‹ Back</button>
      <div style={{ ...fredoka(24), margin: '8px 0 16px' }}>Your Celebration</div>

      {/* --------- who the celebration is for (not the account holder) --------- */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>Who is the celebration for?</div>
        <Field
          placeholder={eventForLabel}
          value={draft.eventFor}
          onChange={(v) => update({ eventFor: v })}
        />
      </div>

      {/* ---------------- location ---------------- */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Event location</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 9 }}>
          Delivery is calculated automatically from your emirate.
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
              Delivery to {zone.zoneName}: AED {money(zone.feeFils)}
            </div>
          )
        )}

        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <Field
            placeholder="Area (e.g. Jumeirah 1)"
            value={draft.address.area}
            onChange={(v) => update({ address: { ...draft.address, area: v } })}
          />
          <div style={{ display: 'flex', gap: 9 }}>
            <Field
              placeholder="Street"
              value={draft.address.street}
              onChange={(v) => update({ address: { ...draft.address, street: v } })}
            />
            <Field
              placeholder="Villa / Building"
              value={draft.address.villa}
              onChange={(v) => update({ address: { ...draft.address, villa: v } })}
            />
          </div>
          <Field
            placeholder="Additional location details (optional)"
            value={draft.address.details}
            onChange={(v) => update({ address: { ...draft.address, details: v } })}
          />
        </div>

        {draft.mapPin ? (
          <div style={{ marginTop: 10 }}>
            <Notice tone="ok">
              ✓ Map pin set · {draft.mapPin.lat.toFixed(4)}, {draft.mapPin.lng.toFixed(4)}
              <div style={{ fontWeight: 600, color: '#6fae95', marginTop: 2 }}>
                Used for delivery, team routes &amp; live ETA
              </div>
            </Notice>
          </div>
        ) : (
          <div
            onClick={() => update({ mapPin: { lat: 25.2048, lng: 55.2708 } })}
            style={{
              marginTop: 10, border: `1.5px dashed ${C.pinkDash}`, borderRadius: 14,
              padding: 16, textAlign: 'center', cursor: 'pointer', background: C.cream,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 12.5, color: C.pinkDeep }}>
              📍 Drop Map Pin — required
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 3 }}>
              Select your exact event location on the map
            </div>
          </div>
        )}
      </div>

      {/* ---------------- placement photos ---------------- */}
      {photoRows.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>
            Setup placement photos{' '}
            <span style={{ fontWeight: 600, fontSize: 11, color: C.muted }}>— optional, skip anytime</span>
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, margin: '4px 0 10px' }}>
            Show us where you’d like each item placed — sent to your Eventana team.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {photoRows.map((row) => (
              <div key={row.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{row.label}</span>
                <button
                  onClick={() =>
                    setPhotos((p) => {
                      const next = { ...p };
                      if (next[row.key]) delete next[row.key];
                      else next[row.key] = 'noted';
                      return next;
                    })
                  }
                  style={{
                    border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 11,
                    padding: '8px 12px', borderRadius: 12, whiteSpace: 'nowrap',
                    background: photos[row.key] ? C.greenSoft : C.pinkSoft,
                    color: photos[row.key] ? C.green : C.pinkDeep,
                  }}
                >
                  {photos[row.key] ? '✓ Noted' : '＋ Add photo'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------------- time ---------------- */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Event time</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 9 }}>
          Pick a start time — your 4-hour party ends automatically.
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
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 6 }}>
            Number of children attending
          </div>
          <Field
            placeholder="25"
            value={String(draft.childrenCount)}
            onChange={(v) => update({ childrenCount: Math.max(0, Number(v.replace(/\D/g, '')) || 0) })}
          />
        </div>
      </div>

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
          <span>Total</span>
          <span>AED {quote ? money(quote.totalFils) : '—'}</span>
        </div>
        {quote?.discountUnlocked && (
          <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: C.green }}>
            You saved AED {money(quote.discountFils)} 🎉
          </div>
        )}
      </div>

      {/* ---------------- account (required to confirm) ---------------- */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>Your account</div>
        {account ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>
              ✓ Signed in as {account.name}
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
              Sign out
            </button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 10 }}>
              Create your account (or sign in) to confirm your booking. Your event details are kept.
            </div>
            {authMode === 'register' && (
              <Field placeholder="Full name" value={reg.name} onChange={(v) => setReg((r) => ({ ...r, name: v }))} style={{ marginBottom: 9 }} />
            )}
            <Field placeholder="Email" value={reg.email} onChange={(v) => setReg((r) => ({ ...r, email: v }))} style={{ marginBottom: 9 }} />
            {authMode === 'register' && (
              <Field placeholder="Mobile number" value={reg.phone} onChange={(v) => setReg((r) => ({ ...r, phone: v }))} style={{ marginBottom: 9 }} />
            )}
            <input
              type="password"
              placeholder="Password"
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
              {authBusy ? 'Please wait…' : authMode === 'register' ? 'Create account' : 'Sign in'}
            </PrimaryButton>
            <div style={{ textAlign: 'center', marginTop: 10, fontSize: 12, fontWeight: 700 }}>
              <span style={{ color: C.muted }}>
                {authMode === 'register' ? 'Already have an account?' : 'New to Eventana?'}
              </span>{' '}
              <a
                onClick={() => {
                  setAuthMode((m) => (m === 'register' ? 'login' : 'register'));
                  setAuthError(null);
                }}
                style={{ cursor: 'pointer', color: C.pinkDeep }}
              >
                {authMode === 'register' ? 'Sign in' : 'Create one'}
              </a>
            </div>
          </>
        )}
      </div>

      {/* ---------------- payment ---------------- */}
      <div style={{ fontWeight: 700, fontSize: 14, margin: '18px 0 10px' }}>Pay with</div>
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
          Map pin required to complete your booking
        </div>
      )}
      {!account && (
        <div style={{ marginTop: 10, fontSize: 11, fontWeight: 700, color: C.red, textAlign: 'center' }}>
          Create your account above to confirm your booking
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 10.5, fontWeight: 600, color: C.faint, textAlign: 'center' }}>
        {catalogue.notices.holdWindow}
      </div>

      <div style={{ marginTop: 14 }}>
        <PrimaryButton disabled={!canPay} onClick={pay}>
          {paying ? 'Opening secure checkout…' : `Pay AED ${quote ? money(quote.totalFils) : '—'}`}
        </PrimaryButton>
      </div>
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
