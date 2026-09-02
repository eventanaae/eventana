import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, Panel, Button, Spinner, Badge } from '../ui';

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'error' | 'neutral'> = {
  approved: 'ok', pending: 'warn', rejected: 'error', cancelled: 'neutral',
};

/**
 * Owner / Manager (and Marsha) view: approve or reject annual-leave requests.
 * Pending requests sit at the top; everything decided drops into the history
 * below. Approving a request frees nothing to chance — the balance is computed
 * live and the person is auto-marked unavailable on the calendar.
 */
export function Leave({ role = 'owner' }: { role?: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const isOwner = role === 'owner';

  const load = () => api.leaveRequests().then((r) => setRows(r.requests)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const decide = async (id: number, decision: 'approved' | 'rejected') => {
    setBusyId(id);
    try { await api.decideLeave(id, decision); await load(); } catch { /* toast handles it */ } finally { setBusyId(null); }
  };

  if (!rows) return <Spinner />;
  const pending = rows.filter((r) => r.status === 'pending');
  const decided = rows.filter((r) => r.status !== 'pending');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isOwner && <LeaveSettings />}

      <Panel title={`🌴 Pending approval (${pending.length})`}>
        {pending.length === 0 ? (
          <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No leave requests waiting. 🎉</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pending.map((r) => (
              <div key={r.id} style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: '13px 15px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ width: 30, height: 30, borderRadius: '50%', background: r.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, flex: 'none' }}>{String(r.member_name)[0]}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: C.ink }}>{r.member_name}</div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted }}>requested {r.submitted_at}</div>
                  </div>
                  <span style={{ fontWeight: 800, fontSize: 15, color: C.pinkDeep }}>{r.days} day(s)</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{r.start_date} → {r.end_date}</div>
                {r.reason && <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, marginTop: 2 }}>“{r.reason}”</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
                  <Button onClick={() => decide(r.id, 'approved')} disabled={busyId === r.id}>{busyId === r.id ? '…' : 'Approve'}</Button>
                  <Button tone="ghost" onClick={() => decide(r.id, 'rejected')} disabled={busyId === r.id} style={{ color: C.red }}>Reject</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="History">
        {decided.length === 0 ? (
          <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>Decided requests will appear here.</div>
        ) : (
          decided.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 0', borderTop: `1px solid ${C.lineSoft}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{r.member_name} · {r.days} day(s)</div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, lineHeight: 1.5 }}>
                  {r.start_date} → {r.end_date}{r.reason ? ` · "${r.reason}"` : ''}
                  {r.decided_by ? ` · by ${r.decided_by}${r.decided_at ? ` on ${r.decided_at}` : ''}` : ''}
                </div>
              </div>
              <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge>
            </div>
          ))
        )}
      </Panel>
    </div>
  );
}

/** Owner-only: the annual entitlement + accrual rate (applies to everyone). */
function LeaveSettings() {
  const [cfg, setCfg] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { api.leaveSettings().then(setCfg).catch(() => setCfg(null)); }, []);
  if (!cfg) return null;
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await api.saveLeaveSettings({ annualEntitlementDays: Number(cfg.annualEntitlementDays), accrualPerMonth: Number(cfg.accrualPerMonth) });
      setMsg('Saved ✓'); setTimeout(() => setMsg(null), 1500);
    } catch (e: any) { setMsg(e?.message ?? 'Could not save'); } finally { setBusy(false); }
  };
  const field: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: 10, padding: '8px 10px', fontSize: 13, fontWeight: 700, width: 90 };
  return (
    <Panel title="⚙ Leave policy">
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: C.muted }}>ANNUAL ENTITLEMENT (DAYS)</span>
          <input type="number" min={0} max={365} value={cfg.annualEntitlementDays} onChange={(e) => setCfg({ ...cfg, annualEntitlementDays: e.target.value })} style={field} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: C.muted }}>ACCRUAL / MONTH</span>
          <input type="number" min={0} max={31} step={0.1} value={cfg.accrualPerMonth} onChange={(e) => setCfg({ ...cfg, accrualPerMonth: e.target.value })} style={field} />
        </label>
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save policy'}</Button>
        {msg && <span style={{ fontSize: 12, fontWeight: 700, color: msg.includes('✓') ? C.green : C.red }}>{msg}</span>}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
        Applies to everyone on the scheme. Each member accrues pro-rata from their employment start date (set on the Team screen).
      </div>
    </Panel>
  );
}
