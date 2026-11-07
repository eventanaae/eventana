import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api';
import { Badge, Button, C, fredoka, Panel, Spinner } from '../ui';
import { LeadThread } from './LeadThread';

/**
 * AI Studio — three Claude helpers in one place. Owner's rule: the AI drafts,
 * a person approves. Nothing here sends a message or spends money by itself.
 *   • Sales follow-ups: leads that went quiet without booking → AI follow-up draft
 *   • Event Designer: theme + budget → party concept priced from the live catalogue
 *   • Marketing: reel & ad ideas per occasion + which ads produced real bookings
 */
type Tab = 'sales' | 'designer' | 'marketing';

const input: CSSProperties = {
  border: `1px solid ${C.line}`, borderRadius: 10, padding: '9px 11px', fontSize: 13,
  fontWeight: 500, fontFamily: 'inherit', background: '#fff', color: C.ink, width: '100%', boxSizing: 'border-box',
};
const label: CSSProperties = { fontSize: 11.5, fontWeight: 800, color: C.muted, marginBottom: 4, display: 'block' };
const small: CSSProperties = { fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.6 };

export function AiStudio() {
  const [tab, setTab] = useState<Tab>('sales');
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {([['sales', '💬 Sales follow-ups'], ['designer', '🎨 Event Designer'], ['marketing', '📣 Marketing ideas']] as const).map(([id, l]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              border: `1px solid ${tab === id ? C.pink : C.line}`, background: tab === id ? C.pink : '#fff',
              color: tab === id ? '#fff' : C.ink, borderRadius: 999, padding: '8px 15px', fontWeight: 800, fontSize: 13, cursor: 'pointer',
            }}
          >
            {l}
          </button>
        ))}
      </div>
      <div style={small}>AI writes drafts only — a person always checks and presses Send. Prices always come from your live catalogue.</div>
      {tab === 'sales' && <SalesTab />}
      {tab === 'designer' && <DesignerTab />}
      {tab === 'marketing' && <MarketingTab />}
    </div>
  );
}

// ── Sales ──────────────────────────────────────────────────────────────────

function SalesTab() {
  const [leads, setLeads] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<{ phone: string; name: string | null } | null>(null);
  useEffect(() => {
    api.aiFollowups().then((d) => setLeads(d.leads ?? [])).catch((e) => { setLeads([]); setErr(e?.message ?? 'Could not load.'); });
  }, []);
  return (
    <Panel title="Customers who didn't confirm" action={leads ? <Badge tone="info">{leads.length}</Badge> : undefined}>
      <div style={{ ...small, marginBottom: 10 }}>
        Chatted with us, no booking yet, quiet for 2–30 days, party date still ahead. Tap one → the AI writes a follow-up in the reply box → you edit and send.
      </div>
      {!leads ? <Spinner /> : leads.length === 0 ? (
        <div style={small}>{err ?? 'Nobody to follow up right now 🎉'}</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {leads.map((l) => (
            <div
              key={l.phone}
              onClick={() => setOpen({ phone: l.phone, name: l.name })}
              style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 12px', cursor: 'pointer', background: '#fff' }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ ...fredoka(14), flex: 1 }}>{l.name || '+' + l.phone}</div>
                <Badge tone={l.status === 'confirmed' ? 'ok' : l.status === 'quoted' ? 'warn' : 'neutral'}>{l.status}</Badge>
                {l.eventDate && <Badge tone="info">🎉 {l.eventDate}</Badge>}
              </div>
              <div style={{ ...small, marginTop: 3 }}>
                Last: {new Date(l.lastMessageAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                {l.ad ? ` · ad: ${l.ad}` : ''} · {l.messages} msgs
                {!l.windowOpen && ' · ⚠️ 24h window closed (template needed)'}
              </div>
              {l.lastIn && <div style={{ fontSize: 12.5, color: C.ink, marginTop: 3 }}>“{l.lastIn}”</div>}
            </div>
          ))}
        </div>
      )}
      {open && <LeadThread phone={open.phone} name={open.name} aiMode="followup" onClose={() => setOpen(null)} />}
    </Panel>
  );
}

// ── Event Designer ─────────────────────────────────────────────────────────

const CELEB = [['kids', 'Kids birthday'], ['baby', 'Baby shower'], ['gender', 'Gender reveal'], ['graduation', 'Graduation'], ['bride', 'Bride to be'], ['adult', 'Adult'], ['customc', 'Custom']] as const;

export function DesignResult({ d }: { d: any }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <div style={{ ...fredoka(18) }}>{d.title}</div>
        <div style={{ fontSize: 13, lineHeight: 1.65, marginTop: 4 }}>{d.story}</div>
        {!d.ai && <div style={{ ...small, color: C.yellowInk }}>AI is off or didn't answer — this is a simple catalogue-based plan.</div>}
      </div>
      {d.palette?.length > 0 && (
        <div style={{ display: 'flex', gap: 6 }}>
          {d.palette.map((c: string) => <div key={c} title={c} style={{ width: 34, height: 34, borderRadius: 10, background: c, border: `1px solid ${C.line}` }} />)}
        </div>
      )}
      {d.inspiration?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          {d.inspiration.map((u: string) => <img key={u} src={u} alt="" style={{ height: 90, borderRadius: 10, flex: 'none' }} />)}
        </div>
      )}
      {d.zones?.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          {d.zones.map((z: any, i: number) => (
            <div key={i} style={{ fontSize: 13, lineHeight: 1.55 }}>
              <b>{z.zone}:</b> {z.idea}{z.items?.length ? <span style={{ color: C.muted }}> ({z.items.join(', ')})</span> : null}
            </div>
          ))}
        </div>
      )}
      <div style={{ background: C.bg, borderRadius: 12, padding: '10px 12px' }}>
        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>Main plan</div>
        {d.core.map((l: any) => <div key={l.id} style={{ fontSize: 13 }}>• {l.name}{l.qty > 1 ? ` × ${l.qty}` : ''} — AED {l.totalAed}</div>)}
        <div style={{ fontWeight: 800, fontSize: 13, marginTop: 4 }}>
          Total AED {d.coreTotalAed}{' '}
          {d.withinBudget === true && <Badge tone="ok">within budget</Badge>}
          {d.withinBudget === false && <Badge tone="warn">over budget</Badge>}
        </div>
      </div>
      {d.extras?.length > 0 && (
        <div>
          <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>Optional upgrades</div>
          {d.extras.map((l: any) => <div key={l.id} style={{ fontSize: 13 }}>＋ {l.name} — AED {l.totalAed}{l.why ? <span style={{ color: C.muted }}> · {l.why}</span> : null}</div>)}
        </div>
      )}
      {d.tip && <div style={{ ...small }}>💡 {d.tip}</div>}
    </div>
  );
}

function DesignerTab() {
  const [themes, setThemes] = useState<Array<{ id: string; name: string; celebration_type: string }>>([]);
  const [f, setF] = useState({ celebrationType: 'kids', themeId: '', themeText: '', budgetAed: '', childrenCount: '20', age: '', notes: '', lang: 'en' as 'en' | 'ar' });
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.themesList().then((d) => setThemes(d.rows ?? [])).catch(() => {}); }, []);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      setRes(await api.aiDesign({
        celebrationType: f.celebrationType, themeId: f.themeId || null, themeText: f.themeText || null,
        budgetAed: f.budgetAed ? Number(f.budgetAed) : null, childrenCount: Math.max(1, Number(f.childrenCount) || 20),
        age: f.age || null, notes: f.notes || null, lang: f.lang,
      }));
    } catch (e: any) { setErr(e?.message ?? 'Failed.'); } finally { setBusy(false); }
  };
  const list = themes.filter((t) => t.celebration_type === f.celebrationType);
  return (
    <Panel title="Design a party">
      <div style={{ ...small, marginBottom: 10 }}>Same tool customers get on the website. Use it on a call or while chatting to send a concept.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
        <div><span style={label}>Celebration</span><select style={input} value={f.celebrationType} onChange={(e) => setF({ ...f, celebrationType: e.target.value, themeId: '' })}>{CELEB.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><span style={label}>Theme</span><select style={input} value={f.themeId} onChange={set('themeId')}><option value="">— type your own —</option>{list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        {!f.themeId && <div><span style={label}>Theme idea</span><input style={input} value={f.themeText} onChange={set('themeText')} placeholder="e.g. Pink butterflies" /></div>}
        <div><span style={label}>Budget (AED)</span><input style={input} inputMode="numeric" value={f.budgetAed} onChange={set('budgetAed')} placeholder="e.g. 3000" /></div>
        <div><span style={label}>Kids</span><input style={input} inputMode="numeric" value={f.childrenCount} onChange={set('childrenCount')} /></div>
        <div><span style={label}>Age</span><input style={input} value={f.age} onChange={set('age')} placeholder="e.g. 5" /></div>
        <div><span style={label}>Language</span><select style={input} value={f.lang} onChange={set('lang')}><option value="en">English</option><option value="ar">العربية</option></select></div>
      </div>
      <div style={{ marginTop: 10 }}><span style={label}>Notes</span><textarea style={{ ...input, minHeight: 56 }} value={f.notes} onChange={set('notes')} placeholder="Indoor/outdoor, favourite colours, must-haves…" /></div>
      <div style={{ marginTop: 12 }}><Button onClick={() => void run()} disabled={busy}>{busy ? '✨ Designing…' : '✨ Design the party'}</Button></div>
      {err && <div style={{ color: C.red, fontWeight: 700, fontSize: 12, marginTop: 8 }}>{err}</div>}
      {res && <div style={{ marginTop: 16 }}><DesignResult d={res} /></div>}
    </Panel>
  );
}

// ── Marketing ──────────────────────────────────────────────────────────────

function MarketingTab() {
  const [occ, setOcc] = useState<any[]>([]);
  const [pick, setPick] = useState('');
  const [topic, setTopic] = useState('');
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<any | null>(null);
  const [days, setDays] = useState(90);
  const [results, setResults] = useState<any | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [vBusy, setVBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.aiOccasions().then((d) => setOcc(d.occasions ?? [])).catch(() => {}); }, []);
  useEffect(() => { setResults(null); api.aiAdResults(days).then(setResults).catch((e) => setErr(e?.message ?? 'Failed.')); }, [days]);

  const gen = async () => {
    setBusy(true); setErr(null);
    try { setIdeas(await api.aiMarketingIdeas({ occasion: pick || null, topic: topic || null, lang })); }
    catch (e: any) { setErr(e?.message ?? 'Failed.'); } finally { setBusy(false); }
  };
  const judge = async () => {
    setVBusy(true);
    try { setVerdict((await api.aiAdVerdict(days, lang)).verdict); } catch (e: any) { setErr(e?.message ?? 'Failed.'); } finally { setVBusy(false); }
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Panel title="Reel & ad ideas">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10 }}>
          <div><span style={label}>Occasion</span>
            <select style={input} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">— none / a topic —</option>
              {occ.map((o) => <option key={o.slug} value={o.slug}>{o.date} · {o.name}{o.greetingOnly ? ' (greeting only)' : ''}</option>)}
            </select>
          </div>
          {!pick && <div><span style={label}>Topic</span><input style={input} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Winter outdoor parties" /></div>}
          <div><span style={label}>Language</span><select style={input} value={lang} onChange={(e) => setLang(e.target.value as any)}><option value="ar">العربية</option><option value="en">English</option></select></div>
        </div>
        <div style={{ marginTop: 12 }}><Button onClick={() => void gen()} disabled={busy}>{busy ? '✨ Thinking…' : '✨ Get ideas'}</Button></div>
        {err && <div style={{ color: C.red, fontWeight: 700, fontSize: 12, marginTop: 8 }}>{err}</div>}
        {ideas && (
          <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
            {ideas.note && <div style={{ ...small, color: C.yellowInk }}>{ideas.note}</div>}
            {ideas.reels?.map((r: any, i: number) => (
              <div key={i} style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 12px' }}>
                <div style={{ ...fredoka(14) }}>🎬 {r.title}</div>
                {r.hook && <div style={{ fontSize: 12.5, marginTop: 3 }}><b>Hook:</b> {r.hook}</div>}
                {Array.isArray(r.shots) && <ol style={{ margin: '4px 0 0 18px', padding: 0, fontSize: 12.5, lineHeight: 1.55 }}>{r.shots.map((s: string, j: number) => <li key={j}>{s}</li>)}</ol>}
                {r.caption && <div style={{ fontSize: 12.5, marginTop: 4, whiteSpace: 'pre-wrap' }}>{r.caption}</div>}
                {r.captionAr && r.captionAr !== r.caption && <div dir="rtl" style={{ fontSize: 12.5, marginTop: 4, whiteSpace: 'pre-wrap' }}>{r.captionAr}</div>}
                {Array.isArray(r.hashtags) && <div style={{ ...small, marginTop: 3 }}>{r.hashtags.join(' ')}</div>}
                {r.why && <div style={{ ...small, marginTop: 3 }}>Why: {r.why}</div>}
              </div>
            ))}
            {ideas.ads?.length > 0 && <div style={{ ...fredoka(14), marginTop: 4 }}>Ad variants to test</div>}
            {ideas.ads?.map((a: any, i: number) => (
              <div key={i} style={{ border: `1px dashed ${C.line2}`, borderRadius: 12, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.55 }}>
                <div style={{ fontWeight: 800 }}>{String.fromCharCode(65 + i)}. {a.headline}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{a.primaryText}</div>
                <div style={small}>CTA: {a.cta} · Audience: {a.audience}{a.offer && a.offer !== 'none' ? ` · Offer: ${a.offer}` : ''}</div>
                {a.test && <div style={{ ...small, color: C.pinkDeep }}>Tests: {a.test}</div>}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Which ads bring real bookings"
        action={
          <select style={{ ...input, width: 'auto' }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </select>
        }
      >
        <div style={{ ...small, marginBottom: 8 }}>WhatsApp chats grouped by the ad that sent them → how many gave a date, confirmed, and actually booked & paid.</div>
        {!results ? <Spinner /> : results.ads.length === 0 ? <div style={small}>No WhatsApp leads in this period yet.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: C.muted }}>
                  {['Ad', 'Chats', 'Gave date', 'Confirmed', 'Booked', 'Rate', 'Revenue'].map((h) => <th key={h} style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {results.ads.map((a: any) => (
                  <tr key={(a.adId ?? '') + a.headline}>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}`, maxWidth: 260 }}>{a.headline}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}` }}>{a.leads}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}` }}>{a.withDate}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}` }}>{a.confirmed}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}`, fontWeight: 800 }}>{a.bookings}</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}` }}>{a.bookingRate}%</td>
                    <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap' }}>AED {a.revenueAed.toLocaleString()}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 800 }}>
                  <td style={{ padding: '6px 8px' }}>Total</td><td style={{ padding: '6px 8px' }}>{results.total.leads}</td><td /><td />
                  <td style={{ padding: '6px 8px' }}>{results.total.bookings}</td><td />
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>AED {results.total.revenueAed.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: 12 }}><Button tone="ghost" onClick={() => void judge()} disabled={vBusy || !results?.ads?.length}>{vBusy ? '✨ Reading…' : '✨ What should we scale / stop?'}</Button></div>
        {verdict && <div dir="auto" style={{ marginTop: 10, fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', background: C.bg, borderRadius: 12, padding: '10px 12px' }}>{verdict}</div>}
      </Panel>
    </div>
  );
}
