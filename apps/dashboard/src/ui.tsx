import type { CSSProperties, ReactNode } from 'react';

export const C = {
  ink: '#3B3641',
  bg: '#F4F1ED',
  line: '#e8e0da',
  lineSoft: '#f1eae5',
  pink: '#F06CA8',
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
  muted: '#a3968f',
  muted2: '#6f6369',
  sidebarMuted: '#a99fa6',
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
        borderRadius: 16,
        padding: 18,
        ...style,
      }}
    >
      {(title || action) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{ ...fredoka(15), flex: 1 }}>{title}</div>
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
    neutral: { bg: '#f1eae5', fg: C.muted2 },
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
        background: '#FBF8F5',
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
        padding: '9px 14px',
        borderRadius: 12,
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
        border: `1px solid ${tone === 'alert' ? '#f2c9c2' : C.line}`,
        borderRadius: 16,
        padding: '16px 18px',
        flex: 1,
        minWidth: 0,
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
