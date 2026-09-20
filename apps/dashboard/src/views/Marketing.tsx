import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { api } from '../api';
import { Badge, Button, C, fredoka, Panel, Spinner } from '../ui';
import { Empty } from './Today';

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'error' | 'info' | 'neutral'> = {
  sent: 'ok', approved: 'ok', scheduled: 'info', sending: 'info',
  pending_approval: 'warn', rejected: 'error', failed: 'error', draft: 'neutral',
};

const TEMPLATES: Record<string, string> = {
  seasonal: 'Hi {name},\n\nThe season for celebrations is here! 🎉 Book your Eventana party this month and let us bring the magic — themed setups, inflatables, food stations and a team that handles everything.\n\nWith love,\nThe Eventana Team',
  comeback: 'Hi {name},\n\nWe miss planning parties with you! 💐 Here’s a little nudge to celebrate your next occasion with Eventana. We’ll make it unforgettable.\n\nSee you soon,\nThe Eventana Team',
};

const OCCASION_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  commercial: { bg: '#fdeef6', fg: '#c02f80', label: 'Offer' },
  national: { bg: '#eef4ff', fg: '#2f5fc0', label: 'National' },
  islamic: { bg: '#eef9f1', fg: '#2f8f57', label: 'Islamic' },
  seasonal: { bg: '#fff4e8', fg: '#c07a2f', label: 'Seasonal' },
  greeting: { bg: '#f4eefb', fg: '#7a2fc0', label: 'Greeting' },
};

export function Marketing() {
  const [data, setData] = useState<any>(null);
  const [cal, setCal] = useState<any[] | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<string>('all');
  const [schedule, setSchedule] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null>(null);

  const load = () => {
    api.marketing().then(setData).catch(() => setData(null));
    api.marketingCalendar().then((r) => setCal(r.occasions ?? [])).catch(() => setCal([]));
  };
  useEffect(() => { load(); }, []);

  const openPreview = async (id: number) => {
    setMsg(null);
    try { setPreview(await api.campaignPreviewHtml(id)); }
    catch { setMsg('Could not load the preview.'); }
  };

  if (!data) return <Spinner />;

  // Audience options: our customers + the corporate directory.
  const corpLabels: Record<string, string> = data.corporateLabels ?? {};
  const corpBy: Record<string, { total: number; emailable: number }> = data.corporate?.byCategory ?? {};
  const audienceGroups = [
    {
      group: '👨‍👩‍👧 Our customers',
      options: [
        { id: 'all', label: 'All customers', n: data.audiences.all },
        { id: 'past_customers', label: 'Past customers', n: data.audiences.past_customers },
        { id: 'no_recent_booking', label: 'Lapsed (90d)', n: data.audiences.no_recent_booking },
      ],
    },
    {
      group: '🏢 Companies (B2B)',
      options: [
        { id: 'corp:all', label: 'All companies', n: data.corporate?.emailable ?? 0 },
        ...Object.keys(corpLabels).filter((c) => (corpBy[c]?.emailable ?? 0) > 0 || c !== 'other')
          .map((c) => ({ id: `corp:${c}`, label: corpLabels[c], n: corpBy[c]?.emailable ?? 0 })),
      ],
    },
  ];
  const audienceCountOf = (a: string): number => {
    if (a.startsWith('corp:')) {
      const cat = a.slice(5);
      return cat === 'all' ? (data.corporate?.emailable ?? 0) : (corpBy[cat]?.emailable ?? 0);
    }
    return data.audiences[a] ?? 0;
  };
  const audienceLabel = (a: string): string => {
    for (const g of audienceGroups) for (const o of g.options) if (o.id === a) return o.label;
    return a.replace(/_/g, ' ');
  };

  const create = async (submit: boolean) => {
    if (!subject.trim() || !body.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const bodyHtml = body.trim().split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join('');
      const c = await api.createCampaign({ subject: subject.trim(), bodyHtml, audience, scheduledFor: schedule ? new Date(schedule).toISOString() : undefined });
      if (submit) { await api.submitCampaign(c.id); setMsg('Submitted for approval — review & approve it below.'); }
      else setMsg(schedule ? 'Draft saved with a send time.' : 'Draft saved.');
      setSubject(''); setBody(''); setSchedule('');
      load();
    } catch (e: any) { setMsg(e?.message ?? 'Could not save the campaign.'); }
    finally { setBusy(false); }
  };

  const act = async (fn: () => Promise<any>, okMsg: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg(okMsg); load(); }
    catch (e: any) { setMsg(e?.message ?? 'Action failed.'); }
    finally { setBusy(false); }
  };

  const saveEdit = async (patch: Record<string, unknown>) => {
    if (!editing) return;
    await act(() => api.updateCampaign(Number(editing.id), patch), 'Saved.');
    setEditing(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!data.emailConfigured && (
        <div style={{ background: '#fff7ec', border: '1px solid #f0d9a8', borderRadius: 12, padding: '12px 15px', fontSize: 12.5, fontWeight: 600, color: '#8a6d2f', lineHeight: 1.6 }}>
          ⚙ Sending isn’t connected yet. You can compose, schedule and save campaigns now — set
          <b> RESEND_API_KEY</b> and <b>EMAIL_FROM</b> in the server environment to start sending.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12 }}>
        <Tile label="All customers" value={data.audiences.all} />
        <Tile label="Past customers" value={data.audiences.past_customers} />
        <Tile label="Lapsed (90d)" value={data.audiences.no_recent_booking} />
        <Tile label="Companies (emailable)" value={data.corporate?.emailable ?? 0} />
        <Tile label="Unsubscribed" value={data.audiences.optedOut} />
      </div>

      <Panel title="Marketing calendar">
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.6, marginBottom: 12 }}>
          A branded draft email is prepared for you automatically a few weeks before each occasion — you just
          <b> review, edit and approve</b>. Nothing is ever sent without your approval. Islamic dates are estimates — please confirm the Hijri date before approving.
        </div>
        {!cal ? <Spinner /> : cal.length === 0 ? <Empty>No occasions.</Empty> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cal.map((o: any) => {
              const tone = OCCASION_TONE[o.type] ?? OCCASION_TONE.seasonal;
              const dateLabel = o.dateISO
                ? new Date(o.dateISO + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
                : '—';
              const away = o.daysAway;
              const camp = o.campaign;
              return (
                <div key={o.slug} style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ background: tone.bg, color: tone.fg, fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>{tone.label}</span>
                    <div style={{ flex: 1, minWidth: 130 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{o.name}</div>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted }}>{dateLabel}{o.greetingOnly ? ' · greeting only' : ''}</div>
                    </div>
                    {away != null && away >= 0 && (
                      <span style={countdownStyle(away)}>{away === 0 ? '🎉 Today' : `⏳ ${away} day${away === 1 ? '' : 's'} left`}</span>
                    )}
                    {o.needsDateConfirm ? (
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.red }}>Confirm this year’s date</span>
                    ) : camp ? (
                      <Badge tone={STATUS_TONE[camp.status] ?? 'neutral'}>{String(camp.status).replace(/_/g, ' ')}</Badge>
                    ) : (
                      <button onClick={() => act(() => api.prepareOccasion(o.slug), 'Draft prepared — review it below.')} disabled={busy} style={{ ...miniBtn, borderColor: C.pink, color: C.pinkDeep }}>Prepare now</button>
                    )}
                  </div>
                  {camp && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      <button onClick={() => openPreview(Number(camp.id))} style={miniBtn}>👁 Preview</button>
                      {(camp.status === 'pending_approval' || camp.status === 'draft') && (
                        <>
                          <button onClick={() => setEditing(data.campaigns.find((x: any) => String(x.id) === String(camp.id)))} style={miniBtn}>✏️ Edit</button>
                          <button onClick={() => act(() => api.approveCampaign(camp.id), 'Approved & scheduled.')} disabled={busy || !data.emailConfigured} style={{ ...miniBtn, borderColor: C.green, color: C.green }}>✓ Approve</button>
                          <button onClick={() => { const r = window.prompt('Reason for rejecting?'); if (r !== null) act(() => api.rejectCampaign(camp.id, r), 'Rejected.'); }} disabled={busy} style={{ ...miniBtn, color: C.red }}>Reject</button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="Compose campaign">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <AudienceSelect groups={audienceGroups} value={audience} onChange={setAudience} />
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line" style={input} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7}
            placeholder="Write your message… (use {name} for the recipient’s name)"
            style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setBody(TEMPLATES.seasonal)} style={chip}>Seasonal template</button>
            <button onClick={() => setBody(TEMPLATES.comeback)} style={chip}>Come-back template</button>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: 11.5, fontWeight: 700, color: C.muted }}>
              Schedule (optional):{' '}
              <input type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} style={{ ...input, width: 'auto', display: 'inline-block' }} />
            </label>
            <div style={{ flex: 1 }} />
            <Button tone="ghost" onClick={() => create(false)} disabled={busy || !subject.trim() || !body.trim()}>Save draft</Button>
            <Button onClick={() => create(true)} disabled={busy || !subject.trim() || !body.trim()}>
              {busy ? 'Working…' : `Submit · ${audienceCountOf(audience)}`}
            </Button>
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, lineHeight: 1.5 }}>
            Sending to <b>{audienceLabel(audience)}</b>. Campaigns are never sent automatically — after you submit, you (or the CEO) approve before anything goes out.
          </div>
          {msg && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.green }}>{msg}</div>}
        </div>
      </Panel>

      <CorporatePanel labels={corpLabels} counts={data.corporate} onChanged={load} setMsg={setMsg} />

      <Panel title="Campaigns">
        {data.campaigns.length === 0 ? <Empty>No campaigns yet.</Empty> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.campaigns.map((c: any) => (
              <div key={c.id} style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.subject}</span>
                  {String(c.audience).startsWith('corp') && <Badge tone="neutral">B2B</Badge>}
                  {(c.source === 'anniversary' || c.source === 'occasion' || c.source === 'occasion_corp') && <Badge tone="info">auto</Badge>}
                  <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{String(c.status).replace(/_/g, ' ')}</Badge>
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, margin: '4px 0 0' }}>
                  {audienceLabel(c.audience)}
                  {c.status === 'sent' && ` · ${c.sent_count}/${c.recipient_count} sent`}
                  {c.created_by && ` · by ${c.created_by}`}
                  {c.approved_by && ` · approved by ${c.approved_by}`}
                  {' · '}
                  {c.sent_at ? new Date(c.sent_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                    : c.scheduled_for ? `⏰ ${new Date(c.scheduled_for).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                    : new Date(c.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                </div>
                {c.status === 'rejected' && c.rejection_reason && (
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: C.red, marginTop: 4 }}>Rejected: {c.rejection_reason}</div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button onClick={() => openPreview(Number(c.id))} style={miniBtn}>👁 Preview</button>
                  {(c.status === 'draft' || c.status === 'rejected' || c.status === 'pending_approval' || c.status === 'scheduled') && (
                    <button onClick={() => setEditing(c)} style={miniBtn}>✏️ Edit</button>
                  )}
                  {(c.status === 'draft' || c.status === 'rejected') && (
                    <button onClick={() => act(() => api.submitCampaign(c.id), 'Submitted for approval.')} disabled={busy} style={miniBtn}>Submit for approval</button>
                  )}
                  {c.status === 'pending_approval' && (
                    <>
                      <button onClick={() => act(() => api.approveCampaign(c.id), 'Approved.')} disabled={busy || !data.emailConfigured} style={{ ...miniBtn, borderColor: C.green, color: C.green }}>
                        ✓ Approve &amp; {c.scheduled_for && new Date(c.scheduled_for).getTime() > Date.now() ? 'schedule' : 'send'}
                      </button>
                      <button onClick={() => { const r = window.prompt('Reason for rejecting?'); if (r !== null) act(() => api.rejectCampaign(c.id, r), 'Rejected.'); }} disabled={busy} style={{ ...miniBtn, color: C.red }}>Reject</button>
                    </>
                  )}
                  {(c.status === 'draft' || c.status === 'rejected' || c.status === 'scheduled' || c.status === 'failed') && (
                    <button onClick={() => act(() => api.deleteCampaign(c.id), 'Deleted.')} disabled={busy} style={{ ...miniBtn, color: C.red }}>Delete</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {preview !== null && (
        <Modal title="Email preview" onClose={() => setPreview(null)}>
          <iframe title="preview" srcDoc={preview} style={{ width: '100%', height: '65vh', border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff' }} />
        </Modal>
      )}

      {editing && (
        <EditModal
          campaign={editing}
          groups={audienceGroups}
          onClose={() => setEditing(null)}
          onSave={saveEdit}
          onPreview={() => openPreview(Number(editing.id))}
          busy={busy}
        />
      )}
    </div>
  );
}

// ── Audience selector (customers + companies), grouped ──────────────────────
function AudienceSelect({ groups, value, onChange }: {
  groups: Array<{ group: string; options: Array<{ id: string; label: string; n: number }> }>;
  value: string; onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {groups.map((g) => (
        <div key={g.group}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, margin: '2px 0 6px' }}>{g.group}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {g.options.map((o) => (
              <button key={o.id} onClick={() => onChange(o.id)} style={{ ...chip, ...(value === o.id ? chipActive : {}) }}>
                {o.label} · {o.n}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Edit a draft: subject, audience, schedule, and (advanced) the email HTML ──
function EditModal({ campaign, groups, onClose, onSave, onPreview, busy }: {
  campaign: any;
  groups: Array<{ group: string; options: Array<{ id: string; label: string; n: number }> }>;
  onClose: () => void; onSave: (p: Record<string, unknown>) => void; onPreview: () => void; busy?: boolean;
}) {
  const [subject, setSubject] = useState(campaign.subject ?? '');
  const [audience, setAudience] = useState(campaign.audience ?? 'all');
  const [bodyHtml, setBodyHtml] = useState(campaign.body_html ?? '');
  const toLocal = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const [schedule, setSchedule] = useState(toLocal(campaign.scheduled_for));
  return (
    <Modal title="Edit campaign" onClose={onClose} onSave={() => onSave({
      subject: subject.trim(), audience, bodyHtml,
      scheduledFor: schedule ? new Date(schedule).toISOString() : undefined,
    })} busy={busy} saveLabel="Save">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Subject"><input value={subject} onChange={(e) => setSubject(e.target.value)} style={input} /></Field>
        <Field label="Who receives it"><AudienceSelect groups={groups} value={audience} onChange={setAudience} /></Field>
        <Field label="Send time"><input type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} style={input} /></Field>
        <Field label="Email content (HTML)">
          <textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} rows={9} style={{ ...input, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }} />
        </Field>
        <button onClick={onPreview} style={miniBtn}>👁 Preview current version</button>
      </div>
    </Modal>
  );
}

// ── Corporate leads directory ───────────────────────────────────────────────
function CorporatePanel({ labels, counts, onChanged, setMsg }: {
  labels: Record<string, string>; counts: any; onChanged: () => void; setMsg: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [leads, setLeads] = useState<any[] | null>(null);
  const [cat, setCat] = useState('');
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');

  const loadLeads = (category = cat) => {
    api.corporateLeads(category ? { category } : undefined).then((r) => setLeads(r.leads ?? [])).catch(() => setLeads([]));
  };
  useEffect(() => { if (open && leads === null) loadLeads(); }, [open]);

  const run = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true);
    try { const r = await fn(); setMsg(ok); loadLeads(); onChanged(); return r; }
    catch (e: any) { setMsg(e?.message ?? 'Action failed.'); }
    finally { setBusy(false); }
  };

  const cats = Object.keys(labels);
  return (
    <Panel title="Companies (B2B directory)">
      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.6, marginBottom: 10 }}>
        Businesses we can email for event bookings — grown automatically each week from Google, auto-categorised. Total <b>{counts?.total ?? 0}</b> · emailable <b>{counts?.emailable ?? 0}</b>.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 8, marginBottom: 12 }}>
        {cats.map((c) => (
          <div key={c} style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: '9px 11px' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted }}>{labels[c]}</div>
            <div style={{ ...fredoka(17), color: C.ink }}>{counts?.byCategory?.[c]?.total ?? 0}
              <span style={{ fontSize: 11, color: C.green, fontWeight: 700 }}> · {counts?.byCategory?.[c]?.emailable ?? 0} ✉️</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => run(() => api.collectCorporate(), 'Collecting from Google — this can take a minute.')} disabled={busy} style={{ ...miniBtn, borderColor: C.pink, color: C.pinkDeep }}>🔄 Collect from Google now</button>
        <button onClick={() => setImporting(true)} style={miniBtn}>⬆ Import list</button>
        <button onClick={() => setOpen((v) => !v)} style={miniBtn}>{open ? 'Hide list' : 'View list'}</button>
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            <button onClick={() => { setCat(''); loadLeads(''); }} style={{ ...chip, ...(cat === '' ? chipActive : {}) }}>All</button>
            {cats.map((c) => (
              <button key={c} onClick={() => { setCat(c); loadLeads(c); }} style={{ ...chip, ...(cat === c ? chipActive : {}) }}>{labels[c]}</button>
            ))}
          </div>
          {leads === null ? <Spinner /> : leads.length === 0 ? <Empty>No companies yet — collect from Google or import a list.</Empty> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 420, overflowY: 'auto' }}>
              {leads.map((l) => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${C.line}`, borderRadius: 10, padding: '8px 10px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700 }}>{l.name}</div>
                    <div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>
                      {labels[l.category] ?? l.category}{l.emirate ? ` · ${l.emirate}` : ''}{l.email ? ` · ${l.email}` : ' · no email'}{l.phone ? ` · ${l.phone}` : ''}
                    </div>
                  </div>
                  <select value={l.status} onChange={(e) => run(() => api.updateCorporateLead(Number(l.id), { status: e.target.value }), 'Updated.')} style={{ ...input, width: 'auto', padding: '5px 8px', fontSize: 11.5 }}>
                    {['new', 'contacted', 'interested', 'booked', 'not_interested'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                  <button onClick={() => { if (window.confirm('Remove this company?')) run(() => api.deleteCorporateLead(Number(l.id)), 'Removed.'); }} style={{ ...miniBtn, color: C.red }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {importing && (
        <Modal title="Import companies" onClose={() => setImporting(false)} busy={busy}
          onSave={async () => { await run(() => api.importCorporate(importText), 'Imported.'); setImportText(''); setImporting(false); }} saveLabel="Import">
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, marginBottom: 8, lineHeight: 1.5 }}>
            Paste one company per line: <b>Name, email, phone, emirate</b> (comma or tab separated). Category is detected automatically.
          </div>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={10} placeholder={'GEMS Dubai American Academy, info@example.ae, 04 123 4567, Dubai\nAl Noor Hospital, info@alnoor.ae, 02 765 4321, Abu Dhabi'} style={{ ...input, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }} />
        </Modal>
      )}
    </Panel>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: C.muted, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function Modal({ title, children, onClose, onSave, busy, saveLabel }: {
  title: string; children: ReactNode; onClose: () => void; onSave?: () => void; busy?: boolean; saveLabel?: string;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(59,54,65,.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px 12px', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 560, maxHeight: '92dvh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.28)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px 12px', flex: 'none', borderBottom: `1px solid ${C.line}` }}>
          <button onClick={onClose} style={{ ...miniBtn, border: 'none', color: C.muted }}>Close</button>
          <div style={{ ...fredoka(15), flex: 1, textAlign: 'center' }}>{title}</div>
          {onSave ? <button onClick={onSave} disabled={busy} style={{ ...miniBtn, border: 'none', color: C.pinkDeep, fontWeight: 800 }}>{busy ? '…' : (saveLabel ?? 'Save')}</button> : <span style={{ width: 48 }} />}
        </div>
        <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '14px 18px 18px' }}>{children}</div>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: '13px 15px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 5 }}>{label}</div>
      <div style={{ ...fredoka(22), color: C.ink }}>{value}</div>
    </div>
  );
}

// A clear, colour-coded "days left" pill.
function countdownStyle(days: number): CSSProperties {
  const base: CSSProperties = { fontSize: 12, fontWeight: 800, padding: '5px 11px', borderRadius: 20, whiteSpace: 'nowrap' };
  if (days <= 3) return { ...base, background: '#fdeaea', color: '#c2453a' };
  if (days <= 14) return { ...base, background: C.pinkSoft, color: C.pinkDeep };
  if (days <= 30) return { ...base, background: '#fff7ec', color: '#a97b1e' };
  return { ...base, background: '#f3eef1', color: C.muted };
}

const input: CSSProperties = { width: '100%', border: `1px solid ${C.line}`, borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 600, outline: 'none', background: '#fff', color: C.ink };
const chip: CSSProperties = { border: `1px solid ${C.line}`, background: '#fff', borderRadius: 20, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', color: C.ink };
const chipActive: CSSProperties = { border: `1px solid ${C.pink}`, background: C.pinkSoft, color: C.pinkDeep };
const miniBtn: CSSProperties = { border: `1px solid ${C.line}`, background: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', color: C.ink };
