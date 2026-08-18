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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.staff.map((s: any, i: number) => (
                <div key={s.id} style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <span style={{ fontSize: 17, width: 24, textAlign: 'center', flex: 'none' }}>{RANK[i] ?? i + 1}</span>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: s.color, color: '#fff', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                      {s.name[0]}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</div>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, textTransform: 'capitalize' }}>{s.role} · {s.accessLevel}</div>
                    </div>
                    <div style={{ textAlign: 'right', flex: 'none' }}>
                      <div style={{ ...fredoka(18), color: C.ink, lineHeight: 1 }}>{s.points}</div>
                      <div style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, letterSpacing: '.4px' }}>POINTS</div>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 11, paddingTop: 11, borderTop: `1px solid ${C.lineSoft}` }}>
                    <MiniKpi label="Events" value={String(s.eventsDone)} />
                    <MiniKpi label="Rating" value={s.avgRating > 0 ? `${s.avgRating} ★` : '—'} accent={C.pinkDeep} />
                    <MiniKpi label={`Tips · ${s.tipsCount}`} value={`AED ${s.tipsDisplay}`} accent={C.pinkDeep} />
                  </div>
                </div>
              ))}
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

function MiniKpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, letterSpacing: '.3px' }}>{label.toUpperCase()}</div>
      <div style={{ fontWeight: 800, fontSize: 13.5, color: accent ?? C.ink, marginTop: 2 }}>{value}</div>
    </div>
  );
}
