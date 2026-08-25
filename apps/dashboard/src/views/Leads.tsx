import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api';
import { C, fredoka, Panel, Badge, Spinner, Stat } from '../ui';
import { Empty } from './Today';

type LeadStatus = 'new' | 'quoted' | 'confirmed' | 'booked' | 'lost';

interface Lead {
  phone: string;
  name: string | null;
  eventDate: string | null;
  emirate: string | null;
  status: LeadStatus;
  ctwaClid: string | null;
  sourceAdId: string | null;
  messageCount: number;
  firstMessageAt: string;
  lastMessageAt: string;
  confirmedAt: string | null;
  orderId: string | null;
}

interface Funnel {
  total: number;
  quoted: number;
  confirmed: number;
  booked: number;
  byEmirate: Array<{ emirate: string; leads: number; booked: number }>;
}

const STATUS: Record<LeadStatus, { label: string; tone: 'ok' | 'warn' | 'error' | 'info' | 'neutral' }> = {
  new: { label: 'New enquiry', tone: 'info' },
  quoted: { label: 'Quoted', tone: 'warn' },
  confirmed: { label: 'Confirmed', tone: 'ok' },
  booked: { label: 'Booked & paid', tone: 'ok' },
  lost: { label: 'Lost', tone: 'neutral' },
};

const FILTERS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'quoted', label: 'Quoted' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'booked', label: 'Booked' },
];

const fmtDate = (iso: string | null) => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  } catch {
    return iso;
  }
};

/** "3 days ago" reads faster than a timestamp when triaging a list. */
const ago = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
};

/** Whole days until the party — negative once it has passed. */
const daysUntil = (iso: string | null): number | null => {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((then - today.getTime()) / 86_400_000);
};

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

export function Leads() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [agentMode, setAgentMode] = useState<string>('off');
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    let live = true;
    const load = () => {
      api
        .whatsappLeads(filter)
        .then((d) => {
          if (!live) return;
          setLeads(d.leads);
          setAgentMode(d.agentMode);
          setConnected(d.connected);
        })
        .catch(() => live && setLeads([]));
      api.whatsappFunnel().then((f) => live && setFunnel(f)).catch(() => {});
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [filter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* The number the ad account cannot produce: chats that became parties. */}
      {funnel && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Stat label="Enquiries" value={funnel.total} />
          <Stat label="Confirmed" value={`${funnel.confirmed} · ${pct(funnel.confirmed, funnel.total)}`} />
          <Stat label="Booked & paid" value={`${funnel.booked} · ${pct(funnel.booked, funnel.total)}`} />
        </div>
      )}

      {!connected && (
        <Panel style={{ background: C.yellowSoft, borderColor: '#eddcbe' }}>
          <div style={{ ...fredoka(14), color: C.yellowInk, marginBottom: 6 }}>
            WhatsApp isn’t connected yet
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted2, lineHeight: 1.65 }}>
            Enquiries will start landing here the moment the Cloud API credentials are set on the
            server. Nothing is lost in the meantime — this page simply stays empty.
          </div>
        </Panel>
      )}

      {connected && agentMode === 'off' && (
        <Panel style={{ background: C.pinkSoft, borderColor: '#f0cdd4' }}>
          <div style={{ ...fredoka(14), color: C.pinkDeep, marginBottom: 6 }}>Listening only</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted2, lineHeight: 1.65 }}>
            Every enquiry is being recorded with its party date, but the assistant sends no replies.
            Turn that on from the server when you’re ready — the team keeps answering as usual until
            then.
          </div>
        </Panel>
      )}

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              cursor: 'pointer',
              border: `1px solid ${filter === f.id ? C.pink : C.line}`,
              background: filter === f.id ? C.pinkSoft : '#fff',
              color: filter === f.id ? C.pinkDeep : C.muted2,
              fontSize: 12,
              fontWeight: 700,
              padding: '7px 14px',
              borderRadius: 12,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!leads ? (
        <Spinner />
      ) : leads.length === 0 ? (
        <Empty>
          No enquiries here yet. Every WhatsApp conversation will appear with the party date it
          mentioned, so nothing depends on someone remembering to write it down.
        </Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {leads.map((l) => (
            <LeadCard key={l.phone} lead={l} />
          ))}
        </div>
      )}

      {/* Which emirate actually converts — the split that decides ad spend. */}
      {funnel && funnel.byEmirate.length > 0 && (
        <Panel title="By emirate">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {funnel.byEmirate.map((e) => (
              <div key={e.emirate} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, width: 108, flex: 'none' }}>{e.emirate}</div>
                <div style={{ flex: 1, height: 8, borderRadius: 5, background: C.lineSoft, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: e.leads > 0 ? `${Math.round((e.booked / e.leads) * 100)}%` : 0,
                      height: '100%',
                      background: C.pink,
                    }}
                  />
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, width: 116, textAlign: 'right', flex: 'none' }}>
                  {e.booked} of {e.leads} booked
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function LeadCard({ lead }: { lead: Lead }) {
  const s = STATUS[lead.status] ?? STATUS.new;
  const left = daysUntil(lead.eventDate);
  // A party inside a week with no booking yet is the one to chase today.
  const urgent = left !== null && left >= 0 && left <= 7 && lead.status !== 'booked';
  const waPhone = lead.phone.replace(/\D+/g, '');

  return (
    <Panel style={urgent ? { borderColor: '#f0cdd4' } : undefined}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...fredoka(15) }}>{lead.name || 'Unnamed'}</div>
          <a
            href={`https://wa.me/${waPhone}`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12.5, fontWeight: 700, color: C.pinkDeep, textDecoration: 'none' }}
          >
            +{lead.phone}
          </a>
        </div>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {lead.eventDate ? (
          <Chip tone={urgent ? 'urgent' : 'strong'}>
            🎈 {fmtDate(lead.eventDate)}
            {left !== null && left >= 0 && ` · in ${left === 0 ? 'today' : `${left}d`}`}
          </Chip>
        ) : (
          <Chip>No date mentioned yet</Chip>
        )}
        {lead.emirate && <Chip>📍 {lead.emirate}</Chip>}
        <Chip>💬 {lead.messageCount} messages</Chip>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 11.5, fontWeight: 600, color: C.muted }}>
        <span>Last message {ago(lead.lastMessageAt)}</span>
        {lead.sourceAdId && <span>· from ad {lead.sourceAdId}</span>}
        {lead.orderId && <span style={{ color: C.green }}>· order {lead.orderId}</span>}
      </div>
    </Panel>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone?: 'strong' | 'urgent' }) {
  const palette =
    tone === 'urgent'
      ? { bg: C.redSoft, fg: C.red }
      : tone === 'strong'
        ? { bg: C.pinkSoft, fg: C.pinkDeep }
        : { bg: C.bg, fg: C.muted2 };
  return (
    <span
      style={{
        background: palette.bg,
        color: palette.fg,
        fontSize: 11.5,
        fontWeight: 700,
        padding: '6px 11px',
        borderRadius: 11,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
