import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

// Eventana identity — candy-pastel pink brand widened into a celebratory,
// multi-colour system: warm plum ink, a festive accent family (mint, peach,
// lavender, sky, sunny yellow), layered pink-tinted surfaces, deeper soft
// shadows and gradients. Professional + premium, but alive and full of party
// energy — never flat or corporate.
export const C = {
  ink: '#3B3641',       // warm plum-charcoal
  inkSoft: '#6E6470',
  bg: '#FFF8FB',        // gentle pink-cream ground
  line: '#F0DCE7',      // soft pink border
  lineSoft: '#F7EAF1',
  pink: '#F06CA8',      // brand candy pink
  pinkDeep: '#E94F9C',
  pinkSoft: '#FDEFF6',
  mint: '#5BCFC5',
  mintDeep: '#2FB4A8',
  mintSoft: '#E1F7F3',
  peach: '#FF9E7A',
  peachSoft: '#FFEBE0',
  lavender: '#B79BE0',
  lavenderSoft: '#F0E9FB',
  sky: '#6FC7EA',
  skySoft: '#E4F4FC',
  yellow: '#F7C948',
  yellowSoft: '#FFF3D6',
  yellowInk: '#a8752a',
  green: '#2e9e7e',
  greenSoft: '#E3F6EF',
  red: '#c2453a',
  redSoft: '#FCE9E5',
  muted: '#b3a8a0',
  muted2: '#96888f',
  sidebarMuted: '#b3a8a0',
  // gradients — the celebratory heart of the new look
  gradPink: 'linear-gradient(135deg,#F97CB4 0%,#E94F9C 100%)',
  gradHero: 'linear-gradient(130deg,#FFE3F0 0%,#F9C6DC 42%,#FBD9C6 100%)',
  gradMint: 'linear-gradient(135deg,#6FDccb 0%,#37B3A6 100%)',
  rainbow: 'linear-gradient(90deg,#7FD8C4,#BFE29A,#F7D06B,#F7A98C,#F080A8,#B79BE0)',
  // soft, pink-tinted, layered shadows
  shadow: '0 2px 10px rgba(233,79,156,.07)',
  shadowLg: '0 12px 30px rgba(233,79,156,.14)',
  shadowXl: '0 20px 46px rgba(233,79,156,.20)',
} as const;

/** The festive accent family, cycled for stat cards / quick actions. */
export const ACCENTS = [
  { key: 'pink', fg: C.pinkDeep, soft: C.pinkSoft, grad: 'linear-gradient(135deg,#FBA6CF,#F06CA8)' },
  { key: 'mint', fg: C.mintDeep, soft: C.mintSoft, grad: 'linear-gradient(135deg,#8FE6D9,#37B3A6)' },
  { key: 'peach', fg: '#E4703F', soft: C.peachSoft, grad: 'linear-gradient(135deg,#FFC2A0,#FF9E7A)' },
  { key: 'lavender', fg: '#7C5BB8', soft: C.lavenderSoft, grad: 'linear-gradient(135deg,#D2BEF2,#B79BE0)' },
  { key: 'sky', fg: '#2E90BE', soft: C.skySoft, grad: 'linear-gradient(135deg,#A9DEF4,#6FC7EA)' },
  { key: 'yellow', fg: C.yellowInk, soft: C.yellowSoft, grad: 'linear-gradient(135deg,#FBE08A,#F7C948)' },
] as const;

export const fredoka = (size: number, weight = 600): CSSProperties => ({
  fontFamily: "'Fredoka', sans-serif",
  fontWeight: weight,
  fontSize: size,
  letterSpacing: '-.2px',
});

export const money = (fils: number) =>
  (fils / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Count a number up from 0 when it first appears — a little life on the stats. */
export function useCountUp(target: number, ms = 650): number {
  const [v, setV] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    if (typeof window === 'undefined' || !Number.isFinite(target)) { setV(target); return; }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setV(target); return; }
    let raf = 0; const start = performance.now(); const from = ref.current;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick); else ref.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function Panel({
  title,
  action,
  children,
  style,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        background: 'rgba(255,255,255,.92)',
        backdropFilter: 'blur(6px)',
        border: `1px solid ${C.line}`,
        borderRadius: 22,
        padding: 20,
        boxShadow: C.shadow,
        ...style,
      }}
    >
      {(title || action) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 15 }}>
          <div style={{ ...fredoka(16), flex: 1 }}>{title}</div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

/** A plain elevated surface (no title row). */
export function Card({ children, style, className, onClick }: { children: ReactNode; style?: CSSProperties; className?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={className}
      style={{
        background: 'rgba(255,255,255,.92)', border: `1px solid ${C.line}`,
        borderRadius: 20, boxShadow: C.shadow, cursor: onClick ? 'pointer' : undefined, ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Section label above a group — small, confident, uppercase. */
export function SectionHeader({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '2px 2px 10px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.1, textTransform: 'uppercase', color: C.muted2, flex: 1 }}>{children}</div>
      {action}
    </div>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'error' | 'info' | 'neutral';
  children: ReactNode;
}) {
  const palette = {
    ok: { bg: C.greenSoft, fg: C.green },
    warn: { bg: C.yellowSoft, fg: C.yellowInk },
    error: { bg: C.redSoft, fg: C.red },
    info: { bg: C.pinkSoft, fg: C.pinkDeep },
    neutral: { bg: '#F6EDF2', fg: C.muted2 },
  }[tone];
  return (
    <span
      style={{
        background: palette.bg,
        color: palette.fg,
        fontSize: 10.5,
        fontWeight: 700,
        padding: '4px 9px',
        borderRadius: 10,
        whiteSpace: 'nowrap',
        letterSpacing: '.2px',
      }}
    >
      {children}
    </span>
  );
}

export function Th({ children, width }: { children?: ReactNode; width?: number | string }) {
  return (
    <th
      style={{
        textAlign: 'left',
        padding: '9px 12px',
        borderBottom: `1.5px solid ${C.line}`,
        fontWeight: 700,
        fontSize: 11.5,
        color: C.ink,
        background: '#FDF5F9',
        width,
      }}
    >
      {children}
    </th>
  );
}

export function Td({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <td
      style={{
        padding: '10px 12px',
        borderBottom: `1px solid ${C.lineSoft}`,
        fontSize: 12.5,
        fontWeight: 600,
        color: C.muted2,
        ...style,
      }}
    >
      {children}
    </td>
  );
}

export function Button({
  children,
  onClick,
  tone = 'primary',
  disabled,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const palette = {
    primary: { bg: C.gradPink, fg: '#fff', border: 'none', shadow: '0 6px 16px rgba(233,79,156,.30)' },
    ghost: { bg: '#fff', fg: C.ink, border: `1px solid ${C.line}`, shadow: 'none' },
    danger: { bg: C.redSoft, fg: C.red, border: 'none', shadow: 'none' },
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={disabled ? undefined : 'press'}
      style={{
        background: palette.bg,
        color: palette.fg,
        border: palette.border,
        boxShadow: palette.shadow,
        fontWeight: 700,
        fontSize: 12.5,
        padding: '10px 16px',
        borderRadius: 13,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** A big, colourful action tile for the Home quick-actions row. */
export function QuickAction({ icon, label, accent, onClick }: { icon: ReactNode; label: string; accent: typeof ACCENTS[number]; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="lift tap"
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start',
        background: 'rgba(255,255,255,.94)', border: `1px solid ${C.line}`, borderRadius: 18,
        padding: '13px 13px 12px', cursor: 'pointer', textAlign: 'left', boxShadow: C.shadow, minWidth: 0,
      }}
    >
      <span style={{ width: 38, height: 38, borderRadius: 12, background: accent.grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, boxShadow: `0 6px 14px ${accent.soft}` }}>{icon}</span>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, lineHeight: 1.2 }}>{label}</span>
    </button>
  );
}

/** A vibrant KPI card — big number (counted up), accent icon, optional hint. */
export function StatCard({ label, value, icon, accent, hint, i = 0, onClick }: {
  label: string; value: ReactNode; icon: ReactNode; accent: typeof ACCENTS[number]; hint?: string; i?: number; onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rise-in ${onClick ? 'lift tap' : ''}`}
      style={{
        ['--i' as any]: i,
        position: 'relative', overflow: 'hidden',
        background: 'rgba(255,255,255,.94)', border: `1px solid ${C.line}`, borderRadius: 20,
        padding: '15px 16px', boxShadow: C.shadow, cursor: onClick ? 'pointer' : undefined,
      }}
    >
      <div style={{ position: 'absolute', right: -14, top: -14, width: 74, height: 74, borderRadius: '50%', background: accent.grad, opacity: .14 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 30, height: 30, borderRadius: 10, background: accent.grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>{icon}</span>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.5px', textTransform: 'uppercase', color: C.muted2 }}>{label}</span>
      </div>
      <div style={{ ...fredoka(24), marginTop: 9, color: C.ink }}>{value}</div>
      {hint && <div style={{ fontSize: 11, fontWeight: 700, color: accent.fg, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export function Spinner() {
  return (
    <div
      style={{
        width: 22,
        height: 22,
        borderRadius: '50%',
        border: `3px solid ${C.pinkSoft}`,
        borderTopColor: C.pink,
        margin: '40px auto',
        animation: 'spin .8s linear infinite',
      }}
    />
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'alert' }) {
  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${tone === 'alert' ? '#f0cdd4' : C.line}`,
        borderRadius: 16,
        padding: '16px 18px',
        flex: 1,
        minWidth: 0,
        boxShadow: C.shadow,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '.6px' }}>
        {label.toUpperCase()}
      </div>
      <div style={{ ...fredoka(24), marginTop: 6, color: tone === 'alert' ? C.red : C.ink }}>
        {value}
      </div>
    </div>
  );
}
