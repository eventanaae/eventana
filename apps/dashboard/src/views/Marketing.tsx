import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api';
import { Badge, Button, C, fredoka, Panel, Spinner } from '../ui';
import { Empty } from './Today';

const AUDIENCES = [
  { id: 'all', label: 'All subscribers' },
  { id: 'past_customers', label: 'Past customers' },
  { id: 'no_recent_booking', label: 'No booking in 90 days' },
] as const;

const TEMPLATES: Record<string, string> = {
  seasonal: 'Hi {name},\n\nThe season for celebrations is here! 🎉 Book your Eventana party this month and let us bring the magic — themed setups, inflatables, food stations and a team that handles everything.\n\nReply to this email or open the app to start.\n\nWith love,\nThe Eventana Team',
  comeback: 'Hi {name},\n\nWe miss planning parties with you! 💐 Here’s a little nudge to celebrate your next occasion with Eventana. Tap into the app and we’ll make it unforgettable.\n\nSee you soon,\nThe Eventana Team',
};

export function Marketing() {
  const [data, setData] = useState<any>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<string>('all');
  const [schedule, setSchedule] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.marketing().then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, []);

  if (!data) return <Spinner />;

  const audienceCount = data.audiences[audience] ?? 0;

  const create = async (send: boolean) => {
    if (!subject.trim() || !body.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const bodyHtml = body.trim().split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join('');
      const c = await api.createCampaign({
        subject: subject.trim(),
        bodyHtml,
        audience,
        scheduledFor: !send && schedule ? new Date(schedule).toISOString() : undefined,
      });
      if (send) {
        const r = await api.sendCampaign(c.id);
        setMsg(`Sent to ${r.sent} of ${r.recipients} recipients.`);
      } else {
        setMsg(schedule ? 'Campaign scheduled.' : 'Draft saved.');
      }
      setSubject(''); setBody(''); setSchedule('');
      load();
    } catch (e: any) {
      setMsg(e?.message ?? 'Could not save the campaign.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!data.emailConfigured && (
        <div style={{ background: '#fff7ec', border: '1px solid #f0d9a8', borderRadius: 12, padding: '12px 15px', fontSize: 12.5, fontWeight: 600, color: '#8a6d2f', lineHeight: 1.6 }}>
          ⚙ Sending isn’t connected yet. You can compose, schedule and save campaigns now — set
          <b> RESEND_API_KEY</b> and <b>EMAIL_FROM</b> in the server environment to start sending.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
        <Tile label="All subscribers" value={data.audiences.all} />
        <Tile label="Past customers" value={data.audiences.past_customers} />
        <Tile label="Lapsed (90d)" value={data.audiences.no_recent_booking} />
        <Tile label="Unsubscribed" value={data.audiences.optedOut} />
      </div>

      <Panel title="Compose campaign">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {AUDIENCES.map((a) => (
              <button key={a.id} onClick={() => setAudience(a.id)}
                style={{ ...chip, ...(audience === a.id ? chipActive : {}) }}>
                {a.label} · {data.audiences[a.id] ?? 0}
              </button>
            ))}
          </div>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line" style={input} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8}
            placeholder="Write your message… (use {name} for the customer’s name)"
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
            <Button tone="ghost" onClick={() => create(false)} disabled={busy || !subject.trim() || !body.trim()}>
              {schedule ? 'Schedule' : 'Save draft'}
            </Button>
            <Button onClick={() => create(true)} disabled={busy || !data.emailConfigured || !subject.trim() || !body.trim()}>
              {busy ? 'Working…' : `Send now to ${audienceCount}`}
            </Button>
          </div>
          {msg && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.green }}>{msg}</div>}
        </div>
      </Panel>

      <Panel title="Campaigns">
        {data.campaigns.length === 0 ? (
          <Empty>No campaigns yet.</Empty>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: C.muted, fontSize: 11 }}>
                  <th style={th}>Subject</th><th style={th}>Audience</th><th style={th}>Status</th>
                  <th style={th}>Sent</th><th style={th}>When</th><th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((c: any) => (
                  <tr key={c.id} style={{ borderTop: `1px solid ${C.lineSoft}` }}>
                    <td style={{ ...td, fontWeight: 700 }}>{c.subject}</td>
                    <td style={td}>{c.audience.replace(/_/g, ' ')}</td>
                    <td style={td}>
                      <Badge tone={c.status === 'sent' ? 'ok' : c.status === 'failed' ? 'error' : c.status === 'scheduled' ? 'info' : 'neutral'}>{c.status}</Badge>
                    </td>
                    <td style={td}>{c.status === 'sent' ? `${c.sent_count}/${c.recipient_count}` : '—'}</td>
                    <td style={{ ...td, color: C.muted, fontSize: 11.5 }}>
                      {c.sent_at ? new Date(c.sent_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                        : c.scheduled_for ? `⏰ ${new Date(c.scheduled_for).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                        : new Date(c.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {(c.status === 'draft' || c.status === 'scheduled' || c.status === 'failed') && (
                        <>
                          {data.emailConfigured && (
                            <button onClick={async () => { await api.sendCampaign(c.id); load(); }} style={miniBtn}>Send</button>
                          )}
                          <button onClick={async () => { await api.deleteCampaign(c.id); load(); }} style={{ ...miniBtn, color: C.red }}>Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
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

const input: CSSProperties = { width: '100%', border: `1px solid ${C.line}`, borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 600, outline: 'none', background: '#fff', color: C.ink };
const chip: CSSProperties = { border: `1px solid ${C.line}`, background: '#fff', borderRadius: 20, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', color: C.ink };
const chipActive: CSSProperties = { border: `1px solid ${C.pink}`, background: C.pinkSoft, color: C.pinkDeep };
const th: CSSProperties = { padding: '6px 10px', fontWeight: 700 };
const td: CSSProperties = { padding: '9px 10px', verticalAlign: 'middle', fontSize: 12.5 };
const miniBtn: CSSProperties = { border: `1px solid ${C.line}`, background: '#fff', borderRadius: 8, padding: '5px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer', color: C.ink, marginLeft: 6 };
