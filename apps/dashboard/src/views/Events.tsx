import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, Button, C, fredoka, money, Panel, Spinner, Td, Th } from '../ui';
import { Empty } from './Today';

const PHASES = [
  'Booking Confirmed', 'Preparing', 'On The Way', 'Arrived',
  'Setting Up', 'Setup Ready', 'Party Started', 'Event Completed',
];

export function Events() {
  const [events, setEvents] = useState<any[] | null>(null);
  const [needsReview, setNeedsReview] = useState<any[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = () => {
    api.events().then(setEvents);
    api.needsReview().then(setNeedsReview).catch(() => setNeedsReview([]));
  };
  useEffect(load, []);

  if (!events) return <Spinner />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {needsReview.length > 0 && (
        <Panel title="Needs review" style={{ borderColor: '#f2c9c2' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 12, lineHeight: 1.6 }}>
            These orders were held back by the engine rather than confirmed — an amount mismatch, or a
            payment that succeeded after the inventory hold expired. A person decides what happens next.
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th width={160}>Order</Th>
                <Th width={110}>Value</Th>
                <Th>Reason</Th>
              </tr>
            </thead>
            <tbody>
              {needsReview.map((o) => (
                <tr key={o.id}>
                  <Td style={{ fontFamily: 'ui-monospace, monospace', color: C.ink }}>{o.id}</Td>
                  <Td style={{ fontWeight: 700, color: C.ink }}>AED {o.totalDisplay}</Td>
                  <Td>{o.last_note}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <Panel title={`All events (${events.length})`}>
        {events.length === 0 ? (
          <Empty>No bookings yet. Complete a checkout in the customer app to see one here.</Empty>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th width={140}>Event ID</Th>
                <Th>Customer</Th>
                <Th width={150}>When</Th>
                <Th width={120}>Emirate</Th>
                <Th width={130}>Phase</Th>
                <Th width={110}>Payment</Th>
                <Th width={110}>Value</Th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} onClick={() => setOpenId(e.id)} style={{ cursor: 'pointer' }}>
                  <Td style={{ fontFamily: 'ui-monospace, monospace', color: C.ink }}>{e.id}</Td>
                  <Td>
                    {e.customer}
                    <div style={{ fontSize: 10.5, color: C.muted }}>{e.phone}</div>
                  </Td>
                  <Td>
                    {new Date(e.event_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    <div style={{ fontSize: 10.5, color: C.muted }}>
                      {e.start_time}–{e.base_end_time}
                    </div>
                  </Td>
                  <Td>{e.emirate}</Td>
                  <Td>
                    <Badge tone={e.phase === 'Cancelled' ? 'error' : 'info'}>{e.phase}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={e.order_status === 'paid' ? 'ok' : e.order_status === 'needs_review' ? 'error' : 'warn'}>
                      {e.order_status}
                    </Badge>
                  </Td>
                  <Td style={{ fontWeight: 700, color: C.ink }}>AED {e.totalDisplay}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {openId && <EventDrawer eventId={openId} onClose={() => { setOpenId(null); load(); }} />}
    </div>
  );
}

function EventDrawer({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [reply, setReply] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const d = await api.event(eventId);
    setData(d);
    if (d.event.order_id) setAudit(await api.audit(d.event.order_id).catch(() => []));
  };
  useEffect(() => { load(); }, [eventId]);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(59,54,65,.4)', zIndex: 20, display: 'flex', justifyContent: 'flex-end' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 640, maxWidth: '92vw', background: C.bg, height: '100vh', overflowY: 'auto', padding: 22 }}
      >
        {!data ? (
          <Spinner />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 18 }}>
              <div style={{ flex: 1 }}>
                <div style={fredoka(20)}>{data.event.id}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginTop: 2 }}>
                  {data.event.customer} · {data.event.phone} ·{' '}
                  {new Date(data.event.event_date).toDateString()} · {data.event.start_time}–
                  {data.event.base_end_time}
                </div>
              </div>
              <Button tone="ghost" onClick={onClose}>Close</Button>
            </div>

            {message && (
              <div style={{ background: C.greenSoft, color: C.green, padding: '10px 14px', borderRadius: 12, fontSize: 12, fontWeight: 700, marginBottom: 14 }}>
                {message}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Panel title="Advance status">
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
                    <Button
                      tone="ghost"
                      onClick={async () => {
                        await api.reinstateEvent(eventId);
                        setMessage('Event reinstated — re-check inventory availability.');
                        load();
                      }}
                    >
                      Reinstate event
                    </Button>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {PHASES.map((p) => (
                        <Button
                          key={p}
                          tone={data.event.phase === p ? 'primary' : 'ghost'}
                          onClick={async () => {
                            await api.setPhase(eventId, p, p === 'On The Way' ? '4:35 PM' : undefined);
                            load();
                          }}
                        >
                          {p}
                        </Button>
                      ))}
                    </div>
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

              <Panel title="Booked services">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr><Th>Item</Th><Th width={70}>Qty</Th><Th width={110}>Source</Th><Th width={110}>Value</Th></tr>
                  </thead>
                  <tbody>
                    {data.services.map((s: any) => (
                      <tr key={s.id}>
                        <Td style={{ color: C.ink }}>{s.label}</Td>
                        <Td>{s.quantity}</Td>
                        <Td>
                          <Badge tone={s.source === 'addon' ? 'info' : 'neutral'}>{s.source}</Badge>
                        </Td>
                        <Td>{s.amount_fils > 0 ? `AED ${money(Number(s.amount_fils))}` : '—'}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>

              <Panel title="Reserved inventory">
                {data.reservations.length === 0 ? (
                  <Empty>No physical assets reserved.</Empty>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr><Th>Asset</Th><Th>Window (incl. buffers)</Th><Th width={100}>Status</Th></tr>
                    </thead>
                    <tbody>
                      {data.reservations.map((r: any) => (
                        <tr key={r.id}>
                          <Td style={{ color: C.ink }}>
                            {r.name}{r.variant ? ` · ${r.variant}` : ''}
                          </Td>
                          <Td>
                            {new Date(r.starts_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            {' → '}
                            {new Date(r.ends_at).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                          </Td>
                          <Td><Badge tone={r.status === 'reserved' ? 'ok' : 'warn'}>{r.status}</Badge></Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Panel>

              <Panel title="Tasks by department">
                {['design', 'operations', 'inventory', 'logistics', 'finance'].map((dept) => {
                  const items = data.tasks.filter((t: any) => t.department === dept);
                  if (items.length === 0) return null;
                  return (
                    <div key={dept} style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '.5px', marginBottom: 6 }}>
                        {dept.toUpperCase()}
                      </div>
                      {items.map((t: any) => (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                          <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? C.muted : C.ink }}>
                            {t.title}
                          </span>
                          <Button
                            tone="ghost"
                            onClick={async () => {
                              await api.setTask(t.id, t.status === 'done' ? 'open' : 'done');
                              load();
                            }}
                          >
                            {t.status === 'done' ? 'Reopen' : 'Done'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </Panel>

              <Panel title="Setup placement notes">
                {data.setupPhotos.length === 0 ? (
                  <Empty>The customer didn’t add placement notes — that’s optional.</Empty>
                ) : (
                  data.setupPhotos.map((p: any) => (
                    <div key={p.id} style={{ fontSize: 12.5, fontWeight: 600, padding: '4px 0' }}>
                      <b style={{ textTransform: 'capitalize' }}>{p.item_key}</b>: {p.description ?? '(photo only)'}
                    </div>
                  ))
                )}
              </Panel>

              <Panel
                title="Customer messages"
                action={
                  <Button
                    tone="ghost"
                    onClick={async () => {
                      await api.setChat(eventId, !data.event.chat_open);
                      load();
                    }}
                  >
                    {data.event.chat_open ? 'Close chat' : 'Open chat'}
                  </Button>
                }
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
              </Panel>

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

              <Panel title="Refund">
                <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 10, lineHeight: 1.6 }}>
                  Refunds can only be started here, by a staff account. The status is set from the
                  provider’s response — never optimistically. A full refund releases the reservations
                  and cancels the scheduled emails.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    placeholder="Amount in AED"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value.replace(/[^\d.]/g, ''))}
                    style={{ ...inputStyle, width: 140, flex: 'none' }}
                  />
                  <input
                    placeholder="Reason (required)"
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    style={inputStyle}
                  />
                  <Button
                    tone="danger"
                    disabled={!refundAmount || !refundReason.trim()}
                    onClick={async () => {
                      try {
                        const res = await api.refund(
                          data.event.order_id,
                          Math.round(Number(refundAmount) * 100),
                          refundReason.trim(),
                        );
                        setMessage(`Refund recorded — order is now ${res.status}.`);
                        setRefundAmount('');
                        setRefundReason('');
                        load();
                      } catch (e: any) {
                        setMessage(e.message);
                      }
                    }}
                  >
                    Refund
                  </Button>
                </div>
              </Panel>
            </div>
          </>
        )}
      </div>
    </div>
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
