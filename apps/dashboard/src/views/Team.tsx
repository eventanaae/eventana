import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api';
import { Badge, Button, C, Panel, Spinner, Td, Th } from '../ui';
import { Empty } from './Today';

const LEVELS = ['owner', 'manager', 'employee', 'driver'] as const;
const LEVEL_NOTE: Record<string, string> = {
  owner: 'Full access, incl. team & finance',
  manager: 'Everything except changing team access',
  employee: 'Board, calendar, events, inventory, tasks',
  driver: 'Calendar and job locations only',
};

const pad = (n: number) => String(n).padStart(2, '0');
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

export function Team({ role = 'owner' }: { role?: string }) {
  const [team, setTeam] = useState<any[] | null>(null);
  const [schedule, setSchedule] = useState<any>(null);
  const isOwner = role === 'owner';
  const canManage = role === 'owner' || role === 'manager';

  const load = () => {
    api.team().then(setTeam);
    api.teamSchedule(thisMonth()).then(setSchedule).catch(() => setSchedule(null));
  };
  useEffect(() => { load(); }, []);

  if (!team) return <Spinner />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {schedule?.birthdays?.length > 0 && (
        <Panel title="🎂 Birthdays this month">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {schedule.birthdays.map((b: any) => (
              <span key={b.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: C.pinkSoft, borderRadius: 20, padding: '6px 12px', fontSize: 12, fontWeight: 700 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: b.color }} />
                {b.name} · {new Date(b.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
              </span>
            ))}
          </div>
        </Panel>
      )}

      <Panel title={`Team (${team.length})`}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: canManage ? 820 : 520 }}>
            <thead>
              <tr>
                <Th width={190}>Name</Th>
                <Th width={120}>Job title</Th>
                {canManage && <Th width={140}>Birthday</Th>}
                {isOwner && <Th width={140}>Access level</Th>}
                {isOwner && <Th width={200}>Login token</Th>}
                <Th>Upcoming assignments</Th>
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.id}>
                  <Td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 30, height: 30, borderRadius: '50%', background: m.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, flex: 'none' }}>
                        {m.name[0]}
                      </div>
                      <span style={{ fontWeight: 700, color: C.ink }}>{m.name}</span>
                    </div>
                  </Td>
                  <Td>{m.role}</Td>
                  {canManage && (
                    <Td>
                      <input
                        type="date"
                        defaultValue={m.birthday ? String(m.birthday).slice(0, 10) : ''}
                        onChange={async (e) => { await api.setTeamProfile(m.id, { birthday: e.target.value || null }); load(); }}
                        style={dateInput}
                      />
                    </Td>
                  )}
                  {isOwner && <Td><AccessSelect member={m} onChange={load} /></Td>}
                  {isOwner && <Td><TokenCell member={m} onChange={load} /></Td>}
                  <Td>
                    {!m.assignments || m.assignments.length === 0 ? (
                      <span style={{ color: C.muted }}>Free</span>
                    ) : (
                      m.assignments.map((a: any) => `${a.eventId} (${new Date(a.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })})`).join(' · ')
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {team.length === 0 && <Empty>No team members configured.</Empty>}
      </Panel>

      {canManage && <DaysOff team={team} schedule={schedule} onChange={load} />}
    </div>
  );
}

function DaysOff({ team, schedule, onChange }: { team: any[]; schedule: any; onChange: () => void }) {
  const [memberId, setMemberId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const list = (schedule?.daysOff ?? []) as any[];

  const add = async () => {
    if (!memberId || !start) return;
    setBusy(true);
    try {
      await api.addDayOff({ memberId, startDate: start, endDate: end || start, reason: reason || undefined });
      setStart(''); setEnd(''); setReason('');
      onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="🌴 Days off (this month)">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', marginBottom: 14 }}>
        <label style={field}><span style={fLabel}>Member</span>
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)} style={sel}>
            <option value="">Choose…</option>
            {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label style={field}><span style={fLabel}>From</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={dateInput} />
        </label>
        <label style={field}><span style={fLabel}>To</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={dateInput} />
        </label>
        <label style={{ ...field, flex: 2, minWidth: 140 }}><span style={fLabel}>Reason</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="optional" style={dateInput} />
        </label>
        <Button onClick={add} disabled={busy || !memberId || !start}>{busy ? 'Adding…' : 'Add day off'}</Button>
      </div>

      {list.length === 0 ? (
        <Empty>No days off recorded this month.</Empty>
      ) : (
        list.map((d) => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: `1px solid ${C.lineSoft}` }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flex: 'none' }} />
            <span style={{ fontWeight: 700, fontSize: 12.5, minWidth: 110 }}>{d.member_name}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, flex: 1 }}>
              {new Date(d.start_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
              {String(d.end_date).slice(0, 10) !== String(d.start_date).slice(0, 10) && ` → ${new Date(d.end_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`}
              {d.reason ? ` · ${d.reason}` : ''}
            </span>
            <Badge tone={d.status === 'approved' ? 'ok' : d.status === 'denied' ? 'error' : 'warn'}>{d.status}</Badge>
            {d.status === 'requested' && (
              <>
                <button onClick={async () => { await api.setDayOffStatus(d.id, 'approved'); onChange(); }} style={miniBtn}>Approve</button>
                <button onClick={async () => { await api.setDayOffStatus(d.id, 'denied'); onChange(); }} style={{ ...miniBtn, color: C.red }}>Deny</button>
              </>
            )}
            <button onClick={async () => { await api.deleteDayOff(d.id); onChange(); }} style={{ ...miniBtn, color: C.muted }}>✕</button>
          </div>
        ))
      )}
    </Panel>
  );
}

function AccessSelect({ member, onChange }: { member: any; onChange: () => void }) {
  const [saving, setSaving] = useState(false);
  const level = member.access_level ?? 'employee';
  return (
    <div>
      <select
        value={level}
        disabled={saving}
        onChange={async (e) => { setSaving(true); try { await api.setTeamAccess(member.id, e.target.value); await onChange(); } finally { setSaving(false); } }}
        style={sel}
      >
        {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
      </select>
      <div style={{ fontSize: 9.5, fontWeight: 600, color: C.muted, marginTop: 3, lineHeight: 1.3 }}>{LEVEL_NOTE[level]}</div>
    </div>
  );
}

function TokenCell({ member, onChange }: { member: any; onChange: () => void }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const token: string | null = member.access_token ?? null;
  const issue = async (rotate: boolean) => {
    setBusy(true);
    try { await api.setTeamAccess(member.id, member.access_level ?? 'employee', rotate); await onChange(); } finally { setBusy(false); }
  };
  if (!token) {
    return <button onClick={() => issue(false)} disabled={busy} style={miniBtn}>{busy ? '…' : 'Issue login token'}</button>;
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <code style={{ fontSize: 10.5, fontFamily: 'ui-monospace, monospace', background: C.lineSoft, padding: '4px 7px', borderRadius: 7, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={token}>{token}</code>
      <button onClick={() => { navigator.clipboard?.writeText(token); setCopied(true); setTimeout(() => setCopied(false), 1500); }} style={miniBtn}>{copied ? '✓' : 'Copy'}</button>
      <button onClick={() => issue(true)} disabled={busy} title="Rotate — signs out the old device" style={{ ...miniBtn, color: C.red }}>{busy ? '…' : '↻'}</button>
    </div>
  );
}

const sel: CSSProperties = { border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 9px', fontSize: 12, fontWeight: 700, background: '#fff', color: C.ink, textTransform: 'capitalize' };
const dateInput: CSSProperties = { border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 9px', fontSize: 12, fontWeight: 600, background: '#fff', color: C.ink };
const miniBtn: CSSProperties = { border: `1px solid ${C.line}`, background: '#fff', borderRadius: 8, padding: '5px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer', color: C.ink, flex: 'none' };
const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 110 };
const fLabel: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: C.muted };
