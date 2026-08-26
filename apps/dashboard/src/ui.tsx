import type { CSSProperties, ReactNode } from 'react';

// Eventana identity, matched to the customer app: candy-pastel pink, warm ink,
// soft pink-tinted borders and shadows, a gentle pink-cream ground and rounded
// white cards — friendly, bright and easy to scan.
export const C = {
  ink: '#3B3641',       // warm plum-charcoal (same as customer app)
  bg: '#FFF8FB',        // gentle pink-cream ground
  line: '#F0DCE7',      // soft pink border
  lineSoft: '#F7EAF1',
  pink: '#F06CA8',      // brand candy pink
  pinkDeep: '#E94F9C',
  pinkSoft: '#FDEFF6',
  mint: '#5BCFC5',
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
  // soft, pink-tinted shadows (same feel as the customer app)
  shadow: '0 2px 8px rgba(233,79,156,.06)',
  shadowLg: '0 3px 14px rgba(233,79,156,.10)',
} as const;

export const fredoka = (size: number, weight = 600): CSSProperties => ({
  fontFamily: "'Fredoka', sans-serif",
  fontWeight: weight,
  fontSize: size,
});

export const money = (fils: number) =>
  (fils / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

export function Panel({
  title,
  action,
  children,
  style,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${C.line}`,
        borderRadius: 20,
        padding: 20,
        boxShadow: C.shadow,
        ...style,
      }}
    >
      {(title || action) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ ...fredoka(15), flex: 1, letterSpacing: '-.1px' }}>{title}</div>
          {action}
        </div>
      )}
      {children}
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
    primary: { bg: C.pink, fg: '#fff', border: 'none' },
    ghost: { bg: '#fff', fg: C.ink, border: `1px solid ${C.line}` },
    danger: { bg: C.redSoft, fg: C.red, border: 'none' },
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: palette.bg,
        color: palette.fg,
        border: palette.border,
        fontWeight: 700,
        fontSize: 12,
        padding: '9px 15px',
        borderRadius: 14,
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
