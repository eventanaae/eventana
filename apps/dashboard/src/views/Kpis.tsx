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
      <AchievementsPanel personal={personal} />
      <Panel
        title={`${personal ? 'My Achievements & Tips' : 'Team Achievements'} — ${monthLabel(month)}`}
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
                const o = data.overall; const target = data.rules?.targetPoints ?? 600;
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
                      <span style={{ color: C.ink }}>{o.points ?? 0} of {target} points</span>
                      <span style={{ color: o.targetPct >= 100 ? C.green : C.pinkDeep }}>{o.targetPct}%</span>
                    </div>
                    <div style={{ height: 12, borderRadius: 8, background: C.lineSoft, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${o.targetPct}%`, background: o.targetPct >= 100 ? C.green : C.pink, borderRadius: 8, transition: 'width .4s' }} />
                    </div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, marginTop: 4 }}>Target {target} points — money starts above it</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12, marginTop: 16 }}>
                      {o.isMarsha ? (
                        <Tile label={`Commission · ${o.corporateInvoices} invoice(s)`} value={`AED ${o.commissionDisplay}`} accent={C.green} />
                      ) : (
                        <>
                          <Tile label="Bonus (above target)" value={`AED ${o.bonusDisplay}`} accent={C.green} />
                          {(o.referralCount ?? 0) > 0 && <Tile label={`Brought in · ${o.referralCount}`} value={`${o.referralPoints} pts`} accent="#8a6cc0" />}
                          {(o.glamCount ?? 0) > 0 && <Tile label={`Glam Doll · ${o.glamCount}`} value={`${(o.glamCount ?? 0) * 20} pts`} accent="#8a6cc0" />}
                        </>
                      )}
                      <Tile label="Tips" value={`AED ${o.tipsDisplay}`} accent={C.pinkDeep} />
                    </div>
                    {o.isMarsha ? (() => {
                      const rate = data.rules?.commissionRate ?? 2;
                      const min = data.rules?.commissionMinAed ?? 20000;
                      const exampleDeal = Math.max(min, 30000);
                      const exampleComm = Math.round(exampleDeal * rate / 100);
                      const bullet: CSSProperties = { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, fontWeight: 600, color: C.ink, lineHeight: 1.5, padding: '3px 0' };
                      return (
                        <div style={{ marginTop: 16, background: C.greenSoft, border: `1px solid #bfe3cf`, borderRadius: 14, padding: '14px 16px' }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: C.green, marginBottom: 8 }}>💼 How your commission works</div>
                          <div style={bullet}><span>💰</span><span>You earn <b>{rate}% commission</b> on every corporate / events deal you bring in worth <b>AED {min.toLocaleString()}+</b>.</span></div>
                          <div style={bullet}><span>📄</span><span>It counts your <b>manual invoices</b> and <b>sales the owner tags to you</b> — never website bookings.</span></div>
                          <div style={bullet}><span>✅</span><span>Each qualifying deal is <b>tagged to you for owner approval</b> before it counts.</span></div>
                          <div style={bullet}><span>🙌</span><span><b>Tips are always 100% yours</b>, on top of commission.</span></div>
                          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid #bfe3cf`, fontSize: 12, fontWeight: 700, color: C.ink, lineHeight: 1.6 }}>
                            <b style={{ color: C.green }}>Example:</b> a AED {exampleDeal.toLocaleString()} corporate booking → you earn <b style={{ color: C.green }}>AED {exampleComm.toLocaleString()}</b>. Deals under AED {min.toLocaleString()} don’t count.
                          </div>
                        </div>
                      );
                    })() : (
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 12, lineHeight: 1.6 }}>
                        {`Points: ${data.rules?.eventPoints ?? 10} per event · ${data.rules?.fiveStarPoints ?? 20} per 5★ · ${data.rules?.glamPoints ?? 20} per Glam Doll · plus points on the value of events you bring in with your code (AED 4,000 event = 2,000 points). Reach ${target} points, then every 100 points above it = AED 10. Tips are 100% yours on top. Part-timers aren’t included.`}
                      </div>
                    )}
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
                <span style={{ fontSize: 16, width: 24, textAlign: 'center', flex: 'none', fontWeight: 800, color: C.muted }}>{i === 0 ? '🥇' : i + 1}</span>
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
            Points = 10 × completed events + 20 × 5★ ratings + 20 × Glam Doll + points on the value of events you bring in. Everyone sees the points board — the money each person earns stays private.
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
                    <span style={{ fontSize: 17, width: 24, textAlign: 'center', flex: 'none', fontWeight: 800, color: C.muted }}>{i === 0 ? '🥇' : i + 1}</span>
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
                  {/* target progress to 600 points */}
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 8, borderRadius: 6, background: C.lineSoft, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${s.targetPct ?? 0}%`, background: (s.targetPct ?? 0) >= 100 ? C.green : C.pink, borderRadius: 6 }} />
                    </div>
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: C.muted, minWidth: 92, textAlign: 'right' }}>{s.points ?? 0}/{data.rules?.targetPoints ?? 600} pts · {s.targetPct ?? 0}%</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginTop: 11, paddingTop: 11, borderTop: `1px solid ${C.lineSoft}` }}>
                    <MiniKpi label="Points" value={String(s.points ?? 0)} accent={C.pinkDeep} />
                    <MiniKpi label="Bonus" value={`AED ${s.bonusDisplay ?? '0'}`} accent={C.green} />
                    <MiniKpi label={`Tips · ${s.tipsCount}`} value={`AED ${s.tipsDisplay}`} accent={C.pinkDeep} />
                    <MiniKpi label="Rating" value={s.avgRating > 0 ? `${s.avgRating} ★` : '—'} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 11, fontWeight: 600, color: C.muted, lineHeight: 1.6 }}>
            Target {data.rules?.targetPoints ?? 600} points. Above it, every 100 points = AED 10. Points: 10/event · 20/5★ · 20/Glam Doll · plus the value of events each person brings in (AED 4,000 = 2,000 pts). Tips 100% on top.
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

// Recorded rewards (Achievements): each positive-feedback reward with its event,
// date, amount and the feedback that earned it. Employee sees own; owner/manager
// see everyone's. Amounts come from the settings value at the time earned.
function AchievementsPanel({ personal }: { personal: boolean }) {
  const [data, setData] = useState<{ rows: any[]; totalDisplay: string } | null>(null);
  useEffect(() => { api.achievements().then(setData).catch(() => setData({ rows: [], totalDisplay: '0' })); }, []);
  if (!data) return null;
  // Each 5★ moment is worth 20 points in the new system.
  const ptsFor = (kind: string) => (kind === 'good_feedback' || kind === 'glam_doll' ? 20 : 0);
  const totalPts = data.rows.reduce((s, r) => s + ptsFor(r.kind), 0);
  return (
    <Panel title={personal ? '🏆 My 5★ moments' : '🏆 5★ moments'} action={<span style={{ ...fredoka(15), color: C.pinkDeep }}>{totalPts} pts</span>}>
      {data.rows.length === 0 ? (
        <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No 5★ feedback yet — great customer ratings will show up here with the points you earned. 🌟</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {data.rows.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
              <span style={{ fontSize: 18 }}>{r.kind === 'glam_doll' ? '💅' : '🌟'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
                  {!personal && r.member ? `${r.member} · ` : ''}Great customer feedback
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.date}{r.eventId ? ` · ${r.eventId}` : ''}{r.note ? ` · "${r.note}"` : ''}
                </div>
              </div>
              <span style={{ ...fredoka(14), color: C.pinkDeep }}>+{ptsFor(r.kind)} pts</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
