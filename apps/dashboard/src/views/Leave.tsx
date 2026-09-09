import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, Panel, Button, Spinner, Badge } from '../ui';

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'error' | 'neutral'> = {
  approved: 'ok', pending: 'warn', rejected: 'error', cancelled: 'neutral', requested: 'warn', denied: 'error',
};

const pad = (n: number) => String(n).padStart(2, '0');
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const rangeDays = (a: string, b: string) =>
  Math.floor((Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10))) / 86_400_000) + 1;

/** One item in the unified queue — either an annual-leave request or a manual day off. */
type Item = {
  _type: 'annual' | 'other';
  id: number;
  member_name: string;
  color?: string;
  start_date: string;
  end_date: string;
  days?: number;
  reason?: string | null;
  status: string;
  submitted_at?: string;
  decided_by?: string | null;
  decided_at?: string | null;
};

const TYPE_META = {
  annual: { label: '🌴 Annual', tone: 'ok' as const, note: 'counts against the 30-day balance' },
  other: { label: '🗓️ Day off', tone: 'neutral' as const, note: 'does not touch the annual balance' },
};

/**
 * Owner / Manager (and Marsha): the single home for ALL time off — two types in
 * one place. "Annual" leave (🌴) accrues and deducts from the 30-day balance;
 * "Day off" (🗓️, e.g. sick, unpaid, or off-scheme members) is recorded but does
 * NOT deduct. Both land in one pending queue and one history, and both mark the
 * person unavailable on the calendar and in auto-staffing once approved. The
 * recurring weekly rest-day roster is separate and lives on the Team screen.
 */
export function Leave({ role = 'owner' }: { role?: string }) {
  const [rows, setRows] = useState<any[] | null>(null);   // annual leave_requests
  const [daysOff, setDaysOff] = useState<any[]>([]);       // manual staff_days_off (this month)
  const [team, setTeam] = useState<any[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const isOwner = role === 'owner';
  const canManage = role === 'owner' || role === 'manager';

  const load = () => {
    api.leaveRequests().then((r) => setRows(r.requests)).catch(() => setRows([]));
    api.teamSchedule(thisMonth()).then((s: any) => setDaysOff(s?.daysOff ?? [])).catch(() => setDaysOff([]));
    api.team().then((t: any) => setTeam(Array.isArray(t) ? t : [])).catch(() => setTeam([]));
  };
  useEffect(() => { load(); }, []);

  const decideAnnual = async (id: number, decision: 'approved' | 'rejected') => {
    setBusyKey(`annual-${id}`);
    try { await api.decideLeave(id, decision); await load(); } catch { /* toast handles it */ } finally { setBusyKey(null); }
  };
  const decideOther = async (id: number, status: 'approved' | 'denied') => {
    setBusyKey(`other-${id}`);
    try { await api.setDayOffStatus(id, status); load(); } catch { /* toast */ } finally { setBusyKey(null); }
  };
  const removeOther = async (id: number) => {
    setBusyKey(`other-${id}`);
    try { await api.deleteDayOff(id); load(); } catch { /* toast */ } finally { setBusyKey(null); }
  };

  if (!rows) return <Spinner />;

  const pending: Item[] = [
    ...rows.filter((r) => r.status === 'pending').map((r) => ({ ...r, _type: 'annual' as const })),
    ...daysOff.filter((d) => d.status === 'requested').map((d) => ({ ...d, _type: 'other' as const })),
  ];
  const decided: Item[] = [
    ...rows.filter((r) => r.status !== 'pending').map((r) => ({ ...r, _type: 'annual' as const })),
    ...daysOff.filter((d) => d.status !== 'requested').map((d) => ({ ...d, _type: 'other' as const })),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isOwner && <LeaveSettings />}

      {canManage && team.length > 0 && <AddDayOff team={team} onAdd={load} />}

      <Panel title={`Pending approval (${pending.length})`}>
        {pending.length === 0 ? (
          <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No time-off requests waiting. 🎉</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pending.map((r) => {
              const key = `${r._type}-${r.id}`;
              const days = r.days ?? rangeDays(r.start_date, r.end_date);
              const busy = busyKey === key;
              return (
                <div key={key} style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: '13px 15px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ width: 30, height: 30, borderRadius: '50%', background: r.color || C.muted, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, flex: 'none' }}>{String(r.member_name || '?')[0]}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: C.ink }}>{r.member_name}</div>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted }}>{r.submitted_at ? `requested ${r.submitted_at}` : 'day off'}</div>
                    </div>
                    <Badge tone={TYPE_META[r._type].tone}>{TYPE_META[r._type].label}</Badge>
                    <span style={{ fontWeight: 800, fontSize: 15, color: C.pinkDeep }}>{days} day(s)</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{String(r.start_date).slice(0, 10)} → {String(r.end_date).slice(0, 10)}</div>
                  {r.reason && <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, marginTop: 2 }}>“{r.reason}”</div>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
                    {r._type === 'annual' ? (
                      <>
                        <Button onClick={() => decideAnnual(r.id, 'approved')} disabled={busy}>{busy ? '…' : 'Approve'}</Button>
                        <Button tone="danger" onClick={() => decideAnnual(r.id, 'rejected')} disabled={busy}>Reject</Button>
                      </>
                    ) : (
                      <>
                        <Button onClick={() => decideOther(r.id, 'approved')} disabled={busy}>{busy ? '…' : 'Approve'}</Button>
                        <Button tone="danger" onClick={() => decideOther(r.id, 'denied')} disabled={busy}>Deny</Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="History">
        {decided.length === 0 ? (
          <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>Decided requests and recorded days off will appear here.</div>
        ) : (
          decided.map((r) => {
            const key = `${r._type}-${r.id}`;
            const days = r.days ?? rangeDays(r.start_date, r.end_date);
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 0', borderTop: `1px solid ${C.lineSoft}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{r.member_name} · {days} day(s) · <span style={{ color: C.muted }}>{TYPE_META[r._type].label}</span></div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, lineHeight: 1.5 }}>
                    {String(r.start_date).slice(0, 10)} → {String(r.end_date).slice(0, 10)}{r.reason ? ` · "${r.reason}"` : ''}
                    {r.decided_by ? ` · by ${r.decided_by}${r.decided_at ? ` on ${r.decided_at}` : ''}` : ''}
                  </div>
                </div>
                <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge>
                {r._type === 'other' && canManage && (
                  <button onClick={() => removeOther(r.id)} disabled={busyKey === key} style={{ border: `1px solid ${C.line}`, background: '#fff', borderRadius: 8, padding: '3px 8px', fontSize: 11, fontWeight: 700, color: C.muted, cursor: 'pointer' }}>✕</button>
                )}
              </div>
            );
          })
        )}
      </Panel>
    </div>
  );
}

/** Manager: record a day off for someone (sick / unpaid / off-scheme) — no balance deduction. */
function AddDayOff({ team, onAdd }: { team: any[]; onAdd: () => void }) {
  const [memberId, setMemberId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!memberId || !start) return;
    setBusy(true);
    try {
      await api.addDayOff({ memberId, startDate: start, endDate: end || start, reason: reason || undefined });
      setMemberId(''); setStart(''); setEnd(''); setReason('');
      onAdd();
    } finally { setBusy(false); }
  };

  const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
  const fLabel: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, color: C.muted };
  const ctrl: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: 10, padding: '8px 10px', fontSize: 13, fontWeight: 700 };

  return (
    <Panel title="🗓️ Add a day off (no balance deduction)">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
        <label style={field}><span style={fLabel}>MEMBER</span>
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)} style={ctrl}>
            <option value="">Choose…</option>
            {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label style={field}><span style={fLabel}>FROM</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={ctrl} />
        </label>
        <label style={field}><span style={fLabel}>TO</span>
          <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} style={ctrl} />
        </label>
        <label style={{ ...field, flex: 2, minWidth: 140 }}><span style={fLabel}>REASON</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. sick / unpaid" style={ctrl} />
        </label>
        <Button onClick={add} disabled={busy || !memberId || !start}>{busy ? 'Adding…' : 'Add day off'}</Button>
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
        For annual leave that accrues and deducts, the team member requests it from their own profile — it shows up above for approval.
      </div>
    </Panel>
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
