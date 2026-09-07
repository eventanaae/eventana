import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, fredoka, Panel, Card, Button, Badge, Spinner, SectionHeader } from '../ui';

type Review = {
  review_id: string; reviewer_name: string | null; rating: number | null; comment: string | null;
  lang: string | null; reply_text: string | null; status: string;
  review_created_at: string | null; reply_posted_at: string | null;
};
type Status = { configured: boolean; connected: boolean; locationSet?: boolean; polling?: boolean; pendingDrafts?: number; autoRepliedTotal?: number };

const Stars = ({ n }: { n: number | null }) => (
  <span style={{ color: C.yellow, fontSize: 15, letterSpacing: 1 }}>
    {'★'.repeat(n ?? 0)}<span style={{ color: C.line }}>{'★'.repeat(Math.max(0, 5 - (n ?? 0)))}</span>
  </span>
);

const fmtDate = (s: string | null) => {
  if (!s) return '';
  try { return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; }
};

export function GoogleReviews() {
  const [status, setStatus] = useState<Status | null>(null);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = () => {
    api.googleStatus().then(setStatus).catch(() => setStatus({ configured: false, connected: false }));
    api.googleReviews().then((r) => setReviews(r.reviews ?? [])).catch(() => setReviews([]));
  };
  useEffect(load, []);

  const connect = async () => {
    setBusy('connect');
    try { const { url } = await api.googleConnect(); window.location.href = url; }
    catch { setBusy(null); }
  };

  const post = async (id: string) => {
    setBusy(id);
    const edited = drafts[id];
    try {
      if (edited !== undefined) await api.googleReviewEdit(id, edited);
      const res = await api.googleReviewPost(id);
      if (res.ok) load();
    } finally { setBusy(null); }
  };
  const skip = async (id: string) => {
    setBusy(id);
    try { await api.googleReviewSkip(id); load(); } finally { setBusy(null); }
  };

  if (reviews === null || status === null) return <Spinner />;

  // Not configured on the server yet — explain the one-time setup.
  if (!status.configured) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '8px 4px' }}>
        <Panel title="⭐ Google Reviews — auto-reply">
          <p style={{ fontSize: 13.5, fontWeight: 600, color: C.inkSoft, lineHeight: 1.7, margin: 0 }}>
            The bot will reply to every new Google review automatically — reading each comment and answering it warmly
            in the reviewer's own language. Happy reviews (4–5★) are answered instantly; the rare critical review is
            drafted here for your approval first.
          </p>
          <div style={{ marginTop: 14, background: C.pinkSoft, borderRadius: 14, padding: '13px 15px', fontSize: 12.5, fontWeight: 600, color: C.inkSoft, lineHeight: 1.7 }}>
            <b style={{ color: C.ink }}>To switch it on</b> we need Google's approval to access your Business Profile
            (a one-time request Google reviews), then you connect your Google account here. We'll walk you through it.
          </div>
        </Panel>
      </div>
    );
  }

  const pending = reviews.filter((r) => r.status === 'draft_pending' || r.status === 'failed');
  const history = reviews.filter((r) => r.status !== 'draft_pending' && r.status !== 'failed');

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '4px 2px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Connection + summary */}
      <Panel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ ...fredoka(16) }}>⭐ Google Reviews</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.muted2, marginTop: 3 }}>
              {status.connected
                ? status.polling ? 'Connected · auto-replying to new reviews' : 'Connected · auto-reply is paused'
                : 'Not connected yet'}
            </div>
          </div>
          {status.connected
            ? <Badge tone={status.polling ? 'ok' : 'warn'}>{status.polling ? 'Live' : 'Paused'}</Badge>
            : <Button onClick={connect} disabled={busy === 'connect'}>{busy === 'connect' ? 'Opening…' : 'Connect Google'}</Button>}
        </div>
        {status.connected && (
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <Mini label="Replied automatically" value={status.autoRepliedTotal ?? 0} accent={C.mint} />
            <Mini label="Awaiting your approval" value={status.pendingDrafts ?? 0} accent={C.pink} />
            {!status.locationSet && <Badge tone="warn">Listing not selected yet</Badge>}
          </div>
        )}
      </Panel>

      {/* Drafts awaiting approval */}
      {pending.length > 0 && (
        <div>
          <SectionHeader>Waiting for your approval</SectionHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {pending.map((r) => (
              <Card key={r.review_id} style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <Stars n={r.rating} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{r.reviewer_name || 'Google user'}</span>
                  <span style={{ flex: 1 }} />
                  {r.status === 'failed' && <Badge tone="error">Send failed — retry</Badge>}
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>{fmtDate(r.review_created_at)}</span>
                </div>
                {r.comment && <div style={{ fontSize: 13, fontWeight: 600, color: C.inkSoft, lineHeight: 1.6, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{r.comment}</div>}
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: C.muted2, marginBottom: 6 }}>Suggested reply</div>
                <textarea
                  value={drafts[r.review_id] ?? r.reply_text ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [r.review_id]: e.target.value }))}
                  dir={r.lang === 'ar' ? 'rtl' : 'ltr'}
                  style={{ width: '100%', minHeight: 92, boxSizing: 'border-box', borderRadius: 12, border: `1px solid ${C.line}`, padding: '11px 13px', fontSize: 13.5, fontWeight: 600, color: C.ink, lineHeight: 1.6, fontFamily: 'inherit', background: '#FFF9FC', resize: 'vertical' }}
                />
                <div style={{ display: 'flex', gap: 9, marginTop: 11 }}>
                  <Button onClick={() => post(r.review_id)} disabled={busy === r.review_id}>{busy === r.review_id ? 'Posting…' : 'Approve & post'}</Button>
                  <Button tone="ghost" onClick={() => skip(r.review_id)} disabled={busy === r.review_id}>Don't reply</Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      <div>
        <SectionHeader>Recent reviews</SectionHeader>
        {history.length === 0 ? (
          <Card style={{ padding: 20, textAlign: 'center', fontSize: 13, fontWeight: 600, color: C.muted2 }}>
            No reviews yet — new ones will appear here as they arrive.
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {history.map((r) => (
              <Card key={r.review_id} style={{ padding: 15 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: r.comment ? 7 : 0 }}>
                  <Stars n={r.rating} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{r.reviewer_name || 'Google user'}</span>
                  <span style={{ flex: 1 }} />
                  <StatusPill status={r.status} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>{fmtDate(r.review_created_at)}</span>
                </div>
                {r.comment && <div style={{ fontSize: 12.5, fontWeight: 600, color: C.inkSoft, lineHeight: 1.6 }}>{r.comment}</div>}
                {r.reply_text && (r.status === 'auto_posted' || r.status === 'posted') && (
                  <div dir={r.lang === 'ar' ? 'rtl' : 'ltr'} style={{ marginTop: 9, background: C.mintSoft, borderRadius: 11, padding: '9px 12px', fontSize: 12.5, fontWeight: 600, color: '#2b6b62', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    <span style={{ fontWeight: 800, color: C.mintDeep }}>Our reply · </span>{r.reply_text}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: '9px 14px', boxShadow: C.shadow }}>
      <div style={{ ...fredoka(20), color: accent }}>{value}</div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted2, letterSpacing: '.3px' }}>{label}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { tone: 'ok' | 'warn' | 'error' | 'info' | 'neutral'; label: string }> = {
    auto_posted: { tone: 'ok', label: 'Auto-replied' },
    posted: { tone: 'ok', label: 'Replied' },
    already_replied: { tone: 'neutral', label: 'Replied elsewhere' },
    skipped: { tone: 'neutral', label: 'No reply' },
    new: { tone: 'info', label: 'New' },
  };
  const m = map[status] ?? { tone: 'neutral' as const, label: status };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
