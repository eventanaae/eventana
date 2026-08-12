import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, Button, C, Panel, Spinner, Td, Th } from '../ui';
import { Empty } from './Today';

export function Inventory() {
  const [assets, setAssets] = useState<any[] | null>(null);

  const load = () => {
    void api.inventory().then(setAssets);
  };
  useEffect(load, []);

  if (!assets) return <Spinner />;

  return (
    <Panel title={`Inventory (${assets.length} assets)`}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 14, lineHeight: 1.6 }}>
        Reservation windows include prep, transport, setup, the event, breakdown, return and cleaning
        — not just the customer’s four hours. That is why a single asset can block a whole day.
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
              <Td>
                −{a.buffer_before_minutes}m / +{a.buffer_after_minutes}m
              </Td>
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
  );
}
