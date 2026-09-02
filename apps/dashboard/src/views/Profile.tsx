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
  const [kpi, setKpi] = useState<any>(null);

  const load = () => {
    void api.myProfile().then(setD).catch(() => setD({ error: true }));
    const now = new Date();
    const m = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    void api.kpis(m).then(setKpi).catch(() => setKpi(null));
  };
  useEffect(() => { load(); }, []);

  if (!d) return <Spinner />;
  if (d.error) return <Panel title="Profile"><div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No personal profile for this account.</div></Panel>;

  const initial = String(d.name || '?').trim().charAt(0).toUpperCase();

  // One read-only line of official HR detail (label + value, or a muted dash).
  const detailRow = (label: string, value?: string | null) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: C.muted }}>{label}</span>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: value ? C.ink : C.muted, textAlign: 'right' }}>{value || '—'}</span>
    </div>
  );

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
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.3px', color: C.muted }}>EVENTS</div>
          </div>
          <div style={{ width: 1, background: C.lineSoft }} />
          <div style={{ flex: 1, textAlign: 'center', padding: '12px 8px' }}>
            <div style={{ ...fredoka(20), color: C.pinkDeep }}>{kpi?.overall?.points ?? 0}</div>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.3px', color: C.muted }}>POINTS / {kpi?.overall?.targetPoints ?? 600}</div>
          </div>
          <div style={{ width: 1, background: C.lineSoft }} />
          <div style={{ flex: 1, textAlign: 'center', padding: '12px 8px' }}>
            <div style={{ ...fredoka(20), color: C.green }}>AED {kpi?.overall?.earningsDisplay ?? '0'}</div>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.3px', color: C.muted }}>EARNED</div>
          </div>
        </div>
        {kpi?.overall && (
          <div style={{ padding: '0 20px 16px' }}>
            <div style={{ height: 9, borderRadius: 6, background: C.lineSoft, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${kpi.overall.targetPct ?? 0}%`, background: (kpi.overall.targetPct ?? 0) >= 100 ? C.green : C.pink, borderRadius: 6, transition: 'width .4s' }} />
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
              {(kpi.overall.points ?? 0) >= (kpi.overall.targetPoints ?? 600)
                ? `🎉 Target reached! Every 100 points above ${kpi.overall.targetPoints ?? 600} now earns you AED 10.`
                : `Your monthly target is ${kpi.overall.targetPoints ?? 600} points — ${(kpi.overall.targetPoints ?? 600) - (kpi.overall.points ?? 0)} to go. Hitting it keeps Eventana growing; past it, every 100 points = AED 10 for you.`}
            </div>
          </div>
        )}
      </div>

      {/* Collapsible sections (dropdowns) in the owner's order:
          Personal details → Annual leave → Day off → Performance → Moments →
          Consequence → Salary increment. */}
      <Section title="🪪 Personal details" defaultOpen>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>
          Kept private for HR & payroll. These are set by the office from your official documents — please contact us if anything needs updating.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {detailRow('Full name (as on passport)', d.passportName)}
          {detailRow('Date of birth', d.birthday)}
          {detailRow('Joining date', d.joiningDate)}
          {detailRow('Passport number', d.passportNumber)}
          {detailRow('Emirates ID number', d.emiratesId)}
        </div>
      </Section>

      <LeaveSection />

      <Section title="🗓️ Weekly day off">
        {d.dayOff ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ ...fredoka(22), color: C.pinkDeep }}>{d.dayOff}</span>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: C.muted }}>Your rest day each week — you won’t be assigned to events on this day.</span>
          </div>
        ) : <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No weekly day off set.</div>}
      </Section>

      <Section title="⭐ Performance feedback">
        {d.performance ? (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, lineHeight: 1.6 }}>“{d.performance.text}”</div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, marginTop: 8 }}>— {d.performance.by}{d.performance.at ? ` · ${d.performance.at}` : ''}</div>
          </div>
        ) : (
          <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No feedback yet — keep up the great work! 🌟</div>
        )}
      </Section>

      <Section title={`🏆 5★ moments (${d.achievements.rows.length})`}>
        {d.achievements.rows.length === 0 ? (
          <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>Great customer feedback will appear here — each 5★ is worth 20 points.</div>
        ) : d.achievements.rows.map((r: any) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
            <span style={{ fontSize: 17 }}>{r.kind === 'glam_doll' ? '💅' : '🌟'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Great customer feedback</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted }}>{r.date}{r.event_id ? ` · ${r.event_id}` : ''}{r.note ? ` · "${r.note}"` : ''}</div>
            </div>
            <span style={{ ...fredoka(14), color: C.pinkDeep }}>+{r.kind === 'good_feedback' || r.kind === 'glam_doll' ? 20 : 0} pts</span>
          </div>
        ))}
      </Section>

      <WarningsSection />

      <Section title="💵 Salary increment">
        {d.salaryIncrement
          ? <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, lineHeight: 1.6 }}>{d.salaryIncrement}</div>
          : <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No salary increment recorded yet.</div>}
      </Section>

      <div>
        <Button tone="ghost" onClick={() => { clearStaffToken(); onSignedOut?.(); window.location.reload(); }}>Sign out</Button>
      </div>
    </div>
  );
}

/** A collapsible profile section (dropdown), styled like a Panel. */
function Section({ title, children, defaultOpen = false }: { title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 16, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '15px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ ...fredoka(15), color: C.ink }}>{title}</span>
        <span style={{ color: C.muted, fontSize: 12, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s', flex: 'none' }}>▼</span>
      </button>
      {open && <div style={{ padding: '0 18px 18px' }}>{children}</div>}
    </div>
  );
}

const LEAVE_STATUS: Record<string, { bg: string; fg: string; label: string }> = {
  pending: { bg: C.yellowSoft, fg: C.yellowInk, label: 'Pending' },
  approved: { bg: '#E1F3EC', fg: C.green, label: 'Approved' },
  rejected: { bg: '#FBE7EC', fg: C.red, label: 'Rejected' },
  cancelled: { bg: C.lineSoft, fg: C.muted, label: 'Cancelled' },
};

const WARN_LETTER_LABEL: Record<string, string> = {
  documented: 'Documented Warning', first: '1st Warning Letter', second: '2nd Warning Letter',
  third: '3rd Warning Letter', final: 'Final Warning Letter',
};

/** "Consequence Management" — the disciplinary letters on the member's record,
 *  each with reasons, date, validity and salary deduction. Hidden when none. */
function WarningsSection() {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api.myWarnings().then(setRows).catch(() => setRows([])); }, []);
  const line = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.5 }}>
      <span style={{ fontWeight: 800, color: C.muted, minWidth: 108 }}>{label}</span>
      <span style={{ fontWeight: 700, color: C.ink }}>{value}</span>
    </div>
  );
  const list = rows ?? [];
  return (
    <Section title="⚖️ Consequence Management">
      {list.length === 0 ? (
        <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No warnings on record. 🌿</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {list.map((w, i) => {
            const pct = Number(w.salaryDeductionPct) || 0;
            return (
              <div key={i} style={{ border: `1px solid #f3c9d3`, background: '#FBE7EC', borderRadius: 12, padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ ...fredoka(16), color: C.red, marginBottom: 2 }}>{WARN_LETTER_LABEL[w.wtype] ?? 'Warning Letter'}</div>
                {w.reason && line('Reasons:', w.reason)}
                {w.issuedDate && line('Date:', w.issuedDate)}
                {w.validUntil && line('Valid till:', w.validUntil)}
                {line('Salary Deduction:', pct > 0 ? `Yes — ${pct}%` : 'No')}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/** A staff member's own annual-leave balance, request form, and history. */
function LeaveSection() {
  const [d, setD] = useState<any>(null);
  const [form, setForm] = useState({ startDate: '', endDate: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.myLeave().then(setD).catch(() => setD({ error: true }));
  useEffect(() => { load(); }, []);
  if (!d || d.error) return null;
  const bal = d.balance;
  if (!bal?.onScheme) return null; // accounts off the leave scheme don't show it

  const days = form.startDate && form.endDate && form.endDate >= form.startDate
    ? Math.floor((Date.parse(form.endDate) - Date.parse(form.startDate)) / 86_400_000) + 1 : 0;

  const submit = async () => {
    if (!form.startDate || !form.endDate) { setMsg('Choose a start and end date.'); return; }
    setBusy(true); setMsg(null);
    try {
      await api.requestLeave({ startDate: form.startDate, endDate: form.endDate, reason: form.reason.trim() || undefined });
      setForm({ startDate: '', endDate: '', reason: '' });
      setMsg('Request submitted ✓'); load(); setTimeout(() => setMsg(null), 2500);
    } catch (e: any) { setMsg(e?.message ?? 'Could not submit.'); } finally { setBusy(false); }
  };
  const cancel = async (id: number) => { try { await api.cancelLeave(id); load(); } catch { /* ignore */ } };

  const stat = (label: string, value: React.ReactNode, color: string = C.ink) => (
    <div style={{ flex: '1 1 30%', minWidth: 92, background: '#faf6f2', borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.3px', color: C.muted }}>{label}</div>
      <div style={{ ...fredoka(19), color }}>{value}</div>
    </div>
  );

  return (
    <Section title="🌴 Annual leave">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
        {stat('ENTITLEMENT', `${bal.entitlement}/yr`)}
        {stat('ACCRUED', `${bal.accrued}`)}
        {stat('USED', `${bal.used}`)}
        {stat('PENDING', `${bal.pending}`, C.yellowInk)}
        {stat('REMAINING', `${bal.remaining}`, bal.remaining > 0 ? C.green : C.red)}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>
        Accrues {bal.accrualPerMonth} day(s) per completed month{bal.startDate ? ` since ${bal.startDate}` : ''}. Remaining = accrued − used − pending.
      </div>

      {!bal.startDate ? (
        <div style={{ background: C.yellowSoft, border: '1px solid #f0e0b8', borderRadius: 12, padding: '11px 13px', fontSize: 12.5, fontWeight: 700, color: C.yellowInk, lineHeight: 1.5 }}>
          Your employment start date isn’t set yet — ask the owner to add it so your balance can be calculated.
        </div>
      ) : (
        <div style={{ borderTop: `1px solid ${C.lineSoft}`, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink }}>Request leave</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Field label="From"><input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} style={{ ...input, minWidth: 140, height: 46, WebkitAppearance: 'none', appearance: 'none' }} /></Field>
            <Field label="To"><input type="date" value={form.endDate} min={form.startDate || undefined} onChange={(e) => setForm({ ...form, endDate: e.target.value })} style={{ ...input, minWidth: 140, height: 46, WebkitAppearance: 'none', appearance: 'none' }} /></Field>
          </div>
          <Field label="Reason (optional)"><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. family visit" style={{ ...input, height: 46 }} /></Field>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button onClick={submit} disabled={busy || days <= 0}>{busy ? 'Submitting…' : days > 0 ? `Request ${days} day(s)` : 'Request leave'}</Button>
            {msg && <span style={{ fontSize: 12, fontWeight: 700, color: msg.includes('✓') ? C.green : C.red }}>{msg}</span>}
          </div>
        </div>
      )}

      {d.requests?.length > 0 && (
        <div style={{ marginTop: 14, borderTop: `1px solid ${C.lineSoft}`, paddingTop: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, marginBottom: 6 }}>Leave history</div>
          {d.requests.map((r: any) => {
            const s = LEAVE_STATUS[r.status] ?? LEAVE_STATUS.pending;
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{r.start_date} → {r.end_date} · {r.days} day(s)</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, lineHeight: 1.5 }}>
                    Requested {r.submitted_at}{r.reason ? ` · "${r.reason}"` : ''}
                    {r.decided_by ? ` · ${r.status} by ${r.decided_by}${r.decided_at ? ` on ${r.decided_at}` : ''}` : ''}
                  </div>
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 999, background: s.bg, color: s.fg, whiteSpace: 'nowrap' }}>{s.label}</span>
                {r.status === 'pending' && (
                  <button onClick={() => cancel(r.id)} style={{ border: `1px solid ${C.line}`, background: '#fff', borderRadius: 8, padding: '3px 8px', fontSize: 10.5, fontWeight: 700, color: C.muted, cursor: 'pointer' }}>Cancel</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
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
