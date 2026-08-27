import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, Button, C, fredoka, money, Panel, Spinner } from '../ui';
import { Empty, eventTitle } from './Today';

const PHASES = [
  'Booking Confirmed', 'Preparing', 'On The Way', 'Arrived',
  'Setting Up', 'Setup Ready', 'Party Started', 'Event Completed',
];

/**
 * The all-events list. Opening an event is lifted to the app so the same
 * Event Details page opens from Today, Schedule or here — always by id.
 * Mobile shows compact cards; wide screens keep the scannable table.
 */
export function Events({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const [events, setEvents] = useState<any[] | null>(null);
  const [needsReview, setNeedsReview] = useState<any[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    api.events().then(setEvents);
    api.needsReview().then(setNeedsReview).catch(() => setNeedsReview([]));
  }, []);

  if (!events) return <Spinner />;

  const filtered = events
    .filter((e) => {
      const s = q.trim().toLowerCase();
      return !s || `${e.id} ${e.customer} ${e.emirate} ${e.phase}`.toLowerCase().includes(s);
    })
    .sort((a, b) => String(a.event_date).slice(0, 10).localeCompare(String(b.event_date).slice(0, 10)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {needsReview.length > 0 && (
        <Panel title="Needs review" style={{ borderColor: '#f2c9c2' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 12, lineHeight: 1.6 }}>
            Held back by the engine rather than confirmed — an amount mismatch, or a payment that
            landed after the hold expired. A person decides what happens next.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {needsReview.map((o) => (
              <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: C.ink }}>{o.id}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>{o.last_note}</div>
                </div>
                <span style={{ fontWeight: 700, fontSize: 12.5, color: C.ink, whiteSpace: 'nowrap' }}>AED {o.totalDisplay}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <input
        placeholder="Search events, customers, emirates…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: '11px 14px', fontSize: 13, fontWeight: 600, outline: 'none', background: '#fff', color: C.ink }}
      />

      {filtered.length === 0 ? (
        <Panel><Empty>No matching bookings.</Empty></Panel>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((e, i) => {
            const d = new Date(e.event_date);
            const key = `${d.getFullYear()}-${d.getMonth()}`;
            const prev = i > 0 ? new Date(filtered[i - 1].event_date) : null;
            const showMonth = !prev || `${prev.getFullYear()}-${prev.getMonth()}` !== key;
            const count = filtered.filter((x) => { const xd = new Date(x.event_date); return `${xd.getFullYear()}-${xd.getMonth()}` === key; }).length;
            return (
              <div key={e.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {showMonth && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: i === 0 ? 0 : 8 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.5px', textTransform: 'uppercase', color: C.pinkDeep, whiteSpace: 'nowrap' }}>
                      {d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                    </span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, background: C.pinkSoft, borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap' }}>{count}</span>
                    <div style={{ flex: 1, height: 1, background: C.line }} />
                  </div>
                )}
                <div
                  onClick={() => onOpenEvent(e.id)}
                  style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: '13px 15px', cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ ...fredoka(14), flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{eventTitle(e)}</span>
                    {e.totalDisplay != null && (
                      <span style={{ fontWeight: 700, fontSize: 13, color: C.ink, whiteSpace: 'nowrap' }}>AED {e.totalDisplay}</span>
                    )}
                  </div>
                  {e.eventFor && <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted2, marginTop: 1 }}>by {e.customer}</div>}
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, margin: '3px 0 8px' }}>
                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>{e.id}</span> ·{' '}
                    {d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} · {e.start_time}–{e.base_end_time} · {e.emirate}
                    {e.theme_name ? ` · 🎨 ${e.theme_name}` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Badge tone={e.phase === 'Cancelled' ? 'error' : 'info'}>{e.phase}</Badge>
                    <Badge tone={e.order_status === 'paid' ? 'ok' : e.order_status === 'needs_review' ? 'error' : 'warn'}>{e.order_status}</Badge>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function EventDrawer({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [reply, setReply] = useState('');
  const [eta, setEta] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundCategory, setRefundCategory] = useState<'customer_cancellation' | 'quality_issue' | 'missing_item' | 'other'>('customer_cancellation');
  const [refundCancelEvent, setRefundCancelEvent] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const d = await api.event(eventId);
    setData(d);
    // The payment audit trail is a manager/owner tool (money view). Employees /
    // drivers don't fetch it — the API forbids it and they don't need it.
    if (d.event.order_id && d.event.totalDisplay != null) setAudit(await api.audit(d.event.order_id).catch(() => []));
  };
  useEffect(() => { load(); }, [eventId]);

  // The API nulls every money figure for employees/drivers — detect that and
  // hide the money panels (payments, refund, tip amounts) entirely.
  const moneyHidden = !!data && data.event.totalDisplay == null;
  // Only the Event Leader (or a manager/owner) may advance the status or message
  // the customer. Managers aren't money-hidden; employees are the leader only if
  // the API says so for this event.
  const canUpdateStatus = !!data && (!moneyHidden || data.isLeader === true);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(59,54,65,.4)', zIndex: 20, display: 'flex', justifyContent: 'flex-end' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(680px, 100vw)', maxWidth: '100vw', background: C.bg, height: '100vh', overflowY: 'auto', padding: 18 }}
      >
        {!data ? (
          <Spinner />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div style={fredoka(20)}>{data.event.id}</div>
              <Button tone="ghost" onClick={onClose}>Close</Button>
            </div>
            <div style={{ marginBottom: 18 }}>
              <div>
                <div style={{ borderRadius: 20, overflow: 'hidden', border: `1px solid ${C.line}`, boxShadow: C.shadow, background: '#fff' }}>
                  <div style={{ height: 5, background: `linear-gradient(90deg,${C.pink},${C.pinkDeep})` }} />
                  {/* Guest of honour banner */}
                  <div style={{ background: 'linear-gradient(135deg,#FFF3F9,#FDEAF3)', padding: '15px 18px 14px' }}>
                    {data.event.eventFor ? (
                      <>
                        <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '1px', color: '#c98fb4' }}>GUEST OF HONOUR</div>
                        <div style={{ ...fredoka(22), color: C.pinkDeep, marginTop: 2 }}>🎉 {data.event.eventFor}</div>
                      </>
                    ) : (
                      <div style={{ ...fredoka(20), color: C.pinkDeep }}>🎉 {data.event.customer}</div>
                    )}
                  </div>
                  {/* Details grid — full-width gridlines, no lopsided gap */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: C.line, borderTop: `1px solid ${C.line}` }}>
                    <InfoCell label="👤 Booked by" value={data.event.customer} />
                    <InfoCell label="📞 Phone" value={data.event.phone
                      ? <a href={`tel:${String(data.event.phone).replace(/[^\d+]/g, '')}`} style={{ color: C.pinkDeep, fontWeight: 800, textDecoration: 'none' }}>{data.event.phone}</a>
                      : <span style={{ color: C.muted }}>—</span>} />
                    <InfoCell span label="🗓️ Date & time" value={`${new Date(data.event.event_date).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })} · ${data.event.start_time}–${data.event.base_end_time}`} />
                    {data.event.email && (
                      <InfoCell span label="✉️ Email" value={
                        <a href={`mailto:${data.event.email}`} style={{ color: C.ink, fontWeight: 700, textDecoration: 'none', wordBreak: 'break-word' }}>{data.event.email}</a>
                      } />
                    )}
                    <InfoCell span label="📍 Location" value={data.event.emirate || <span style={{ color: C.muted }}>—</span>} />
                  </div>
                </div>
                {(data.event.referenceImages ?? []).length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 4 }}>📎 Reference images</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(data.event.referenceImages ?? []).map((u: string, i: number) => (
                        <a key={i} href={u} target="_blank" rel="noreferrer">
                          <img src={u} alt="reference" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: `1px solid ${C.line}` }} />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {message && (
              <div style={{ background: C.greenSoft, color: C.green, padding: '10px 14px', borderRadius: 12, fontSize: 12, fontWeight: 700, marginBottom: 14 }}>
                {message}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {!moneyHidden && data.event.phase !== 'Cancelled' && (
                <EditEventPanel event={data.event} eventId={eventId} onSaved={load} onMessage={setMessage} />
              )}
              <LocationPanel event={data.event} />

              <Panel title="Booked services">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.services.map((s: any) => (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>{s.label}</div>
                        <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted }}>×{s.quantity} · {s.source}</div>
                      </div>
                      <span style={{ fontWeight: 700, fontSize: 12.5, color: C.ink, whiteSpace: 'nowrap' }}>
                        {s.amount_fils > 0 ? `AED ${money(Number(s.amount_fils))}` : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>

              <PartyDetailsPanel event={data.event} />
              {(data.rating || (!moneyHidden && data.tips && data.tips.length > 0)) && (
                <RatingTipsPanel rating={data.rating} tips={moneyHidden ? [] : data.tips} />
              )}
              {data.event.custom_theme && (
                <DesignPanel eventId={eventId} designs={data.designs ?? []} onChange={load} />
              )}
              {!moneyHidden && data.event.phase !== 'Cancelled' && <StaffingPanel eventId={eventId} />}

              {/* Everyone on the job sees who's on the crew and who the Event
                  Leader is — the Leader is the one who updates status & messages. */}
              {data.event.phase !== 'Cancelled' && (
                <Panel title="👥 Team for this event">
                  {(data.team ?? []).length === 0 ? (
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, lineHeight: 1.5 }}>
                      No crew assigned yet{!moneyHidden ? ' — assign the team from Staffing above.' : '.'}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {[...(data.team ?? [])].sort((a: any, b: any) => (b.is_leader ? 1 : 0) - (a.is_leader ? 1 : 0)).map((m: any) => (
                        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 2px', borderBottom: `1px solid ${C.lineSoft}` }}>
                          <div style={{ width: 34, height: 34, borderRadius: '50%', background: m.color || C.pink, color: '#fff', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{String(m.name || '?')[0]}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{m.name}</div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>{m.job_title || ROLE_LABEL[m.event_role] || 'Crew'}</div>
                          </div>
                          {m.is_leader && (
                            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.3px', color: C.pinkDeep, background: C.pinkSoft, padding: '4px 9px', borderRadius: 20, flex: 'none' }}>👑 Leader</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>
              )}

              <Panel title="Advance status">
                {data.event.phase !== 'Cancelled' && (
                  <div style={{ background: C.pinkSoft, color: C.pinkDeep, borderRadius: 10, padding: '8px 11px', fontSize: 11.5, fontWeight: 700, marginBottom: 12, lineHeight: 1.5 }}>
                    {canUpdateStatus
                      ? (data.isLeader
                          ? '👑 You are the Event Leader — you update the status on the day.'
                          : '👑 The Event Leader updates the status on the day.')
                      : `👑 Only the Event Leader${data.leaderName ? ` (${data.leaderName})` : ''} can update the status on the day — this is view-only for you.`}
                  </div>
                )}
                {data.event.phase === 'Cancelled' ? (
                  <div>
                    <div style={{ marginBottom: 12 }}>
                      <Badge tone="error">Cancelled</Badge>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted2, marginTop: 8, lineHeight: 1.6 }}>
                        {data.event.cancellation_reason ?? 'No reason recorded.'}
                        <br />
                        Live tracking is off, reservations are released, and the customer can no
                        longer buy extra hours, socks or servings.
                      </div>
                    </div>
                    {canUpdateStatus && (
                      <Button
                        tone="ghost"
                        onClick={async () => {
                          const r: any = await api.reinstateEvent(eventId);
                          setMessage(r?.conflicts?.length
                            ? `Reinstated. Re-reserved ${r.reReserved} item(s). ⚠️ Not available: ${r.conflicts.join(', ')}`
                            : `Reinstated — ${r?.reReserved ?? 0} item(s) re-reserved and available.`);
                          load();
                        }}
                      >
                        Reinstate event
                      </Button>
                    )}
                  </div>
                ) : !canUpdateStatus ? (
                  <div>
                    <Badge tone={data.event.phase === 'Event Completed' ? 'neutral' : 'info'}>{data.event.phase}</Badge>
                    {data.event.eta && (
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.pinkDeep, marginTop: 8 }}>
                        Customer sees ETA: {data.event.eta}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>
                        ETA for “On The Way”:
                      </span>
                      <input
                        placeholder="e.g. 25 min · 4:35 PM"
                        value={eta}
                        onChange={(e) => setEta(e.target.value)}
                        style={{ ...inputStyle, maxWidth: 210 }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {PHASES.map((p) => (
                        <Button
                          key={p}
                          tone={data.event.phase === p ? 'primary' : 'ghost'}
                          onClick={async () => {
                            await api.setPhase(
                              eventId,
                              p,
                              p === 'On The Way' ? eta.trim() || undefined : undefined,
                            );
                            load();
                          }}
                        >
                          {p}
                        </Button>
                      ))}
                    </div>
                    {data.event.eta && (
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.pinkDeep, marginTop: 6 }}>
                        Customer sees ETA: {data.event.eta}
                      </div>
                    )}
                    <div style={{ marginTop: 14, borderTop: `1px solid ${C.lineSoft}`, paddingTop: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8, lineHeight: 1.6 }}>
                        Cancelling stops live tracking, releases the reserved assets, closes the
                        preparation tasks and blocks further customer purchases. It does not refund
                        by itself — that stays a separate decision below.
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          placeholder="Cancellation reason (required)"
                          value={cancelReason}
                          onChange={(e) => setCancelReason(e.target.value)}
                          style={inputStyle}
                        />
                        <Button
                          tone="danger"
                          disabled={!cancelReason.trim()}
                          onClick={async () => {
                            await api.cancelEvent(eventId, cancelReason.trim());
                            setCancelReason('');
                            setMessage('Event cancelled. Assets released and tasks closed.');
                            load();
                          }}
                        >
                          Cancel event
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </Panel>

              <Panel title="Reserved inventory">
                {data.reservations.length === 0 ? (
                  <Empty>No physical assets reserved.</Empty>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {data.reservations.map((r: any) => (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>{r.name}{r.variant ? ` · ${r.variant}` : ''}</div>
                          <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted }}>
                            {new Date(r.starts_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            {' → '}
                            {new Date(r.ends_at).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        <Badge tone={r.status === 'reserved' ? 'ok' : 'warn'}>{r.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="Setup placement notes">
                {data.setupPhotos.length === 0 ? (
                  <Empty>The customer didn’t add placement notes — that’s optional.</Empty>
                ) : (
                  data.setupPhotos.map((p: any) => (
                    <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '5px 0' }}>
                      {p.photo_url && (
                        <a href={p.photo_url} target="_blank" rel="noreferrer">
                          <img src={p.photo_url} alt={p.item_key} style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 8, border: `1px solid ${C.line}` }} />
                        </a>
                      )}
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                        <b style={{ textTransform: 'capitalize' }}>{p.item_key}</b>: {p.description || '(photo)'}
                      </div>
                    </div>
                  ))
                )}
              </Panel>

              <Panel
                title="Customer messages"
                action={canUpdateStatus ? (
                  <Button
                    tone="ghost"
                    onClick={async () => {
                      await api.setChat(eventId, !data.event.chat_open);
                      load();
                    }}
                  >
                    {data.event.chat_open ? 'Close chat' : 'Open chat'}
                  </Button>
                ) : undefined}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 12 }}>
                  {data.messages.length === 0 && <Empty>No messages yet.</Empty>}
                  {data.messages.map((m: any) => (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: m.sender === 'team' ? 'flex-end' : 'flex-start',
                        background: m.sender === 'team' ? C.pinkSoft : '#fff',
                        border: `1px solid ${C.line}`,
                        fontSize: 12, fontWeight: 600, padding: '8px 12px',
                        borderRadius: 12, maxWidth: '80%',
                      }}
                    >
                      {m.body}
                      <div style={{ fontSize: 9.5, color: C.muted, marginTop: 3 }}>
                        {m.author ?? 'Customer'}
                      </div>
                    </div>
                  ))}
                </div>
                {!canUpdateStatus ? (
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, background: '#faf6f9', borderRadius: 10, padding: '9px 12px', lineHeight: 1.5 }}>
                    👑 Only the Event Leader{data.leaderName ? ` (${data.leaderName})` : ''} replies to the customer. You can read the chat here.
                  </div>
                ) : (
                  <>
                    {data.event.chat_open && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                        {[
                          'We’re on our way 🚐',
                          'We’ve arrived 🎉',
                          'Please open the gate 🙏',
                          'Where should we park?',
                          'We’re setting up now ✨',
                        ].map((q) => (
                          <Button
                            key={q}
                            tone="ghost"
                            onClick={async () => {
                              await api.reply(eventId, q);
                              load();
                            }}
                          >
                            {q}
                          </Button>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        placeholder="Reply to the customer…"
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        style={inputStyle}
                      />
                      <Button
                        onClick={async () => {
                          if (!reply.trim()) return;
                          await api.reply(eventId, reply.trim());
                          setReply('');
                          load();
                        }}
                      >
                        Send
                      </Button>
                    </div>
                  </>
                )}
              </Panel>

              {!moneyHidden && (
              <Panel title="Payments &amp; audit trail">
                {data.orders.map((o: any) => (
                  <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, flex: 1 }}>{o.id}</span>
                    <Badge tone={o.kind === 'addon' ? 'info' : 'neutral'}>{o.kind}</Badge>
                    <Badge tone={o.status === 'paid' ? 'ok' : o.status === 'needs_review' ? 'error' : 'warn'}>
                      {o.status}
                    </Badge>
                    <span style={{ fontWeight: 700, fontSize: 12.5, minWidth: 90, textAlign: 'right' }}>
                      AED {o.totalDisplay}
                    </span>
                  </div>
                ))}

                <div style={{ marginTop: 14, borderTop: `1px solid ${C.lineSoft}`, paddingTop: 12 }}>
                  {audit.map((a) => (
                    <div key={a.id} style={{ fontSize: 11.5, fontWeight: 600, color: C.muted2, padding: '3px 0', display: 'flex', gap: 8 }}>
                      <span style={{ color: C.muted, minWidth: 130 }}>
                        {new Date(a.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span style={{ fontFamily: 'ui-monospace, monospace' }}>
                        {a.old_status ?? '—'} → {a.new_status}
                      </span>
                      <span style={{ color: C.muted }}>[{a.source}]</span>
                      <span style={{ flex: 1 }}>{a.note ?? ''}</span>
                    </div>
                  ))}
                </div>
              </Panel>
              )}

              {data.event.cancellation && (
                <Panel title="Cancellation & refund">
                  {(() => {
                    const cx = data.event.cancellation;
                    const statusTone =
                      cx.refundStatus === 'processed'
                        ? 'ok'
                        : cx.refundStatus === 'failed'
                          ? 'error'
                          : cx.refundStatus === 'none'
                            ? 'neutral'
                            : 'warn';
                    const row = (k: string, v: string) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0' }}>
                        <span style={{ color: C.muted, fontWeight: 700 }}>{k}</span>
                        <span style={{ fontWeight: 700, color: C.ink }}>{v}</span>
                      </div>
                    );
                    return (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <Badge tone={statusTone}>Refund {cx.refundStatus}</Badge>
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: C.muted }}>
                            cancelled by {cx.cancelledBy}
                          </span>
                        </div>
                        {row('Total paid', cx.totalPaidDisplay)}
                        {row('Refund %', `${cx.refundPercent}%`)}
                        {row('Refund owed', cx.refundAmountDisplay)}
                        {cx.refundReference ? row('Reference', String(cx.refundReference)) : null}
                        {cx.refundStatus === 'pending' && cx.refundAmountFils > 0 && (
                          <Button
                            tone="ghost"
                            style={{ marginTop: 10, fontSize: 11.5, padding: '8px 12px' }}
                            onClick={() => {
                              setRefundAmount(String(cx.refundAmountFils / 100));
                              setRefundReason(`Customer cancellation — ${cx.refundPercent}% per policy`);
                            }}
                          >
                            Use policy amount ({cx.refundAmountDisplay}) →
                          </Button>
                        )}
                      </div>
                    );
                  })()}
                </Panel>
              )}

              {!moneyHidden && (
              <Panel title="Refund">
                <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 10, lineHeight: 1.6 }}>
                  A refund is <b>not</b> a cancellation. Refund a completed party for a quality issue or a
                  missing item without cancelling it — or tick “Cancel the event too” when the whole booking
                  is off. The status comes from the provider’s response, and the customer is emailed automatically.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input
                      placeholder="Amount in AED"
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value.replace(/[^\d.]/g, ''))}
                      style={{ ...inputStyle, width: 140, flex: 'none' }}
                    />
                    <select
                      value={refundCategory}
                      onChange={(e) => setRefundCategory(e.target.value as any)}
                      style={{ ...inputStyle, flex: 1, minWidth: 200 }}
                    >
                      <option value="customer_cancellation">Customer requested cancellation</option>
                      <option value="quality_issue">Quality issue</option>
                      <option value="missing_item">Missing item or service</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <input
                    placeholder="Note (optional — the specifics)"
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    style={inputStyle}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: refundCancelEvent ? C.red : C.muted2, cursor: 'pointer' }}>
                    <input type="checkbox" checked={refundCancelEvent} onChange={(e) => setRefundCancelEvent(e.target.checked)} />
                    Cancel the event too (releases reservations, stops emails, moves it to Cancelled)
                  </label>
                  <div>
                    <Button
                      tone="danger"
                      disabled={!refundAmount}
                      onClick={async () => {
                        try {
                          const res = await api.refund(
                            data.event.order_id,
                            Math.round(Number(refundAmount) * 100),
                            { reasonCategory: refundCategory, reason: refundReason.trim() || undefined, cancelEvent: refundCancelEvent },
                          );
                          setMessage(`Refund recorded — order is now ${res.status}.${res.eventCancelled ? ' Event cancelled.' : ''} The customer has been emailed.`);
                          setRefundAmount('');
                          setRefundReason('');
                          setRefundCancelEvent(false);
                          load();
                        } catch (e: any) {
                          setMessage(e.message);
                        }
                      }}
                    >
                      Refund
                    </Button>
                  </div>
                </div>
              </Panel>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Event location for the driver/team. The pin comes straight from the
 * customer's Google-Maps placement at checkout. "Directions" and "Open in
 * Maps" are Google's universal deep links — they open the driver's native
 * Google Maps app with turn-by-turn navigation, no API key required.
 */
/** A premium icon + value row for the event header — icon in a soft chip. */
/** One labelled cell in the event's details grid. `span` makes it full-width. */
function InfoCell({ label, value, span }: { label: string; value: React.ReactNode; span?: boolean }) {
  return (
    <div style={{ background: '#fff', padding: '11px 16px', gridColumn: span ? '1 / -1' : undefined, minWidth: 0 }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.5px', textTransform: 'uppercase', color: '#b98aa6' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, marginTop: 3, lineHeight: 1.35, wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  leader: '👑 Event Leader', balloon_artist: '🎈 Balloon Artist', clown: '🤡 Clown',
  face_painting: '🎨 Face Painter', helper: '🧍 Helper', balloon_twisting: '🎈 Balloon Twisting',
  staff: '👷 Staff', acrobat_clown: '🤸 Acrobat Clown', design: '🖌️ Design (Marsha)', driver: '🚐 Driver',
};

/**
 * Smart staff assignment for this event: who the engine put on the crew, and
 * any slot still needing a part-timer. The manager types the part-timer's name
 * to confirm it, or overrides any slot with an internal member.
 */
function StaffingPanel({ eventId }: { eventId: string }) {
  const [plan, setPlan] = useState<any[] | null>(null);
  const [crew, setCrew] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [openOverride, setOpenOverride] = useState<string | null>(null);
  const [manual, setManual] = useState<any[]>([]);

  const load = async () => {
    const [p, m] = await Promise.all([
      api.staffingPlan(eventId).catch(() => []),
      api.staffingRequirements(eventId).catch(() => []),
    ]);
    setPlan(p);
    setManual(m);
  };
  useEffect(() => {
    load();
    api.staffingCrew().then(setCrew).catch(() => setCrew([]));
  }, [eventId]);

  const manualCount = (role: string) => Number(manual.find((x) => x.role === role)?.count ?? 0);
  const addRole = async (role: string, delta: number) => {
    setBusy(true);
    try { setPlan(await api.setStaffingRequirement(eventId, role, Math.max(0, manualCount(role) + delta))); await load(); }
    finally { setBusy(false); }
  };

  const leader = (plan ?? []).find((s) => s.is_leader);
  const slots = (plan ?? []).filter((s) => !s.is_leader);
  const open = slots.filter((s) => s.status === 'part_time_required' || s.status === 'to_confirm').length;

  const reassign = async () => {
    setBusy(true);
    try { await api.assignStaff(eventId); await load(); } finally { setBusy(false); }
  };

  return (
    <Panel
      title="Team assignment 🎭"
      action={<Button tone="ghost" onClick={reassign}>{busy ? 'Assigning…' : 'Re-assign'}</Button>}
    >
      {plan === null ? (
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>Loading the crew…</div>
      ) : plan.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Empty>No staffing plan yet.</Empty>
          <Button onClick={reassign}>{busy ? 'Assigning…' : 'Assign staff'}</Button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {open > 0 && (
            <div style={{ background: '#fdecea', color: C.red, borderRadius: 10, padding: '9px 12px', fontSize: 12, fontWeight: 800, letterSpacing: '.3px' }}>
              ⚠ ACTION REQUIRED — {open} slot{open > 1 ? 's' : ''} need{open > 1 ? '' : 's'} a part-timer
            </div>
          )}

          {leader && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', borderRadius: 10, background: C.pinkSoft, border: `1px solid ${C.pink}` }}>
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 800, color: C.pinkDeep }}>
                👑 Event Leader
                <span style={{ fontWeight: 600, color: C.muted }}>{leader.reason === 'Remote event leader' ? ' · remote' : ''}</span>
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: C.ink }}>{leader.assignee_name ?? '—'}</span>
            </div>
          )}

          {slots.map((s) => {
            const filled = s.status === 'assigned';
            const confirmed = s.status === 'confirmed';
            const needsPart = s.status === 'part_time_required';
            const needsPrep = s.status === 'to_confirm'; // internal prep, no part-time
            return (
              <div key={s.id} style={{ padding: '8px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{ROLE_LABEL[s.role] ?? s.role}</div>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted }}>{s.reason}{s.source && s.source !== 'Leader' ? ` · ${s.source}` : ''}</div>
                  </div>
                  {filled && <Badge tone="ok">{s.assignee_name ?? 'Assigned'}</Badge>}
                  {confirmed && <Badge tone="ok">{s.part_time_name} · part-timer</Badge>}
                  {needsPart && <Badge tone="error">Part-time required</Badge>}
                  {needsPrep && <Badge tone="warn">Confirm internal</Badge>}
                </div>

                {(needsPart) && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                    <input
                      placeholder={`Part-time ${ROLE_LABEL[s.role]?.replace(/^\S+\s/, '') ?? s.role} name…`}
                      value={names[s.id] ?? ''}
                      onChange={(e) => setNames((n) => ({ ...n, [s.id]: e.target.value }))}
                      style={{ ...inputStyle, fontSize: 12 }}
                    />
                    <Button
                      disabled={!(names[s.id] ?? '').trim()}
                      onClick={async () => { setPlan(await api.confirmPartTime(s.id, names[s.id].trim())); }}
                    >
                      Confirm
                    </Button>
                  </div>
                )}

                {(needsPart || needsPrep || filled || confirmed) && (
                  <div style={{ marginTop: 6 }}>
                    {openOverride === s.id ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {crew.map((m) => (
                          <Button key={m.id} tone="ghost"
                            onClick={async () => { setPlan(await api.overrideSlot(s.id, m.id)); setOpenOverride(null); }}>
                            {m.name}
                          </Button>
                        ))}
                        <Button tone="ghost" onClick={() => setOpenOverride(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setOpenOverride(s.id)}
                        style={{ background: 'none', border: 'none', color: C.muted, fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}
                      >
                        ✎ Assign internal instead
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 2 }}>
            Internal crew is assigned automatically by skill, availability and fairness. The customer
            never sees “part-time” — only confirmed names or “to be confirmed”.
          </div>
        </div>
      )}

      {/* Manual roles — for events the engine can't read (e.g. a custom offer). */}
      {plan !== null && (
        <div style={{ borderTop: `1px dashed ${C.line}`, marginTop: 12, paddingTop: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: C.muted, letterSpacing: '.4px', marginBottom: 7 }}>➕ ADD A ROLE MANUALLY</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([['balloon_artist', '🎈 Balloon'], ['clown', '🤡 Clown'], ['face_painting', '🎨 Face Painter'], ['helper', '🧍 Helper'], ['balloon_twisting', '🎈 Twisting'], ['driver', '🚐 Driver']] as [string, string][]).map(([r, label]) => (
              <Button key={r} tone="ghost" onClick={() => addRole(r, +1)}>
                {busy ? '…' : `+ ${label}${manualCount(r) > 0 ? ` (${manualCount(r)})` : ''}`}
              </Button>
            ))}
          </div>
          {manual.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {manual.map((m) => (
                <button key={m.role} onClick={() => addRole(m.role, -1)}
                  style={{ border: `1px solid ${C.line}`, background: C.pinkSoft, color: C.pinkDeep, borderRadius: 20, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  {(ROLE_LABEL[m.role] ?? m.role)} × {m.count} · remove one
                </button>
              ))}
            </div>
          )}
          <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, marginTop: 7, lineHeight: 1.5 }}>
            For a custom offer the engine can't read — e.g. an “AED 2,900 Offer” that needs 1 Balloon Artist + 2 Clowns.
          </div>
        </div>
      )}
    </Panel>
  );
}

const UAE_EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain', 'Al Ain'];

/**
 * Manager/owner edit of a booking's details — date-day time, location, guest-of-
 * honour name and theme. Collapsed by default. A time change safely re-checks and
 * moves the reserved inventory holds on the server.
 */
function EditEventPanel({ event, eventId, onSaved, onMessage }: { event: any; eventId: string; onSaved: () => void; onMessage: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [themes, setThemes] = useState<Array<{ id: string; name: string }>>([]);
  const [eventFor, setEventFor] = useState(event.eventFor ?? '');
  const [emirate, setEmirate] = useState(event.emirate ?? '');
  const [startTime, setStartTime] = useState(event.start_time ?? '');
  const [endTime, setEndTime] = useState(event.base_end_time ?? '');
  const [themeId, setThemeId] = useState(event.theme_id ?? '');
  const [customThemeName, setCustomThemeName] = useState(event.custom_theme ? (event.theme_name ?? '') : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open && themes.length === 0) api.themesList().then((r) => setThemes(r.rows)).catch(() => {}); }, [open]);

  const save = async () => {
    setBusy(true); setErr(null);
    const patch: any = {};
    if (startTime && startTime !== event.start_time) patch.startTime = startTime;
    if (endTime && endTime !== event.base_end_time) patch.endTime = endTime;
    if (emirate && emirate !== event.emirate) patch.emirate = emirate;
    if ((eventFor ?? '') !== (event.eventFor ?? '')) patch.eventFor = eventFor.trim() || null;
    const ct = customThemeName.trim();
    if (ct) {
      if (ct !== (event.custom_theme ? (event.theme_name ?? '') : '')) patch.customThemeName = ct;
    } else if (themeId && themeId !== event.theme_id) {
      patch.themeId = themeId;
    }
    if (Object.keys(patch).length === 0) { setOpen(false); setBusy(false); return; }
    try {
      await api.eventUpdateDetails(eventId, patch);
      onMessage('Booking details updated.');
      setOpen(false);
      onSaved();
    } catch (e: any) { setErr(e?.message ?? 'Could not save.'); } finally { setBusy(false); }
  };

  return (
    <Panel
      title="✏️ Edit details"
      action={<Button tone="ghost" onClick={() => setOpen((o) => !o)}>{open ? 'Close' : 'Edit'}</Button>}
    >
      {!open ? (
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.5 }}>
          Change the time, location, guest-of-honour name or theme. A time change re-checks equipment availability.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={editLbl}>Start time</span>
              <input type="time" value={to24(startTime)} onChange={(e) => setStartTime(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={editLbl}>End time</span>
              <input type="time" value={to24(endTime)} onChange={(e) => setEndTime(e.target.value)} style={inputStyle} />
            </label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={editLbl}>Location (emirate)</span>
            <select value={emirate} onChange={(e) => setEmirate(e.target.value)} style={inputStyle}>
              {!UAE_EMIRATES.includes(emirate) && emirate && <option value={emirate}>{emirate}</option>}
              {UAE_EMIRATES.map((em) => <option key={em} value={em}>{em}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={editLbl}>Guest of honour (baby name)</span>
            <input value={eventFor} onChange={(e) => setEventFor(e.target.value)} style={inputStyle} placeholder="e.g. Sara" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={editLbl}>Theme</span>
            <select value={customThemeName.trim() ? '' : themeId} onChange={(e) => { setThemeId(e.target.value); if (e.target.value) setCustomThemeName(''); }} style={inputStyle}>
              <option value="">— keep current —</option>
              {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={editLbl}>…or type a custom theme</span>
            <input value={customThemeName} onChange={(e) => setCustomThemeName(e.target.value)} style={inputStyle} placeholder="e.g. Jungle Safari" />
          </label>
          {err && <div style={{ color: C.red, fontSize: 12.5, fontWeight: 700 }}>{err}</div>}
          <div><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button></div>
        </div>
      )}
    </Panel>
  );
}

const editLbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: C.muted2 };
/** Coerce a possibly "5:00 PM"/"17:00" string to a 24h "HH:MM" for <input type=time>. */
function to24(t: string): string {
  if (!t) return '';
  if (/^\d{2}:\d{2}$/.test(t)) return t;
  const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return '';
  let h = Number(m[1]); const min = m[2]; const ap = m[3]?.toUpperCase();
  if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}

function PartyDetailsPanel({ event }: { event: any }) {
  const rows: Array<[string, string]> = [];
  if (event.children_count) rows.push(['👶 Children', String(event.children_count)]);
  if (event.movie_id) rows.push(['🎬 Movie', String(event.movie_id)]);
  if (event.custom_theme) rows.push(['🎨 Theme', event.theme_name ? String(event.theme_name) : 'Custom design (see brief / design panel)']);
  else if (event.theme_name) rows.push(['🎨 Theme', String(event.theme_name)]);
  else if (event.theme_id) rows.push(['🎨 Theme', String(event.theme_id)]);
  if (event.castle_variant) rows.push(['🏰 Castle colour', String(event.castle_variant)]);
  if (rows.length === 0) return null;
  return (
    <Panel title="Party details">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>
            <span style={{ color: C.muted, fontWeight: 700 }}>{k}: </span>
            {v}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function LocationPanel({ event }: { event: any }) {
  const pin = event.mapPin as { lat: number; lng: number } | null;
  if (!pin) {
    return (
      <Panel title="Event location">
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>
          {event.emirate ? `${event.emirate} — ` : ''}no exact pin was captured for this booking.
        </div>
      </Panel>
    );
  }
  const q = `${pin.lat},${pin.lng}`;
  const view = `https://www.google.com/maps/search/?api=1&query=${q}`;
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`;
  const embed = `https://maps.google.com/maps?q=${q}&z=16&output=embed`;
  const linkBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none',
    border: `1px solid ${C.line}`, background: '#fff', color: C.ink,
    borderRadius: 10, padding: '8px 13px', fontSize: 12.5, fontWeight: 700,
  };
  return (
    <Panel title="Event location">
      <div style={{ fontSize: 12, fontWeight: 600, color: C.ink, marginBottom: 4 }}>
        📍 {event.emirate ?? 'UAE'}
        <span style={{ color: C.muted, fontWeight: 600 }}> · {q}</span>
      </div>
      {(() => {
        const a = (event.address ?? {}) as Record<string, string>;
        const parts = [a.area, a.street, a.villa && `Villa/House ${a.villa}`]
          .filter(Boolean)
          .join(' · ');
        return parts ? (
          <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 4, lineHeight: 1.5 }}>
            🏠 {parts}
          </div>
        ) : null;
      })()}
      {event.addressDetails && (
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>
          {event.addressDetails}
        </div>
      )}
      <iframe
        title="Event location map"
        src={embed}
        style={{ width: '100%', height: 190, border: 0, borderRadius: 12, marginBottom: 10 }}
        loading="lazy"
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <a href={directions} target="_blank" rel="noreferrer" style={{ ...linkBtn, background: C.pinkSoft, borderColor: C.pink, color: C.pinkDeep }}>
          🧭 Directions
        </a>
        <a href={view} target="_blank" rel="noreferrer" style={linkBtn}>
          Open in Google Maps
        </a>
      </div>
    </Panel>
  );
}

/** Upload a custom-theme design for the customer to approve. */
function DesignPanel({ eventId, designs, onChange }: { eventId: string; designs: any[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const latest = designs[0];
  return (
    <Panel title="Design for approval 🎨">
      {latest && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 12.5 }}>Version {latest.version}</span>
            <Badge tone={latest.status === 'approved' ? 'ok' : latest.status === 'changes_requested' ? 'error' : 'warn'}>
              {String(latest.status).replace('_', ' ')}
            </Badge>
          </div>
          {latest.image_url ? (
            <a href={latest.image_url} target="_blank" rel="noreferrer">
              <img src={latest.image_url} alt="design" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 12, border: `1px solid ${C.line}` }} />
            </a>
          ) : (
            <div style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>No image uploaded yet.</div>
          )}
          {latest.customer_note && (
            <div style={{ fontSize: 12, fontWeight: 600, color: C.red, marginTop: 6 }}>Customer asked: “{latest.customer_note}”</div>
          )}
        </div>
      )}
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: `1px solid ${C.pink}`, background: C.pinkSoft, color: C.pinkDeep, borderRadius: 10, padding: '8px 13px', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
        {busy ? 'Uploading…' : latest?.status === 'changes_requested' ? '📤 Upload new version' : '📤 Upload design'}
        <input
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            try {
              const url = await api.uploadImage(f, 'designs');
              await api.uploadDesign(eventId, url);
              onChange();
            } catch (err: any) {
              alert(err?.message ?? 'Upload failed');
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 8 }}>
        The customer sees this in their app and approves or requests changes.
      </div>
    </Panel>
  );
}

/** Customer's rating and any paid tips for this event. */
function RatingTipsPanel({ rating, tips }: { rating: any; tips: any[] }) {
  const totalTipFils = (tips ?? []).reduce((sum, t) => sum + Number(t.amount_fils), 0);
  return (
    <Panel title="Rating & tips">
      {rating ? (
        <div style={{ marginBottom: tips?.length ? 12 : 0 }}>
          <span style={{ color: C.pinkDeep, fontSize: 17, letterSpacing: 1 }}>
            {'★'.repeat(rating.stars)}
            <span style={{ color: C.line }}>{'★'.repeat(5 - rating.stars)}</span>
          </span>
          {rating.feedback && (
            <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink, marginTop: 6, lineHeight: 1.5 }}>
              “{rating.feedback}”
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>No rating yet.</div>
      )}

      {tips && tips.length > 0 && (
        <div style={{ borderTop: `1px solid ${C.lineSoft}`, paddingTop: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>
            Tips · AED {money(totalTipFils)} total 💐
          </div>
          {tips.map((t) => (
            <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, padding: '3px 0' }}>
              <span style={{ color: C.muted }}>{t.member_name ? `For ${t.member_name}` : 'For the whole team'}</span>
              <span style={{ fontWeight: 700, color: C.pinkDeep }}>AED {t.amountDisplay}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: `1px solid ${C.line}`,
  borderRadius: 12,
  padding: '9px 12px',
  fontSize: 12.5,
  fontWeight: 600,
  outline: 'none',
  background: '#fff',
  color: C.ink,
};
