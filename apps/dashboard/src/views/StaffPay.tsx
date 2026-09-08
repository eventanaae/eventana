import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, fredoka, Panel, Spinner, Badge, Button } from '../ui';
import { Empty } from './Today';

/**
 * Part-timer & driver tracker (owner/manager). This month's clown/face-paint
 * engagements with amounts + per-person totals, and the driver deliveries.
 * Also emailed to the owner + Marsha on the 1st of each month.
 */
// "Pay" a part-timer or driver for the month: enter the amount, record it, and
// (when WhatsApp is on) message them their summary. Shows "Paid ✓" after.
function PayButton({ kind, name, suggestedFils, month, paid, paidDisplay, onPaid }: {
  kind: 'part_timer' | 'driver'; name: string; suggestedFils: number; month?: string; paid: boolean; paidDisplay: string | null; onPaid: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (paid) return <span style={{ fontSize: 11.5, fontWeight: 800, color: C.green }}>✓ Paid {paidDisplay}</span>;
  return (
    <Button disabled={busy} onClick={async () => {
      const cur = suggestedFils ? String(suggestedFils / 100) : '';
      const v = prompt(`Amount paid to ${name} (AED):`, cur);
      if (v == null) return;
      const fils = Math.round(Number(v) * 100);
      if (!Number.isFinite(fils) || fils < 0) { alert('Enter a valid amount.'); return; }
      setBusy(true);
      try {
        const r = await api.markStaffPaid({ kind, name, amountFils: fils, month });
        onPaid();
        if (r?.summary) {
          const msg = r.whatsappSent ? 'Paid ✓ — WhatsApp sent to them.' : 'Paid ✓\n\nWhatsApp isn’t live yet — copy their summary to send manually?';
          if (r.whatsappSent) { alert(msg); }
          else if (confirm(msg)) { try { await navigator.clipboard.writeText(r.summary); } catch (_) { alert(r.summary); } }
        }
      } catch (e: any) { alert(e?.message ?? 'Could not record the payment.'); }
      finally { setBusy(false); }
    }} style={{ padding: '5px 12px', fontSize: 11.5 }}>💵 Pay</Button>
  );
}

export function StaffPay() {
  const [data, setData] = useState<any>(null);
  const reload = () => api.staffPayReport().then(setData).catch(() => setData({ partTimers: [], drivers: [] }));
  useEffect(() => { reload(); }, []);
  if (!data) return <Spinner />;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ ...fredoka(20) }}>🤡🚐 Part-timers & Drivers</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.muted, marginTop: 2 }}>{data.monthLabel} · emailed to you & Marsha on the 1st</div>
      </div>

      <Panel title="🤡 Part-timers" action={<Badge tone="info">total {data.partTimerTotalDisplay ?? '—'}</Badge>}>
        {(!data.partTimers || data.partTimers.length === 0) ? (
          <Empty>No part-timer engagements this month.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.partTimers.map((p: any) => (
              <div key={p.name} style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: '11px 13px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: C.ink, flex: 1 }}>{p.name}{p.phone ? '' : ' ⚠️'}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.pinkDeep }}>{p.totalDisplay}</span>
                  <PayButton kind="part_timer" name={p.name} suggestedFils={p.totalFils} month={data.month} paid={p.paid} paidDisplay={p.paidDisplay} onPaid={reload} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
                  {p.entries.map((e: any, i: number) => (
                    <div key={i} style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>
                      {fmtDate(e.date)} · {e.job} · 📍 {e.emirate} · <span style={{ color: C.ink, fontWeight: 700 }}>{e.amountDisplay}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="🚐 Deliveries" action={<Badge tone="info">total {data.deliveryTotalDisplay ?? '—'}</Badge>}>
        <DeliveryForm onAdded={reload} />
        {(!data.drivers || data.drivers.length === 0) ? (
          <Empty>No deliveries this month.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {data.drivers.map((d: any) => <DeliveryRow key={d.id} d={d} onChange={reload} />)}
          </div>
        )}
      </Panel>

      {data.driverPayouts && data.driverPayouts.length > 0 && (
        <Panel title="💵 Driver payouts">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.driverPayouts.map((d: any) => (
              <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${C.line}`, borderRadius: 11, padding: '9px 12px' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, flex: 1 }}>{d.name}{d.phone ? '' : ' ⚠️'}</span>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: C.muted }}>{d.count} trip{d.count > 1 ? 's' : ''}</span>
                <PayButton kind="driver" name={d.name} suggestedFils={d.suggestedFils} month={data.month} paid={d.paid} paidDisplay={d.paidDisplay} onPaid={reload} />
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.muted2, marginTop: 8 }}>The suggested amount is the delivery total — you type the actual amount you transfer.</div>
        </Panel>
      )}

      <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted2, padding: '0 4px' }}>
        Clown = AED 200 · Face painting = AED 350. Delivery price = truck size × emirate (you can edit any price). ⚠️ = no phone on file yet. Paying sends them their monthly summary on WhatsApp (once the template is approved) — meanwhile you can copy it.
      </div>
    </div>
  );
}

const EMIRATES = ['Dubai', 'Sharjah', 'Ajman', 'Abu Dhabi', 'Ras Al Khaimah', 'Fujairah', 'Khorfakkan', 'Al Ain', 'Umm Al Quwain'];
const DRIVERS = [
  { name: 'Ubaid', type: 'own_van' }, { name: 'Majeed', type: 'own_van' },
  { name: 'Ali', type: 'external' }, { name: 'Rashid', type: 'external' }, { name: 'Rana Rashid', type: 'external' },
];

// One delivery row — pick truck (→ auto price) and edit the price; delete manual ones.
function DeliveryRow({ d, onChange }: { d: any; onChange: () => void }) {
  const isEvent = String(d.id).startsWith('event:');
  const realId = String(d.id).split(':')[1];
  const setTruck = async (truck: 'small' | 'big') => {
    if (isEvent) await api.setEventDelivery(realId, { truck }); else await api.updateDelivery(realId, { truck });
    onChange();
  };
  const editPrice = async () => {
    const cur = d.priceFils != null ? String(d.priceFils / 100) : '';
    const v = prompt('Delivery price (AED):', cur);
    if (v == null) return;
    const fils = v.trim() === '' ? null : Math.round(Number(v) * 100);
    if (v.trim() !== '' && !Number.isFinite(fils as number)) return;
    if (isEvent) await api.setEventDelivery(realId, { priceFils: fils }); else await api.updateDelivery(realId, { priceFils: fils });
    onChange();
  };
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: C.muted2, minWidth: 50 }}>{new Date(d.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, flex: 1 }}>{d.name}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>📍 {d.emirate}</span>
        {!isEvent && <button onClick={async () => { if (confirm('Remove this delivery?')) { await api.deleteDelivery(realId); onChange(); } }} style={{ border: 'none', background: 'transparent', color: C.muted2, cursor: 'pointer', fontSize: 13 }}>✕</button>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {(['small', 'big'] as const).map((t) => (
          <button key={t} onClick={() => setTruck(t)} style={{
            border: `1px solid ${d.truck === t ? C.pink : C.line}`, background: d.truck === t ? C.pink : '#fff', color: d.truck === t ? '#fff' : C.muted2,
            borderRadius: 9, padding: '5px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
          }}>{t === 'small' ? '🚐 Small' : '🚛 Big'} truck</button>
        ))}
        <button onClick={editPrice} style={{ marginLeft: 'auto', border: `1px solid ${C.line}`, background: '#fff', borderRadius: 9, padding: '5px 12px', fontSize: 12.5, fontWeight: 800, color: d.priceFils != null ? C.pinkDeep : C.muted2, cursor: 'pointer' }}>
          {d.priceDisplay}{d.priceManual ? ' ✎' : ''}
        </button>
      </div>
    </div>
  );
}

// Add a manual delivery (external driver, no event).
function DeliveryForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), driverName: '', driverType: 'external', emirate: '', truck: '' as '' | 'small' | 'big', price: '' });
  const [busy, setBusy] = useState(false);
  if (!open) return <div><Button onClick={() => setOpen(true)}>➕ Add a delivery</Button></div>;
  const submit = async () => {
    if (!f.date) return;
    setBusy(true);
    try {
      await api.addManualDelivery({
        date: f.date, driverName: f.driverName.trim() || undefined, driverType: f.driverType, emirate: f.emirate || undefined,
        truck: f.truck || undefined, priceFils: f.price.trim() ? Math.round(Number(f.price) * 100) : undefined,
      });
      setF({ date: new Date().toISOString().slice(0, 10), driverName: '', driverType: 'external', emirate: '', truck: '', price: '' });
      setOpen(false); onAdded();
    } catch (e: any) { alert(e?.message ?? 'Could not add.'); } finally { setBusy(false); }
  };
  const inp = { padding: '9px 11px', border: `1px solid ${C.line}`, borderRadius: 9, fontSize: 13, fontWeight: 600, fontFamily: 'inherit' } as const;
  return (
    <div style={{ border: `1px solid ${C.pink}`, borderRadius: 12, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 4 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} style={inp} />
        <input list="drv" placeholder="Driver" value={f.driverName} onChange={(e) => { const n = e.target.value; const m = DRIVERS.find((x) => x.name === n); setF({ ...f, driverName: n, driverType: m?.type ?? f.driverType }); }} style={{ ...inp, flex: 1, minWidth: 120 }} />
        <datalist id="drv">{DRIVERS.map((x) => <option key={x.name} value={x.name} />)}</datalist>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={f.emirate} onChange={(e) => setF({ ...f, emirate: e.target.value })} style={{ ...inp, flex: 1, minWidth: 120 }}>
          <option value="">Emirate…</option>
          {EMIRATES.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        {(['small', 'big'] as const).map((t) => (
          <button key={t} onClick={() => setF({ ...f, truck: f.truck === t ? '' : t })} style={{ border: `1px solid ${f.truck === t ? C.pink : C.line}`, background: f.truck === t ? C.pink : '#fff', color: f.truck === t ? '#fff' : C.muted2, borderRadius: 9, padding: '7px 11px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>{t}</button>
        ))}
        <input placeholder="Price AED (optional)" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^\d.]/g, '') })} style={{ ...inp, width: 130 }} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={submit} disabled={busy}>{busy ? 'Adding…' : '✓ Add delivery'}</Button>
        <Button tone="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
