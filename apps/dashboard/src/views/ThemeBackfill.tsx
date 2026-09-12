import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { C, fredoka, Panel, Spinner } from '../ui';

/**
 * Themes — a live sheet of every sale this year (app bookings + QuickBooks
 * history). The team types the party theme in each row and it saves straight to
 * the system (no CSV round-trip), so the CEO "top themes" covers the whole year.
 */
export function ThemeBackfill() {
  const now = new Date().getUTCFullYear();
  const [year, setYear] = useState(now);
  const [data, setData] = useState<{ total: number; filled: number; rows: any[] } | null>(null);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState<Record<string, 'saving' | 'saved'>>({});

  const load = () => { setData(null); api.themeBackfill(year).then(setData).catch(() => setData({ total: 0, filled: 0, rows: [] })); };
  useEffect(load, [year]);

  const rows = useMemo(() => {
    const rs = data?.rows ?? [];
    const term = q.trim().toLowerCase();
    if (!term) return rs;
    return rs.filter((r) => `${r.customer} ${r.product} ${r.phone} ${r.date}`.toLowerCase().includes(term));
  }, [data, q]);

  const save = async (saleKey: string, theme: string) => {
    setSaving((s) => ({ ...s, [saleKey]: 'saving' }));
    try {
      await api.saveThemeBackfill(saleKey, theme.trim());
      setSaving((s) => ({ ...s, [saleKey]: 'saved' }));
      // reflect in local counts
      setData((d) => {
        if (!d) return d;
        const rows = d.rows.map((r) => (r.saleKey === saleKey ? { ...r, savedTheme: theme.trim() } : r));
        const filled = rows.filter((r) => r.savedTheme || r.currentTheme).length;
        return { ...d, rows, filled };
      });
      setTimeout(() => setSaving((s) => { const n = { ...s }; delete n[saleKey]; return n; }), 1500);
    } catch {
      setSaving((s) => { const n = { ...s }; delete n[saleKey]; return n; });
    }
  };

  const years = [now, now - 1, now - 2, now - 3];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 900 }}>
      <Panel
        title="🎨 Themes — fill in each party's theme"
        action={
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
            style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: '8px 12px', fontWeight: 700, fontSize: 13, color: C.ink, background: '#fff' }}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        }
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted2, marginBottom: 12, lineHeight: 1.5 }}>
          Every sale this year. Type the theme in the last column — it saves on its own. App bookings already show their theme; the
          QuickBooks history is blank for you to fill. Saved themes feed the CEO “top themes”.
        </div>
        {!data ? <Spinner /> : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.pinkDeep }}>{data.filled} / {data.total} have a theme</div>
              <div style={{ flex: 1, minWidth: 160, height: 8, borderRadius: 8, background: C.lineSoft, overflow: 'hidden' }}>
                <div style={{ width: `${data.total ? Math.round((data.filled / data.total) * 100) : 0}%`, height: '100%', background: C.mint }} />
              </div>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔎 Search name / package…"
                style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: '8px 12px', fontSize: 12.5, fontWeight: 600, color: C.ink, minWidth: 180 }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {rows.length === 0 ? <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>Nothing here.</div> : rows.map((r) => (
                <div key={r.saleKey} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 4px', borderBottom: `1px solid ${C.lineSoft}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>
                      {r.customer || '—'} <span style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, marginLeft: 4 }}>{r.date}{r.source === 'quickbooks' ? '' : ' · app'}</span>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.muted2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[r.phone, r.product].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <div style={{ position: 'relative', flex: 'none' }}>
                    <input
                      defaultValue={r.savedTheme || ''}
                      placeholder={r.currentTheme ? `${r.currentTheme} (in system)` : 'Theme…'}
                      onBlur={(e) => { if ((e.target.value.trim()) !== (r.savedTheme || '')) save(r.saleKey, e.target.value); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      style={{ width: 190, border: `1.5px solid ${r.savedTheme ? C.mint : C.line}`, borderRadius: 10, padding: '8px 10px', fontSize: 12.5, fontWeight: 600, color: C.ink, background: '#fff' }}
                    />
                    {saving[r.saleKey] && (
                      <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 800, color: saving[r.saleKey] === 'saved' ? C.green : C.muted }}>
                        {saving[r.saleKey] === 'saved' ? '✓' : '…'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
