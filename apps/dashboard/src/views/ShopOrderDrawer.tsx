import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api';
import { Badge, Button, C, fredoka, Panel, Spinner } from '../ui';

/**
 * Shop order fulfilment — a printed / digital goods order (no party, no
 * delivery crew). Marsha uploads the finished design; the Owner approves and it
 * is emailed to the customer on the agreed template. Internal until sent.
 */
export function ShopOrderDrawer({ orderId, role, onClose }: { orderId: string; role?: string; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const canApprove = role === 'owner' || role === 'manager';

  const load = () => api.shopOrder(orderId).then(setD).catch(() => setD({ error: true }));
  useEffect(() => { load(); }, [orderId]);

  const design = d?.design ?? { status: 'awaiting_design' };
  const fmtDate = (s: string) => (s ? new Date(s).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '—');

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(59,54,65,.4)', zIndex: 20, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(600px, 100vw)', background: C.bg, height: '100vh', overflowY: 'auto', padding: 18 }}>
        {!d ? <Spinner /> : d.error ? (
          <Panel><div style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>Couldn’t load this order.</div></Panel>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ ...fredoka(18), color: '#6B4E9E' }}>🛍️ {d.itemsLabel}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginTop: 3 }}>{d.id}</div>
              </div>
              <Button tone="ghost" onClick={onClose}>Close</Button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Panel title="Order">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 12.5 }}>
                  <Row label="👤 Customer" value={d.customer?.name} />
                  {d.customer?.phone && (
                    <Row label="📞 Call" value={<a href={`tel:${String(d.customer.phone).replace(/[^\d+]/g, '')}`} style={{ color: '#8a6cc0', fontWeight: 700, textDecoration: 'none' }}>{d.customer.phone}</a>} />
                  )}
                  {d.customer?.email && (
                    <Row label="✉️ Email" value={<a href={`mailto:${d.customer.email}`} style={{ color: C.ink, fontWeight: 600, textDecoration: 'none', wordBreak: 'break-word' }}>{d.customer.email}</a>} />
                  )}
                  <Row label="📦 Deliver by" value={fmtDate(d.readyBy)} />
                  {d.items?.map((i: any, idx: number) => (
                    <Row key={idx} label={idx === 0 ? '🎁 Items' : ''} value={`${i.quantity > 1 ? `${i.quantity}× ` : ''}${i.name}`} />
                  ))}
                  {d.totalDisplay && <Row label="💰 Total" value={`AED ${d.totalDisplay}`} />}
                </div>
                {Array.isArray(d.customization?.refImages) && d.customization.refImages.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 5 }}>📎 Customer reference</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {d.customization.refImages.map((u: string, i: number) => (
                        <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt="ref" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: `1px solid ${C.line}` }} /></a>
                      ))}
                    </div>
                  </div>
                )}
              </Panel>

              {/* Design workflow — Marsha uploads, Owner approves & sends. */}
              <Panel title="Design 🎨"
                action={<Badge tone={design.status === 'sent' ? 'ok' : design.status === 'design_ready' ? 'info' : 'warn'}>
                  {design.status === 'sent' ? 'Sent to customer' : design.status === 'design_ready' ? 'Ready — awaiting approval' : 'Awaiting design'}
                </Badge>}>
                {design.imageUrl ? (
                  <a href={design.imageUrl} target="_blank" rel="noreferrer">
                    <img src={design.imageUrl} alt="design" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 12, border: `1px solid ${C.line}` }} />
                  </a>
                ) : (
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted }}>Marsha hasn’t uploaded the design yet.</div>
                )}
                {design.uploadedBy && (
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, marginTop: 6 }}>
                    Uploaded by {design.uploadedBy}{design.sentAt ? ` · sent ${new Date(design.sentAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}` : ''}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: `1px solid ${C.pink}`, background: C.pinkSoft, color: C.pinkDeep, borderRadius: 10, padding: '8px 13px', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
                    {busy ? 'Uploading…' : design.imageUrl ? '📤 Replace design' : '📤 Upload design'}
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                      const f = e.target.files?.[0]; if (!f) return;
                      setBusy(true); setMsg(null);
                      try { const url = await api.uploadImage(f, 'designs'); await api.shopUploadDesign(orderId, url); await load(); setMsg('Design uploaded — ready for approval.'); }
                      catch (err: any) { setMsg(err?.message ?? 'Upload failed'); } finally { setBusy(false); }
                    }} />
                  </label>

                  {canApprove && design.imageUrl && design.status !== 'sent' && (
                    <Button disabled={busy} onClick={async () => {
                      setBusy(true); setMsg(null);
                      try { await api.shopSendDesign(orderId); await load(); setMsg('Approved — the design is on its way to the customer by email. 💌'); }
                      catch (err: any) { setMsg(err?.message ?? 'Failed'); } finally { setBusy(false); }
                    }}>✓ Approve &amp; send to customer</Button>
                  )}
                  {design.status === 'sent' && canApprove && (
                    <Button tone="ghost" disabled={busy} onClick={async () => { setBusy(true); try { await api.shopSendDesign(orderId); await load(); setMsg('Re-sent to the customer.'); } finally { setBusy(false); } }}>↻ Re-send</Button>
                  )}
                </div>
                {msg && <div style={{ marginTop: 10, background: C.greenSoft, color: C.green, padding: '9px 12px', borderRadius: 10, fontSize: 12, fontWeight: 700 }}>{msg}</div>}
                <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>
                  Marsha uploads the finished design here. Once you approve, it’s emailed to the customer automatically on the Eventana template. No delivery crew — it’s a digital/printed item.
                </div>
              </Panel>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, minWidth: 92 }}>{label}</span>
      <span style={{ flex: 1, fontWeight: 600, color: C.ink }}>{value}</span>
    </div>
  );
}
