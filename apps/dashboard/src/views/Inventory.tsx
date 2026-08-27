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
  const [q, setQ] = useState('');
  const [nc, setNc] = useState({ name: '', category: 'plates', onHand: '', reorderLevel: '', perGuest: true, supplier: '' });
  const [nm, setNm] = useState({ item: '', quantity: '', supplier: '' });
  const [report, setReport] = useState<{ code: string; name: string } | null>(null);

  const load = () => {
    void api.inventory().then(setAssets);
    void api.missingItems().then(setMissing).catch(() => setMissing([]));
    if (canManage) {
      void api.consumables().then(setConsumables).catch(() => setConsumables([]));
      void api.assetIssues().then(setIssues).catch(() => setIssues([]));
    }
  };
  useEffect(load, []);
  if (!assets) return <Spinner />;

  const reportMissing = async () => {
    if (!nm.item.trim()) return;
    await api.reportMissing({ item: nm.item.trim(), quantity: Number(nm.quantity) || 1, supplier: nm.supplier.trim() || undefined });
    setNm({ item: '', quantity: '', supplier: '' });
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input placeholder="What's missing?" value={nm.item} onChange={(e) => setNm({ ...nm, item: e.target.value })} style={inp('min(220px,55vw)')} />
            <input placeholder="Qty" value={nm.quantity} onChange={(e) => setNm({ ...nm, quantity: e.target.value.replace(/\D/g, '') })} style={inp(64)} />
            <input placeholder="Supplier (optional)" value={nm.supplier} onChange={(e) => setNm({ ...nm, supplier: e.target.value })} style={inp('min(160px,40vw)')} />
            <Button onClick={reportMissing} disabled={!nm.item.trim()}>Report</Button>
          </div>
        </div>
      </div>

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

      {/* ── Manager/owner only: missing items — take action ── */}
      {canManage && (
        <Panel title={`Missing items (${openMissing} open)`}>
          {missing.length === 0 ? (
            <Empty>No missing items reported.</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {missing.map((m: any) => (
                <div key={m.id} style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: C.ink }}>{m.item} <span style={{ fontWeight: 600, color: C.muted }}>×{m.quantity}</span></div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 2 }}>{m.reported_by ? `by ${m.reported_by}` : ''}{m.supplier ? ` · ${m.supplier}` : ''}</div>
                    </div>
                    <Badge tone={m.status === 'received' ? 'ok' : m.status === 'cancelled' ? 'error' : 'warn'}>{m.status}</Badge>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    {['ordered', 'received', 'cancelled'].map((s) => (
                      <Button key={s} tone="ghost" style={{ padding: '6px 11px', fontSize: 11 }} onClick={async () => { await api.setMissingStatus(m.id, s); load(); }}>{s}</Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

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
