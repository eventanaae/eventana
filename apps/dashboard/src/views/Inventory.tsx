import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api';
import { Badge, Button, C, Panel, Spinner } from '../ui';
import { Empty } from './Today';

const inp = (w: number): CSSProperties => ({
  width: w,
  border: `1px solid ${C.line}`,
  borderRadius: 10,
  padding: '9px 11px',
  fontWeight: 600,
  fontSize: 12.5,
  outline: 'none',
});

export function Inventory() {
  const [assets, setAssets] = useState<any[] | null>(null);
  const [consumables, setConsumables] = useState<any[] | null>(null);
  const [missing, setMissing] = useState<any[] | null>(null);

  const [nc, setNc] = useState({
    name: '', category: 'plates', onHand: '', reorderLevel: '', perGuest: true, supplier: '',
  });
  const [nm, setNm] = useState({ item: '', quantity: '', supplier: '' });

  const load = () => {
    void api.inventory().then(setAssets);
    void api.consumables().then(setConsumables);
    void api.missingItems().then(setMissing);
  };
  useEffect(load, []);

  if (!assets || !consumables || !missing) return <Spinner />;

  const addConsumable = async () => {
    if (!nc.name.trim()) return;
    await api.saveConsumable({
      name: nc.name.trim(),
      category: nc.category.trim() || 'general',
      onHand: Number(nc.onHand) || 0,
      reorderLevel: Number(nc.reorderLevel) || 0,
      perGuest: nc.perGuest,
      supplier: nc.supplier.trim() || undefined,
    });
    setNc({ name: '', category: 'plates', onHand: '', reorderLevel: '', perGuest: true, supplier: '' });
    load();
  };

  const reportMissing = async () => {
    if (!nm.item.trim()) return;
    await api.reportMissing({
      item: nm.item.trim(),
      quantity: Number(nm.quantity) || 1,
      supplier: nm.supplier.trim() || undefined,
    });
    setNm({ item: '', quantity: '', supplier: '' });
    load();
  };

  const openMissing = missing.filter((m: any) => m.status === 'requested').length;

  return (
    <>
      {/* ---------------- durable assets ---------------- */}
      <Panel title={`Durable assets (${assets.length}) — machines & inflatables`}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 14, lineHeight: 1.6 }}>
          Reservation windows include prep, transport, setup, the event, breakdown, return and cleaning —
          not just the customer’s four hours. That is why a single asset can block a whole day.
        </div>
        {assets.length === 0 ? (
          <Empty>No assets configured.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {assets.map((a) => (
              <div key={a.code} style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: C.ink }}>{a.name}{a.variant ? ` · ${a.variant}` : ''}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 2 }}>
                      {a.units} unit{a.units === 1 ? '' : 's'} · {a.reserved} reserved · {a.held} held · buffers −{a.buffer_before_minutes}m/+{a.buffer_after_minutes}m
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 'none' }}>
                    <Badge tone={a.status === 'available' ? 'ok' : a.status === 'maintenance' ? 'warn' : 'error'}>{a.status}</Badge>
                    <Button tone="ghost" style={{ padding: '5px 9px', fontSize: 11 }}
                      onClick={async () => { await api.setAsset(a.code, { status: a.status === 'available' ? 'maintenance' : 'available' }); load(); }}>
                      {a.status === 'available' ? 'Hold' : 'Free'}
                    </Button>
                  </div>
                </div>
                {a.upcoming && a.upcoming.length > 0 && (
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.lineSoft}` }}>
                    Next: {a.upcoming.slice(0, 2).map((u: any) => `${u.eventId ?? u.orderId} · ${new Date(u.startsAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`).join('  ·  ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* ---------------- consumables ---------------- */}
      <Panel title={`Consumables (${consumables.length}) — plates, cups, cutlery, water`}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 12, lineHeight: 1.6 }}>
          Single-use stock, drawn down automatically when a booking confirms (per-guest items draw the
          head count). Restock or manually adjust below.
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

      {/* ---------------- missing items ---------------- */}
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
                    {m.supplier && <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 2 }}>{m.supplier}</div>}
                  </div>
                  <Badge tone={m.status === 'received' ? 'ok' : m.status === 'cancelled' ? 'error' : 'warn'}>{m.status}</Badge>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  {['ordered', 'received', 'cancelled'].map((s) => (
                    <Button key={s} tone="ghost" style={{ padding: '6px 11px', fontSize: 11 }} onClick={async () => { await api.setMissingStatus(m.id, s); load(); }}>
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          <input placeholder="Item" value={nm.item} onChange={(e) => setNm({ ...nm, item: e.target.value })} style={inp(160)} />
          <input placeholder="Qty" value={nm.quantity} onChange={(e) => setNm({ ...nm, quantity: e.target.value.replace(/\D/g, '') })} style={inp(70)} />
          <input placeholder="Supplier" value={nm.supplier} onChange={(e) => setNm({ ...nm, supplier: e.target.value })} style={inp(120)} />
          <Button onClick={reportMissing}>Report</Button>
        </div>
      </Panel>
    </>
  );
}
