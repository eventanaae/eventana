import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Screen } from '../App';
import { C, fredoka, money, Notice, PrimaryButton, Spinner, timeLabel } from '../ui';
import type { Lang, TFn } from '../i18n';
import { TermsSheet } from './Terms';
import { loadAccount } from '../account';
import { AuthSheet } from './AuthSheet';

const PHASES = [
  'Booking Confirmed',
  'Preparing',
  'On The Way',
  'Arrived',
  'Setting Up',
  'Setup Ready',
  'Party Started',
  'Event Completed',
];

/** A cancelled event shows two steps, not the eight-step timeline. */
const CANCELLED_STEPS = [
  { label: 'Booking Confirmed', mark: '✓', done: true },
  { label: 'Cancelled', mark: '✕', done: false },
];

export function MyEvent({
  eventId,
  onPickEvent,
  go,
  t,
  lang,
}: {
  eventId: string | null;
  onPickEvent: (id: string) => void;
  go: (s: Screen) => void;
  t: TFn;
  lang: Lang;
}) {
  const [list, setList] = useState<any[] | null>(null);
  const [event, setEvent] = useState<any>(null);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState({ hours: 0, socks: 0, servings: {} as Record<string, number> });
  const [addonQuote, setAddonQuote] = useState<any>(null);
  const [chat, setChat] = useState('');
  const [designNote, setDesignNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [addonError, setAddonError] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  const load = useCallback(async () => {
    // Always keep the full list so a customer with several bookings can switch
    // between them — not just see the most recent one.
    const events = await api.events();
    setList(events);
    if (eventId) {
      setEvent(await api.event(eventId));
    } else if (events.length > 0) {
      onPickEvent(events[0].id);
    }
  }, [eventId, onPickEvent]);

  useEffect(() => {
    setLoadError(false);
    load().catch(() => { setLoadError(true); setList((l) => l ?? []); });
  }, [load]);

  // Live price for whatever extras are currently selected.
  useEffect(() => {
    if (!eventId) return;
    const hasAny =
      pending.hours > 0 || pending.socks > 0 || Object.values(pending.servings).some((n) => n > 0);
    if (!hasAny) {
      setAddonQuote(null);
      return;
    }
    api
      .addonQuote(eventId, {
        additionalHours: pending.hours,
        socksPairs: pending.socks,
        extraServings: pending.servings,
      })
      .then(setAddonQuote)
      .catch(() => setAddonQuote(null));
  }, [eventId, pending]);

  if (!eventId && list?.length === 0) {
    return (
      <div style={{ padding: '60px 30px', textAlign: 'center' }}>
        <div style={{ ...fredoka(22), marginBottom: 10 }}>{t('me.noEvents')}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, lineHeight: 1.6, marginBottom: 24 }}>
          {t('me.noEventsBody')}
        </div>
        <PrimaryButton onClick={() => go('explore')}>{t('me.explorePackages')}</PrimaryButton>
        {!loadAccount() && (
          <button
            onClick={() => setShowAuth(true)}
            style={{ display: 'block', margin: '18px auto 0', background: 'none', border: 'none', color: C.pinkDeep, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >
            {t('auth.haveAccount')}
          </button>
        )}
        {showAuth && (
          <AuthSheet t={t} lang={lang} onClose={() => setShowAuth(false)} onSignedIn={() => window.location.reload()} />
        )}
      </div>
    );
  }

  if (!event) {
    if (loadError) {
      return (
        <div style={{ padding: '60px 30px', textAlign: 'center' }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🎈</div>
          <div style={{ ...fredoka(20) }}>{t('me.loadFailed')}</div>
          <div style={{ marginTop: 16 }}>
            <PrimaryButton onClick={() => { setLoadError(false); setEvent(null); load().catch(() => setLoadError(true)); }}>
              {t('common.tryAgain')}
            </PrimaryButton>
          </div>
        </div>
      );
    }
    return <Spinner label={t('me.loading')} />;
  }

  const cancelled = Boolean(event.cancelled);
  const phaseIndex = PHASES.indexOf(event.phase);
  const design = event.designs?.[0];
  const phaseLabel = (p: string) => t(`me.phase.${p}`);
  const dateFmt = (d: string) =>
    new Date(d).toLocaleDateString(lang === 'ar' ? 'ar-AE' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const payExtras = async () => {
    setBusy(true);
    setAddonError(null);
    try {
      const result = await api.addonCheckout(eventId!, {
        // Use a live payment method (Tabby stays disabled until its live
        // credentials are in).
        provider: 'ziina',
        additionalHours: pending.hours,
        socksPairs: pending.socks,
        extraServings: pending.servings,
      });
      if (result.checkoutUrl) window.location.href = result.checkoutUrl;
      else setAddonError(t('me.errCheckout'));
    } catch (e: any) {
      setAddonError(e?.body?.message ?? e?.message ?? t('me.errAddon'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: '8px 22px 30px', animation: 'rise .35s ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <span style={fredoka(24)}>{list && list.length > 1 ? t('me.titlePlural') : t('me.title')}</span>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: C.muted }}>{event.id}</span>
      </div>

      {/* Switcher — only when there is more than one booking to move between. */}
      {list && list.length > 1 && (
        <div className="scroll" style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -22px 14px', padding: '0 22px 4px' }}>
          {list.map((e) => {
            const active = e.id === event.id;
            return (
              <button
                key={e.id}
                onClick={() => { if (!active) onPickEvent(e.id); }}
                style={{
                  flex: 'none', textAlign: 'start', cursor: 'pointer', borderRadius: 14,
                  border: `1.5px solid ${active ? C.pink : C.pinkLine}`,
                  background: active ? C.pinkSoft : '#fff', padding: '9px 13px', minWidth: 140,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 12, color: active ? C.pinkDeep : C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {e.packageName ?? t('me.celebration')}
                </div>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, marginTop: 2 }}>
                  {new Date(e.date).toLocaleDateString(lang === 'ar' ? 'ar-AE' : 'en-GB', { day: 'numeric', month: 'short' })} · {e.phase ? phaseLabel(e.phase) : ''}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div
        style={{
          background: cancelled ? '#efe9e6' : 'linear-gradient(135deg,#F9C6DC,#BDEBE4)',
          borderRadius: 22,
          padding: '18px 20px',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{event.packageName ?? t('me.celebration')}</span>
          <span
            style={{
              background: cancelled ? C.redSoft : '#fff',
              color: cancelled ? C.red : C.pinkDeep,
              fontSize: 10, fontWeight: 700, padding: '4px 10px',
              borderRadius: 12, letterSpacing: '.4px', whiteSpace: 'nowrap',
            }}
          >
            {phaseLabel(event.phase)}
          </span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#8b7d84', marginTop: 6 }}>
          {dateFmt(event.date)} · {event.startDisplay} – {event.endDisplay} · {event.emirate}
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#8b7d84', marginTop: 2 }}>
          {event.totalDisplay} {t('common.aed')} · {cancelled ? t('me.cancelled') : t('me.paidInFull')}
        </div>
      </div>

      <ReceiptCard event={event} t={t} lang={lang} />

      {!cancelled && (
        <button
          onClick={async () => {
            try {
              const url = await api.walletPass(event.id);
              window.location.href = url;
            } catch (e: any) {
              alert(e?.message ?? t('me.walletUnavailable'));
            }
          }}
          style={{
            width: '100%', marginBottom: 14, background: '#000', color: '#fff', border: 'none',
            borderRadius: 16, padding: '13px 0', fontWeight: 700, fontSize: 13.5, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
           {t('me.addWallet')}
        </button>
      )}

      {!cancelled && event.canReschedule && (
        <Reschedule eventId={event.id} t={t} onDone={async () => setEvent(await api.event(event.id))} />
      )}

      {!cancelled && event.canCancel && (
        <CancelBooking
          event={event}
          t={t}
          lang={lang}
          onDone={async () => setEvent(await api.event(event.id))}
        />
      )}

      {cancelled && (
        <div style={{ marginBottom: 14 }}>
          <Notice tone="error">
            {t('me.cancelledNotice')}
            {event.cancellationReason ? ` ${event.cancellationReason}.` : ''}
            <div style={{ fontWeight: 600, marginTop: 5, lineHeight: 1.5 }}>
              {t('me.cancelledBody')}
            </div>
          </Notice>
          {event.cancellation && (
            <div style={{ ...card, marginTop: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 13.5, color: C.ink, marginBottom: 8 }}>
                💳 {t('cancel.refundTitle')}
              </div>
              <SummaryRow label={t('cancel.refundStatus')} value={t(`cancel.status_${event.cancellation.refundStatus}` as any)} strong />
              {event.cancellation.refundAmountFils > 0 && (
                <SummaryRow label={t('cancel.expectedRefund')} value={`${event.cancellation.refundAmountDisplay} ${t('common.aed')}`} />
              )}
              <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
                {t('cancel.eta7days')}
              </div>
            </div>
          )}
        </div>
      )}

      {/* The team has arrived — a clear, celebratory banner + contact shortcut. */}
      {!cancelled && event.phase === 'Arrived' && (
        <div style={{ background: C.green, borderRadius: 20, padding: '15px 18px', color: '#fff', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 13 }}>
          <span style={{ fontSize: 24 }}>🎉</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('me.arrivedTitle')}</div>
            <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.95, marginTop: 2 }}>
              {t('me.arrivedSub')}
            </div>
          </div>
        </div>
      )}

      {/* Live tracking never shows for a cancelled event — no team is on the way. */}
      {!cancelled && event.phase !== 'Arrived' && event.eta && (
        <div style={{ background: C.mint, borderRadius: 20, padding: '15px 18px', color: '#fff', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 13 }}>
          <span style={{ fontSize: 24, animation: 'pulse 1.6s infinite' }}>🚐</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('me.onWayTitle')}</div>
            <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.95, marginTop: 2 }}>
              {t('me.eta')} <b>{event.eta}</b>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- add more ----------------
          Hidden entirely once cancelled: no additional hour, no socks,
          no extra servings. The API refuses them too. */}
      {!cancelled && (
      <div style={card}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{t('me.addMore')}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, margin: '3px 0 14px' }}>
          {t('me.addMoreSub')}
        </div>

        {event.addOns.maxExtraHours > 0 ? (
          <Stepper
            title={t('me.additionalHour', { aed: `${t('common.aed')} ${money(event.addOns.additionalHourFils)}` })}
            sub={
              pending.hours > 0 && addonQuote?.newEndTime
                ? t('me.endsAt', { time: addonQuote.newEndTime })
                : t('me.endsNow', { time: event.endDisplay })
            }
            value={pending.hours}
            max={event.addOns.maxExtraHours}
            onChange={(v) => setPending((p) => ({ ...p, hours: v }))}
          />
        ) : (
          <div style={{ marginBottom: 12 }}>
            <Notice tone="error">{t('me.hourUnavailable')}</Notice>
          </div>
        )}

        {event.addOns.socks && (
          <>
            <div style={{ marginBottom: 10 }}>
              <Notice tone="warn">{t('me.socksNotice')}</Notice>
            </div>
            <Stepper
              title={t('me.kidsSocks', { aed: `${t('common.aed')} ${money(event.addOns.socks.perPairFils)}` })}
              sub={t('me.childrenAttending', { n: event.childrenCount })}
              value={pending.socks}
              step={5}
              max={200}
              onChange={(v) => setPending((p) => ({ ...p, socks: v }))}
            />
            <button
              onClick={() => setPending((p) => ({ ...p, socks: event.addOns.socks.suggestedPairs }))}
              style={{
                border: 'none', background: C.pinkSoft, color: C.pinkDeep, fontWeight: 700,
                fontSize: 11, padding: '8px 12px', borderRadius: 12, cursor: 'pointer', marginBottom: 12,
              }}
            >
              {t('me.addSuggested', { n: event.addOns.socks.suggestedPairs, aed: `${t('common.aed')} ${event.addOns.socks.suggestedDisplay}` })}
            </button>
          </>
        )}

        {event.addOns.extraServings.map((row: any) => (
          <Stepper
            key={row.serviceId}
            title={t('me.extraServings', { name: row.name })}
            sub={t('me.servingsSub', { n: row.blockSize, aed: `${t('common.aed')} ${row.priceDisplay}` })}
            value={pending.servings[row.serviceId] ?? 0}
            max={20}
            format={(v) => `+${v * row.blockSize}`}
            onChange={(v) =>
              setPending((p) => ({ ...p, servings: { ...p.servings, [row.serviceId]: v } }))
            }
          />
        ))}

        {addonQuote?.bookable && (
          <button
            onClick={payExtras}
            disabled={busy}
            style={{
              width: '100%', background: C.pink, color: '#fff', border: 'none', fontWeight: 700,
              fontSize: 13, padding: '13px 0', borderRadius: 16, cursor: 'pointer', marginTop: 4,
            }}
          >
            {busy ? t('me.openingCheckout') : t('me.payAdd', { aed: `${t('common.aed')} ${addonQuote.totalDisplay}` })}
          </button>
        )}
        {addonQuote && !addonQuote.bookable && addonQuote.problems?.[0] && (
          <Notice tone="error">{addonQuote.problems[0].message}</Notice>
        )}
        {addonError && (
          <div style={{ marginTop: 8 }}>
            <Notice tone="error">{addonError}</Notice>
          </div>
        )}
      </div>
      )}

      {/* ---------------- timeline ---------------- */}
      <div style={card}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>{t('me.timeline')}</div>
        {cancelled
          ? CANCELLED_STEPS.map((step, i) => (
              <div key={step.label} style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div
                    style={{
                      width: 22, height: 22, borderRadius: '50%', flex: 'none',
                      background: step.done ? C.pink : C.red,
                      color: '#fff', fontSize: 11, display: 'flex',
                      alignItems: 'center', justifyContent: 'center', fontWeight: 700,
                    }}
                  >
                    {step.mark}
                  </div>
                  {i < CANCELLED_STEPS.length - 1 && (
                    <div style={{ width: 2, height: 22, background: '#f3ebe6' }} />
                  )}
                </div>
                <div
                  style={{
                    fontSize: 13, paddingTop: 2, fontWeight: 700,
                    color: step.done ? C.ink : C.red,
                  }}
                >
                  {phaseLabel(step.label)}
                </div>
              </div>
            ))
          : PHASES.map((label, i) => {
              const done = i <= phaseIndex;
              const current = i === phaseIndex;
              return (
                <div key={label} style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div
                      style={{
                        width: 22, height: 22, borderRadius: '50%', flex: 'none',
                        background: done ? C.pink : '#f3ebe6',
                        color: done ? '#fff' : C.muted,
                        fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700,
                      }}
                    >
                      {done ? '✓' : i + 1}
                    </div>
                    {i < PHASES.length - 1 && (
                      <div style={{ width: 2, height: 22, background: done ? C.pink : '#f3ebe6' }} />
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 13, paddingTop: 2,
                      fontWeight: current ? 700 : 600,
                      color: done ? C.ink : C.muted,
                    }}
                  >
                    {phaseLabel(label)}
                  </div>
                </div>
              );
            })}
      </div>

      {/* ---------------- team ---------------- */}
      {(() => {
        // Prefer the smart-staffing crew (names + "to be confirmed"); fall back
        // to the legacy team list. The customer never sees internal status.
        const crew: any[] = (event.crew && event.crew.length ? event.crew : null)
          ?? event.team.map((m: any) => ({ role: m.role, name: m.name, confirmed: true, isLeader: false }));
        if (!crew.length) return null;
        const AV = ['#ff8fab', '#8ecae6', '#ffb703', '#a3d977', '#c8a2ff', '#ff9f7a'];
        return (
          <div style={card}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 13 }}>{t('me.yourTeam')}</div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {crew.map((m: any, i: number) => (
                <div key={i} style={{ textAlign: 'center', width: 74 }}>
                  <div
                    style={{
                      width: 52, height: 52, borderRadius: '50%',
                      background: m.confirmed ? AV[i % AV.length] : '#eee',
                      color: m.confirmed ? '#fff' : C.muted,
                      fontWeight: 700, fontSize: 17, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', margin: '0 auto 7px',
                      border: m.confirmed ? 'none' : `2px dashed ${C.line}`,
                    }}
                  >
                    {m.isLeader ? '👑' : m.confirmed ? String(m.name)[0] : '★'}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 12, lineHeight: 1.2 }}>
                    {m.confirmed ? m.name : t('me.toBeConfirmed')}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, marginTop: 1 }}>{m.role}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ---------------- setup-spot photos ---------------- */}
      {!cancelled && <SetupSpotPhotos eventId={event.id} t={t} />}

      {/* ---------------- rate & tip ---------------- */}
      {!cancelled && event.review?.canReview && (
        <RateAndTip event={event} onDone={async () => setEvent(await api.event(event.id))} t={t} />
      )}

      {/* ---------------- chat ---------------- */}
      <div style={card}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{t('me.chatTitle')}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, margin: '3px 0 12px' }}>
          {t('me.chatConnected', { id: event.id })}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {event.messages.map((m: any) => (
            <div
              key={m.id}
              style={{
                alignSelf: m.sender === 'customer' ? 'flex-end' : 'flex-start',
                background: m.sender === 'customer' ? C.pink : C.pinkSoft,
                color: m.sender === 'customer' ? '#fff' : C.ink,
                fontSize: 12, fontWeight: 600, padding: '9px 13px',
                borderRadius: 16, maxWidth: '78%', lineHeight: 1.4,
              }}
            >
              {m.body}
            </div>
          ))}
          {event.messages.length === 0 && (
            <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted }}>
              {t('me.chatEmpty')}
            </div>
          )}
        </div>
        {event.chatOpen ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder={t('me.chatPlaceholder')}
              value={chat}
              onChange={(e) => setChat(e.target.value)}
              style={{
                flex: 1, minWidth: 0, border: `1px solid ${C.pinkLine}`, borderRadius: 14,
                padding: '11px 14px', fontWeight: 600, fontSize: 12, background: '#fff',
                color: C.ink, outline: 'none',
              }}
            />
            <button
              onClick={async () => {
                if (!chat.trim()) return;
                await api.sendMessage(event.id, chat.trim());
                setChat('');
                setEvent(await api.event(event.id));
              }}
              style={{ width: 40, height: 40, borderRadius: 14, border: 'none', background: C.pink, color: '#fff', fontSize: 15, cursor: 'pointer', flex: 'none' }}
            >
              ➤
            </button>
          </div>
        ) : (
          <Notice tone="info">{t('me.chatClosed')}</Notice>
        )}
      </div>

      {/* ---------------- design approval ---------------- */}
      {design && (
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
            {design.status === 'pending' ? t('me.designReady') : t('me.designYour')}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 12 }}>
            {t('me.designCustom', { v: design.version })}
          </div>
          {design.image_url ? (
            <img
              src={design.image_url}
              alt="Your design"
              style={{ width: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 16, marginBottom: 12, background: '#faf6f2' }}
            />
          ) : (
            <div style={{ height: 180, borderRadius: 16, background: 'linear-gradient(135deg,#FDE0EE,#BDEBE4)', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#a76f8d' }}>
              {t('me.designPreparing')}
            </div>
          )}

          {design.status === 'pending' && (
            <>
              <PrimaryButton
                onClick={async () => {
                  await api.designDecision(event.id, design.version, 'approve');
                  setEvent(await api.event(event.id));
                }}
                style={{ marginBottom: 12 }}
              >
                {t('me.designApprove')}
              </PrimaryButton>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>{t('me.designRequest')}</div>
              <textarea
                placeholder={t('me.designChangePh')}
                rows={3}
                value={designNote}
                onChange={(e) => setDesignNote(e.target.value)}
                style={{
                  width: '100%', border: `1px solid ${C.pinkLine}`, borderRadius: 14, padding: '12px 14px',
                  fontWeight: 600, fontSize: 12.5, background: C.cream, color: C.ink,
                  outline: 'none', resize: 'none', marginBottom: 9,
                }}
              />
              <button
                disabled={!designNote.trim()}
                onClick={async () => {
                  await api.designDecision(event.id, design.version, 'request_changes', designNote.trim());
                  setDesignNote('');
                  setEvent(await api.event(event.id));
                }}
                style={{
                  width: '100%', background: C.pinkSoft, color: C.pinkDeep, border: 'none',
                  fontWeight: 700, fontSize: 13, padding: '13px 0', borderRadius: 16,
                  cursor: designNote.trim() ? 'pointer' : 'not-allowed',
                  opacity: designNote.trim() ? 1 : 0.5,
                }}
              >
                {t('me.designSend')}
              </button>
            </>
          )}

          {design.status === 'approved' && (
            <Notice tone="ok">{t('me.designApproved', { v: design.version })}</Notice>
          )}
          {design.status === 'changes_requested' && (
            <Notice tone="warn">
              {t('me.designChangesSent')}
              <div style={{ fontWeight: 600, marginTop: 5, lineHeight: 1.45 }}>“{design.customer_note}”</div>
              <div style={{ fontWeight: 600, marginTop: 5 }}>
                {t('me.designNextVersion')}
              </div>
            </Notice>
          )}
        </div>
      )}
    </div>
  );
}

function Reschedule({ eventId, t, onDone }: { eventId: string; t: TFn; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('17:00');
  const [times, setTimes] = useState<string[]>(['11:00', '14:00', '17:00', '19:00']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.startTimes().then((r) => setTimes(r.filter((x) => x.allowed).map((x) => x.value))).catch(() => {});
  }, []);

  // 72h ≈ 3 days; add a day of buffer so the picked date always clears the rule.
  const minDate = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);

  const submit = async () => {
    if (!date) return;
    setBusy(true);
    setError(null);
    try {
      await api.reschedule(eventId, date, startTime);
      setDone(true);
      await onDone();
    } catch (e: any) {
      setError(e?.body?.message ?? e?.message ?? t('me.errReschedule'));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div style={{ marginBottom: 14 }}>
        <Notice tone="ok">{t('me.rescheduleDone')}</Notice>
      </div>
    );
  }

  return (
    <div style={{ ...card, background: C.mintSoft }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 0 }}
      >
        <span style={{ fontWeight: 700, fontSize: 13.5, color: C.ink }}>🗓️ {t('me.reschedule')}</span>
        <span style={{ color: C.mint, fontWeight: 700, fontSize: 16 }}>{open ? '−' : '＋'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#5f8f86', marginBottom: 12, lineHeight: 1.5 }}>
            {t('me.rescheduleHint')}
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>{t('me.rescheduleNewDate')}</div>
          <input
            type="date"
            value={date}
            min={minDate}
            onChange={(e) => setDate(e.target.value)}
            style={{ width: '100%', border: `1px solid ${C.pinkLine}`, borderRadius: 12, padding: '11px 14px', fontWeight: 600, fontSize: 12.5, background: '#fff', color: C.ink, outline: 'none', marginBottom: 12 }}
          />
          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>{t('me.rescheduleNewTime')}</div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
            {times.map((tm) => (
              <button
                key={tm}
                onClick={() => setStartTime(tm)}
                style={{
                  border: `1.5px solid ${startTime === tm ? C.pink : C.pinkLine}`,
                  background: startTime === tm ? C.pinkSoft : '#fff', color: startTime === tm ? C.pinkDeep : C.ink,
                  fontWeight: 700, fontSize: 12, padding: '8px 12px', borderRadius: 12, cursor: 'pointer',
                }}
              >
                {timeLabel(tm)}
              </button>
            ))}
          </div>
          {error && <div style={{ marginBottom: 10 }}><Notice tone="error">{error}</Notice></div>}
          <button
            onClick={submit}
            disabled={!date || busy}
            style={{
              width: '100%', background: !date ? '#cfe8e3' : C.mint, color: '#fff', border: 'none',
              fontWeight: 700, fontSize: 13, padding: '12px 0', borderRadius: 14, cursor: !date ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? t('me.rescheduleSaving') : t('me.rescheduleConfirm')}
          </button>
        </div>
      )}
    </div>
  );
}

function SetupSpotPhotos({ eventId, t }: { eventId: string; t: TFn }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const url = await api.uploadEventImage(eventId, file);
      await api.setupPhoto(eventId, 'spot', note.trim(), url);
      setSent((s) => [url, ...s]);
      setNote('');
    } catch (e: any) {
      // Cloudinary not configured yet, or upload failed.
      setError(e?.body?.error === 'uploads_disabled' ? t('me.setupDisabled') : (e?.message ?? t('me.setupFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={card}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{t('me.setupTitle')}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, margin: '3px 0 12px' }}>
        {t('me.setupSub')}
      </div>
      <input
        placeholder={t('me.setupNotePh')}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={{
          width: '100%', border: `1px solid ${C.pinkLine}`, borderRadius: 14, padding: '11px 14px',
          fontWeight: 600, fontSize: 12.5, background: '#fff', color: C.ink, outline: 'none', marginBottom: 10,
        }}
      />
      <label
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          border: `1.5px dashed ${C.pinkDash}`, borderRadius: 14, padding: '14px',
          fontWeight: 700, fontSize: 13, color: C.pinkDeep, cursor: 'pointer',
        }}
      >
        {busy ? t('me.setupUploading') : t('me.setupAdd')}
        <input
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
        />
      </label>
      {error && <div style={{ marginTop: 8 }}><Notice tone="info">{error}</Notice></div>}
      {sent.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {sent.map((u) => (
            <img key={u} src={u} alt="setup spot" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10, border: `1px solid ${C.pinkLine}` }} />
          ))}
        </div>
      )}
    </div>
  );
}

function RateAndTip({ event, onDone, t }: { event: any; onDone: () => Promise<void>; t: TFn }) {
  const existing = event.review?.rating as { stars: number; feedback: string | null } | null;
  const presets: number[] = event.review?.tipPresetsFils ?? [5000, 10000, 15000];

  const [stars, setStars] = useState<number>(existing?.stars ?? 0);
  const [feedback, setFeedback] = useState<string>(existing?.feedback ?? '');
  const [saved, setSaved] = useState<boolean>(Boolean(existing));
  const [savingRating, setSavingRating] = useState(false);

  const [amountFils, setAmountFils] = useState<number>(presets[0] ?? 5000);
  const [customAed, setCustomAed] = useState<string>('');
  const [memberId, setMemberId] = useState<string | null>(null); // null = whole team
  const [tipping, setTipping] = useState(false);
  const [tipError, setTipError] = useState<string | null>(null);

  const submitRating = async () => {
    if (stars < 1) return;
    setSavingRating(true);
    try {
      await api.rateEvent(event.id, stars, feedback.trim() || undefined);
      setSaved(true);
      await onDone();
    } finally {
      setSavingRating(false);
    }
  };

  const effectiveTip = customAed ? Math.round(Number(customAed) * 100) : amountFils;

  const sendTip = async () => {
    if (!Number.isFinite(effectiveTip) || effectiveTip < 500) {
      setTipError(t('me.tipMin'));
      return;
    }
    setTipping(true);
    setTipError(null);
    try {
      const res = await api.tipCheckout(event.id, effectiveTip, memberId);
      if (res.checkoutUrl) window.location.href = res.checkoutUrl;
      else setTipError(t('me.errCheckout'));
    } catch (e: any) {
      setTipError(e?.body?.message ?? e?.message ?? t('me.errTip'));
    } finally {
      setTipping(false);
    }
  };

  return (
    <div style={card}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{t('me.rateTitle')}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, margin: '3px 0 12px' }}>
        {t('me.rateSub')}
      </div>

      {/* stars */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => { setStars(n); setSaved(false); }}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: 30, lineHeight: 1, padding: 0,
              filter: n <= stars ? 'none' : 'grayscale(1) opacity(0.35)',
            }}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
          >
            ⭐
          </button>
        ))}
      </div>

      {saved && existing ? (
        <Notice tone="ok">{t('me.rateThanks', { stars: existing.stars })}</Notice>
      ) : (
        <>
          <textarea
            placeholder={t('me.rateFeedbackPh')}
            rows={2}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            style={{
              width: '100%', border: `1px solid ${C.pinkLine}`, borderRadius: 14, padding: '11px 14px',
              fontWeight: 600, fontSize: 12.5, background: C.cream, color: C.ink,
              outline: 'none', resize: 'none', marginBottom: 10,
            }}
          />
          <button
            onClick={submitRating}
            disabled={stars < 1 || savingRating}
            style={{
              width: '100%', background: stars < 1 ? '#e6dcd6' : C.pink, color: '#fff', border: 'none',
              fontWeight: 700, fontSize: 13, padding: '12px 0', borderRadius: 16,
              cursor: stars < 1 ? 'not-allowed' : 'pointer', marginBottom: 6,
            }}
          >
            {savingRating ? t('me.rateSaving') : t('me.rateSubmit')}
          </button>
        </>
      )}

      {/* tip */}
      <div style={{ borderTop: `1px solid ${C.pinkLine}`, marginTop: 14, paddingTop: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{t('me.tipTitle')}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 10 }}>
          {t('me.tipSub')}
        </div>

        {/* who */}
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
          <TipChip label={t('me.tipWholeTeam')} active={memberId === null} onClick={() => setMemberId(null)} />
          {event.team.map((m: any) => (
            <TipChip key={m.id} label={m.name} active={memberId === m.id} onClick={() => setMemberId(m.id)} />
          ))}
        </div>

        {/* amount */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {presets.map((f) => {
            const active = !customAed && amountFils === f;
            return (
              <button
                key={f}
                onClick={() => { setAmountFils(f); setCustomAed(''); }}
                style={{
                  flex: 1, border: `1.5px solid ${active ? C.pink : C.pinkLine}`,
                  background: active ? C.pinkSoft : '#fff', color: active ? C.pinkDeep : C.ink,
                  fontWeight: 700, fontSize: 14, padding: '12px 0', borderRadius: 14, cursor: 'pointer',
                }}
              >
                AED {money(f)}
              </button>
            );
          })}
        </div>
        <input
          placeholder={t('me.tipCustom')}
          inputMode="decimal"
          value={customAed}
          onChange={(e) => setCustomAed(e.target.value.replace(/[^\d.]/g, ''))}
          style={{
            width: '100%', border: `1px solid ${C.pinkLine}`, borderRadius: 14, padding: '11px 14px',
            fontWeight: 700, fontSize: 13, background: '#fff', color: C.ink, outline: 'none', marginBottom: 10,
          }}
        />
        <button
          onClick={sendTip}
          disabled={tipping}
          style={{
            width: '100%', background: C.pinkDeep, color: '#fff', border: 'none', fontWeight: 700,
            fontSize: 13, padding: '13px 0', borderRadius: 16, cursor: 'pointer',
          }}
        >
          {tipping
            ? t('me.opening')
            : memberId
              ? t('me.tipTo', { aed: `${t('common.aed')} ${money(effectiveTip)}`, who: event.team.find((m: any) => m.id === memberId)?.name ?? t('me.crew') })
              : t('me.tipToTeam', { aed: `${t('common.aed')} ${money(effectiveTip)}` })}
        </button>
        {tipError && (
          <div style={{ marginTop: 8 }}>
            <Notice tone="error">{tipError}</Notice>
          </div>
        )}
      </div>
    </div>
  );
}

function TipChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: `1.5px solid ${active ? C.pink : C.pinkLine}`,
        background: active ? C.pinkSoft : '#fff', color: active ? C.pinkDeep : C.ink,
        fontWeight: 700, fontSize: 11.5, padding: '7px 12px', borderRadius: 20, cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function Stepper({
  title,
  sub,
  value,
  onChange,
  max,
  step = 1,
  format,
}: {
  title: string;
  sub: string;
  value: number;
  onChange: (v: number) => void;
  max: number;
  step?: number;
  format?: (v: number) => string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5 }}>{title}</div>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted }}>{sub}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => onChange(Math.max(0, value - step))} style={stepBtn}>−</button>
        <span style={{ fontWeight: 700, fontSize: 13, minWidth: 26, textAlign: 'center' }}>
          {format ? format(value) : value}
        </span>
        <button onClick={() => onChange(Math.min(max, value + step))} style={stepBtn}>＋</button>
      </div>
    </div>
  );
}

const stepBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 10, border: 'none', background: C.pinkSoft,
  color: C.pinkDeep, fontWeight: 700, fontSize: 15, cursor: 'pointer',
};

const card: React.CSSProperties = {
  background: '#fff', borderRadius: 22, padding: '18px 20px',
  boxShadow: C.shadow, marginBottom: 14,
};

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', fontSize: 12.5, gap: 12 }}>
      <span style={{ color: C.muted, fontWeight: 600, flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: strong ? 800 : 700, color: C.ink, textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

// Readable labels for the celebration type ids stored on the booking.
const RC_TYPE: Record<string, { en: string; ar: string }> = {
  kids: { en: 'Kids birthday', ar: 'عيد ميلاد أطفال' },
  adult: { en: 'Adult celebration', ar: 'مناسبة' },
  gender: { en: 'Gender reveal', ar: 'تحديد الجنس' },
  graduation: { en: 'Graduation', ar: 'تخرّج' },
  bride: { en: 'Bride to be', ar: 'عروس' },
  baby: { en: 'Baby shower', ar: 'استقبال مولود' },
  customc: { en: 'Custom celebration', ar: 'مناسبة مخصصة' },
};

/**
 * Order receipt — a faithful echo of everything captured at checkout, so the
 * customer sees the same detail we hold: event, guest of honour, theme,
 * location, contact, the priced items, the full price breakdown and payment.
 * Every row is conditional — an imported or partial order shows only what it
 * actually has, never a guessed or blank field.
 */
function ReceiptCard({ event, t, lang }: { event: any; t: TFn; lang: Lang }) {
  const aed = t('common.aed');
  const p = event.pricing ?? {};
  const items: any[] = Array.isArray(p.items) ? p.items : [];
  const addr = event.address ?? {};
  const addressLine = [addr.area, addr.street, addr.villa, addr.details].filter(Boolean).join(', ');
  const typeLabel = event.celebrationType
    ? RC_TYPE[event.celebrationType]?.[lang] ?? event.celebrationType
    : '';
  const theme = event.themeName ?? (event.customTheme ? t('me.rcCustomTheme') : null);
  const c = event.contact ?? {};
  const pay = event.payment;
  const dateStr = event.date
    ? new Date(event.date).toLocaleDateString(lang === 'ar' ? 'ar-AE' : 'en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : '';
  const sectionTitle: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 800, color: C.pinkDeep, letterSpacing: 0.5,
    textTransform: 'uppercase', margin: '13px 0 1px',
  };
  return (
    <div style={card}>
      <div style={{ ...fredoka(15), marginBottom: 4 }}>{t('me.rcTitle')}</div>
      <SummaryRow label={t('pay.eventId')} value={event.id} />
      {typeLabel && <SummaryRow label={t('me.rcType')} value={typeLabel} />}
      {event.eventFor && <SummaryRow label={t('me.rcFor')} value={event.eventFor} />}
      {event.ageBand && <SummaryRow label={t('me.rcAge')} value={String(event.ageBand)} />}
      {theme && <SummaryRow label={t('me.rcTheme')} value={theme} />}
      {event.packageName && <SummaryRow label={t('me.rcPackage')} value={event.packageName} />}
      {dateStr && <SummaryRow label={t('me.rcDate')} value={dateStr} />}
      {event.startDisplay && (
        <SummaryRow label={t('me.rcTime')} value={`${event.startDisplay} – ${event.endDisplay}`} />
      )}
      {event.emirate && <SummaryRow label={t('me.rcEmirate')} value={event.emirate} />}
      {addressLine && <SummaryRow label={t('me.rcAddress')} value={addressLine} />}
      {event.childrenCount > 0 && (
        <SummaryRow label={t('me.rcChildren')} value={String(event.childrenCount)} />
      )}

      {(c.name || c.phone || c.email) && (
        <>
          <div style={sectionTitle}>{t('me.rcContactTitle')}</div>
          {c.name && <SummaryRow label={t('me.rcName')} value={c.name} />}
          {c.phone && <SummaryRow label={t('me.rcPhone')} value={c.phone} />}
          {c.backupPhone && <SummaryRow label={t('me.rcBackup')} value={c.backupPhone} />}
          {c.email && <SummaryRow label={t('me.rcEmail')} value={c.email} />}
        </>
      )}

      {items.length > 0 && (
        <>
          <div style={sectionTitle}>{t('me.rcItemsTitle')}</div>
          {items.map((li, i) => (
            <SummaryRow
              key={i}
              label={li.quantity > 1 ? `${li.label} × ${li.quantity}` : li.label}
              value={`${li.amountDisplay} ${aed}`}
            />
          ))}
        </>
      )}

      <div style={{ height: 1, background: C.pinkLine, margin: '11px 0 1px' }} />
      {items.length > 0 && (
        <SummaryRow label={t('me.rcSubtotal')} value={`${p.subtotalDisplay} ${aed}`} />
      )}
      {p.discountFils > 0 && (
        <SummaryRow label={t('me.rcDiscount')} value={`− ${p.discountDisplay} ${aed}`} />
      )}
      {p.deliveryFils > 0 && (
        <SummaryRow label={t('me.rcDelivery')} value={`${p.deliveryDisplay} ${aed}`} />
      )}
      <SummaryRow label={t('me.rcTotal')} value={`${event.totalDisplay} ${aed}`} strong />

      {pay && (
        <>
          <div style={sectionTitle}>{t('me.rcPaymentTitle')}</div>
          <SummaryRow
            label={t('me.rcMethod')}
            value={pay.brand ? `${pay.method} · ${pay.brand}${pay.last4 ? ' ' + pay.last4 : ''}` : pay.method}
          />
          {pay.paidDisplay && <SummaryRow label={t('me.rcPaid')} value={`${pay.paidDisplay} ${aed}`} />}
        </>
      )}
    </div>
  );
}

/**
 * Cancel Booking flow: policy + server-computed refund preview → final
 * confirmation → cancel. The refund figure comes from the server and is what
 * the team will honour; the app never computes it locally.
 */
function CancelBooking({
  event,
  t,
  lang,
  onDone,
}: {
  event: any;
  t: TFn;
  lang: Lang;
  onDone: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'intro' | 'confirm'>('intro');
  const [quote, setQuote] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terms, setTerms] = useState(false);

  const expand = async () => {
    const next = !open;
    setOpen(next);
    if (next && !quote) {
      setLoading(true);
      try {
        setQuote(await api.cancellationQuote(event.id));
      } catch (e: any) {
        setError(e?.message ?? t('cancel.err'));
      } finally {
        setLoading(false);
      }
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.cancelEvent(event.id);
      await onDone();
    } catch (e: any) {
      setError(e?.body?.error === 'already_cancelled' ? t('cancel.errRetry') : e?.message ?? t('cancel.err'));
      setBusy(false);
    }
  };

  const r = quote?.refund;
  const aed = t('common.aed');

  return (
    <div style={{ ...card, border: `1px solid ${C.pinkLine}` }}>
      <button
        onClick={expand}
        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 0 }}
      >
        <span style={{ fontWeight: 700, fontSize: 13.5, color: C.ink }}>⚠️ {t('cancel.manage')}</span>
        <span style={{ color: C.pinkDeep, fontWeight: 700, fontSize: 16 }}>{open ? '−' : '＋'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          {loading && <Spinner label={t('cancel.loading')} />}
          {!loading && r && step === 'intro' && (
            <>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.ink, marginBottom: 6 }}>{t('cancel.policyTitle')}</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, lineHeight: 1.7, marginBottom: 10 }}>
                {t('cancel.tier1')}<br />{t('cancel.tier2')}<br />{t('cancel.tier3')}<br />{t('cancel.tierExtras')}
              </div>
              <div style={{ background: C.cream, borderRadius: 14, padding: '12px 14px', marginBottom: 10 }}>
                <SummaryRow label={t('cancel.totalPaid')} value={`${r.totalPaidDisplay} ${aed}`} />
                <SummaryRow label={t('cancel.refundPct')} value={`${r.percent}%`} />
                <SummaryRow label={t('cancel.deduction')} value={`${r.deductionDisplay} ${aed}`} />
                <div style={{ borderTop: `1px solid ${C.pinkLine}`, marginTop: 4, paddingTop: 4 }}>
                  <SummaryRow label={t('cancel.refundAmount')} value={`${r.refundDisplay} ${aed}`} strong />
                </div>
              </div>
              {r.refundFils === 0 && (
                <div style={{ marginBottom: 10 }}><Notice tone="error">{t('cancel.noRefundWarn')}</Notice></div>
              )}
              <button
                onClick={() => setTerms(true)}
                style={{ background: 'none', border: 'none', color: C.pinkDeep, fontWeight: 700, fontSize: 11.5, cursor: 'pointer', padding: 0, marginBottom: 12, textDecoration: 'underline' }}
              >
                {t('cancel.viewTerms')}
              </button>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>{t('cancel.eta7days')}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setOpen(false)} style={cancelKeepBtn}>{t('cancel.keep')}</button>
                <button onClick={() => setStep('confirm')} style={cancelDangerOutlineBtn}>{t('cancel.continue')}</button>
              </div>
            </>
          )}
          {!loading && r && step === 'confirm' && (
            <>
              <div style={{ fontWeight: 800, fontSize: 14, color: C.ink, marginBottom: 8 }}>{t('cancel.confirmTitle')}</div>
              <div style={{ background: C.cream, borderRadius: 14, padding: '12px 14px', marginBottom: 10 }}>
                <SummaryRow label={t('cancel.event')} value={event.packageName ?? t('me.celebration')} />
                <SummaryRow label={t('cancel.date')} value={new Date(event.date).toLocaleDateString()} />
                <SummaryRow label={t('cancel.order')} value={event.orderId} />
                <SummaryRow label={t('cancel.totalPaid')} value={`${r.totalPaidDisplay} ${aed}`} />
                <SummaryRow label={t('cancel.refundPct')} value={`${r.percent}%`} />
                <SummaryRow label={t('cancel.refundAmount')} value={`${r.refundDisplay} ${aed}`} strong />
              </div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>{t('cancel.eta7days')}</div>
              {error && <div style={{ marginBottom: 10 }}><Notice tone="error">{error}</Notice></div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setStep('intro'); setError(null); }} disabled={busy} style={cancelKeepBtn}>{t('cancel.keep')}</button>
                <button onClick={confirm} disabled={busy} style={{ ...cancelDangerBtn, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}>
                  {busy ? t('cancel.cancelling') : t('cancel.confirmBtn')}
                </button>
              </div>
            </>
          )}
          {error && !r && <div style={{ marginTop: 8 }}><Notice tone="error">{error}</Notice></div>}
        </div>
      )}
      {terms && <TermsSheet lang={lang} onClose={() => setTerms(false)} />}
    </div>
  );
}

const cancelKeepBtn: React.CSSProperties = {
  flex: 1, background: C.pinkSoft, color: C.pinkDeep, border: 'none',
  fontWeight: 700, fontSize: 12.5, padding: '12px 0', borderRadius: 14, cursor: 'pointer',
};
const cancelDangerOutlineBtn: React.CSSProperties = {
  flex: 1, background: '#fff', color: C.red, border: `1.5px solid ${C.red}`,
  fontWeight: 700, fontSize: 12.5, padding: '12px 0', borderRadius: 14, cursor: 'pointer',
};
const cancelDangerBtn: React.CSSProperties = {
  flex: 1, background: C.red, color: '#fff', border: 'none',
  fontWeight: 700, fontSize: 12.5, padding: '12px 0', borderRadius: 14,
};

void timeLabel;
