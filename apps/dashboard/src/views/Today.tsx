import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, Button, C, Panel, Spinner, Stat, Td, Th } from '../ui';

export function Today({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.today().then(setData);
  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!data) return <Spinner />;

  const k = data.kpis;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', gap: 14 }}>
        <Stat label="Events today" value={k.eventsToday} />
        <Stat label="Bookings this month" value={k.bookingsThisMonth} />
        <Stat label="Revenue this month" value={`AED ${k.revenueThisMonthDisplay}`} />
        <Stat label="Open tasks" value={k.openTasks} />
        <Stat label="Awaiting payment" value={k.processing} />
        <Stat label="Needs review" value={k.needsReview} tone={k.needsReview > 0 ? 'alert' : undefined} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 18, alignItems: 'start' }}>
        <Panel title="Upcoming events">
          {data.events.length === 0 ? (
            <Empty>No upcoming events yet.</Empty>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <Th>Event</Th>
                  <Th>Customer</Th>
                  <Th>When</Th>
                  <Th>Where</Th>
                  <Th>Phase</Th>
                  <Th>Value</Th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e: any) => (
                  <tr
                    key={e.id}
                    onClick={() => onOpenEvent(e.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <Td style={{ fontFamily: 'ui-monospace, monospace', color: C.ink }}>{e.id}</Td>
                    <Td>{e.customer}</Td>
                    <Td>
                      {new Date(e.event_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ·{' '}
                      {e.start_time}–{e.base_end_time}
                    </Td>
                    <Td>{e.emirate}</Td>
                    <Td>
                      <Badge tone={e.phase === 'Event Completed' ? 'neutral' : 'info'}>{e.phase}</Badge>
                    </Td>
                    <Td style={{ fontWeight: 700, color: C.ink }}>AED {e.totalDisplay}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Panel
            title="Critical inventory"
            action={<span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>single units</span>}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {data.criticalInventory.slice(0, 8).map((a: any) => (
                <div key={a.code} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                      {a.name}
                      {a.variant ? ` · ${a.variant}` : ''}
                    </div>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted }}>
                      {a.committed} committed window{a.committed === 1 ? '' : 's'}
                    </div>
                  </div>
                  <Badge tone={a.status !== 'available' ? 'error' : a.committed > 0 ? 'warn' : 'ok'}>
                    {a.status !== 'available' ? a.status : a.committed > 0 ? 'In demand' : 'Free'}
                  </Badge>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Design approvals">
            {data.pendingDesignApprovals.length === 0 ? (
              <Empty>Nothing waiting on a customer.</Empty>
            ) : (
              data.pendingDesignApprovals.map((d: any) => (
                <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {d.event_id} · v{d.version}
                  </span>
                  <Badge tone="warn">Pending</Badge>
                </div>
              ))
            )}
          </Panel>

          <Panel
            title="Integrations"
            action={
              <Button
                tone="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await api.reconcile().catch(() => null);
                  await load();
                  setBusy(false);
                }}
              >
                {busy ? 'Running…' : 'Run reconciliation'}
              </Button>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.integrations.map((i: any) => (
                <div key={i.name}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'capitalize', flex: 1 }}>
                      {i.name}
                    </span>
                    <Badge tone={i.mode === 'live' ? 'ok' : i.mode === 'sandbox' ? 'warn' : 'neutral'}>
                      {i.mode}
                    </Badge>
                  </div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>
                    {i.note}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <Panel title="Open tasks">
        {data.tasks.length === 0 ? (
          <Empty>Everything is done.</Empty>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th width={140}>Event</Th>
                <Th width={120}>Department</Th>
                <Th>Task</Th>
                <Th width={110}>Status</Th>
                <Th width={90} />
              </tr>
            </thead>
            <tbody>
              {data.tasks.map((t: any) => (
                <tr key={t.id}>
                  <Td style={{ fontFamily: 'ui-monospace, monospace' }}>{t.event_id}</Td>
                  <Td style={{ textTransform: 'capitalize' }}>{t.department}</Td>
                  <Td style={{ color: C.ink }}>{t.title}</Td>
                  <Td>
                    <Badge tone={t.status === 'blocked' ? 'error' : 'warn'}>{t.status}</Badge>
                  </Td>
                  <Td>
                    <Button
                      tone="ghost"
                      onClick={async () => {
                        await api.setTask(t.id, 'done');
                        load();
                      }}
                    >
                      Done
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, padding: '10px 0' }}>{children}</div>
  );
}
