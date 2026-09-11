import { useEffect, useState } from 'react';
import { api } from '../api';
import { Button, C, fredoka, Panel, Spinner } from '../ui';
import { GoogleReviews } from './GoogleReviews';

/**
 * The full customer-ratings REPORT — every rating customers left, newest first,
 * with the event (celebration + guest-of-honour + theme + booking ref), BOTH
 * dates (event date and when it was rated), the crew who worked it, and the
 * written comment. A summary header shows totals + the Google-reviews status.
 */
const CELEB: Record<string, string> = {
  kids: 'Kids Birthday', graduation: 'Graduation', bride: 'Bride to Be',
  baby: 'Baby Shower', gender: 'Gender Reveal', adult: 'Adult Birthday', customc: 'Custom Celebration',
};
const stars = (n: number) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);

export function Feedback({ onBack, onOpenEvent }: { onBack: () => void; onOpenEvent: (id: string) => void }) {
  const [data, setData] = useState<{ stats: any; google: { reviews: number; connected: boolean }; rows: any[] } | null>(null);
  useEffect(() => { api.ratingsReport().then(setData).catch(() => setData({ stats: null, google: { reviews: 0, connected: false }, rows: [] })); }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button tone="ghost" onClick={onBack}>← Back</Button>
        <div style={fredoka(20)}>⭐ Review Report</div>
      </div>

      {/* Google Reviews (connection status + auto-reply + Google reviews) on top */}
      <GoogleReviews />

      {!data ? <Spinner /> : (
        <>
          {/* Summary */}
          <Panel>
            {data.stats && data.stats.total > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                  <Stat n={data.stats.total} label="ratings" />
                  <Stat n={data.stats.customers} label="customers rated" />
                  <Stat n={data.stats.avg_stars} label="avg stars" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[5, 4, 3, 2, 1].map((s) => {
                    const c = Number(data.stats[`s${s}`]) || 0;
                    const pct = data.stats.total ? Math.round((c / data.stats.total) * 100) : 0;
                    return (
                      <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700 }}>
                        <span style={{ width: 26, color: C.muted }}>{s}★</span>
                        <div style={{ flex: 1, height: 8, background: C.lineSoft, borderRadius: 5, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: s >= 4 ? '#2e9e7e' : s === 3 ? C.yellow : '#F06C6C' }} />
                        </div>
                        <span style={{ width: 34, textAlign: 'right', color: C.ink }}>{c}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No ratings yet — they’ll appear here as customers review their events. 🌟</div>
            )}
          </Panel>

          {/* Google reviews status */}
          <Panel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: C.ink }}>
              <span>🔵 Google reviews:</span>
              {data.google.connected
                ? <span style={{ color: '#2e9e7e' }}>{data.google.reviews} in system · connected</span>
                : <span style={{ color: C.muted }}>{data.google.reviews} in system · not linked yet</span>}
            </div>
          </Panel>

          {/* The report */}
          {data.rows.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.rows.map((r) => {
                const what = [r.baby ? `${r.baby}'s` : '', CELEB[r.celebration_type] ?? r.celebration_type ?? '', r.theme ? `· ${r.theme}` : ''].filter(Boolean).join(' ');
                const ref = r.receipt_number ? `EV-${r.receipt_number}` : null;
                return (
                  <Panel key={r.id}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} onClick={() => onOpenEvent(r.event_id)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 15, letterSpacing: 1, color: r.stars >= 4 ? '#e8a800' : '#F06C6C' }}>{stars(r.stars)}</span>
                        {ref && <span style={{ fontSize: 11.5, fontWeight: 800, color: C.pinkDeep }}>{ref}</span>}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>{r.customer}</div>
                      {what && <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted }}>🎉 {what}</div>}
                      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11.5, fontWeight: 700, color: C.muted }}>
                        <span>📅 Event: {r.event_date ?? '—'}</span>
                        <span>⭐ Rated: {r.rated_on}</span>
                      </div>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted }}>👥 Team: {r.team || '—'}</div>
                      {r.feedback && (
                        <div style={{ marginTop: 2, fontSize: 13, color: C.ink, background: C.pinkSoft, borderRadius: 10, padding: '8px 11px', lineHeight: 1.55 }}>
                          “{r.feedback}”
                        </div>
                      )}
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ n, label }: { n: number | string; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 22, fontWeight: 800, color: C.ink, lineHeight: 1.1 }}>{n ?? 0}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>{label}</span>
    </div>
  );
}
