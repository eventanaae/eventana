import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api';
import { Badge, Button, C, fredoka, Panel, Spinner } from '../ui';
import { Empty } from './Today';

const inp = (w: number | string): CSSProperties => ({
  width: w, boxSizing: 'border-box',
  border: `1px solid ${C.line}`, borderRadius: 10, padding: '9px 11px',
  fontWeight: 600, fontSize: 12.5, outline: 'none',
});

const ISSUE_KINDS: Array<{ id: 'broken' | 'damaged' | 'maintenance' | 'other'; label: string }> = [
  { id: 'broken', label: '🔴 Broken' },
  { id: 'damaged', label: '🟠 Damaged' },
  { id: 'maintenance', label: '🛠️ Needs maintenance' },
  { id: 'other', label: '❔ Other' },
];

export function Inventory({ role }: { role?: string }) {
  const canManage = role === 'owner' || role === 'manager';
  const [assets, setAssets] = useState<any[] | null>(null);
  const [consumables, setConsumables] = useState<any[]>([]);
  const [missing, setMissing] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [crew, setCrew] = useState<any[]>([]);
  const [supplierNames, setSupplierNames] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [nc, setNc] = useState({ name: '', category: 'plates', onHand: '', reorderLevel: '', perGuest: true, supplier: '' });
  const [nm, setNm] = useState({ item: '', quantity: '', supplier: '', location: '', photoUrl: '', assignTo: '' });
  const [report, setReport] = useState<{ code: string; name: string } | null>(null);

  const load = () => {
    void api.inventory().then(setAssets);
    void api.missingItems().then(setMissing).catch(() => setMissing([]));
    void api.me().then((m: any) => setMyId(m?.id ?? null)).catch(() => {});
    void api.supplierNames().then((r) => setSupplierNames(r?.names ?? [])).catch(() => {});
    if (canManage) {
      void api.consumables().then(setConsumables).catch(() => setConsumables([]));
      void api.assetIssues().then(setIssues).catch(() => setIssues([]));
      void api.staffingCrew().then((c) => setCrew((c ?? []).filter((m: any) => m.name))).catch(() => setCrew([]));
    }
  };
  useEffect(load, []);
  if (!assets) return <Spinner />;

  const reportMissing = async () => {
    if (!nm.item.trim()) return;
    await api.reportMissing({ item: nm.item.trim(), quantity: Number(nm.quantity) || 1, supplier: nm.supplier.trim() || undefined, location: nm.location.trim() || undefined, photoUrl: nm.photoUrl || undefined, assignTo: nm.assignTo || undefined });
    setNm({ item: '', quantity: '', supplier: '', location: '', photoUrl: '', assignTo: '' });
    load();
  };
  const addConsumable = async () => {
    if (!nc.name.trim()) return;
    await api.saveConsumable({ name: nc.name.trim(), category: nc.category.trim() || 'general', onHand: Number(nc.onHand) || 0, reorderLevel: Number(nc.reorderLevel) || 0, perGuest: nc.perGuest, supplier: nc.supplier.trim() || undefined });
    setNc({ name: '', category: 'plates', onHand: '', reorderLevel: '', perGuest: true, supplier: '' });
    load();
  };

  const openMissing = missing.filter((m: any) => m.status === 'requested').length;
  const filtered = q.trim()
    ? assets.filter((a) => `${a.name} ${a.variant ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
    : assets;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Report a missing item — front and centre ── */}
      <div style={{ background: '#fff', border: `1px solid ${C.pink}`, borderRadius: 18, overflow: 'hidden' }}>
        <div style={{ height: 5, background: `linear-gradient(90deg,${C.pink},${C.pinkDeep})` }} />
        <div style={{ padding: '15px 17px' }}>
          <div style={{ ...fredoka(15), color: C.ink }}>📢 Report a missing item</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, margin: '4px 0 12px', lineHeight: 1.5 }}>
            Ran out of something, or need it re-ordered? Tell the team — the manager & owner get it instantly.
          </div>
          <datalist id="supplier-suggestions">
            {supplierNames.map((s) => <option key={s} value={s} />)}
          </datalist>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input placeholder="What's missing?" value={nm.item} onChange={(e) => setNm({ ...nm, item: e.target.value })} style={inp('min(220px,55vw)')} />
            <input placeholder="Qty" value={nm.quantity} onChange={(e) => setNm({ ...nm, quantity: e.target.value.replace(/\D/g, '') })} style={inp(64)} />
          </div>
          {/* Supplier + location on their own clear row so they're not missed —
              supplier is a searchable dropdown of who we buy from most. */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
            <input list="supplier-suggestions" placeholder="🏬 Supplier — pick or type" value={nm.supplier} onChange={(e) => setNm({ ...nm, supplier: e.target.value })} style={inp('min(200px,48vw)')} />
            <input placeholder="📍 Location / emirate" value={nm.location} onChange={(e) => setNm({ ...nm, location: e.target.value })} style={inp('min(180px,44vw)')} />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${nm.photoUrl ? C.pink : C.line}`, background: nm.photoUrl ? C.pinkSoft : '#fff', color: nm.photoUrl ? C.pinkDeep : C.ink, borderRadius: 12, padding: '9px 12px', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
              📷 {nm.photoUrl ? 'Photo added ✓' : 'Photo (optional)'}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const url = await api.uploadImage(f, 'reference'); setNm((s) => ({ ...s, photoUrl: url })); } catch (err: any) { alert(err?.message ?? 'Upload failed'); } }} />
            </label>
            {canManage && (
              <select value={nm.assignTo} onChange={(e) => setNm({ ...nm, assignTo: e.target.value })}
                style={{ border: `1px solid ${nm.assignTo ? C.pink : C.line}`, borderRadius: 12, padding: '10px 12px', fontSize: 13, fontWeight: 700, color: nm.assignTo ? C.pinkDeep : C.muted2, background: '#fff', cursor: 'pointer' }}>
                <option value="">Assign to… (optional)</option>
                {crew.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <Button onClick={reportMissing} disabled={!nm.item.trim()}>Report</Button>
          </div>
        </div>
      </div>

      {/* ── Reported missing items — visible to EVERYONE so nobody re-reports or
             re-buys something already handled: who reported it, when, and its
             current status. ── */}
      {missing.filter((m: any) => m.status !== 'received' && m.status !== 'cancelled').length > 0 && (
        <Panel title={`🛒 Reported missing${canManage ? ` — ${openMissing} to action` : ' — status'}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {missing.filter((m: any) => m.status !== 'received' && m.status !== 'cancelled').map((m: any) => (
              <div key={m.id} style={{ borderBottom: `1px solid ${C.lineSoft}`, paddingBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{m.item}{m.quantity > 1 ? ` ×${m.quantity}` : ''}</div>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 2 }}>
                      by {m.reported_by ?? '—'} · {m.created ?? (m.created_at ? String(m.created_at).slice(0, 10) : '')}{m.supplier ? ` · 🏬 ${m.supplier}` : ''}{m.location ? ` · 📍 ${m.location}` : ''}{m.note ? ` · "${m.note}"` : ''}
                    </div>
                    {(m.supplier_phone || m.supplier_email || m.supplier_location) && (
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.pinkDeep, marginTop: 2 }}>
                        {m.supplier_location ? `📍 ${m.supplier_location}` : ''}{m.supplier_phone ? `${m.supplier_location ? ' · ' : ''}📞 ${m.supplier_phone}` : ''}{m.supplier_email ? ` · ✉️ ${m.supplier_email}` : ''}
                      </div>
                    )}
                    {m.assigned_name && (
                      <div style={{ fontSize: 10.5, fontWeight: 800, color: C.pinkDeep, marginTop: 3 }}>
                        → {String(m.assigned_to) === String(myId) ? 'Assigned to you' : `Assigned to ${m.assigned_name}`}
                      </div>
                    )}
                    {m.photo_url && (
                      <a href={m.photo_url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 6 }}>
                        <img src={m.photo_url} alt="reference" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 9, border: `1px solid ${C.line}` }} />
                      </a>
                    )}
                  </div>
                  <Badge tone={m.status === 'requested' ? 'error' : m.status === 'ordered' ? 'warn' : 'ok'}>{m.status}</Badge>
                </div>
                {/* Owner/manager act on any item; the person it's assigned to gets
                    the same buttons. Everyone else just sees the status. */}
                {(canManage || String(m.assigned_to ?? '') === String(myId)) && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {(m.supplier_phone || m.supplier_email) && (
                      <Button style={{ padding: '6px 12px', fontSize: 11 }} onClick={async () => {
                        const r = await api.contactSupplier(m.id).catch(() => null);
                        if (!r) { alert('Failed — please try again.'); return; }
                        if (!r.ok) { alert('No supplier phone/email saved — add it on the Suppliers page.'); return; }
                        if (r.waLink) { window.open(r.waLink, '_blank'); if (r.emailSent) alert('Also emailed the supplier ✅'); }
                        else if (r.emailSent) alert('Order request emailed to the supplier ✅');
                        else alert('This supplier has no WhatsApp number and email isn’t set up — add a phone on the Suppliers page.');
                        load();
                      }}>📩 Request from supplier</Button>
                    )}
                    {m.status !== 'ordered' && <Button tone="ghost" style={{ padding: '6px 12px', fontSize: 11 }} onClick={async () => { await api.setMissingStatus(m.id, 'ordered'); load(); }}>🛒 Ordered</Button>}
                    <Button style={{ padding: '6px 12px', fontSize: 11 }} onClick={async () => { await api.setMissingStatus(m.id, 'received'); load(); }}>✓ Received</Button>
                    <Button tone="ghost" style={{ padding: '6px 12px', fontSize: 11 }} onClick={async () => { await api.setMissingStatus(m.id, 'cancelled'); load(); }}>✕ Cancel</Button>
                    {/* Optional photo — a reference of what's needed, or proof it was bought. */}
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${C.line}`, background: '#fff', color: C.ink, borderRadius: 10, padding: '6px 11px', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
                      📷 {m.photo_url ? 'Change photo' : 'Add photo'}
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const url = await api.uploadImage(f, 'reference'); await api.setMissingPhoto(m.id, url); load(); } catch (err: any) { alert(err?.message ?? 'Upload failed'); } }} />
                    </label>
                    {m.photo_url && <button onClick={async () => { await api.setMissingPhoto(m.id, null); load(); }} style={{ border: 'none', background: 'none', color: C.muted, fontSize: 11, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>Remove</button>}
                  </div>
                )}
                {/* Owner/manager can hand it to a specific person to sort out. */}
                {canManage && (
                  <div style={{ display: 'flex', gap: 7, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.3px', textTransform: 'uppercase', color: C.muted2 }}>Assign to</span>
                    <select value={m.assigned_to ?? ''} onChange={async (e) => { await api.assignMissing(m.id, e.target.value || null); load(); }}
                      style={{ border: `1px solid ${C.line}`, borderRadius: 9, padding: '6px 9px', fontSize: 12, fontWeight: 700, color: C.ink, background: '#fff', cursor: 'pointer' }}>
                      <option value="">— nobody —</option>
                      {crew.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* ── Search ── */}
      <input placeholder="🔍 Search for an item…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inp('100%'), fontSize: 14, padding: '11px 14px' }} />

      {/* ── Durable assets ── */}
      <Panel title={`Durable assets (${filtered.length}${q ? ` of ${assets.length}` : ''}) — machines & inflatables`}>
        {canManage && (
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 14, lineHeight: 1.6 }}>
            Reservation windows include prep, transport, setup, the event, breakdown, return and cleaning — a single asset can block a whole day.
          </div>
        )}
        {filtered.length === 0 ? (
          <Empty>{q ? 'No items match your search.' : 'No assets configured.'}</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((a) => (
              <div key={a.code} style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: C.ink }}>{a.name}{a.variant ? ` · ${a.variant}` : ''}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 2 }}>
                      {a.units} unit{a.units === 1 ? '' : 's'}{canManage ? ` · ${a.reserved} reserved · ${a.held} held` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 'none' }}>
                    <Badge tone={a.status === 'available' ? 'ok' : a.status === 'maintenance' ? 'warn' : 'error'}>{a.status}</Badge>
                    <Button tone="ghost" style={{ padding: '5px 9px', fontSize: 11, color: C.pinkDeep }} onClick={() => setReport({ code: a.code, name: `${a.name}${a.variant ? ` · ${a.variant}` : ''}` })}>⚠ Report</Button>
                    {canManage && (
                      <Button tone="ghost" style={{ padding: '5px 9px', fontSize: 11 }}
                        onClick={async () => { await api.setAsset(a.code, { status: a.status === 'available' ? 'maintenance' : 'available' }); load(); }}>
                        {a.status === 'available' ? 'Hold' : 'Free'}
                      </Button>
                    )}
                  </div>
                </div>
                {canManage && a.upcoming && a.upcoming.length > 0 && (
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.lineSoft}` }}>
                    Next: {a.upcoming.slice(0, 2).map((u: any) => `${u.eventId ?? u.orderId} · ${new Date(u.startsAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`).join('  ·  ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* ── Manager/owner only: open equipment issues (take action) ── */}
      {canManage && (
        <Panel title={`🧰 Equipment issues (${issues.length} open)`}>
          {issues.length === 0 ? (
            <Empty>No open equipment issues. 🎉</Empty>
          ) : issues.map((it) => (
            <div key={it.id} style={{ border: `1px solid ${it.kind === 'broken' ? '#f2c9c2' : C.line}`, borderRadius: 14, padding: '12px 14px', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.ink }}>{it.asset_name} · <span style={{ color: it.kind === 'broken' ? C.red : '#c98a2b' }}>{it.kind}</span></div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 2 }}>
                    by {it.reported_by} · {it.created}{it.note ? ` · "${it.note}"` : ''}
                  </div>
                </div>
                <Badge tone={it.status === 'in_progress' ? 'warn' : 'error'}>{it.status}</Badge>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                {it.status !== 'in_progress' && <Button tone="ghost" style={{ padding: '6px 11px', fontSize: 11 }} onClick={async () => { await api.resolveAssetIssue(it.id, 'in_progress'); load(); }}>Start fixing</Button>}
                <Button style={{ padding: '6px 11px', fontSize: 11 }} onClick={async () => { await api.resolveAssetIssue(it.id, 'resolved'); load(); }}>✓ Resolved</Button>
              </div>
            </div>
          ))}
        </Panel>
      )}

      {/* ── Manager/owner only: consumables management ── */}
      {canManage && (
        <Panel title={`Consumables (${consumables.length}) — plates, cups, cutlery, water`}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 12, lineHeight: 1.6 }}>
            Single-use stock, drawn down automatically when a booking confirms. Restock or adjust below.
          </div>
          {consumables.length === 0 ? (
            <Empty>No consumables yet — add one below.</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {consumables.map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${C.line}`, borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: C.ink }}>{c.name}</span>
                      {c.low_stock && <Badge tone="warn">low</Badge>}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 2 }}>
                      {c.on_hand} {c.unit} · reorder {c.reorder_level} · {c.per_guest ? 'per guest' : c.per_event_qty ? `${c.per_event_qty}/event` : '—'}{c.supplier ? ` · ${c.supplier}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                    <Button tone="ghost" style={{ padding: '6px 10px', fontSize: 11 }} onClick={async () => { await api.adjustConsumable(c.id, 50, 'restock'); load(); }}>+50</Button>
                    <Button tone="ghost" style={{ padding: '6px 10px', fontSize: 11 }} onClick={async () => { await api.adjustConsumable(c.id, -10, 'manual'); load(); }}>−10</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
            <input placeholder="Item name" value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} style={inp(150)} />
            <input placeholder="Category" value={nc.category} onChange={(e) => setNc({ ...nc, category: e.target.value })} style={inp(110)} />
            <input placeholder="On hand" value={nc.onHand} onChange={(e) => setNc({ ...nc, onHand: e.target.value.replace(/\D/g, '') })} style={inp(80)} />
            <input placeholder="Reorder at" value={nc.reorderLevel} onChange={(e) => setNc({ ...nc, reorderLevel: e.target.value.replace(/\D/g, '') })} style={inp(90)} />
            <input placeholder="Supplier" value={nc.supplier} onChange={(e) => setNc({ ...nc, supplier: e.target.value })} style={inp(120)} />
            <label style={{ fontSize: 12, fontWeight: 600, display: 'flex', gap: 5, alignItems: 'center' }}>
              <input type="checkbox" checked={nc.perGuest} onChange={(e) => setNc({ ...nc, perGuest: e.target.checked })} /> per guest
            </label>
            <Button onClick={addConsumable}>Add item</Button>
          </div>
        </Panel>
      )}

      {/* Missing-items actions now live inline in the "Reported missing" list at
          the top — one place, no separate buried panel. */}

      {/* ── Report-issue modal ── */}
      {report && <ReportModal target={report} onClose={() => setReport(null)} onDone={() => { setReport(null); load(); }} />}
    </div>
  );
}

function ReportModal({ target, onClose, onDone }: { target: { code: string; name: string }; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<'broken' | 'damaged' | 'maintenance' | 'other'>('broken');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await api.reportAsset(target.code, kind, note.trim() || undefined); onDone(); }
    catch { setBusy(false); }
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(40,20,35,.4)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px,100%)', background: '#fff', borderRadius: 18, padding: 20 }}>
        <div style={{ ...fredoka(16), color: C.ink }}>Report an issue</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.pinkDeep, margin: '4px 0 14px' }}>{target.name}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          {ISSUE_KINDS.map((k) => (
            <button key={k.id} onClick={() => setKind(k.id)} style={{
              border: `1.5px solid ${kind === k.id ? C.pink : C.line}`, background: kind === k.id ? C.pinkSoft : '#fff',
              color: kind === k.id ? C.pinkDeep : C.ink, fontWeight: 700, fontSize: 12.5, padding: '10px 8px', borderRadius: 12, cursor: 'pointer',
            }}>{k.label}</button>
          ))}
        </div>
        <textarea placeholder="What happened? (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={3}
          style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 12px', fontSize: 13, fontWeight: 600, outline: 'none', resize: 'vertical', marginBottom: 12 }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button tone="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Sending…' : 'Send report'}</Button>
        </div>
      </div>
    </div>
  );
}
