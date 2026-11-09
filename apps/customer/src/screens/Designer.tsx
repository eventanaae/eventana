import { useState } from 'react';
import { api } from '../api';
import type { ScreenProps } from '../App';
import { C, fredoka } from '../ui';
import { clampPlanServices, glamDollsFor, missingPlanChoices } from '../planChoices';

/**
 * AI Event Designer — the customer picks a theme and a budget and gets a first
 * picture of the party: a story, a colour palette, decor ideas per zone and a
 * plan priced from the live catalogue. "Book this" drops the plan into the cart.
 */
const TXT = {
  en: {
    title: 'AI Party Designer', sub: 'Pick a theme and a budget — we sketch your party',
    theme: 'Theme', own: 'Or describe your idea', ownPh: 'e.g. Pink butterflies & gold',
    budget: 'Budget (AED)', kids: 'Kids', age: 'Age', notes: 'Anything we should know?',
    notesPh: 'Indoor / outdoor, favourite colours, must-haves…', go: '✨ Design my party', busy: '✨ Designing…',
    plan: 'Your plan', total: 'Total', within: 'Within budget', over: 'A bit over budget',
    extras: 'Optional upgrades', book: 'Book this plan', again: 'Try another idea', fail: 'Something went wrong — please try again.',
    note: 'Prices come from our live price list. Final price is confirmed at checkout.',
  },
  ar: {
    title: 'مصمم الحفلات الذكي', sub: 'اختاري الثيم والميزانية — ونرسم لج تصور الحفلة',
    theme: 'الثيم', own: 'أو اكتبي فكرتج', ownPh: 'مثلاً: فراشات وردي وذهبي',
    budget: 'الميزانية (درهم)', kids: 'عدد الأطفال', age: 'العمر', notes: 'شي تبين نعرفه؟',
    notesPh: 'داخلي / خارجي، الألوان المفضلة، أشياء لازم تكون…', go: '✨ صمم حفلتي', busy: '✨ جاري التصميم…',
    plan: 'الخطة', total: 'المجموع', within: 'ضمن الميزانية', over: 'فوق الميزانية شوي',
    extras: 'إضافات اختيارية', book: 'احجزي هالخطة', again: 'جربي فكرة ثانية', fail: 'صار خطأ — حاولي مرة ثانية.',
    note: 'الأسعار من قائمة الأسعار الحالية، والسعر النهائي يتأكد عند الدفع.',
  },
};

const field = {
  width: '100%', boxSizing: 'border-box' as const, border: `1px solid ${C.pinkLine}`, borderRadius: 12,
  padding: '10px 12px', fontWeight: 700, fontSize: 12.5, background: '#fff', color: C.ink, outline: 'none', fontFamily: 'inherit',
};
const lbl = { fontSize: 11, fontWeight: 800, color: C.muted, margin: '0 0 4px' };

export function Designer({ catalogue, draft, update, go, t, lang }: ScreenProps) {
  const T = TXT[lang === 'ar' ? 'ar' : 'en'];
  const themes = catalogue.themes.filter((th) => th.celebrationType === draft.celebrationType);
  const [themeId, setThemeId] = useState<string>(draft.themeId ?? '');
  const [own, setOwn] = useState('');
  const [budget, setBudget] = useState('');
  const [kids, setKids] = useState(String(draft.childrenCount || 20));
  const [age, setAge] = useState(draft.ageBand ?? '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const [d, setD] = useState<any | null>(null);
  const kidsN = Math.max(1, Number(kids.replace(/\D/g, '')) || 20);

  // A typed idea that IS one of our existing themes ("Frozen", "unicorn") is
  // that theme — not a custom design. Treating it as custom added the AED 800
  // custom-theme fee to a party built on a ready theme.
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ').trim();
  const typedTheme = (() => {
    const q = norm(own);
    if (!q) return null;
    return themes.find((th) => norm(th.name) === q)
      ?? themes.find((th) => { const n = norm(th.name); return n.length >= 4 && (` ${q} `).includes(` ${n} `); })
      ?? null;
  })();
  const effectiveThemeId = themeId || typedTheme?.id || '';

  const run = async () => {
    setBusy(true); setErr(false);
    try {
      setD(await api.design({
        celebrationType: draft.celebrationType, themeId: effectiveThemeId || null, themeText: effectiveThemeId ? null : own || null,
        budgetAed: budget ? Number(budget) : null, childrenCount: kidsN, age: age || null, notes: notes || null,
        lang: lang === 'ar' ? 'ar' : 'en',
      }));
    } catch { setErr(true); } finally { setBusy(false); }
  };

  const book = (withExtras: boolean) => {
    if (!d) return;
    const lines = [...d.core, ...(withExtras ? d.extras : [])];
    const pkg = lines.find((l: any) => l.kind === 'package');
    const raw: Record<string, number> = {};
    for (const l of lines) if (l.kind === 'service') raw[l.id] = l.qty;
    // Raise quantities to each service's booking minimum (20-child activities).
    const services = clampPlanServices(raw, catalogue);
    const chosenThemeId = d.theme?.id ?? (effectiveThemeId || null);
    // Custom (AED 800) only when the party has NO existing theme at all and the
    // customer described their own idea.
    const isCustom = !chosenThemeId && Boolean(own.trim());
    update({
      celebrationTypeChosen: true, buildAnswered: true, packageId: pkg?.id ?? null, services,
      glamDolls: glamDollsFor(services),
      themeId: chosenThemeId, customTheme: isCustom,
      ...(isCustom
        ? { themeBrief: { theme: own, concept: `${d.title} — ${d.story}`, colors: (d.palette ?? []).join(', '), child: '', age, notes } }
        : {}),
      childrenCount: kidsN,
    });
    go(pkg ? 'package' : 'build');
  };

  return (
    <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: '8px 22px 30px', animation: 'rise .35s ease' }}>
      <button onClick={() => go('home')} style={{ background: 'none', border: 'none', color: C.muted, fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 6 }}>
        {t('common.home')}
      </button>
      <div style={{ ...fredoka(21), lineHeight: 1.15 }}>{T.title}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 14 }}>{T.sub}</div>

      {!d ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <div style={lbl}>{T.theme}</div>
            <div className="scroll" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {themes.map((th) => (
                <div
                  key={th.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={themeId === th.id}
                  aria-label={th.name}
                  onClick={() => setThemeId(themeId === th.id ? '' : th.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setThemeId(themeId === th.id ? '' : th.id); } }}
                  style={{ flex: 'none', width: 96, cursor: 'pointer' }}
                >
                  <div style={{
                    height: 70, borderRadius: 14, boxShadow: C.shadow,
                    background: th.coverImageUrl ? `#f2e7ee url(${th.coverImageUrl}) center/cover no-repeat` : th.gradient,
                    outline: themeId === th.id ? `3px solid ${C.pink}` : 'none', outlineOffset: 2,
                  }} />
                  <div style={{ fontSize: 10.5, fontWeight: 700, textAlign: 'center', paddingTop: 5 }}>{th.name}</div>
                </div>
              ))}
            </div>
          </div>
          {!themeId && (
            <div><div style={lbl}>{T.own}</div><input style={field} aria-label={T.own} value={own} onChange={(e) => setOwn(e.target.value)} placeholder={T.ownPh} /></div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}><div style={lbl}>{T.budget}</div><input style={field} aria-label={T.budget} inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ''))} placeholder="3000" /></div>
            <div style={{ width: 80 }}><div style={lbl}>{T.kids}</div><input style={field} aria-label={T.kids} inputMode="numeric" value={kids} onChange={(e) => setKids(e.target.value.replace(/[^\d]/g, ''))} /></div>
            <div style={{ width: 70 }}><div style={lbl}>{T.age}</div><input style={field} aria-label={T.age} value={age} onChange={(e) => setAge(e.target.value.slice(0, 10))} /></div>
          </div>
          <div><div style={lbl}>{T.notes}</div><textarea style={{ ...field, minHeight: 60, resize: 'vertical' }} aria-label={T.notes} value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 600))} placeholder={T.notesPh} /></div>
          <button
            onClick={() => void run()} disabled={busy || (!themeId && !own.trim())}
            style={{ border: 'none', background: !themeId && !own.trim() ? C.pinkLine : C.pink, color: '#fff', fontWeight: 800, fontSize: 14, padding: '13px 0', borderRadius: 14, cursor: 'pointer' }}
          >{busy ? T.busy : T.go}</button>
          {err && <div style={{ color: C.pinkDeep, fontWeight: 700, fontSize: 12 }}>{T.fail}</div>}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ background: 'linear-gradient(135deg,#FCEBF3,#F3ECFB)', borderRadius: 20, padding: '16px 18px' }}>
            <div style={{ ...fredoka(18) }}>{d.title}</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.6, marginTop: 5 }}>{d.story}</div>
            {d.palette?.length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                {d.palette.map((c: string) => <div key={c} style={{ width: 30, height: 30, borderRadius: 10, background: c, border: '2px solid #fff' }} />)}
              </div>
            )}
          </div>
          {d.inspiration?.length > 0 && (
            <div className="scroll" style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
              {d.inspiration.map((u: string, i: number) => <img key={u} src={u} alt={`${d.theme?.name ?? d.title} — ${lang === 'ar' ? 'إلهام' : 'inspiration'} ${i + 1}`} style={{ height: 110, borderRadius: 14, flex: 'none' }} />)}
            </div>
          )}
          {d.zones?.length > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              {d.zones.map((z: any, i: number) => (
                <div key={i} style={{ background: '#fff', borderRadius: 14, padding: '10px 13px', boxShadow: C.shadow, fontSize: 12.5, fontWeight: 600, lineHeight: 1.55 }}>
                  <div style={{ fontWeight: 800, color: C.pinkDeep }}>{z.zone}</div>{z.idea}
                </div>
              ))}
            </div>
          )}
          <div style={{ background: '#fff', borderRadius: 16, padding: '12px 14px', boxShadow: C.shadow }}>
            <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 6 }}>{T.plan}</div>
            {d.core.map((l: any) => (
              <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 600, padding: '3px 0' }}>
                <span>{l.name}{l.qty > 1 ? ` × ${l.qty}` : ''}</span><span>{t('common.aed')} {l.totalAed.toLocaleString()}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 800, borderTop: `1px solid ${C.pinkLine}`, marginTop: 6, paddingTop: 6 }}>
              <span>{T.total}</span><span>{t('common.aed')} {d.coreTotalAed.toLocaleString()}</span>
            </div>
            {d.withinBudget != null && (
              <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4, color: d.withinBudget ? C.mint : C.pinkDeep }}>{d.withinBudget ? `✓ ${T.within}` : T.over}</div>
            )}
          </div>
          {d.extras?.length > 0 && (
            <div style={{ background: '#fff', borderRadius: 16, padding: '12px 14px', boxShadow: C.shadow }}>
              <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 6 }}>{T.extras}</div>
              {d.extras.map((l: any) => (
                <div key={l.id} style={{ fontSize: 12.5, fontWeight: 600, padding: '3px 0' }}>
                  ＋ {l.name} — {t('common.aed')} {l.totalAed.toLocaleString()}
                  {l.why && <div style={{ fontSize: 11, color: C.muted }}>{l.why}</div>}
                </div>
              ))}
            </div>
          )}
          {d.tip && <div style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>💡 {d.tip}</div>}
          <div style={{ fontSize: 10.5, fontWeight: 600, color: C.faint }}>{T.note}</div>
          {(() => {
            const svc: Record<string, number> = {};
            for (const l of d.core) if (l.kind === 'service') svc[l.id] = l.qty;
            const pkg = d.core.find((l: any) => l.kind === 'package');
            const miss = [...new Set(missingPlanChoices(svc, pkg?.id ?? null, catalogue, lang === 'ar' ? 'ar' : 'en'))];
            return miss.length > 0 ? (
              <div style={{ fontSize: 11, fontWeight: 700, color: C.yellowInk, background: C.yellowSoft, borderRadius: 10, padding: '7px 10px', lineHeight: 1.45 }}>
                {lang === 'ar' ? 'بتختارين بعدها: ' : 'You’ll still choose: '}{miss.join(lang === 'ar' ? '، ' : ', ')}
              </div>
            ) : null;
          })()}
          <button onClick={() => book(false)} style={{ border: 'none', background: C.pink, color: '#fff', fontWeight: 800, fontSize: 14, padding: '13px 0', borderRadius: 14, cursor: 'pointer' }}>{T.book}</button>
          <button onClick={() => setD(null)} style={{ border: `1px solid ${C.pinkLine}`, background: '#fff', color: C.ink, fontWeight: 700, fontSize: 13, padding: '11px 0', borderRadius: 14, cursor: 'pointer' }}>{T.again}</button>
        </div>
      )}
    </div>
  );
}
