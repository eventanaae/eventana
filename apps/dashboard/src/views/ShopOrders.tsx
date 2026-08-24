import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, fredoka, Panel, Spinner, money } from '../ui';
import { Empty } from './Today';

interface ShopItem { serviceId: string; quantity: number; name: string }
interface ShopOrder {
  orderId: string;
  totalFils: number;
  createdAt: string;
  readyBy: string | null;
  emirate: string | null;
  address: { area?: string; street?: string; villa?: string; details?: string } | null;
  items: ShopItem[];
  customization: { refImages?: string[]; wantDraw?: boolean } | null;
  customer: { name: string; email: string; phone: string; backupPhone: string | null };
}

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
};

export function ShopOrders() {
  const [orders, setOrders] = useState<ShopOrder[] | null>(null);
  const load = () => api.shopOrders().then(setOrders).catch(() => setOrders([]));
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  if (!orders) return <Spinner />;
  if (orders.length === 0) return <Empty>No shop orders yet. Standalone custom-goods orders will appear here.</Empty>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {orders.map((o) => {
        const addr = [o.address?.area, o.address?.street, o.address?.villa].filter(Boolean).join(', ');
        return (
          <Panel key={o.orderId} title={`🛍️ ${o.orderId}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: C.muted }}>{fmtDate(o.createdAt)}</div>
              <div style={{ ...fredoka(16), color: C.pinkDeep }}>AED {money(o.totalFils)}</div>
            </div>

            {/* items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {o.items.map((it) => (
                <div key={it.serviceId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600 }}>
                  <span>{it.name}</span>
                  <span style={{ color: C.muted }}>× {it.quantity}</span>
                </div>
              ))}
            </div>

            {/* delivery */}
            <div style={sectionLabel}>Delivery</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>
              {o.emirate ? (
                <>
                  <div>{o.emirate}{addr ? ` — ${addr}` : ''}</div>
                  {o.address?.details && <div style={{ color: C.muted, marginTop: 2 }}>{o.address.details}</div>}
                  {o.readyBy && <div style={{ color: C.pinkDeep, marginTop: 3 }}>🧵 Ready by {fmtDate(o.readyBy)}</div>}
                </>
              ) : (
                <div style={{ color: C.muted }}>Digital only — emailed to the customer.</div>
              )}
            </div>

            {/* customization */}
            {o.customization && (
              <>
                <div style={sectionLabel}>Customization</div>
                {o.customization.wantDraw && !o.customization.refImages?.length ? (
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: C.pinkDeep, marginBottom: 12 }}>
                    ✏️ Customer asked us to create a professional digital drawing.
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    {(o.customization.refImages ?? []).map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer">
                        <img src={url} alt="reference" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, border: `1px solid ${C.line}` }} />
                      </a>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* customer */}
            <div style={sectionLabel}>Customer</div>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{o.customer.name}</div>
            <div style={{ fontSize: 12, color: C.muted }}>
              {o.customer.email} · {o.customer.phone}{o.customer.backupPhone ? ` · ${o.customer.backupPhone}` : ''}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: C.muted, marginBottom: 4,
};
