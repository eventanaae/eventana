import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api';
import { Badge, C, Panel, Spinner, Td, Th } from '../ui';
import { Empty } from './Today';

const LEVELS = ['owner', 'manager', 'employee', 'driver'] as const;

const LEVEL_NOTE: Record<string, string> = {
  owner: 'Full access, incl. team & finance',
  manager: 'Everything except changing team access',
  employee: 'Board, calendar, events, inventory, tasks',
  driver: 'Calendar and job locations only',
};

export function Team({ role = 'owner' }: { role?: string }) {
  const [team, setTeam] = useState<any[] | null>(null);
  const isOwner = role === 'owner';

  const load = () => api.team().then(setTeam);
  useEffect(() => { load(); }, []);

  if (!team) return <Spinner />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isOwner && (
        <Panel title="Access levels & staff login">
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.6, marginBottom: 4 }}>
            Set each person's access level and share their personal login token — they enter it once on
            their device to sign in as themselves. Only you (Owner) see this panel. Rotating a token
            signs the old device out.
          </div>
        </Panel>
      )}

      <Panel title={`Team (${team.length})`}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isOwner ? 780 : 520 }}>
            <thead>
              <tr>
                <Th width={200}>Name</Th>
                <Th width={130}>Job title</Th>
                {isOwner && <Th width={150}>Access level</Th>}
                {isOwner && <Th width={210}>Login token</Th>}
                <Th>Upcoming assignments</Th>
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.id}>
                  <Td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 30, height: 30, borderRadius: '50%', background: m.color,
                          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, fontSize: 12, flex: 'none',
                        }}
                      >
                        {m.name[0]}
                      </div>
                      <span style={{ fontWeight: 700, color: C.ink }}>{m.name}</span>
                    </div>
                  </Td>
                  <Td>{m.role}</Td>
                  {isOwner && (
                    <Td>
                      <AccessSelect member={m} onChange={load} />
                    </Td>
                  )}
                  {isOwner && (
                    <Td>
                      <TokenCell member={m} onChange={load} />
                    </Td>
                  )}
                  <Td>
                    {!m.assignments || m.assignments.length === 0 ? (
                      <span style={{ color: C.muted }}>Free</span>
                    ) : (
                      m.assignments
                        .map(
                          (a: any) =>
                            `${a.eventId} (${new Date(a.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })})`,
                        )
                        .join(' · ')
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {team.length === 0 && <Empty>No team members configured.</Empty>}
      </Panel>
    </div>
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
        onChange={async (e) => {
          setSaving(true);
          try {
            await api.setTeamAccess(member.id, e.target.value);
            await onChange();
          } finally {
            setSaving(false);
          }
        }}
        style={selectStyle}
      >
        {LEVELS.map((l) => (
          <option key={l} value={l}>{l}</option>
        ))}
      </select>
      <div style={{ fontSize: 9.5, fontWeight: 600, color: C.muted, marginTop: 3, lineHeight: 1.3 }}>
        {LEVEL_NOTE[level]}
      </div>
    </div>
  );
}

function TokenCell({ member, onChange }: { member: any; onChange: () => void }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const token: string | null = member.access_token ?? null;

  const issue = async (rotate: boolean) => {
    setBusy(true);
    try {
      await api.setTeamAccess(member.id, member.access_level ?? 'employee', rotate);
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <button onClick={() => issue(false)} disabled={busy} style={btn}>
        {busy ? '…' : 'Issue login token'}
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <code
        style={{
          fontSize: 10.5, fontFamily: 'ui-monospace, monospace', background: C.lineSoft,
          padding: '4px 7px', borderRadius: 7, maxWidth: 110, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
        title={token}
      >
        {token}
      </code>
      <button
        onClick={() => { navigator.clipboard?.writeText(token); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        style={btn}
      >
        {copied ? '✓' : 'Copy'}
      </button>
      <button onClick={() => issue(true)} disabled={busy} title="Rotate — signs out the old device" style={{ ...btn, color: C.red }}>
        {busy ? '…' : '↻'}
      </button>
    </div>
  );
}

const selectStyle: CSSProperties = {
  border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 9px',
  fontSize: 12, fontWeight: 700, background: '#fff', color: C.ink, textTransform: 'capitalize',
};
const btn: CSSProperties = {
  border: `1px solid ${C.line}`, background: '#fff', borderRadius: 8, padding: '5px 9px',
  fontSize: 11, fontWeight: 700, cursor: 'pointer', color: C.ink, flex: 'none',
};
