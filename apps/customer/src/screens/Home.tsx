import type { ScreenProps } from '../App';
import { C, fredoka, money, SectionTitle } from '../ui';

export function Home({ catalogue, draft, update, go, customerName }: ScreenProps) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = (customerName || '').trim().split(' ')[0] || 'there';
  const initial = firstName.charAt(0).toUpperCase() || '☺';
  const popular = catalogue.packages.slice(0, 3);
  const popularThemes = catalogue.themes.filter((t) => t.popular);
  const trending = (popularThemes.length >= 4 ? popularThemes : catalogue.themes).slice(0, 12);

  const pickCelebration = (id: string, route: 'explore' | 'build') => {
    // Switching celebration type resets the build so pricing stays
    // coherent, and re-opens the Build intake so the age and head-count
    // answers are re-confirmed for the new celebration.
    update({
      celebrationType: id,
      celebrationTypeChosen: true,
      buildAnswered: draft.celebrationType === id ? draft.buildAnswered : false,
      packageId: null,
      services: {},
      themeId: null,
      customTheme: false,
    });
    go(route);
  };

  return (
    <div style={{ padding: '10px 22px 30px', animation: 'rise .35s ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, letterSpacing: '.4px' }}>
            {greeting}
          </div>
          <div style={{ ...fredoka(23), marginTop: 2 }}>{firstName} ✨</div>
        </div>
        <div
          style={{
            width: 42, height: 42, borderRadius: '50%', background: C.pink, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15,
          }}
        >
          {initial}
        </div>
      </div>

      <div
        style={{
          background: 'linear-gradient(135deg,#FDE0EE 0%,#F9C6DC 55%,#BDEBE4 130%)',
          borderRadius: 26,
          padding: '28px 24px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', top: -30, right: -30, width: 130, height: 130, borderRadius: '50%', background: 'rgba(255,255,255,.5)' }} />
        <div style={{ position: 'absolute', bottom: -44, right: 36, width: 80, height: 80, borderRadius: '50%', background: 'rgba(247,201,72,.28)' }} />
        <div style={{ position: 'relative', fontFamily: "'Sacramento', cursive", fontSize: 24, color: C.pinkDeep, lineHeight: 1 }}>
          Eventana Parties
        </div>
        <div style={{ position: 'relative', ...fredoka(27), lineHeight: 1.15, marginTop: 4 }}>
          Let’s Create Something Magical ✨
        </div>
        <div style={{ position: 'relative', fontSize: 12.5, fontWeight: 600, color: '#8b7d84', margin: '8px 0 18px' }}>
          Cheers to love, music, and the magic of every moment.
        </div>
      </div>

      {/* Two clear, premium ways to begin */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
        <OptionCard
          icon="🎁"
          tint="linear-gradient(135deg,#FDE0EE,#F9C6DC)"
          title="Explore Kids Packages"
          sub="Ready-made setups — themed, priced & ready to book"
          onClick={() => go('explore')}
        />
        <OptionCard
          icon="🎨"
          tint="linear-gradient(135deg,#E9F8F5,#BDEBE4)"
          title="Build Your Own Party"
          sub="Hand-pick every detail and make it uniquely yours"
          onClick={() => go('build')}
        />
      </div>

      <SectionTitle style={{ marginBottom: 4 }}>What Are You Celebrating? ✨</SectionTitle>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 12 }}>
        We’ll tailor packages, services &amp; themes to your celebration.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {catalogue.celebrationTypes.map((ev) => (
          <div
            key={ev.id}
            onClick={() => pickCelebration(ev.id, ev.route)}
            style={{
              borderRadius: 20,
              cursor: 'pointer',
              border: `2px solid ${draft.celebrationType === ev.id ? C.pink : 'transparent'}`,
              background: '#fff',
              overflow: 'hidden',
              boxShadow: C.shadow,
            }}
          >
            <div style={{ height: 56, background: ev.gradient }} />
            <div style={{ padding: '9px 12px 11px' }}>
              <div style={{ fontWeight: 700, fontSize: 12.5 }}>{ev.label}</div>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, marginTop: 2 }}>{ev.sub}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '28px 0 14px' }}>
        <span style={fredoka(19)}>Popular Packages</span>
        <a onClick={() => go('explore')} style={{ fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
          See all
        </a>
      </div>
      <div className="scroll" style={{ display: 'flex', gap: 14, overflowX: 'auto', margin: '0 -22px', padding: '0 22px 6px' }}>
        {popular.map((p) => (
          <div
            key={p.id}
            onClick={() => { update({ packageId: p.id, services: {} }); go('package'); }}
            style={{ flex: 'none', width: 230, background: '#fff', borderRadius: 22, overflow: 'hidden', boxShadow: C.shadowLg, cursor: 'pointer' }}
          >
            <div style={{ height: 120, background: p.gradient, position: 'relative' }}>
              <span style={{ position: 'absolute', top: 10, left: 10, background: '#fff', color: C.pinkDeep, fontSize: 9.5, fontWeight: 700, padding: '4px 9px', borderRadius: 20, letterSpacing: '.5px' }}>
                {p.tag}
              </span>
            </div>
            <div style={{ padding: '13px 15px 15px' }}>
              <div style={fredoka(14.5)}>{p.name}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, margin: '3px 0 8px' }}>
                {p.capacity} · {p.durationHours} hours
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.pinkDeep }}>AED {money(p.priceFils)}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '26px 0 12px' }}>
        <span style={fredoka(19)}>Trending Themes</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.faint }}>swipe →</span>
      </div>
      <div className="scroll" style={{ display: 'flex', gap: 12, overflowX: 'auto', margin: '0 -22px', padding: '0 22px 6px' }}>
        {trending.map((t) => (
          <div key={t.id} onClick={() => go('theme')} style={{ flex: 'none', width: 132, cursor: 'pointer' }}>
            <div style={{ height: 96, borderRadius: 18, background: t.gradient, boxShadow: C.shadow }} />
            <div style={{ fontSize: 11.5, fontWeight: 700, padding: '8px 2px 0', textAlign: 'center' }}>{t.name}</div>
          </div>
        ))}
      </div>

      <div
        onClick={() => go('assistant')}
        style={{ marginTop: 26, background: C.mintSoft, borderRadius: 22, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}
      >
        <div style={{ width: 44, height: 44, borderRadius: 16, background: C.mint, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, flex: 'none' }}>
          ✦
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>Eventana AI Assistant</div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: '#7ba49e' }}>
            “I have 30 kids and AED 5,000 — help me plan.”
          </div>
        </div>
        <span style={{ color: C.mint, fontWeight: 700 }}>›</span>
      </div>

      <div style={{ marginTop: 18, textAlign: 'center', fontSize: 11, fontWeight: 600, color: C.faint }}>
        @eventana.uae · +971 56 450 0777
      </div>
    </div>
  );
}

/** A premium, tappable way-to-start card (Explore / Build Your Own). */
function OptionCard({
  icon,
  tint,
  title,
  sub,
  onClick,
}: {
  icon: string;
  tint: string;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        background: '#fff',
        borderRadius: 22,
        padding: '14px 16px',
        boxShadow: C.shadowLg,
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 18,
          background: tint,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
          flex: 'none',
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={fredoka(15)}>{title}</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>
          {sub}
        </div>
      </div>
      <span style={{ color: C.pink, fontWeight: 700, fontSize: 18 }}>›</span>
    </div>
  );
}
