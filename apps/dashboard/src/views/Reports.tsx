import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, fredoka, Panel, Button, Spinner } from '../ui';

/**
 * Reports & Tools (owner only). One place for the reconciliation diagnostics
 * (what the "outstanding" money really is, payment-method coverage, phone-format
 * health, duplicates, refund reasons), the critical-action audit log, and the
 * safe one-click clean-up actions.
 */
export function Reports() {
  const [tab, setTab] = useState<'reconcile' | 'refunds' | 'audit' | 'tools'>('reconcile');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {([['reconcile', '🔎 Reconciliation'], ['refunds', '💸 Refund reasons'], ['audit', '🛡️ Audit log'], ['tools', '🧰 Tools']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            border: `1.5px solid ${tab === id ? C.pink : C.line}`, background: tab === id ? C.pinkSoft : '#fff',
            color: tab === id ? C.pinkDeep : C.muted2, fontWeight: 800, fontSize: 13, padding: '9px 15px', borderRadius: 14, cursor: 'pointer',
          }}>{label}</button>
        ))}
      </div>
      {tab === 'reconcile' && <Reconcile />}
      {tab === 'refunds' && <Refunds />}
      {tab === 'audit' && <AuditLog />}
      {tab === 'tools' && <Tools />}
    </div>
  );
}

function KV({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${C.lineSoft}`, fontSize: 13 }}>
      <span style={{ fontWeight: 600, color: C.muted2 }}>{k}</span>
      <span style={{ fontWeight: 800, color: tone || C.ink }}>{v}</span>
    </div>
  );
}

function Reconcile() {
  const [d, setD] = useState<Record<string, any>>({});
  const load = (s: string) => api.auditReport(s).then((r) => setD((p) => ({ ...p, [s]: r }))).catch(() => {});
  useEffect(() => { ['outstanding', 'payment_methods', 'phones', 'dup_customers'].forEach(load); }, []);
  const o = d.outstanding, pm = d.payment_methods, ph = d.phones, dup = d.dup_customers;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Panel title="Outstanding / expected-in — what it really is">
        {!o ? <Spinner /> : (<>
          <KV k="Total unpaid orders" v={`AED ${o.totalDisplay}`} tone={C.pinkDeep} />
          <KV k="Count" v={o.count} />
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>{o.note}</div>
        </>)}
      </Panel>
      <Panel title="Payment method coverage">
        {!pm ? <Spinner /> : (<>
          {(pm.receiptsByMethod || []).map((r: any, i: number) => <KV key={i} k={`${r.method} · ${r.source}`} v={`${r.n} · AED ${r.display}`} />)}
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>{pm.note}</div>
        </>)}
      </Panel>
      <Panel title="Phone number health (+9715XXXXXXXX)">
        {!ph ? <Spinner /> : (<>
          <KV k="Live customers — valid" v={`${ph.liveCustomers?.valid_e164} valid · ${ph.liveCustomers?.other_review} review`} />
          <KV k="QuickBooks — valid" v={`${ph.historicalCustomers?.valid_e164} valid · ${ph.historicalCustomers?.other_review} review · ${ph.historicalCustomers?.empty} empty`} />
          <KV k="Alternate numbers — valid" v={`${ph.historicalAlt?.valid_e164} valid`} />
        </>)}
      </Panel>
      <Panel title="Possible duplicate customers">
        {!dup ? <Spinner /> : dup.rows?.length === 0 ? <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>None.</div> : (<>
          {dup.rows.map((r: any, i: number) => <KV key={i} k={`…${r.tail} (${r.n})`} v={<span style={{ fontSize: 11, fontWeight: 600, color: C.muted2 }}>{(r.who || []).slice(0, 3).join(', ')}{r.who?.length > 3 ? '…' : ''}</span>} />)}
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>{dup.note}</div>
        </>)}
      </Panel>
    </div>
  );
}

function Refunds() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api.refundsReport().then(setD).catch(() => setD({ byReason: [], rows: [] })); }, []);
  if (!d) return <Spinner />;
  return (
    <Panel title="Refunds by reason">
      {(d.byReason || []).length === 0 ? <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No refunds recorded yet.</div> : (
        <div>
          {d.byReason.map((r: any) => <KV key={r.reason} k={String(r.reason).replace(/_/g, ' ')} v={`${r.n} · AED ${r.display}`} />)}
        </div>
      )}
    </Panel>
  );
}

function AuditLog() {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api.auditLog().then((r) => setRows(r.rows)).catch(() => setRows([])); }, []);
  if (!rows) return <Spinner />;
  return (
    <Panel title="Critical-action audit log">
      {rows.length === 0 ? <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No actions logged yet.</div> : rows.map((r) => (
        <div key={r.id} style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: `1px solid ${C.lineSoft}`, fontSize: 12.5 }}>
          <span style={{ fontWeight: 800, color: C.pinkDeep, minWidth: 120 }}>{r.action}</span>
          <span style={{ flex: 1, color: C.ink }}>{r.target || ''} <span style={{ color: C.muted }}>· {r.actor}</span></span>
          <span style={{ color: C.muted, whiteSpace: 'nowrap' }}>{r.at}</span>
        </div>
      ))}
    </Panel>
  );
}

function Tools() {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (name: string, fn: () => Promise<any>) => {
    setBusy(name); setMsg(null);
    try { const r = await fn(); setMsg(`${name}: ${JSON.stringify(r).slice(0, 200)}`); }
    catch (e: any) { setMsg(`${name} failed: ${e?.message}`); } finally { setBusy(null); }
  };
  const btn = (name: string, label: string, fn: () => Promise<any>, note: string) => (
    <div style={{ padding: '10px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{label}</div>
        <Button onClick={() => run(name, fn)} disabled={!!busy}>{busy === name ? 'Running…' : 'Run'}</Button>
      </div>
      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>{note}</div>
    </div>
  );
  return (
    <Panel title="Safe one-click clean-up">
      {btn('normalize-phones', 'Normalize phone numbers', () => api.normalizePhones(), 'Rewrites 05XXXXXXXX / 9715XXXXXXXX numbers to +9715XXXXXXXX. Unclear numbers are left untouched. Idempotent.')}
      {btn('mark-unknown-payment', 'Mark unverified payment methods', () => api.markUnknownPayment(), 'Relabels QuickBooks receipts that defaulted to Cash as Unknown (needs a QuickBooks re-export for the real method).')}
      {btn('backfill-refund-emails', 'Send any missing refund emails', () => api.backfillRefundEmails(), 'Emails the customer for any refund that moved money but never sent a confirmation. Idempotent.')}
      {msg && <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: C.ink, background: C.pinkSoft, borderRadius: 10, padding: '10px 12px', wordBreak: 'break-word' }}>{msg}</div>}
    </Panel>
  );
}
