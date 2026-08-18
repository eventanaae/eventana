import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api';
import { C, fredoka, Panel, Spinner } from '../ui';

const pad = (n: number) => String(n).padStart(2, '0');
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};

const navBtn: CSSProperties = {
  border: `1px solid ${C.line}`, background: '#fff', borderRadius: 8,
  padding: '5px 10px', fontWeight: 700, fontSize: 12, cursor: 'pointer', color: C.ink,
};

const RANK = ['🥇', '🥈', '🥉'];

export function Kpis() {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    setData(null);
    void api.kpis(month).then(setData);
  }, [month]);

  const shift = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  };

  const stars = (n: number) => (n > 0 ? `${'★'.repeat(Math.round(n))}${'☆'.repeat(5 - Math.round(n))}` : '—');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Panel
        title={`Team KPIs — ${monthLabel(month)}`}
        action={
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => shift(-1)} style={navBtn}>‹</button>
            <button
              onClick={() => setMonth(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`)}
              style={navBtn}
            >
              This month
            </button>
            <button onClick={() => shift(1)} style={navBtn}>›</button>
          </div>
        }
      >
        {!data ? (
          <Spinner />
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 8 }}>
              <Tile label="Tips this month" value={`AED ${data.overall.tipsDisplay}`} accent={C.pinkDeep} />
              <Tile label="Team-pool tips" value={`AED ${data.overall.teamPoolDisplay}`} />
              <Tile label="Events completed" value={String(data.overall.eventsDone)} />
              <Tile
                label={`Avg rating · ${data.overall.ratingsCount} reviews`}
                value={data.overall.avgRating > 0 ? `${data.overall.avgRating} ★` : '—'}
              />
            </div>
          </>
        )}
      </Panel>

      {data && (
        <Panel title="Leaderboard">
          {data.staff.length === 0 ? (
            <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted }}>No active staff.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: C.muted, fontSize: 11 }}>
                    <th style={th}>#</th>
                    <th style={th}>Member</th>
                    <th style={th}>Events</th>
                    <th style={th}>Rating</th>
                    <th style={th}>Tips</th>
                    <th style={{ ...th, textAlign: 'right' }}>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {data.staff.map((s: any, i: number) => (
                    <tr key={s.id} style={{ borderTop: `1px solid ${C.lineSoft}` }}>
                      <td style={{ ...td, fontSize: 16 }}>{RANK[i] ?? i + 1}</td>
                      <td style={td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div
                            style={{
                              width: 32, height: 32, borderRadius: '50%', background: s.color, color: '#fff',
                              fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
                            }}
                          >
                            {s.name[0]}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 12.5 }}>{s.name}</div>
                            <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, textTransform: 'capitalize' }}>
                              {s.role} · {s.accessLevel}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ ...td, fontWeight: 700 }}>{s.eventsDone}</td>
                      <td style={td}>
                        <span style={{ color: C.pinkDeep, fontSize: 13, letterSpacing: 1 }}>{stars(s.avgRating)}</span>
                        <div style={{ fontSize: 10, fontWeight: 600, color: C.muted }}>
                          {s.avgRating > 0 ? `${s.avgRating} · ${s.fiveStars}×5★` : 'no reviews'}
                        </div>
                      </td>
                      <td style={td}>
                        <div style={{ fontWeight: 700, fontSize: 12.5, color: C.pinkDeep }}>AED {s.tipsDisplay}</div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: C.muted }}>{s.tipsCount} tips</div>
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <span style={{ ...fredoka(18), color: C.ink }}>{s.points}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 11, fontWeight: 600, color: C.muted, lineHeight: 1.6 }}>
            Points = 10 × completed events + 1 per AED 1 of tips + 20 × 5-star ratings. Tips shown are
            paid tips aimed at that member; whole-team tips go to the team pool above.
          </div>
        </Panel>
      )}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: '13px 15px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 5 }}>{label}</div>
      <div style={{ ...fredoka(20), color: accent ?? C.ink }}>{value}</div>
    </div>
  );
}

const th: CSSProperties = { padding: '6px 10px', fontWeight: 700 };
const td: CSSProperties = { padding: '10px', verticalAlign: 'middle' };
