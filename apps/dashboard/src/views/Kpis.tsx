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

export function Kpis({ role }: { role?: string }) {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`);
  const [data, setData] = useState<any>(null);
  // The API decides who sees the whole team (owner, manager, Marsha) vs only
  // their own numbers (personal:true). Trust the API, not the local role, so
  // Marsha — an employee who co-runs the dashboard — gets the full view.
  void role;
  const personal = !!data?.personal;

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
        title={`${personal ? 'My KPIs & Tips' : 'Team KPIs'} — ${monthLabel(month)}`}
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
            {personal ? (
              (() => {
                const o = data.overall; const target = data.rules?.targetEvents ?? 20; const min = data.rules?.minEvents ?? 15;
                return (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <div style={fredoka(30)}>AED {o.earningsDisplay}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>earned this month 💐</div>
                      </div>
                      <div style={{ flex: 1 }} />
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ ...fredoka(24), color: C.pinkDeep }}>{o.points ?? 0}</div>
                        <div style={{ fontSize: 10.5, fontWeight: 800, color: C.muted, letterSpacing: '.4px' }}>MY POINTS</div>
                      </div>
                    </div>
                    <div style={{ marginTop: 14, marginBottom: 5, display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 800 }}>
                      <span style={{ color: C.ink }}>{o.attended} of {target} events</span>
                      <span style={{ color: o.targetPct >= 100 ? C.green : C.pinkDeep }}>{o.targetPct}%</span>
                    </div>
                    <div style={{ height: 12, borderRadius: 8, background: C.lineSoft, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${o.targetPct}%`, background: o.targetPct >= 100 ? C.green : C.pink, borderRadius: 8, transition: 'width .4s' }} />
                    </div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, marginTop: 4 }}>Minimum {min} events (80%) · target {target} (100%)</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12, marginTop: 16 }}>
                      {o.isMarsha ? (
                        <Tile label={`Commission · ${o.corporateInvoices} invoice(s)`} value={`AED ${o.commissionDisplay}`} accent={C.green} />
                      ) : (
                        <>
                          <Tile label="Incentive" value={`AED ${o.incentiveDisplay}`} accent={C.green} />
                          <Tile label="Feedback bonus" value={`AED ${o.feedbackDisplay}`} accent={C.pinkDeep} />
                          {(o.glamCount ?? 0) > 0 && <Tile label={`Glam Doll · ${o.glamCount}`} value={`AED ${o.glamDisplay}`} accent="#8a6cc0" />}
                        </>
                      )}
                      <Tile label="Tips" value={`AED ${o.tipsDisplay}`} accent={C.pinkDeep} />
                    </div>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 12, lineHeight: 1.6 }}>
                      {o.isMarsha
                        ? `You earn ${data.rules?.commissionRate ?? 2}% commission on every corporate/events invoice you bring in worth AED ${(data.rules?.commissionMinAed ?? 20000).toLocaleString()}+. Tips are yours on top.`
                        : `After ${target} events you earn AED ${data.rules?.incentivePerEventAed ?? 50} for each event worth AED ${(data.rules?.minEventValueAed ?? 2000).toLocaleString()}+ (excluding delivery). Every good customer rating adds AED ${data.rules?.feedbackBonusAed ?? 10}, and each Glam Doll performance adds AED ${data.rules?.glamBonusAed ?? 20}. Tips are yours on top. Part-timers aren’t included.`}
                    </div>
                  </div>
                );
              })()
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 8 }}>
                <Tile label="Tips this month" value={`AED ${data.overall.tipsDisplay}`} accent={C.pinkDeep} />
                <Tile label="Team-pool tips" value={`AED ${data.overall.teamPoolDisplay}`} />
                <Tile label="Events completed" value={String(data.overall.eventsDone)} />
                <Tile label={`Avg rating · ${data.overall.ratingsCount} reviews`} value={data.overall.avgRating > 0 ? `${data.overall.avgRating} ★` : '—'} />
              </div>
            )}
          </>
        )}
      </Panel>

      {/* Points competition — visible to everyone, no money. */}
      {data && (data.board?.length ?? 0) > 0 && (
        <Panel title="🏆 Team competition">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[...data.board].sort((a: any, b: any) => b.points - a.points).map((s: any, i: number) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 4px' }}>
                <span style={{ fontSize: 16, width: 24, textAlign: 'center', flex: 'none' }}>{RANK[i] ?? i + 1}</span>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: s.color, color: '#fff', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{s.name[0]}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted }}>{s.eventsDone} events · {s.avgRating > 0 ? `${s.avgRating}★` : '—'}</div>
                </div>
                <div style={{ textAlign: 'right', flex: 'none' }}>
                  <div style={{ ...fredoka(18), color: C.pinkDeep, lineHeight: 1 }}>{s.points}</div>
                  <div style={{ fontSize: 9, fontWeight: 800, color: C.muted, letterSpacing: '.4px' }}>PTS</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 10, lineHeight: 1.6 }}>
            Points = 10 × completed events + 1 per AED 1 of tips + 20 × 5★ ratings. Everyone sees the points board — the money each person earns stays private.
          </div>
        </Panel>
      )}

      {data && !personal && (
        <Panel title="Team earnings (owner)">
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
                      <div style={{ ...fredoka(18), color: C.green, lineHeight: 1 }}>AED {s.earningsDisplay}</div>
                      <div style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, letterSpacing: '.4px' }}>EARNED</div>
                    </div>
                  </div>
                  {/* target progress to 20 */}
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 8, borderRadius: 6, background: C.lineSoft, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${s.targetPct ?? 0}%`, background: (s.targetPct ?? 0) >= 100 ? C.green : C.pink, borderRadius: 6 }} />
                    </div>
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: C.muted, minWidth: 78, textAlign: 'right' }}>{s.attended ?? 0}/{data.rules?.targetEvents ?? 20} · {s.targetPct ?? 0}%</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginTop: 11, paddingTop: 11, borderTop: `1px solid ${C.lineSoft}` }}>
                    <MiniKpi label="Incentive" value={`AED ${s.incentiveDisplay ?? '0'}`} accent={C.green} />
                    <MiniKpi label="Feedback" value={`AED ${s.feedbackDisplay ?? '0'}`} accent={C.pinkDeep} />
                    <MiniKpi label={`Tips · ${s.tipsCount}`} value={`AED ${s.tipsDisplay}`} accent={C.pinkDeep} />
                    <MiniKpi label="Rating" value={s.avgRating > 0 ? `${s.avgRating} ★` : '—'} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 11, fontWeight: 600, color: C.muted, lineHeight: 1.6 }}>
            Target {data.rules?.targetEvents ?? 20} events (min {data.rules?.minEvents ?? 15}). Beyond the target, AED {data.rules?.incentivePerEventAed ?? 50}
            {' '}per event worth AED {(data.rules?.minEventValueAed ?? 2000).toLocaleString()}+ (excl. delivery) · AED {data.rules?.feedbackBonusAed ?? 10} per good-rated event · plus tips.
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
