import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { api } from '../api';
import { Badge, Button, C, fredoka, Panel, Spinner } from '../ui';
import { Empty } from './Today';

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'error' | 'info' | 'neutral'> = {
  sent: 'ok', approved: 'ok', scheduled: 'info', sending: 'info',
  pending_approval: 'warn', rejected: 'error', failed: 'error', draft: 'neutral',
};

const OCCASION_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  commercial: { bg: '#fdeef6', fg: '#c02f80', label: 'Offer' },
  national: { bg: '#eef4ff', fg: '#2f5fc0', label: 'National' },
  islamic: { bg: '#eef9f1', fg: '#2f8f57', label: 'Islamic' },
  seasonal: { bg: '#fff4e8', fg: '#c07a2f', label: 'Seasonal' },
  greeting: { bg: '#f4eefb', fg: '#7a2fc0', label: 'Greeting' },
  awareness: { bg: '#eef7f9', fg: '#2f7f9c', label: 'Awareness' },
};

export function Marketing() {
  const [data, setData] = useState<any>(null);
  const [cal, setCal] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [occ, setOcc] = useState<any | null>(null);      // occasion pop-up
  const [wizard, setWizard] = useState(false);            // new-campaign wizard
  const [month, setMonth] = useState<string>('all');
  const [showList, setShowList] = useState(false);

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
        ...Object.keys(corpLabels).map((c) => ({ id: `corp:${c}`, label: corpLabels[c], n: corpBy[c]?.emailable ?? 0 })),
      ],
    },
  ];
  const audienceLabel = (a: string): string => {
    for (const g of audienceGroups) for (const o of g.options) if (o.id === a) return o.label;
    return String(a).replace(/_/g, ' ');
  };
  const findFull = (id: string) => data.campaigns.find((x: any) => String(x.id) === String(id));
  const refreshOcc = (slug: string, updated: any[]) => setOcc((updated ?? []).find((o) => o.slug === slug) ?? null);

  const months = (cal ?? []).filter((o) => o.dateISO).map((o) => o.dateISO.slice(0, 7));
  const uniqueMonths = Array.from(new Set(months)).sort();
  const monthLabel = (m: string) => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!data.emailConfigured && (
        <div style={{ background: '#fff7ec', border: '1px solid #f0d9a8', borderRadius: 12, padding: '12px 15px', fontSize: 12.5, fontWeight: 600, color: '#8a6d2f', lineHeight: 1.6 }}>
          ⚙ Sending isn’t connected yet — set <b>RESEND_API_KEY</b> and <b>EMAIL_FROM</b> to start sending.
        </div>
      )}

      {/* Just what matters: how many we can email. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
        <Tile label="Customer emails" value={data.audiences.all} />
        <Tile label="Company emails" value={data.corporate?.emailable ?? 0} />
      </div>

      <Panel title="Send a campaign">
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, lineHeight: 1.6, marginBottom: 12 }}>
          Start a brand-new campaign, or tap an occasion below to review the draft that’s already prepared.
        </div>
        <Button onClick={() => { setMsg(null); setWizard(true); }}>➕ New campaign</Button>
        {msg && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.green, marginTop: 10 }}>{msg}</div>}
      </Panel>

      <Panel title="Marketing calendar">
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.6, marginBottom: 12 }}>
          A draft is auto-prepared a few weeks before each occasion — tap one to review & approve. Islamic dates are estimates; confirm the Hijri date before approving.
        </div>
        {uniqueMonths.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            <button onClick={() => setMonth('all')} style={{ ...chip, ...(month === 'all' ? chipActive : {}) }}>All</button>
            {uniqueMonths.map((m) => (
              <button key={m} onClick={() => setMonth(m)} style={{ ...chip, ...(month === m ? chipActive : {}) }}>{monthLabel(m)}</button>
            ))}
          </div>
        )}
        {!cal ? <Spinner /> : cal.length === 0 ? <Empty>No occasions.</Empty> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cal.filter((o) => month === 'all' || (o.dateISO && o.dateISO.slice(0, 7) === month)).map((o) => {
              const tone = OCCASION_TONE[o.type] ?? OCCASION_TONE.seasonal;
              const dateLabel = o.dateISO ? new Date(o.dateISO + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
              const away = o.daysAway;
              const drafts = [o.consumer, o.corporate].filter(Boolean).length;
              return (
                <button key={o.slug} onClick={() => setOcc(o)} style={{ textAlign: 'left', cursor: 'pointer', border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 12px', background: '#fff', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ background: tone.bg, color: tone.fg, fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>{tone.label}</span>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: C.ink }}>{o.name}</div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted }}>
                      {dateLabel}
                      {o.needsDateConfirm ? ' · confirm date' : drafts ? ` · ${drafts} draft${drafts > 1 ? 's' : ''} ready` : ' · tap to prepare'}
                    </div>
                  </div>
                  {away != null && away >= 0 && <span style={countdownStyle(away)}>{away === 0 ? '🎉 Today' : `⏳ ${away}d`}</span>}
                  <span style={{ color: C.muted, fontSize: 18, fontWeight: 700 }}>›</span>
                </button>
              );
            })}
          </div>
        )}
      </Panel>

      <CorporatePanel labels={corpLabels} counts={data.corporate} onChanged={load} setMsg={setMsg} />

      <Panel title="All campaigns">
        <button onClick={() => setShowList((v) => !v)} style={miniBtn}>{showList ? 'Hide' : `Show (${data.campaigns.length})`}</button>
        {showList && (
          data.campaigns.length === 0 ? <div style={{ marginTop: 10 }}><Empty>No campaigns yet.</Empty></div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              {data.campaigns.map((c: any) => (
                <div key={c.id} style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.subject}</span>
                    {String(c.audience).startsWith('corp') && <Badge tone="neutral">B2B</Badge>}
                    <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{String(c.status).replace(/_/g, ' ')}</Badge>
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, margin: '4px 0 0' }}>
                    {audienceLabel(c.audience)}
                    {c.status === 'sent' && ` · ${c.sent_count}/${c.recipient_count} sent`}
                    {c.scheduled_for && c.status !== 'sent' ? ` · ⏰ ${new Date(c.scheduled_for).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <button onClick={() => openPreview(Number(c.id))} style={miniBtn}>👁 Preview</button>
                    {(c.status === 'draft' || c.status === 'rejected' || c.status === 'pending_approval' || c.status === 'scheduled') && (
                      <button onClick={() => setEditing(c)} style={miniBtn}>✏️ Edit</button>
                    )}
                    {(c.status === 'draft' || c.status === 'rejected') && (
                      <button onClick={() => act(() => api.submitCampaign(c.id), 'Submitted for approval.')} disabled={busy} style={miniBtn}>Submit</button>
                    )}
                    {c.status === 'pending_approval' && (
                      <>
                        <button onClick={() => act(() => api.approveCampaign(c.id), 'Approved.')} disabled={busy || !data.emailConfigured} style={{ ...miniBtn, borderColor: C.green, color: C.green }}>✓ Approve</button>
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
          )
        )}
      </Panel>

      {preview !== null && (
        <Modal title="Email preview" onClose={() => setPreview(null)}>
          <iframe title="preview" srcDoc={preview} style={{ width: '100%', height: '65vh', border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff' }} />
        </Modal>
      )}

      {editing && (
        <EditModal campaign={editing} groups={audienceGroups} busy={busy}
          onClose={() => setEditing(null)} onSave={saveEdit} onPreview={() => openPreview(Number(editing.id))} />
      )}

      {occ && (
        <OccasionModal
          occ={occ} busy={busy} emailConfigured={data.emailConfigured} findFull={findFull}
          onClose={() => setOcc(null)}
          onPreview={openPreview}
          onEdit={(id) => setEditing(findFull(id))}
          onAct={act}
          onReloaded={(slug) => { api.marketingCalendar().then((r) => refreshOcc(slug, r.occasions ?? [])); load(); }}
        />
      )}

      {wizard && (
        <NewCampaignWizard groups={audienceGroups} busy={busy} emailConfigured={data.emailConfigured}
          onClose={() => setWizard(false)} onPreview={openPreview} onReload={load} setMsg={setMsg} />
      )}
    </div>
  );
}

// ── Occasion pop-up: both versions + services + actions (incl. Regenerate) ────
function OccasionModal({ occ, busy, emailConfigured, findFull, onClose, onPreview, onEdit, onAct, onReloaded }: {
  occ: any; busy?: boolean; emailConfigured: boolean; findFull: (id: string) => any;
  onClose: () => void; onPreview: (id: number) => void; onEdit: (id: string) => void;
  onAct: (fn: () => Promise<any>, ok: string) => Promise<void>; onReloaded: (slug: string) => void;
}) {
  const [svc, setSvc] = useState(false);
  const dateLabel = occ.dateISO ? new Date(occ.dateISO + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—';

  const version = (label: string, camp: any, canHave: boolean) => {
    if (!canHave) return null;
    return (
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 13, flex: 1 }}>{label}</span>
          {camp ? <Badge tone={STATUS_TONE[camp.status] ?? 'neutral'}>{String(camp.status).replace(/_/g, ' ')}</Badge> : <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 700 }}>not prepared</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {!camp ? (
            <button onClick={() => onAct(() => api.prepareOccasion(occ.slug), 'Draft prepared.').then(() => onReloaded(occ.slug))} disabled={busy} style={{ ...miniBtn, borderColor: C.pink, color: C.pinkDeep }}>✨ Generate draft</button>
          ) : (
            <>
              <button onClick={() => onPreview(Number(camp.id))} style={miniBtn}>👁 Preview</button>
              {(camp.status === 'pending_approval' || camp.status === 'draft') && (
                <>
                  <button onClick={() => onEdit(camp.id)} style={miniBtn}>✏️ Edit</button>
                  <button onClick={() => onAct(() => api.regenerateCampaign(Number(camp.id)), 'Regenerated from the template.').then(() => onReloaded(occ.slug))} disabled={busy} style={miniBtn}>🔄 Regenerate</button>
                  <button onClick={() => onAct(() => api.approveCampaign(Number(camp.id)), 'Approved & scheduled.').then(() => onReloaded(occ.slug))} disabled={busy || !emailConfigured} style={{ ...miniBtn, borderColor: C.green, color: C.green }}>✓ Approve</button>
                  <button onClick={() => { const r = window.prompt('Reason for rejecting?'); if (r !== null) onAct(() => api.rejectCampaign(Number(camp.id), r), 'Rejected.').then(() => onReloaded(occ.slug)); }} disabled={busy} style={{ ...miniBtn, color: C.red }}>Reject</button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <Modal title={occ.name} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted }}>
          {dateLabel}{occ.daysAway != null && occ.daysAway >= 0 ? ` · in ${occ.daysAway} day${occ.daysAway === 1 ? '' : 's'}` : ''}
        </div>
        {occ.needsDateConfirm && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.red }}>Please confirm this year’s Hijri date before approving.</div>}

        {!occ.greetingOnly && (
          <button onClick={() => setSvc(true)} style={{ ...miniBtn, alignSelf: 'flex-start' }}>🧩 Edit suggested services{occ.servicesCustom ? ' ✓' : ''}</button>
        )}

        {occ.greetingOnly
          ? version('Greeting to customers', occ.consumer, true)
          : (
            <>
              {version('👨‍👩‍👧 Customers version', occ.consumer, !occ.corporateOnly)}
              {version('🏢 Companies version', occ.corporate, true)}
            </>
          )}
      </div>

      {svc && (
        <ServicesModal occasion={occ} busy={busy}
          onClose={() => setSvc(false)}
          onSave={async (payload) => { await onAct(() => api.saveOccasionSettings(occ.slug, payload), 'Saved — emails updated.'); setSvc(false); onReloaded(occ.slug); }} />
      )}
    </Modal>
  );
}

// ── New-campaign wizard (step by step) ───────────────────────────────────────
function NewCampaignWizard({ groups, busy, emailConfigured, onClose, onPreview, onReload, setMsg }: {
  groups: any[]; busy?: boolean; emailConfigured: boolean;
  onClose: () => void; onPreview: (id: number) => void; onReload: () => void; setMsg: (m: string) => void;
}) {
  const [step, setStep] = useState(1);
  const [audience, setAudience] = useState('all');
  const [subject, setSubject] = useState('');
  const [services, setServices] = useState('');
  const [message, setMessage] = useState('');
  const [offer, setOffer] = useState('');
  const [working, setWorking] = useState(false);
  const [created, setCreated] = useState<any | null>(null);
  const isCorp = audience.startsWith('corp:');

  const buildBody = (): string => {
    const greet = `<p>Hi {{name}},</p>`;
    const msg = message.trim() ? textToHtml(message) : '';
    const offerHtml = (!isCorp && offer.trim())
      ? `<div style="background:#FDEFF6;border:2px dashed #F3B6D2;border-radius:16px;padding:14px 16px;text-align:center;margin:4px 0 14px"><div style="font-size:12px;font-weight:800;color:#c98bb0;letter-spacing:1px">SPECIAL OFFER</div><div style="font-size:17px;font-weight:800;color:#E94F9C;margin-top:2px">${offer.trim()}</div></div>`
      : '';
    const lines = services.split('\n').map((s) => s.trim()).filter(Boolean);
    const svc = lines.length ? `<p style="font-weight:700;margin:16px 0 8px">What we can bring:</p><ul style="margin:0;padding-left:20px">${lines.map((l) => `<li style="margin:0 0 6px">${l}</li>`).join('')}</ul>` : '';
    const sig = `<p style="margin:16px 0 0">With love,<br/>The Eventana Team 💕</p>`;
    return `${greet}${msg}${offerHtml}${svc}${sig}`;
  };

  const generate = async () => {
    setWorking(true);
    try {
      const c = await api.createCampaign({ subject: subject.trim(), bodyHtml: buildBody(), audience });
      setCreated(c);
      onReload();
      setStep(5);
    } catch (e: any) { setMsg(e?.message ?? 'Could not create the campaign.'); }
    finally { setWorking(false); }
  };

  const canNext = (step === 1 && audience) || (step === 2 && subject.trim().length > 1) || step === 3 || step === 4;
  const stepTitles = ['Who is it for?', 'Subject line', 'Services & message', 'Review', 'Done 🎉'];

  return (
    <Modal title={`New campaign · ${stepTitles[step - 1]}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* progress dots */}
        <div style={{ display: 'flex', gap: 6 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} style={{ flex: 1, height: 5, borderRadius: 4, background: n <= step ? C.pink : C.line }} />
          ))}
        </div>

        {step === 1 && (
          <Field label="Send this campaign to">
            <AudienceSelect groups={groups} value={audience} onChange={setAudience} />
            <div style={{ fontSize: 11.5, color: C.muted, fontWeight: 600, marginTop: 6 }}>
              {isCorp ? 'Companies get a services + “why us” email.' : 'Customers get a warm email — you can add a special offer.'}
            </div>
          </Field>
        )}
        {step === 2 && (
          <Field label="Subject line (what they see first)">
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. A little treat for your next celebration 🎉" style={input} autoFocus />
          </Field>
        )}
        {step === 3 && (
          <>
            <Field label="Services to feature (one per line, optional)">
              <textarea value={services} onChange={(e) => setServices(e.target.value)} rows={5} style={{ ...input, resize: 'vertical', lineHeight: 1.5 }}
                placeholder={'📸 Photo booth\n🖼️ Main backdrop & stand\n🎁 Giveaways\n🎨 Flower arranging / pottery painting'} />
            </Field>
            <Field label="Message (optional)">
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} placeholder="A warm line or two…" />
            </Field>
            {!isCorp && (
              <Field label="Special offer for customers (optional)">
                <input value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="e.g. 10% off this week 🎉" style={input} />
              </Field>
            )}
          </>
        )}
        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
            <Row k="To" v={groups.flatMap((g: any) => g.options).find((o: any) => o.id === audience)?.label ?? audience} />
            <Row k="Subject" v={subject} />
            <Row k="Services" v={services.trim() ? `${services.split('\n').filter((s) => s.trim()).length} listed` : '—'} />
            {!isCorp && <Row k="Offer" v={offer.trim() || '—'} />}
            <div style={{ fontSize: 11.5, color: C.muted, fontWeight: 600, marginTop: 4 }}>The logo, buttons and WhatsApp contact are added automatically.</div>
          </div>
        )}
        {step === 5 && created && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>✅ Draft created — review it before it goes out.</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => onPreview(Number(created.id))} style={miniBtn}>👁 Preview</button>
              <button onClick={async () => { await api.submitCampaign(created.id).catch(() => {}); onReload(); setMsg('Submitted for approval.'); onClose(); }} style={miniBtn}>Submit for approval</button>
              <button onClick={async () => { try { await api.approveCampaign(created.id); onReload(); setMsg('Approved & sending.'); onClose(); } catch (e: any) { setMsg(e?.message ?? 'Approve failed.'); } }} disabled={!emailConfigured} style={{ ...miniBtn, borderColor: C.green, color: C.green }}>✓ Approve &amp; send</button>
            </div>
          </div>
        )}

        {/* nav */}
        {step < 5 && (
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            {step > 1 && <Button tone="ghost" onClick={() => setStep(step - 1)}>Back</Button>}
            <div style={{ flex: 1 }} />
            {step < 4 && <Button onClick={() => setStep(step + 1)} disabled={!canNext}>Next</Button>}
            {step === 4 && <Button onClick={generate} disabled={working || !subject.trim()}>{working ? 'Generating…' : '✨ Generate'}</Button>}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <span style={{ fontWeight: 800, color: C.muted, minWidth: 70 }}>{k}</span>
      <span style={{ flex: 1, fontWeight: 600 }}>{v}</span>
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
              <button key={o.id} onClick={() => onChange(o.id)} style={{ ...chip, ...(value === o.id ? chipActive : {}) }}>{o.label} · {o.n}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Edit a draft: subject, audience, schedule, plain-text message ────────────
function EditModal({ campaign, groups, onClose, onSave, onPreview, busy }: {
  campaign: any; groups: any[]; onClose: () => void; onSave: (p: Record<string, unknown>) => void; onPreview: () => void; busy?: boolean;
}) {
  const [subject, setSubject] = useState(campaign.subject ?? '');
  const [audience, setAudience] = useState(campaign.audience ?? 'all');
  const [bodyText, setBodyText] = useState(htmlToText(campaign.body_html ?? ''));
  const toLocal = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const [schedule, setSchedule] = useState(toLocal(campaign.scheduled_for));
  return (
    <Modal title="Edit campaign" onClose={onClose} busy={busy} saveLabel="Save"
      onSave={() => onSave({ subject: subject.trim(), audience, bodyHtml: textToHtml(bodyText), scheduledFor: schedule ? new Date(schedule).toISOString() : undefined })}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Subject"><input value={subject} onChange={(e) => setSubject(e.target.value)} style={input} /></Field>
        <Field label="Who receives it"><AudienceSelect groups={groups} value={audience} onChange={setAudience} /></Field>
        <Field label="Send time"><input type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} style={input} /></Field>
        <Field label="Message">
          <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={9} style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} />
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginTop: 4 }}>Plain text — logo, buttons and WhatsApp contact are added automatically.</div>
        </Field>
        <button onClick={onPreview} style={miniBtn}>👁 Preview current version</button>
      </div>
    </Modal>
  );
}

// ── Owner-authored services / intro / customer-offer for an occasion ─────────
function ServicesModal({ occasion, onClose, onSave, busy }: {
  occasion: any; onClose: () => void; onSave: (p: { services: string; intro: string; offer: string }) => void; busy?: boolean;
}) {
  const [services, setServices] = useState<string>((occasion.services ?? []).join('\n'));
  const [intro, setIntro] = useState<string>(occasion.intro ?? '');
  const [offer, setOffer] = useState<string>(occasion.offer ?? '');
  return (
    <Modal title={`Services · ${occasion.name}`} onClose={onClose} busy={busy} saveLabel="Save" onSave={() => onSave({ services, intro, offer })}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, lineHeight: 1.5 }}>
          The services this occasion’s email lists — <b>one per line</b>. Saved and reused every year, for both the customer and company version.
        </div>
        <Field label="Suggested services (one per line)">
          <textarea value={services} onChange={(e) => setServices(e.target.value)} rows={8} style={{ ...input, resize: 'vertical', lineHeight: 1.5 }}
            placeholder={'📸 Photo booth\n🖼️ Main backdrop & stand\n🎁 Giveaways\n🎨 Flower arranging / pottery painting'} />
        </Field>
        <Field label="Custom intro (optional)">
          <textarea value={intro} onChange={(e) => setIntro(e.target.value)} rows={3} style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} placeholder="Leave empty to use the default warm intro." />
        </Field>
        <Field label="Customer offer (optional — customers only)">
          <input value={offer} onChange={(e) => setOffer(e.target.value)} style={input} placeholder="e.g. 10% off bookings this week 🎉" />
        </Field>
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
    try { await fn(); setMsg(ok); loadLeads(); onChanged(); }
    catch (e: any) { setMsg(e?.message ?? 'Action failed.'); }
    finally { setBusy(false); }
  };

  const cats = Object.keys(labels);
  return (
    <Panel title="Companies (B2B directory)">
      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.6, marginBottom: 10 }}>
        Businesses we can email — grown automatically each week from Google. Total <b>{counts?.total ?? 0}</b> · emailable <b>{counts?.emailable ?? 0}</b>.
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
            Paste one company per line: <b>Name, email, phone, emirate</b>. Category is detected automatically.
          </div>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={10} placeholder={'GEMS Dubai American Academy, info@example.ae, 04 123 4567, Dubai'} style={{ ...input, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }} />
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

function countdownStyle(days: number): CSSProperties {
  const base: CSSProperties = { fontSize: 12, fontWeight: 800, padding: '5px 11px', borderRadius: 20, whiteSpace: 'nowrap' };
  if (days <= 3) return { ...base, background: '#fdeaea', color: '#c2453a' };
  if (days <= 14) return { ...base, background: C.pinkSoft, color: C.pinkDeep };
  if (days <= 30) return { ...base, background: '#fff7ec', color: '#a97b1e' };
  return { ...base, background: '#f3eef1', color: C.muted };
}

function htmlToText(html: string): string {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/(p|li|div|h[1-6]|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"')
    .replace(/\{\{\s*name\s*\}\}/g, '{name}')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function textToHtml(text: string): string {
  return String(text || '').trim()
    .replace(/\{name\}/g, '{{name}}')
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

const input: CSSProperties = { width: '100%', border: `1px solid ${C.line}`, borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 600, outline: 'none', background: '#fff', color: C.ink };
const chip: CSSProperties = { border: `1px solid ${C.line}`, background: '#fff', borderRadius: 20, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', color: C.ink };
const chipActive: CSSProperties = { border: `1px solid ${C.pink}`, background: C.pinkSoft, color: C.pinkDeep };
const miniBtn: CSSProperties = { border: `1px solid ${C.line}`, background: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', color: C.ink };
