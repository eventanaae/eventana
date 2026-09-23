import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api';
import { C, fredoka, Panel, Badge, Button, Spinner, Stat } from '../ui';
import { Empty } from './Today';
import { LeadThread } from './LeadThread';

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

/* ---------------------------------------------------------------- import --
 * The team's real booking record lives in the WhatsApp Business app: chats
 * labelled "Order complete" / "New order", each contact renamed after the
 * party date and theme ("25/07/26 Unicorn"). Exported as label,phone,name,
 * that file is years of history this screen would otherwise never show.
 */
const LABEL_STATUS: Record<string, string> = {
  'order complete': 'booked',
  'order completed': 'booked',
  confirmed: 'confirmed',
  'pending payment': 'confirmed',
  'new order': 'quoted',
  'new customer': 'new',
  cancelled: 'lost',
  refund: 'lost',
};

const EMIRATES: Array<[RegExp, string]> = [
  [/dubai|دبي/i, 'Dubai'],
  [/sharjah|shsrjah|الشارقة/i, 'Sharjah'],
  [/al ?ain|العين/i, 'Al Ain'],
  [/\brak\b|ras al/i, 'Ras Al Khaimah'],
  [/abu ?dhabi|أبوظبي|ابوظبي/i, 'Abu Dhabi'],
  [/ajman|عجمان/i, 'Ajman'],
  [/fujairah|الفجيرة/i, 'Fujairah'],
  [/umm al|\buaq\b/i, 'Umm Al Quwain'],
];

/** "25/07/26 Unicorn" → 2026-07-25. Day-first, the way the team writes it. */
function partyDate(name: string): string | null {
  const m = name.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2015 || year > 2035) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Splits a CSV row, honouring "quoted, fields". */
function csvRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseExport(text: string) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = csvRow(lines[0]).map((h) => h.toLowerCase());
  const iLabel = head.indexOf('label');
  const iPhone = head.indexOf('phone');
  const iName = head.indexOf('name');
  if (iPhone < 0) return [];
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const line of lines.slice(1)) {
    const cells = csvRow(line);
    const phone = (cells[iPhone] || '').replace(/\D+/g, '');
    if (phone.length < 10 || seen.has(phone)) continue;
    const label = (iLabel >= 0 ? cells[iLabel] : '').trim();
    const status = LABEL_STATUS[label.toLowerCase()];
    // Only rows that say something about a booking — vendors, drivers and
    // team chats are not customers and must not land in the funnel.
    if (!status) continue;
    seen.add(phone);
    const name = iName >= 0 ? cells[iName] || '' : '';
    const emirate = EMIRATES.find(([re]) => re.test(name))?.[1] ?? null;
    out.push({
      phone,
      name: name || null,
      eventDate: partyDate(name),
      emirate,
      status,
      notes: label ? `WhatsApp label: ${label}` : null,
    });
  }
  return out;
}

const MODE_INFO: Record<string, { label: string; blurb: string; tone: 'ok' | 'warn' | 'neutral' }> = {
  off: {
    label: 'Listening only',
    blurb: 'Every enquiry is recorded with its party date, but the assistant sends no replies — the team answers as usual.',
    tone: 'neutral',
  },
  greet: {
    label: 'Welcome reply',
    blurb: 'Each brand-new enquiry gets one warm welcome asking for the date, emirate and number of kids. After that, the assistant stays quiet.',
    tone: 'warn',
  },
  full: {
    label: 'Full auto-reply',
    blurb: 'Also answers catalogue questions (packages, prices, delivery) from the live price list. Refunds, discounts, price disputes and confirmations always go to a human.',
    tone: 'ok',
  },
};

/**
 * The owner's on/off switch for the auto-reply assistant — plus a safe way to
 * read exactly what it would say before turning it on. Managers see the status
 * and can test replies; only the owner can change the mode.
 */
function AgentControl({
  mode,
  isOwner,
  onChanged,
}: {
  mode: string;
  isOwner: boolean;
  onChanged: (m: 'off' | 'greet' | 'full') => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState('');
  const [preview, setPreview] = useState<{ source: string; reply: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [knowledge, setKnowledge] = useState<string | null>(null);
  const [savingK, setSavingK] = useState(false);
  const [savedK, setSavedK] = useState(false);
  const info = MODE_INFO[mode] ?? MODE_INFO.off;

  useEffect(() => {
    if (!isOwner) return;
    api.getWhatsappKnowledge().then((r) => setKnowledge(r.knowledge ?? '')).catch(() => setKnowledge(''));
  }, [isOwner]);

  const saveKnowledge = async () => {
    if (knowledge == null) return;
    setSavingK(true); setSavedK(false);
    try {
      await api.saveWhatsappKnowledge(knowledge);
      setSavedK(true);
      setTimeout(() => setSavedK(false), 2500);
    } catch { /* ignore */ } finally { setSavingK(false); }
  };

  const setMode = async (m: 'off' | 'greet' | 'full') => {
    if (m === mode) return;
    setBusy(m);
    try {
      await api.setWhatsappAgentMode(m);
      onChanged(m);
    } catch {
      /* the poll will re-sync the real state */
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    if (!test.trim()) return;
    setTesting(true);
    setPreview(null);
    try {
      const r = await api.previewWhatsappReply(test.trim());
      setPreview({ source: r.source, reply: r.reply });
    } catch {
      setPreview({ source: 'error', reply: 'Could not generate a preview just now.' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Panel style={{ background: info.tone === 'neutral' ? C.pinkSoft : C.greenSoft, borderColor: info.tone === 'neutral' ? '#f0cdd4' : '#c9e6cf' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ ...fredoka(14), color: info.tone === 'neutral' ? C.pinkDeep : C.green }}>
          Auto-reply: {info.label}
        </div>
        <Badge tone={info.tone}>{mode === 'off' ? 'silent' : mode === 'greet' ? 'greeting' : 'answering'}</Badge>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted2, lineHeight: 1.65, marginBottom: isOwner ? 12 : 0 }}>
        {info.blurb}
      </div>

      {isOwner && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['off', 'greet', 'full'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={busy !== null}
              style={{
                border: `1.5px solid ${m === mode ? C.pinkDeep : C.line}`,
                background: m === mode ? C.pinkDeep : '#fff',
                color: m === mode ? '#fff' : C.ink,
                borderRadius: 10,
                padding: '8px 14px',
                fontSize: 12.5,
                fontWeight: 800,
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              {busy === m ? '…' : m === 'off' ? 'Listen only' : m === 'greet' ? 'Welcome only' : 'Full replies'}
            </button>
          ))}
        </div>
      )}

      {/* Test the reply quality — never sends anything to a customer. */}
      <div style={{ marginTop: 14, borderTop: `1px solid ${C.lineSoft}`, paddingTop: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: C.ink, marginBottom: 6 }}>
          Test a reply (nothing is sent)
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={test}
            placeholder="e.g. كم سعر باكج ٢٠ طفل؟"
            onChange={(e) => setTest(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void runTest(); }}
            style={{ flex: 1, minWidth: 200, border: `1px solid ${C.line}`, borderRadius: 10, padding: '9px 12px', fontSize: 12.5, fontWeight: 600, outline: 'none', background: '#fff', color: C.ink }}
          />
          <Button onClick={runTest} disabled={testing || !test.trim()}>{testing ? 'Thinking…' : 'Test reply'}</Button>
        </div>
        {preview && (
          <div style={{ marginTop: 10, background: '#fff', border: `1px solid ${C.lineSoft}`, borderRadius: 12, padding: '10px 13px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Badge tone={preview.source === 'handoff' ? 'warn' : preview.source === 'ai' ? 'ok' : 'neutral'}>
                {preview.source === 'handoff' ? 'Hands off to team' : preview.source === 'ai' ? 'AI answer' : preview.source === 'rules' ? 'Standard answer' : 'Error'}
              </Badge>
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{preview.reply}</div>
          </div>
        )}
      </div>

      {/* Teach the assistant — free-text house knowledge the bot answers from. */}
      {isOwner && (
        <div style={{ marginTop: 14, borderTop: `1px solid ${C.lineSoft}`, paddingTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: C.ink, marginBottom: 4 }}>
            Teach the assistant
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.muted2, lineHeight: 1.6, marginBottom: 8 }}>
            Write anything you want it to know — parking, setup time, what's included, common questions,
            the way you like to answer. It uses this in every reply. (Prices always come from your live
            catalogue, never from here.)
          </div>
          <textarea
            value={knowledge ?? ''}
            onChange={(e) => setKnowledge(e.target.value)}
            placeholder={'e.g. نوصل قبل الحفلة بساعة نجهّز. التوصيل حسب الإمارة. ما نسوي حجز بدون دفعة.'}
            rows={5}
            style={{ width: '100%', border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 12px', fontSize: 12.5, fontWeight: 600, outline: 'none', background: '#fff', color: C.ink, resize: 'vertical', lineHeight: 1.6 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <Button onClick={saveKnowledge} disabled={savingK || knowledge == null}>{savingK ? 'Saving…' : 'Save'}</Button>
            {savedK && <span style={{ fontSize: 12, fontWeight: 700, color: C.green }}>Saved ✓ — test a reply above to see it.</span>}
          </div>
        </div>
      )}
    </Panel>
  );
}

export function Leads({ role }: { role?: string }) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [agentMode, setAgentMode] = useState<string>('off');
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState('all');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // The open conversation, if any — the only way to reply to a Cloud API number.
  const [openThread, setOpenThread] = useState<Lead | null>(null);

  const runImport = async (file: File) => {
    setImportError(null);
    setImportMsg(null);
    let rows: Array<Record<string, unknown>>;
    try {
      rows = parseExport(await file.text());
    } catch {
      return setImportError('Could not read that file. It should be a .csv.');
    }
    if (!rows.length) {
      return setImportError(
        'No customer rows found. The file needs label, phone and name columns, and only booking labels are imported.',
      );
    }
    setImporting(true);
    let imported = 0;
    try {
      // Chunked so one oversized request can't time out the whole import.
      for (let i = 0; i < rows.length; i += 150) {
        const res = await api.importWhatsappLeads(rows.slice(i, i + 150));
        imported += res.imported;
        setImportMsg(`Importing… ${imported} of ${rows.length}`);
      }
      setImportMsg(`Imported ${imported} customers. Existing bookings were left as they were.`);
      setReloadKey((k) => k + 1);
    } catch (e: any) {
      setImportError(e?.message ?? 'The import failed part way. Re-running it is safe.');
    } finally {
      setImporting(false);
    }
  };

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
  }, [filter, reloadKey]);

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

      {connected && (
        <AgentControl
          mode={agentMode}
          isOwner={role === 'owner'}
          onChanged={(m) => setAgentMode(m)}
        />
      )}

      {/* Years of booking history live only in the WhatsApp app's labels. */}
      <Panel title="Import from WhatsApp labels">
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted2, lineHeight: 1.65, marginBottom: 12 }}>
          Export your WhatsApp Business labels as a <b>.csv</b> with <b>label</b>, <b>phone</b> and{' '}
          <b>name</b> columns. Chats labelled <i>Order complete</i> become bookings, and a party date
          written in the contact name (<i>25/07/26 Unicorn</i>) is read automatically.
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={importing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void runImport(f);
            }}
            style={{ fontSize: 12.5, fontWeight: 600 }}
          />
          {importing && <span style={{ fontSize: 12.5, fontWeight: 700, color: C.muted }}>Working…</span>}
        </div>
        {importMsg && (
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.green, marginTop: 10 }}>{importMsg}</div>
        )}
        {importError && (
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.red, marginTop: 10 }}>{importError}</div>
        )}
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 10, lineHeight: 1.6 }}>
          Safe to run more than once — a customer already marked as booked is never downgraded, and a
          date already on file is never overwritten. Vendor, driver and team labels are ignored.
        </div>
      </Panel>

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
            <LeadCard key={l.phone} lead={l} onOpen={() => setOpenThread(l)} />
          ))}
        </div>
      )}

      {/* Which emirate actually converts — the split that decides ad spend. */}
      {openThread && (
        <LeadThread
          phone={openThread.phone}
          name={openThread.name}
          onClose={() => { setOpenThread(null); setReloadKey((k) => k + 1); }}
        />
      )}

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

function LeadCard({ lead, onOpen }: { lead: Lead; onOpen: () => void }) {
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
        <div style={{ flex: 1 }} />
        <button
          onClick={onOpen}
          style={{
            border: `1px solid ${C.pink}`, background: C.pinkSoft, color: C.pinkDeep,
            borderRadius: 10, padding: '7px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer',
          }}
        >
          Open conversation
        </button>
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
