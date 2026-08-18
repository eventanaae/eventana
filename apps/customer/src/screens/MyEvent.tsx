import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Screen } from '../App';
import { C, fredoka, money, Notice, PrimaryButton, Spinner, timeLabel } from '../ui';

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
}: {
  eventId: string | null;
  onPickEvent: (id: string) => void;
  go: (s: Screen) => void;
}) {
  const [list, setList] = useState<any[] | null>(null);
  const [event, setEvent] = useState<any>(null);
  const [pending, setPending] = useState({ hours: 0, socks: 0, servings: {} as Record<string, number> });
  const [addonQuote, setAddonQuote] = useState<any>(null);
  const [chat, setChat] = useState('');
  const [designNote, setDesignNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [addonError, setAddonError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (eventId) {
      setEvent(await api.event(eventId));
    } else {
      const events = await api.events();
      setList(events);
      if (events.length > 0) onPickEvent(events[0].id);
    }
  }, [eventId, onPickEvent]);

  useEffect(() => {
    load().catch(() => setList([]));
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
        <div style={{ ...fredoka(22), marginBottom: 10 }}>No events yet</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, lineHeight: 1.6, marginBottom: 24 }}>
          Once you book a celebration it appears here with your live timeline, your team and
          everything you can add before the day.
        </div>
        <PrimaryButton onClick={() => go('explore')}>Explore packages</PrimaryButton>
      </div>
    );
  }

  if (!event) return <Spinner label="Loading your event…" />;

  const cancelled = Boolean(event.cancelled);
  const phaseIndex = PHASES.indexOf(event.phase);
  const design = event.designs?.[0];

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
      else setAddonError('Could not open checkout. Please try again.');
    } catch (e: any) {
      setAddonError(e?.body?.message ?? e?.message ?? 'Could not add this right now.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: '8px 22px 30px', animation: 'rise .35s ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <span style={fredoka(24)}>My Event</span>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: C.muted }}>{event.id}</span>
      </div>

      <div
        style={{
          background: cancelled ? '#efe9e6' : 'linear-gradient(135deg,#F9C6DC,#BDEBE4)',
          borderRadius: 22,
          padding: '18px 20px',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{event.packageName ?? 'Your celebration'}</span>
          <span
            style={{
              background: cancelled ? C.redSoft : '#fff',
              color: cancelled ? C.red : C.pinkDeep,
              fontSize: 10, fontWeight: 700, padding: '4px 10px',
              borderRadius: 12, letterSpacing: '.4px', whiteSpace: 'nowrap',
            }}
          >
            {event.phase}
          </span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#8b7d84', marginTop: 6 }}>
          {new Date(event.date).toDateString()} · {event.startDisplay} – {event.endDisplay} · {event.emirate}
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#8b7d84', marginTop: 2 }}>
          {event.totalDisplay} AED · {cancelled ? 'Cancelled' : 'Paid in full'}
        </div>
      </div>

      {cancelled && (
        <div style={{ marginBottom: 14 }}>
          <Notice tone="error">
            This event has been cancelled.
            {event.cancellationReason ? ` ${event.cancellationReason}.` : ''}
            <div style={{ fontWeight: 600, marginTop: 5, lineHeight: 1.5 }}>
              Additional purchases and location changes are no longer available. For anything else —
              including refunds — message your Eventana team below.
            </div>
          </Notice>
        </div>
      )}

      {/* The team has arrived — a clear, celebratory banner + contact shortcut. */}
      {!cancelled && event.phase === 'Arrived' && (
        <div style={{ background: C.green, borderRadius: 20, padding: '15px 18px', color: '#fff', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 13 }}>
          <span style={{ fontSize: 24 }}>🎉</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>Your Eventana team has arrived!</div>
            <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.95, marginTop: 2 }}>
              They’re getting set up — message them below if you need anything.
            </div>
          </div>
        </div>
      )}

      {/* Live tracking never shows for a cancelled event — no team is on the way. */}
      {!cancelled && event.phase !== 'Arrived' && event.eta && (
        <div style={{ background: C.mint, borderRadius: 20, padding: '15px 18px', color: '#fff', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 13 }}>
          <span style={{ fontSize: 24, animation: 'pulse 1.6s infinite' }}>🚐</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>Your Eventana team is on the way!</div>
            <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.95, marginTop: 2 }}>
              Estimated arrival: <b>{event.eta}</b>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- add more ----------------
          Hidden entirely once cancelled: no additional hour, no socks,
          no extra servings. The API refuses them too. */}
      {!cancelled && (
      <div style={card}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Add More to My Event ✨</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, margin: '3px 0 14px' }}>
          Extras before the big day — a separate payment on the same Event ID.
        </div>

        {event.addOns.maxExtraHours > 0 ? (
          <Stepper
            title={`Additional Hour · AED ${money(event.addOns.additionalHourFils)}`}
            sub={
              pending.hours > 0 && addonQuote?.newEndTime
                ? `Ends ${addonQuote.newEndTime} · max 12:00 AM`
                : `Ends ${event.endDisplay} now · max 12:00 AM`
            }
            value={pending.hours}
            max={event.addOns.maxExtraHours}
            onChange={(v) => setPending((p) => ({ ...p, hours: v }))}
          />
        ) : (
          <div style={{ marginBottom: 12 }}>
            <Notice tone="error">
              Additional hour unavailable — events must finish by 12:00 AM.
            </Notice>
          </div>
        )}

        {event.addOns.socks && (
          <>
            <div style={{ marginBottom: 10 }}>
              <Notice tone="warn">
                Your booking includes an inflatable — children must wear socks 🧦
              </Notice>
            </div>
            <Stepper
              title={`Kids Socks · AED ${money(event.addOns.socks.perPairFils)}/pair`}
              sub={`${event.childrenCount} children attending`}
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
              Add suggested {event.addOns.socks.suggestedPairs} pairs · AED {event.addOns.socks.suggestedDisplay}
            </button>
          </>
        )}

        {event.addOns.extraServings.map((row: any) => (
          <Stepper
            key={row.serviceId}
            title={`${row.name} — extra servings`}
            sub={`+${row.blockSize} servings · AED ${row.priceDisplay}`}
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
            {busy ? 'Opening checkout…' : `Pay AED ${addonQuote.totalDisplay} · Add to My Event`}
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
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Event timeline</div>
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
                  {step.label}
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
                    {label}
                  </div>
                </div>
              );
            })}
      </div>

      {/* ---------------- team ---------------- */}
      <div style={card}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 13 }}>Your Eventana Team ✨</div>
        <div style={{ display: 'flex', gap: 16 }}>
          {event.team.map((m: any) => (
            <div key={m.id} style={{ textAlign: 'center', flex: 1 }}>
              <div
                style={{
                  width: 52, height: 52, borderRadius: '50%', background: m.color, color: '#fff',
                  fontWeight: 700, fontSize: 17, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', margin: '0 auto 7px',
                }}
              >
                {m.name[0]}
              </div>
              <div style={{ fontWeight: 700, fontSize: 12 }}>{m.name}</div>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, marginTop: 1 }}>{m.role}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ---------------- rate & tip ---------------- */}
      {!cancelled && event.review?.canReview && (
        <RateAndTip event={event} onDone={async () => setEvent(await api.event(event.id))} />
      )}

      {/* ---------------- chat ---------------- */}
      <div style={card}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Message Your Team 💬</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, margin: '3px 0 12px' }}>
          Connected to {event.id} · replies come from your Eventana team
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
              No messages yet — tell your team anything they need to know on the day.
            </div>
          )}
        </div>
        {event.chatOpen ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="e.g. Please use the second gate"
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
          <Notice tone="info">This event chat is closed.</Notice>
        )}
      </div>

      {/* ---------------- design approval ---------------- */}
      {design && (
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
            Your design {design.status === 'pending' ? 'is ready for approval ✨' : ''}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 12 }}>
            Custom theme · v{design.version}
          </div>
          <div style={{ height: 180, borderRadius: 16, background: 'linear-gradient(135deg,#FDE0EE,#BDEBE4)', marginBottom: 12 }} />

          {design.status === 'pending' && (
            <>
              <PrimaryButton
                onClick={async () => {
                  await api.designDecision(event.id, design.version, 'approve');
                  setEvent(await api.event(event.id));
                }}
                style={{ marginBottom: 12 }}
              >
                Approve Design
              </PrimaryButton>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>Request Changes</div>
              <textarea
                placeholder="Tell us what to change (required)"
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
                Send to Design Team
              </button>
            </>
          )}

          {design.status === 'approved' && (
            <Notice tone="ok">
              Approved ✓ — v{design.version} is locked and production has started.
            </Notice>
          )}
          {design.status === 'changes_requested' && (
            <Notice tone="warn">
              Changes sent to the design team
              <div style={{ fontWeight: 600, marginTop: 5, lineHeight: 1.45 }}>“{design.customer_note}”</div>
              <div style={{ fontWeight: 600, marginTop: 5 }}>
                They’ll upload the next version for your approval — we’ll notify you.
              </div>
            </Notice>
          )}
        </div>
      )}
    </div>
  );
}

function RateAndTip({ event, onDone }: { event: any; onDone: () => Promise<void> }) {
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
      setTipError('A tip must be at least AED 5.');
      return;
    }
    setTipping(true);
    setTipError(null);
    try {
      const res = await api.tipCheckout(event.id, effectiveTip, memberId);
      if (res.checkoutUrl) window.location.href = res.checkoutUrl;
      else setTipError('Could not open checkout. Please try again.');
    } catch (e: any) {
      setTipError(e?.body?.message ?? e?.message ?? 'Could not start the tip right now.');
    } finally {
      setTipping(false);
    }
  };

  return (
    <div style={card}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>How was your celebration? ⭐</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, margin: '3px 0 12px' }}>
        Your rating helps the crew — and a tip goes straight to them.
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
        <Notice tone="ok">Thanks for rating {existing.stars}★ — the team sees it.</Notice>
      ) : (
        <>
          <textarea
            placeholder="Tell us what you loved (optional)"
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
            {savingRating ? 'Saving…' : 'Submit rating'}
          </button>
        </>
      )}

      {/* tip */}
      <div style={{ borderTop: `1px solid ${C.pinkLine}`, marginTop: 14, paddingTop: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Leave a tip for the crew 💐</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 10 }}>
          100% goes to the team · paid securely by card / Apple Pay via Ziina
        </div>

        {/* who */}
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
          <TipChip label="Whole team 🎉" active={memberId === null} onClick={() => setMemberId(null)} />
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
          placeholder="Custom amount (AED)"
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
          {tipping ? 'Opening checkout…' : `Tip AED ${money(effectiveTip)} ${memberId ? `to ${event.team.find((m: any) => m.id === memberId)?.name ?? 'crew'}` : 'to the team'}`}
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

void timeLabel;
