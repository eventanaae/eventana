import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api';
import { Badge, Button, C, Panel, Spinner, Td, Th } from '../ui';
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
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Asset</Th>
              <Th width={110}>Variant</Th>
              <Th width={70}>Units</Th>
              <Th width={90}>Reserved</Th>
              <Th width={70}>Held</Th>
              <Th width={150}>Buffers</Th>
              <Th width={120}>Status</Th>
              <Th width={190}>Next commitments</Th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.code}>
                <Td style={{ color: C.ink, fontWeight: 700 }}>{a.name}</Td>
                <Td>{a.variant ?? '—'}</Td>
                <Td>{a.units}</Td>
                <Td>{a.reserved}</Td>
                <Td>{a.held}</Td>
                <Td>−{a.buffer_before_minutes}m / +{a.buffer_after_minutes}m</Td>
                <Td>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Badge tone={a.status === 'available' ? 'ok' : a.status === 'maintenance' ? 'warn' : 'error'}>
                      {a.status}
                    </Badge>
                    <Button
                      tone="ghost"
                      style={{ padding: '5px 9px', fontSize: 11 }}
                      onClick={async () => {
                        await api.setAsset(a.code, {
                          status: a.status === 'available' ? 'maintenance' : 'available',
                        });
                        load();
                      }}
                    >
                      {a.status === 'available' ? 'Hold' : 'Free'}
                    </Button>
                  </div>
                </Td>
                <Td>
                  {!a.upcoming || a.upcoming.length === 0 ? (
                    <span style={{ color: C.muted }}>Free</span>
                  ) : (
                    a.upcoming.slice(0, 2).map((u: any, i: number) => (
                      <div key={i} style={{ fontSize: 11 }}>
                        {u.eventId ?? u.orderId} ·{' '}
                        {new Date(u.startsAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                      </div>
                    ))
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {assets.length === 0 && <Empty>No assets configured.</Empty>}
      </Panel>

      {/* ---------------- consumables ---------------- */}
      <Panel title={`Consumables (${consumables.length}) — plates, cups, cutlery, water`}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 12, lineHeight: 1.6 }}>
          Single-use stock, drawn down automatically when a booking confirms (per-guest items draw the
          head count). Restock or manually adjust below.
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th width={90}>Category</Th>
              <Th width={110}>On hand</Th>
              <Th width={80}>Reorder</Th>
              <Th width={100}>Auto-draw</Th>
              <Th width={120}>Supplier</Th>
              <Th width={150}>Adjust</Th>
            </tr>
          </thead>
          <tbody>
            {consumables.map((c) => (
              <tr key={c.id}>
                <Td style={{ color: C.ink, fontWeight: 700 }}>{c.name}</Td>
                <Td>{c.category}</Td>
                <Td>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span>{c.on_hand} {c.unit}</span>
                    {c.low_stock && <Badge tone="warn">low</Badge>}
                  </div>
                </Td>
                <Td>{c.reorder_level}</Td>
                <Td>{c.per_guest ? 'per guest' : c.per_event_qty ? `${c.per_event_qty}/event` : '—'}</Td>
                <Td>{c.supplier ?? '—'}</Td>
                <Td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button tone="ghost" style={{ padding: '5px 9px', fontSize: 11 }} onClick={async () => { await api.adjustConsumable(c.id, 50, 'restock'); load(); }}>+50</Button>
                    <Button tone="ghost" style={{ padding: '5px 9px', fontSize: 11 }} onClick={async () => { await api.adjustConsumable(c.id, -10, 'manual'); load(); }}>−10</Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {consumables.length === 0 && <Empty>No consumables yet — add one below.</Empty>}
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
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th width={60}>Qty</Th>
              <Th width={120}>Supplier</Th>
              <Th width={110}>Status</Th>
              <Th width={210}>Action</Th>
            </tr>
          </thead>
          <tbody>
            {missing.map((m: any) => (
              <tr key={m.id}>
                <Td style={{ color: C.ink, fontWeight: 700 }}>{m.item}</Td>
                <Td>{m.quantity}</Td>
                <Td>{m.supplier ?? '—'}</Td>
                <Td>
                  <Badge tone={m.status === 'received' ? 'ok' : m.status === 'cancelled' ? 'error' : 'warn'}>
                    {m.status}
                  </Badge>
                </Td>
                <Td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {['ordered', 'received', 'cancelled'].map((s) => (
                      <Button key={s} tone="ghost" style={{ padding: '5px 9px', fontSize: 11 }} onClick={async () => { await api.setMissingStatus(m.id, s); load(); }}>
                        {s}
                      </Button>
                    ))}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {missing.length === 0 && <Empty>No missing items reported.</Empty>}
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
