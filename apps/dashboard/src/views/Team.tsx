import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, C, Panel, Spinner, Td, Th } from '../ui';
import { Empty } from './Today';

export function Team() {
  const [team, setTeam] = useState<any[] | null>(null);

  useEffect(() => {
    api.team().then(setTeam);
  }, []);

  if (!team) return <Spinner />;

  return (
    <Panel title={`Team (${team.length})`}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <Th width={220}>Name</Th>
            <Th width={200}>Role</Th>
            <Th width={110}>Status</Th>
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
              <Td>
                <Badge tone={m.active ? 'ok' : 'neutral'}>{m.active ? 'Active' : 'Inactive'}</Badge>
              </Td>
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
      {team.length === 0 && <Empty>No team members configured.</Empty>}
    </Panel>
  );
}
