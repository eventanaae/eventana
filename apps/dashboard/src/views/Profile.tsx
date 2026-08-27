import { useEffect, useState } from 'react';
import { api, clearStaffToken } from '../api';
import { C, fredoka, Panel, Button, Spinner } from '../ui';

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', border: `1px solid ${C.line}`, borderRadius: 12,
  padding: '11px 13px', fontSize: 14, fontWeight: 600, color: C.ink, outline: 'none',
};

/**
 * A staff member's own profile: who they are, how many events they've run, the
 * rewards they've earned, their personal details (which they keep up to date),
 * and the performance feedback their manager left them.
 */
export function Profile({ onSignedOut }: { onSignedOut?: () => void }) {
  const [d, setD] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => { void api.myProfile().then((p) => {
    setD(p);
    setForm({ birthday: p.birthday || '', passportName: p.passportName || '', passportNumber: p.passportNumber || '', emiratesId: p.emiratesId || '' });
  }).catch(() => setD({ error: true })); };
  useEffect(() => { load(); }, []);

  if (!d) return <Spinner />;
  if (d.error) return <Panel title="Profile"><div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No personal profile for this account.</div></Panel>;

  const save = async () => {
    setBusy(true); setMsg(null);
    try { await api.updateMyProfile({ birthday: form.birthday || null, passportName: form.passportName, passportNumber: form.passportNumber, emiratesId: form.emiratesId }); setMsg('Saved ✓'); load(); setTimeout(() => setMsg(null), 1500); }
    catch (e: any) { setMsg(e?.message ?? 'Could not save'); } finally { setBusy(false); }
  };

  const initial = String(d.name || '?').trim().charAt(0).toUpperCase();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      {/* Identity header */}
      <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 20, overflow: 'hidden' }}>
        <div style={{ height: 5, background: `linear-gradient(90deg,${C.pink},${C.pinkDeep})` }} />
        <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 60, height: 60, borderRadius: 999, background: C.gradPink, color: '#fff', display: 'grid', placeItems: 'center', ...fredoka(26), flex: 'none' }}>{initial}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...fredoka(21), color: C.ink }}>{d.name}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.pinkDeep }}>{d.jobTitle}</div>
            {d.email && <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 2 }}>{d.email}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', borderTop: `1px solid ${C.lineSoft}` }}>
          <div style={{ flex: 1, textAlign: 'center', padding: '12px 8px' }}>
            <div style={{ ...fredoka(20), color: C.ink }}>{d.eventsDone}</div>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.3px', color: C.muted }}>EVENTS DONE</div>
          </div>
          <div style={{ width: 1, background: C.lineSoft }} />
          <div style={{ flex: 1, textAlign: 'center', padding: '12px 8px' }}>
            <div style={{ ...fredoka(20), color: C.green }}>AED {d.achievements.totalDisplay}</div>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.3px', color: C.muted }}>REWARDS EARNED</div>
          </div>
        </div>
      </div>

      {/* Missing-info nudge */}
      {d.missing?.length > 0 && (
        <div style={{ background: C.yellowSoft, border: `1px solid #f0e0b8`, borderRadius: 14, padding: '12px 15px', fontSize: 12.5, fontWeight: 700, color: C.yellowInk, lineHeight: 1.5 }}>
          ⚠️ Please complete your profile — still needed: {d.missing.join(', ')}.
        </div>
      )}

      {/* Performance feedback from the manager */}
      <Panel title="⭐ Performance feedback">
        {d.performance ? (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, lineHeight: 1.6 }}>“{d.performance.text}”</div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, marginTop: 8 }}>— {d.performance.by}{d.performance.at ? ` · ${d.performance.at}` : ''}</div>
          </div>
        ) : (
          <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No feedback yet — keep up the great work! 🌟</div>
        )}
      </Panel>

      {/* Achievements */}
      <Panel title={`🏆 Achievements (${d.achievements.rows.length})`}>
        {d.achievements.rows.length === 0 ? (
          <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>Great customer feedback and performance rewards will appear here.</div>
        ) : d.achievements.rows.map((r: any) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
            <span style={{ fontSize: 17 }}>{r.kind === 'glam_doll' ? '💅' : r.kind === 'event_incentive' ? '🎯' : '🌟'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Good customer feedback</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted }}>{r.date}{r.event_id ? ` · ${r.event_id}` : ''}{r.note ? ` · "${r.note}"` : ''}</div>
            </div>
            <span style={{ ...fredoka(14), color: C.green }}>+AED {r.amountDisplay}</span>
          </div>
        ))}
      </Panel>

      {/* Personal details — editable by the staff member */}
      <Panel title="🪪 Personal details">
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>
          Kept private for HR & payroll. Please keep these accurate and up to date.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Full name (as on passport)"><input value={form.passportName} onChange={(e) => setForm({ ...form, passportName: e.target.value })} style={input} /></Field>
          <Field label="Date of birth"><input type="date" value={form.birthday} onChange={(e) => setForm({ ...form, birthday: e.target.value })} style={input} /></Field>
          <Field label="Passport number"><input value={form.passportNumber} onChange={(e) => setForm({ ...form, passportNumber: e.target.value })} style={input} /></Field>
          <Field label="Emirates ID number"><input value={form.emiratesId} onChange={(e) => setForm({ ...form, emiratesId: e.target.value })} style={input} /></Field>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save my details'}</Button>
            {msg && <span style={{ fontSize: 12.5, fontWeight: 700, color: msg.includes('✓') ? C.green : C.red }}>{msg}</span>}
          </div>
        </div>
      </Panel>

      <div>
        <Button tone="ghost" onClick={() => { clearStaffToken(); onSignedOut?.(); window.location.reload(); }}>Sign out</Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: C.muted2 }}>{label}</span>
      {children}
    </label>
  );
}
