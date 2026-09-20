import { useState, useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { api } from '../api';
import { Badge, Button, C, fredoka, Panel, Spinner } from '../ui';
import { Empty } from './Today';

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'error' | 'info' | 'neutral'> = {
  sent: 'ok', approved: 'ok', scheduled: 'info', sending: 'info',
  pending_approval: 'warn', rejected: 'error', failed: 'error', draft: 'neutral',
};
export function Marketing() {
  const [data, setData] = useState<any>(null);
  const [cal, setCal] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [flowInit, setFlowInit] = useState<{ path: 'menu' | 'new' | 'existing'; aud: 'customer' | 'company'; step: number } | null>(null);
  const [companies, setCompanies] = useState(false);
  const openFlow = (path: 'menu' | 'new' | 'existing', aud: 'customer' | 'company' = 'customer', step = 1) => { setMsg(null); setFlowInit({ path, aud, step }); };
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
  const findFull = (id: string) => data.campaigns.find((x: any) => String(x.id) === String(id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!data.emailConfigured && (
        <div style={{ background: '#fff7ec', border: '1px solid #f0d9a8', borderRadius: 12, padding: '12px 15px', fontSize: 12.5, fontWeight: 600, color: '#8a6d2f', lineHeight: 1.6 }}>
          ⚙ Sending isn’t connected yet — set <b>RESEND_API_KEY</b> and <b>EMAIL_FROM</b> to start sending.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Tile label="Customer emails" value={data.audiences.all} onClick={() => openFlow('new', 'customer', 2)} />
        <Tile label="Company emails" value={data.corporate?.emailable ?? 0} onClick={() => openFlow('new', 'company', 2)} />
      </div>

      <Panel title="Marketing">
        <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
          What would you like to do? 🌸
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Choice emoji="🆕" label="New campaign" sub="Write and send a fresh one" onClick={() => openFlow('new')} />
          <Choice emoji="📅" label="Existing occasion" sub="Review a draft that’s ready" onClick={() => openFlow('existing')} />
          <Choice emoji="🏢" label="Companies directory" sub={`${data.corporate?.total ?? 0} businesses`} onClick={() => setCompanies(true)} />
        </div>
        {msg && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.green, marginTop: 12 }}>{msg}</div>}
      </Panel>

      {flowInit && (
        <MarketingFlow
          data={data} cal={cal} busy={busy}
          initialPath={flowInit.path} initialAud={flowInit.aud} initialStep={flowInit.step}
          onClose={() => setFlowInit(null)}
          onPreview={openPreview}
          onEdit={(id: string) => setEditing(findFull(id))}
          onAct={act}
          onReload={load}
          setMsg={setMsg}
        />
      )}

      {companies && (
        <Modal title="Companies (B2B)" onClose={() => setCompanies(false)}>
          <CorporatePanel labels={data.corporateLabels ?? {}} counts={data.corporate} onChanged={load} setMsg={setMsg} bare />
        </Modal>
      )}

      {preview !== null && (
        <Modal title="Email preview" onClose={() => setPreview(null)}>
          <iframe title="preview" srcDoc={preview} style={{ width: '100%', height: '65vh', border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff' }} />
        </Modal>
      )}

      {editing && (
        <EditModal campaign={editing} busy={busy}
          onClose={() => setEditing(null)} onSave={saveEdit} onPreview={() => openPreview(Number(editing.id))} />
      )}
    </div>
  );
}

// ── The one marketing flow: step by step, one question per screen ────────────
function MarketingFlow({ data, cal, busy, initialPath, initialAud, initialStep, onClose, onPreview, onEdit, onAct, onReload, setMsg }: {
  data: any; cal: any[] | null; busy?: boolean;
  initialPath?: 'menu' | 'new' | 'existing'; initialAud?: 'customer' | 'company'; initialStep?: number;
  onClose: () => void; onPreview: (id: number) => void; onEdit: (id: string) => void;
  onAct: (fn: () => Promise<any>, ok: string) => Promise<void>; onReload: () => void; setMsg: (m: string) => void;
}) {
  const [path, setPath] = useState<'menu' | 'new' | 'existing'>(initialPath ?? 'menu');
  const [step, setStep] = useState(initialStep ?? 1);
  // shared
  const [aud, setAud] = useState<'customer' | 'company'>(initialAud ?? 'customer');
  // new
  const [category, setCategory] = useState<string>('all'); // company category (or 'all')
  const [subject, setSubject] = useState('');
  const [services, setServices] = useState('');
  const [offer, setOffer] = useState('');
  const [occasionNote, setOccasionNote] = useState('');
  const [sendDate, setSendDate] = useState('');
  const [working, setWorking] = useState(false);
  const [created, setCreated] = useState<any | null>(null);
  // existing
  const [occ, setOcc] = useState<any | null>(null);
  const [svc, setSvc] = useState(false);
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});

  const back = () => {
    if (step > 1) return setStep(step - 1);
    // At the first step: go back to the menu only if we started there; else close.
    if (path !== 'menu' && (initialPath ?? 'menu') === 'menu') { setPath('menu'); setCreated(null); setOcc(null); return; }
    onClose();
  };

  const title = path === 'menu' ? 'Send a campaign'
    : path === 'new' ? 'New campaign'
    : 'Existing campaign';

  // ---- build a manual email body from the wizard fields ----
  const buildBody = (): string => {
    const isCorp = aud === 'company';
    const heading = occasionNote.trim() ? `<p style="font-size:19px;font-weight:800;margin:0 0 12px;color:#3B3641">${occasionNote.trim()}</p>` : '';
    const greet = isCorp ? `<p>Hello <b>{{name}}</b>,</p>` : `<p>Hi {{name}},</p>`;
    const lead = isCorp
      ? `<p>We’d love to help you create a memorable event — Eventana can handle every detail, tailored to your organisation.</p>`
      : '';
    const offerHtml = (!isCorp && offer.trim())
      ? `<div style="background:#FDEFF6;border:2px dashed #F3B6D2;border-radius:16px;padding:14px 16px;text-align:center;margin:8px 0 14px"><div style="font-size:12px;font-weight:800;color:#c98bb0;letter-spacing:1px">SPECIAL OFFER</div><div style="font-size:17px;font-weight:800;color:#E94F9C;margin-top:2px">${offer.trim()}</div></div>`
      : '';
    const lines = services.split('\n').map((s) => s.trim()).filter(Boolean);
    const list = lines.length ? `<p style="font-weight:700;margin:16px 0 8px">What we can bring:</p><ul style="margin:0;padding-left:20px">${lines.map((l) => `<li style="margin:0 0 6px">${l}</li>`).join('')}</ul>` : '';
    const why = isCorp ? `<p style="font-weight:700;margin:16px 0 8px">Why Eventana:</p><ul style="margin:0;padding-left:20px"><li style="margin:0 0 6px">🇦🇪 We know UAE occasions & local culture better than anyone.</li><li style="margin:0 0 6px">🎨 Tailored to your brand, theme and budget.</li><li style="margin:0 0 6px">✅ Fully managed — setup & teardown handled.</li></ul>` : '';
    const sig = isCorp ? `<p style="margin:16px 0 0">Warm regards,<br/>The Eventana Team</p>` : `<p style="margin:16px 0 0">With love,<br/>The Eventana Team 💕</p>`;
    return `${heading}${greet}${lead}${offerHtml}${list}${why}${sig}`;
  };

  // Steps adapt to the audience (company adds a category picker).
  const newSteps = aud === 'company'
    ? ['audience', 'category', 'subject', 'services', 'when', 'done']
    : ['audience', 'subject', 'services', 'when', 'done'];
  const key = newSteps[step - 1];

  const generate = async () => {
    setWorking(true);
    try {
      const audience = aud === 'company' ? (category === 'all' ? 'corp:all' : `corp:${category}`) : 'all';
      const c = await api.createCampaign({ subject: subject.trim(), bodyHtml: buildBody(), audience, scheduledFor: sendDate ? new Date(sendDate).toISOString() : undefined });
      setCreated(c); onReload(); setStep(newSteps.indexOf('done') + 1);
    } catch (e: any) { setMsg(e?.message ?? 'Could not create the campaign.'); }
    finally { setWorking(false); }
  };

  // all occasions relevant to the chosen audience (prepared or not — the ones
  // without a draft can be prepared with one tap on the next step)
  const existingList = (cal ?? []).filter((o) => !o.needsDateConfirm && (aud === 'company' ? !o.greetingOnly : !o.corporateOnly));
  const chosenCamp = occ ? (aud === 'company' ? occ.corporate : occ.consumer) : null;

  return (
    <Modal title={title} onClose={onClose} onBack={path === 'menu' ? undefined : back}>
      {/* MENU */}
      {path === 'menu' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>What would you like to do?</div>
          <Choice emoji="🆕" label="A new campaign" sub="Write and send a fresh one" onClick={() => { setPath('new'); setStep(1); }} />
          <Choice emoji="📅" label="An existing occasion" sub="Review a draft that’s ready" onClick={() => { setPath('existing'); setStep(1); }} />
        </div>
      )}

      {/* NEW */}
      {path === 'new' && (
        <Wiz step={step} total={newSteps.length}
          onBack={back}
          canNext={key === 'subject' ? subject.trim().length > 1 : true}
          onNext={key === 'subject' || key === 'services' ? () => setStep(step + 1) : undefined}
          footer={key === 'when' ? <Button onClick={generate} disabled={working || !subject.trim()}>{working ? 'Generating…' : '✨ Generate'}</Button> : undefined}
          hideNav={key === 'audience' || key === 'category' || key === 'done'}
        >
          {key === 'audience' && (
            <Q title="Who is this campaign for?">
              <Choice emoji="👨‍👩‍👧" label="Our customers" sub={`${data.audiences.all} emails`} active={aud === 'customer'} onClick={() => { setAud('customer'); setStep(2); }} />
              <Choice emoji="🏢" label="Companies" sub={`${data.corporate?.emailable ?? 0} emails`} active={aud === 'company'} onClick={() => { setAud('company'); setStep(2); }} />
            </Q>
          )}
          {key === 'category' && (
            <Q title="Which companies?">
              <Choice emoji="🏙️" label="All companies" sub={`${data.corporate?.emailable ?? 0} emails`} active={category === 'all'} onClick={() => { setCategory('all'); setStep(step + 1); }} />
              {Object.keys(data.corporateLabels ?? {}).filter((c) => (data.corporate?.byCategory?.[c]?.emailable ?? 0) > 0).map((c) => (
                <Choice key={c} emoji="🏢" label={data.corporateLabels[c]} sub={`${data.corporate?.byCategory?.[c]?.emailable ?? 0} emails`} active={category === c} onClick={() => { setCategory(c); setStep(step + 1); }} />
              ))}
            </Q>
          )}
          {key === 'subject' && (
            <Q title="What’s the subject line?">
              <input value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus placeholder={aud === 'company' ? 'e.g. Plan a memorable event with Eventana' : 'e.g. A treat for your next celebration 🎉'} style={input} />
            </Q>
          )}
          {key === 'services' && (
            <Q title="Which services to include?">
              <textarea value={services} onChange={(e) => setServices(e.target.value)} rows={6} style={{ ...input, resize: 'vertical', lineHeight: 1.5 }}
                placeholder={'📸 Photo booth\n🖼️ Main backdrop & stand\n🎁 Giveaways\n🎨 Flower arranging / pottery painting'} />
              {aud === 'customer' && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: C.muted, marginBottom: 6 }}>Special offer (optional)</div>
                  <input value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="e.g. 10% off this week 🎉" style={input} />
                </div>
              )}
              <div style={{ fontSize: 11.5, color: C.muted, fontWeight: 600, marginTop: 8 }}>The logo, buttons and WhatsApp contact are added automatically.</div>
            </Q>
          )}
          {key === 'when' && (
            <Q title="Occasion & when to send">
              <div style={{ fontSize: 11.5, fontWeight: 800, color: C.muted, marginBottom: 6 }}>Occasion / headline (optional)</div>
              <input value={occasionNote} onChange={(e) => setOccasionNote(e.target.value)} placeholder="e.g. Ramadan 2027, National Day…" style={input} />
              <div style={{ fontSize: 11.5, fontWeight: 800, color: C.muted, margin: '12px 0 6px' }}>Send date &amp; time (optional — leave empty to send on approval)</div>
              <input type="datetime-local" value={sendDate} onChange={(e) => setSendDate(e.target.value)} style={input} />
            </Q>
          )}
          {key === 'done' && created && (
            <Q title="Done 🎉 — review before it goes out">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Action emoji="👁" label="Preview the email" onClick={() => onPreview(Number(created.id))} />
                <Action emoji="✏️" label="Edit the text" onClick={() => onEdit(String(created.id))} />
                <Action emoji="✅" label="Approve & send" tone="green" disabled={!data.emailConfigured}
                  onClick={async () => { try { await api.approveCampaign(created.id); onReload(); setMsg('Approved & sending.'); onClose(); } catch (e: any) { setMsg(e?.message ?? 'Approve failed.'); } }} />
                <Action emoji="📨" label="Submit for approval" onClick={async () => { await api.submitCampaign(created.id).catch(() => {}); onReload(); setMsg('Submitted for approval.'); onClose(); }} />
              </div>
            </Q>
          )}
        </Wiz>
      )}

      {/* EXISTING */}
      {path === 'existing' && (
        <Wiz step={step} total={3} onBack={back} hideNav>
          {step === 1 && (
            <Q title="Which audience?">
              <Choice emoji="👨‍👩‍👧" label="Customers" sub="Our customer list" active={aud === 'customer'} onClick={() => { setAud('customer'); setStep(2); }} />
              <Choice emoji="🏢" label="Companies" sub="The B2B directory" active={aud === 'company'} onClick={() => { setAud('company'); setStep(2); }} />
            </Q>
          )}
          {step === 2 && (
            <Q title="Choose a campaign">
              {!cal ? <Spinner /> : existingList.length === 0 ? <Empty>No occasions for this audience.</Empty> : (() => {
                // Group by month, in date order.
                const groups: Array<{ month: string; label: string; items: any[] }> = [];
                for (const o of existingList) {
                  const m = o.dateISO ? o.dateISO.slice(0, 7) : 'other';
                  let g = groups.find((x) => x.month === m);
                  if (!g) { g = { month: m, label: m === 'other' ? 'Other' : new Date(m + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }), items: [] }; groups.push(g); }
                  g.items.push(o);
                }
                const firstMonth = groups[0]?.month;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {groups.map((g) => {
                      const isOpen = openMonths[g.month] ?? (g.month === firstMonth);
                      return (
                        <div key={g.month}>
                          <button onClick={() => setOpenMonths((s) => ({ ...s, [g.month]: !isOpen }))}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px' }}>
                            <span style={{ flex: 1, textAlign: 'left', fontSize: 12.5, fontWeight: 800, color: C.pinkDeep, letterSpacing: 0.3 }}>{g.label}</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>{g.items.length}</span>
                            <span style={{ color: C.muted, fontSize: 14, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</span>
                          </button>
                          {isOpen && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                              {g.items.map((o) => {
                                const c = aud === 'company' ? o.corporate : o.consumer;
                                return (
                                  <button key={o.slug} onClick={() => { setOcc(o); setStep(3); }} style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: `1px solid ${C.line}`, borderRadius: 12, padding: '11px 12px', background: '#fff', display: 'flex', alignItems: 'center', gap: 10, color: C.ink }}>
                                    <span style={{ flex: 1, fontWeight: 700, fontSize: 13.5, color: C.ink }}>{o.name}</span>
                                    {c ? <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{String(c.status).replace(/_/g, ' ')}</Badge> : <span style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>not prepared</span>}
                                    <span style={{ color: C.muted, fontSize: 18, fontWeight: 700 }}>›</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </Q>
          )}
          {step === 3 && occ && (
            <Q title={occ.name}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {chosenCamp ? (
                  <>
                    <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 600 }}>
                      Status: <Badge tone={STATUS_TONE[chosenCamp.status] ?? 'neutral'}>{String(chosenCamp.status).replace(/_/g, ' ')}</Badge>
                    </div>
                    <Action emoji="👁" label="Preview the email" onClick={() => onPreview(Number(chosenCamp.id))} />
                    {!occ.greetingOnly && <Action emoji="🧩" label={`Edit suggested services${occ.servicesCustom ? ' ✓' : ''}`} onClick={() => setSvc(true)} />}
                    {(chosenCamp.status === 'pending_approval' || chosenCamp.status === 'draft') && (
                      <>
                        <Action emoji="✏️" label="Edit the text" onClick={() => onEdit(String(chosenCamp.id))} />
                        <Action emoji="🔄" label="Regenerate (I don’t like it)" onClick={() => onAct(() => api.regenerateCampaign(Number(chosenCamp.id)), 'Regenerated — preview it again.').then(() => api.marketingCalendar().then((r) => setOcc((r.occasions ?? []).find((x: any) => x.slug === occ.slug) ?? occ)))} />
                        <Action emoji="✅" label="Approve & schedule" tone="green" disabled={!data.emailConfigured}
                          onClick={() => onAct(() => api.approveCampaign(Number(chosenCamp.id)), 'Approved & scheduled.').then(onClose)} />
                        <Action emoji="🚫" label="Reject" tone="red"
                          onClick={() => { const r = window.prompt('Reason for rejecting?'); if (r !== null) onAct(() => api.rejectCampaign(Number(chosenCamp.id), r), 'Rejected.').then(onClose); }} />
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {!occ.greetingOnly && <Action emoji="🧩" label={`Add suggested services${occ.servicesCustom ? ' ✓' : ''}`} onClick={() => setSvc(true)} />}
                    <Action emoji="✨" label="Prepare this draft" onClick={() => onAct(() => api.prepareOccasion(occ.slug, aud === 'company'), 'Draft prepared.').then(() => api.marketingCalendar().then((r) => setOcc((r.occasions ?? []).find((x: any) => x.slug === occ.slug) ?? occ)))} />
                  </>
                )}
              </div>
              {svc && (
                <ServicesModal occasion={occ} busy={busy}
                  onClose={() => setSvc(false)}
                  onSave={async (p) => { await onAct(() => api.saveOccasionSettings(occ.slug, p), 'Saved — emails updated.'); setSvc(false); api.marketingCalendar().then((r) => setOcc((r.occasions ?? []).find((x: any) => x.slug === occ.slug) ?? occ)); }} />
              )}
            </Q>
          )}
        </Wiz>
      )}
    </Modal>
  );
}

// ── Wizard chrome: progress dots + Back/Next ────────────────────────────────
function Wiz({ step, total, children, onBack, onNext, canNext, nextLabel, footer, hideNav }: {
  step: number; total: number; children: ReactNode; onBack: () => void; onNext?: () => void;
  canNext?: boolean; nextLabel?: string; footer?: ReactNode; hideNav?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{ flex: 1, height: 5, borderRadius: 4, background: i < step ? C.pink : C.line }} />
        ))}
      </div>
      {children}
      {!hideNav && (
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <Button tone="ghost" onClick={onBack}>Back</Button>
          <div style={{ flex: 1 }} />
          {footer ?? (onNext && <Button onClick={onNext} disabled={!canNext}>{nextLabel ?? 'Next'}</Button>)}
        </div>
      )}
    </div>
  );
}

function Q({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...fredoka(17), color: C.ink }}>{title}</div>
      {children}
    </div>
  );
}

function Choice({ emoji, label, sub, onClick, active }: { emoji: string; label: string; sub: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} style={{
      cursor: 'pointer', textAlign: 'left', borderRadius: 16, padding: '16px 16px', display: 'flex', alignItems: 'center', gap: 14,
      border: active ? `2px solid ${C.pink}` : `1px solid ${C.line}`, background: active ? C.pinkSoft : '#fff', color: C.ink,
    }}>
      <span style={{ fontSize: 28 }}>{emoji}</span>
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontWeight: 800, fontSize: 15 }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>{sub}</span>
      </span>
    </button>
  );
}

function Action({ emoji, label, onClick, tone, disabled }: { emoji: string; label: string; onClick: () => void; tone?: 'green' | 'red'; disabled?: boolean }) {
  const color = tone === 'green' ? C.green : tone === 'red' ? C.red : C.ink;
  return (
    <button onClick={onClick} disabled={disabled} style={{
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, textAlign: 'left', borderRadius: 12, padding: '13px 14px',
      display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${C.line}`, background: '#fff', color, fontWeight: 700, fontSize: 14,
    }}>
      <span style={{ fontSize: 20 }}>{emoji}</span>{label}
    </button>
  );
}

// ── Edit a draft: subject, schedule, plain-text message ──────────────────────
function EditModal({ campaign, onClose, onSave, onPreview, busy }: {
  campaign: any; onClose: () => void; onSave: (p: Record<string, unknown>) => void; onPreview: () => void; busy?: boolean;
}) {
  const [subject, setSubject] = useState(campaign.subject ?? '');
  const [bodyText, setBodyText] = useState(htmlToText(campaign.body_html ?? ''));
  const toLocal = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const [schedule, setSchedule] = useState(toLocal(campaign.scheduled_for));
  return (
    <Modal title="Edit campaign" onClose={onClose} busy={busy} saveLabel="Save"
      onSave={() => onSave({ subject: subject.trim(), bodyHtml: textToHtml(bodyText), scheduledFor: schedule ? new Date(schedule).toISOString() : undefined })}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Subject"><input value={subject} onChange={(e) => setSubject(e.target.value)} style={input} /></Field>
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
          The services this occasion’s email lists — <b>one per line</b>. Saved and reused every year.
        </div>
        <Field label="Suggested services (one per line)">
          <textarea value={services} onChange={(e) => setServices(e.target.value)} rows={7} style={{ ...input, resize: 'vertical', lineHeight: 1.5 }}
            placeholder={'📸 Photo booth\n🖼️ Main backdrop & stand\n🎁 Giveaways'} />
        </Field>
        <Field label="Custom intro (optional)">
          <textarea value={intro} onChange={(e) => setIntro(e.target.value)} rows={3} style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} placeholder="Leave empty for the default." />
        </Field>
        <Field label="Customer offer (optional — customers only)">
          <input value={offer} onChange={(e) => setOffer(e.target.value)} style={input} placeholder="e.g. 10% off this week 🎉" />
        </Field>
      </div>
    </Modal>
  );
}

// ── Corporate leads directory ───────────────────────────────────────────────
function CorporatePanel({ labels, counts, onChanged, setMsg, bare }: {
  labels: Record<string, string>; counts: any; onChanged: () => void; setMsg: (m: string) => void; bare?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [leads, setLeads] = useState<any[] | null>(null);
  const [cat, setCat] = useState('');
  const [busy, setBusy] = useState(false);

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
  const inner = (
    <>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.6, marginBottom: 10 }}>
        Businesses we can email — grown automatically each week from Google. Total <b>{counts?.total ?? 0}</b> · emailable <b>{counts?.emailable ?? 0}</b>.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => run(() => api.collectCorporate(), 'Collecting from Google — this can take a minute.')} disabled={busy} style={{ ...miniBtn, borderColor: C.pink, color: C.pinkDeep }}>🔄 Collect from Google now</button>
        <button onClick={() => { if (window.confirm('Delete ALL companies and start fresh from Google under the new rules (email required)?')) run(async () => { await api.resetCorporate(); return api.collectCorporate(); }, 'Cleared — recollecting from Google (this can take a minute).'); }} disabled={busy} style={{ ...miniBtn, color: C.red }}>🗑️ Reset &amp; recollect</button>
        <button onClick={() => setOpen((v) => !v)} style={miniBtn}>{open ? 'Hide list' : 'View list'}</button>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          <select value={cat} onChange={(e) => { setCat(e.target.value); loadLeads(e.target.value); }} style={{ ...input, marginBottom: 10 }}>
            <option value="">All categories</option>
            {cats.map((c) => <option key={c} value={c}>{labels[c]}</option>)}
          </select>
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
    </>
  );
  return bare ? inner : <Panel title="Companies (B2B directory)">{inner}</Panel>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: C.muted, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function Modal({ title, children, onClose, onSave, onBack, busy, saveLabel }: {
  title: string; children: ReactNode; onClose: () => void; onSave?: () => void; onBack?: () => void; busy?: boolean; saveLabel?: string;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(59,54,65,.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px 12px', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 560, maxHeight: '92dvh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.28)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px 12px', flex: 'none', borderBottom: `1px solid ${C.line}` }}>
          <button onClick={onBack ?? onClose} style={{ ...miniBtn, border: 'none', color: C.muted }}>{onBack ? '‹ Back' : 'Close'}</button>
          <div style={{ ...fredoka(15), flex: 1, textAlign: 'center' }}>{title}</div>
          {onSave ? <button onClick={onSave} disabled={busy} style={{ ...miniBtn, border: 'none', color: C.pinkDeep, fontWeight: 800 }}>{busy ? '…' : (saveLabel ?? 'Save')}</button> : <span style={{ width: 48 }} />}
        </div>
        <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 18px 18px' }}>{children}</div>
      </div>
    </div>
  );
}

function Tile({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  const style: CSSProperties = { background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: '13px 15px', textAlign: 'left', cursor: onClick ? 'pointer' : 'default', width: '100%' };
  const inner = (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 5 }}>{label}{onClick ? ' ›' : ''}</div>
      <div style={{ ...fredoka(22), color: C.ink }}>{value}</div>
    </>
  );
  return onClick ? <button onClick={onClick} style={style}>{inner}</button> : <div style={style}>{inner}</div>;
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
