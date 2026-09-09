import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, Panel, Button, Spinner, Badge } from '../ui';

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'error' | 'neutral'> = {
  approved: 'ok', pending: 'warn', rejected: 'error', cancelled: 'neutral',
};
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayName = (n: number | null | undefined) => (n === null || n === undefined ? '—' : WEEKDAYS[Number(n)] ?? '—');

/**
 * The single home for staff time off — two kinds:
 *   • Annual leave 🌴 — the 30-day balance: employees request, owner/Marsha
 *     approve, and it deducts from their balance.
 *   • Day off 🗓️ — each member's fixed WEEKLY rest day (e.g. Jane = Wednesday).
 *     Owner/manager edit it here; a member can ask to move theirs and it comes
 *     back to owner/Marsha for approval.
 */
export function Leave({ role = 'owner' }: { role?: string }) {
  const [rows, setRows] = useState<any[] | null>(null);   // annual leave_requests
  const [team, setTeam] = useState<any[]>([]);
  const [dayChanges, setDayChanges] = useState<any[]>([]); // weekly day-off change requests
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const isOwner = role === 'owner';
  const canManage = role === 'owner' || role === 'manager';

  const load = () => {
    api.leaveRequests().then((r) => setRows(r.requests)).catch(() => setRows([]));
    api.team().then((t: any) => setTeam(Array.isArray(t) ? t : [])).catch(() => setTeam([]));
    api.dayOffChangeRequests().then((r) => setDayChanges(r.requests)).catch(() => setDayChanges([]));
  };
  useEffect(() => { load(); }, []);

  const decideAnnual = async (id: number, decision: 'approved' | 'rejected') => {
    setBusyKey(`leave-${id}`);
    try { await api.decideLeave(id, decision); await load(); } catch { /* toast */ } finally { setBusyKey(null); }
  };
  const decideDayChange = async (id: number, decision: 'approved' | 'rejected') => {
    setBusyKey(`change-${id}`);
    try { await api.decideDayOffChange(id, decision); load(); } catch { /* toast */ } finally { setBusyKey(null); }
  };

  if (!rows) return <Spinner />;
  const pending = rows.filter((r) => r.status === 'pending');
  const decided = rows.filter((r) => r.status !== 'pending');
  const pendingChanges = dayChanges.filter((c) => c.status === 'pending');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isOwner && <LeaveSettings />}

      {canManage && team.length > 0 && <WeeklyDayOff team={team} onChange={load} />}

      {pendingChanges.length > 0 && (
        <Panel title={`🗓️ Day-off change requests (${pendingChanges.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pendingChanges.map((c) => {
              const busy = busyKey === `change-${c.id}`;
              return (
                <div key={c.id} style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: '13px 15px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ width: 30, height: 30, borderRadius: '50%', background: c.color || C.muted, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, flex: 'none' }}>{String(c.member_name || '?')[0]}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: C.ink }}>{c.member_name}</div>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted }}>requested {c.submitted_at}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
                    {weekdayName(c.current_day)} → <span style={{ color: C.pinkDeep }}>{weekdayName(c.requested_day)}</span>
                  </div>
                  {c.reason && <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, marginTop: 2 }}>“{c.reason}”</div>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
                    <Button onClick={() => decideDayChange(c.id, 'approved')} disabled={busy}>{busy ? '…' : 'Approve & move'}</Button>
                    <Button tone="danger" onClick={() => decideDayChange(c.id, 'rejected')} disabled={busy}>Reject</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel title={`🌴 Annual leave — pending approval (${pending.length})`}>
        {pending.length === 0 ? (
          <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No leave requests waiting. 🎉</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pending.map((r) => {
              const busy = busyKey === `leave-${r.id}`;
              return (
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
                    <Button onClick={() => decideAnnual(r.id, 'approved')} disabled={busy}>{busy ? '…' : 'Approve'}</Button>
                    <Button tone="danger" onClick={() => decideAnnual(r.id, 'rejected')} disabled={busy}>Reject</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="History">
        {decided.length === 0 ? (
          <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>Decided leave requests will appear here.</div>
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

/** Each member's fixed weekly rest day — the whole roster + a per-person picker. */
function WeeklyDayOff({ team, onChange }: { team: any[]; onChange: () => void }) {
  const set = async (id: string, v: string) => {
    await api.setTeamProfile(id, { weeklyDayOff: v === '' ? null : Number(v) });
    onChange();
  };
  const byDay = WEEKDAYS.map((_, i) => team.filter((m) => m.weekly_day_off === i));
  const anySet = byDay.some((g) => g.length > 0);
  const ctrl: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 9px', fontSize: 12, fontWeight: 600, background: '#fff', color: C.ink };
  return (
    <Panel title="🗓️ Weekly day off">
      {anySet && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {WEEKDAYS.map((d, i) => byDay[i].length > 0 ? (
            <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ width: 96, flex: 'none', fontSize: 12.5, fontWeight: 800, color: C.pinkDeep }}>{d}</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {byDay[i].map((m) => (
                  <span key={m.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.pinkSoft, borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 700, color: C.ink }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color }} />{m.name}
                  </span>
                ))}
              </div>
            </div>
          ) : null)}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: anySet ? `1px solid ${C.lineSoft}` : 'none', paddingTop: anySet ? 12 : 0 }}>
        {team.map((m) => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: C.ink }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color }} />{m.name}
            </span>
            <select defaultValue={m.weekly_day_off ?? ''} onChange={(e) => set(m.id, e.target.value)} style={ctrl}>
              <option value="">— none —</option>
              {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>
        Each person’s rest day each week — they’re never assigned to events on it. A team member can ask to move theirs from their profile; it comes here for approval.
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
