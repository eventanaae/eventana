import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, Panel, Spinner, Button } from '../ui';

/**
 * Story Studio — a library of daily story images + captions with a schedule.
 * Prepare stories once; each day the "Today" card surfaces the one that's due,
 * ready to post to Instagram / WhatsApp (download + copy caption for now;
 * one-tap auto-post to Instagram lights up once the IG Business account is
 * connected).
 */
const fmtDate = (d?: string | null) => {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00`);
  return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
};

export function StoryStudio() {
  const [list, setList] = useState<any[] | null>(null);
  const [today, setToday] = useState<any | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    api.stories().then(setList).catch(() => setList([]));
    api.storyToday().then((r) => setToday(r.story)).catch(() => setToday(null));
  };
  useEffect(() => { load(); }, []);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2500); };
  const copy = async (t?: string | null) => { if (!t) return; try { await navigator.clipboard.writeText(t); flash('Caption copied ✓'); } catch { flash('Copy failed'); } };
  const markPosted = async (id: number, to: 'instagram' | 'whatsapp' | 'both') => { await api.updateStory(id, { markPosted: to }); flash('Marked as posted ✓'); load(); };
  const del = async (id: number) => { await api.deleteStory(id); load(); };

  if (list === null) return <Spinner />;
  const upcoming = list.filter((s) => !s.posted_at);
  const posted = list.filter((s) => s.posted_at);

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 820 }}>
      <Panel style={{ background: C.gradHero, border: 'none' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.1, textTransform: 'uppercase', color: C.pinkDeep }}>Marketing</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: C.ink, margin: '6px 0 6px' }}>Story Studio 🎬</div>
        <div style={{ fontSize: 14, color: C.inkSoft, maxWidth: 620 }}>
          Build a library of daily stories — image + caption + the day it goes out. Each day the story that's due appears here, ready to post to Instagram &amp; WhatsApp.
        </div>
      </Panel>

      {msg && <div style={{ background: C.greenSoft, color: C.green, borderRadius: 12, padding: '9px 13px', fontSize: 13, fontWeight: 700 }}>{msg}</div>}

      {/* Today's story */}
      <Panel title="⭐ Today's story">
        {today ? (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <img src={today.image_url} alt="story" style={{ width: 150, height: 267, objectFit: 'cover', borderRadius: 14, border: `1px solid ${C.line}`, flex: 'none', background: C.pinkSoft }} />
            <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {today.caption_en && <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.5 }}>{today.caption_en}</div>}
              {today.caption_ar && <div dir="rtl" style={{ fontSize: 13, color: C.ink, lineHeight: 1.6 }}>{today.caption_ar}</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                <a href={today.image_url} download target="_blank" rel="noreferrer" style={{ textDecoration: 'none', fontSize: 12.5, fontWeight: 800, color: '#fff', background: C.gradPink, borderRadius: 11, padding: '9px 14px' }}>⬇️ Download image</a>
                {today.caption_en && <button onClick={() => copy(today.caption_en)} style={pill}>Copy caption (EN)</button>}
                {today.caption_ar && <button onClick={() => copy(today.caption_ar)} style={pill}>نسخ الكابشن</button>}
                <a href="https://www.instagram.com" target="_blank" rel="noreferrer" style={{ ...pill, textDecoration: 'none', display: 'inline-block' } as any}>Open Instagram</a>
                <button onClick={() => markPosted(today.id, 'both')} style={{ ...pill, color: C.green, borderColor: C.green } as any}>✓ Mark posted</button>
              </div>
              <div style={{ fontSize: 11, color: C.muted2, marginTop: 4 }}>Auto-post to Instagram turns on once your IG Business account is connected — for now, download + post in a tap.</div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>No story due today. Add one below or schedule it for today.</div>
        )}
      </Panel>

      <AddStory onAdded={() => { load(); flash('Story added ✓'); }} />

      {/* Queue */}
      <Panel title={`🗂️ Upcoming & queued · ${upcoming.length}`}>
        {upcoming.length === 0 ? <div style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>Nothing queued yet.</div> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 12 }}>
            {upcoming.map((s) => (
              <div key={s.id} style={{ border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
                <img src={s.image_url} alt="" style={{ width: '100%', height: 180, objectFit: 'cover', background: C.pinkSoft }} />
                <div style={{ padding: '8px 10px' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: s.scheduled_date ? C.pinkDeep : C.muted }}>{s.scheduled_date ? `📅 ${fmtDate(s.scheduled_date)}` : 'Queue'}</div>
                  {(s.caption_en || s.caption_ar) && <div style={{ fontSize: 11, color: C.muted, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.caption_en || s.caption_ar}</div>}
                  <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                    <button onClick={() => markPosted(s.id, 'both')} style={{ ...miniBtn, color: C.green } as any}>Posted</button>
                    <button onClick={() => del(s.id)} style={{ ...miniBtn, color: C.red } as any}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {posted.length > 0 && (
        <Panel title={`✅ Posted · ${posted.length}`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(90px,1fr))', gap: 8 }}>
            {posted.slice(0, 24).map((s) => (
              <img key={s.id} src={s.image_url} alt="" title={s.posted_to || 'posted'} style={{ width: '100%', height: 130, objectFit: 'cover', borderRadius: 10, opacity: 0.75, background: C.pinkSoft }} />
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

const pill: React.CSSProperties = { border: `1px solid ${C.line}`, background: '#fff', borderRadius: 11, padding: '9px 13px', fontSize: 12.5, fontWeight: 800, color: C.ink, cursor: 'pointer' };
const miniBtn: React.CSSProperties = { flex: 1, border: `1px solid ${C.line}`, background: '#fff', borderRadius: 8, padding: '5px 0', fontSize: 11, fontWeight: 800, cursor: 'pointer' };

function AddStory({ onAdded }: { onAdded: () => void }) {
  const [imageUrl, setImageUrl] = useState('');
  const [captionEn, setCaptionEn] = useState('');
  const [captionAr, setCaptionAr] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', border: `1px solid ${C.line}`, borderRadius: 11, padding: '10px 12px', fontSize: 13.5, fontWeight: 600, color: C.ink, outline: 'none' };

  const add = async () => {
    if (!/^https?:\/\/.+/.test(imageUrl.trim())) { setErr('Paste an image link (starts with https://).'); return; }
    setBusy(true); setErr(null);
    try {
      await api.addStory({
        imageUrl: imageUrl.trim(),
        captionEn: captionEn.trim() || undefined,
        captionAr: captionAr.trim() || undefined,
        linkUrl: linkUrl.trim() || undefined,
        scheduledDate: scheduledDate || undefined,
      });
      setImageUrl(''); setCaptionEn(''); setCaptionAr(''); setLinkUrl(''); setScheduledDate('');
      onAdded();
    } catch { setErr('Could not add — check the link and try again.'); }
    finally { setBusy(false); }
  };

  return (
    <Panel title="➕ Add a story">
      <div style={{ display: 'grid', gap: 9 }}>
        <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="Image link (https://…)  — paste a photo/story image URL" style={inp} />
        {imageUrl && /^https?:\/\/.+/.test(imageUrl) && <img src={imageUrl} alt="preview" style={{ width: 110, height: 196, objectFit: 'cover', borderRadius: 12, border: `1px solid ${C.line}`, background: C.pinkSoft }} />}
        <textarea value={captionEn} onChange={(e) => setCaptionEn(e.target.value)} placeholder="Caption (English) — optional" rows={2} style={{ ...inp, resize: 'vertical' }} />
        <textarea value={captionAr} onChange={(e) => setCaptionAr(e.target.value)} dir="rtl" placeholder="الكابشن (عربي) — اختياري" rows={2} style={{ ...inp, resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="Link (optional)" style={{ ...inp, flex: 1, minWidth: 180 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: C.muted }}>
            Post on
            <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} style={{ ...inp, width: 160 }} />
          </label>
        </div>
        {err && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.red }}>{err}</div>}
        <div><Button onClick={add} disabled={busy}>{busy ? 'Adding…' : 'Add to library'}</Button></div>
      </div>
    </Panel>
  );
}
