/**
 * Design tokens and small primitives, transcribed from the Eventana
 * prototype so the built app matches it: candy-pastel palette, Fredoka
 * headings, Quicksand body, Sacramento script accent.
 */
import type { CSSProperties, ReactNode } from 'react';

export const C = {
  ink: '#3B3641',
  pink: '#F06CA8',
  pinkDeep: '#E94F9C',
  pinkSoft: '#FDEFF6',
  pinkLine: '#f0dce7',
  pinkDash: '#f0c4da',
  mint: '#5BCFC5',
  mintSoft: '#E9F8F5',
  yellow: '#F7C948',
  yellowSoft: '#FFF3D6',
  yellowInk: '#a8752a',
  cream: '#FFFDFA',
  muted: '#b3a8a0',
  muted2: '#96888f',
  faint: '#c9beb6',
  green: '#2e9e7e',
  greenSoft: '#E3F6EF',
  red: '#c2453a',
  redSoft: '#FCE9E5',
  card: '#ffffff',
  shadow: '0 2px 8px rgba(233,79,156,.06)',
  shadowLg: '0 3px 14px rgba(233,79,156,.09)',
} as const;

export const fredoka = (size: number, weight = 600): CSSProperties => ({
  fontFamily: "'Fredoka', sans-serif",
  fontWeight: weight,
  fontSize: size,
});

export const money = (fils: number) =>
  (fils / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

/** "17:00" -> "5:00 PM" */
export function timeLabel(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 && h < 24 ? 'PM' : 'AM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:${String(m).padStart(2, '0')} ${suffix === 'AM' && h === 24 ? 'AM' : suffix}`;
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: C.card,
        borderRadius: 20,
        padding: '16px 18px',
        boxShadow: C.shadow,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ ...fredoka(19), margin: '26px 0 12px', ...style }}>{children}</div>;
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        background: disabled ? '#e6dcd6' : C.pink,
        color: '#fff',
        border: 'none',
        fontWeight: 700,
        fontSize: 14.5,
        padding: '16px 0',
        borderRadius: 22,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function Chip({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        flex: 'none',
        border: `1.5px solid ${active ? C.pink : C.pinkLine}`,
        background: active ? C.pinkSoft : '#fff',
        color: disabled ? C.faint : active ? C.pinkDeep : C.ink,
        fontSize: 11.5,
        fontWeight: 700,
        padding: '8px 12px',
        borderRadius: 14,
        cursor: disabled ? 'not-allowed' : 'pointer',
        whiteSpace: 'nowrap',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

export function Field(props: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  style?: CSSProperties;
}) {
  return (
    <input
      placeholder={props.placeholder}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      style={{
        border: `1px solid ${C.pinkLine}`,
        borderRadius: 14,
        padding: '12px 14px',
        fontWeight: 600,
        fontSize: 12.5,
        background: '#fff',
        color: C.ink,
        outline: 'none',
        width: '100%',
        ...props.style,
      }}
    />
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: 'warn' | 'error' | 'ok' | 'info';
  children: ReactNode;
}) {
  const palette = {
    warn: { bg: C.yellowSoft, fg: C.yellowInk },
    error: { bg: C.redSoft, fg: C.red },
    ok: { bg: C.greenSoft, fg: C.green },
    info: { bg: C.pinkSoft, fg: '#a76f8d' },
  }[tone];
  return (
    <div
      style={{
        background: palette.bg,
        color: palette.fg,
        borderRadius: 14,
        padding: '11px 14px',
        fontSize: 11.5,
        fontWeight: 600,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: 40 }}>
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          border: `3px solid ${C.pinkSoft}`,
          borderTopColor: C.pink,
          margin: '0 auto 12px',
          animation: 'spin .8s linear infinite',
        }}
      />
      {label && <div style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>{label}</div>}
    </div>
  );
}

/** Bottom sheet used for item detail. */
export function Sheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(59,54,65,.5)',
        zIndex: 20,
        display: 'flex',
        alignItems: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="scroll"
        style={{
          width: '100%',
          maxHeight: '78%',
          overflowY: 'auto',
          background: C.cream,
          borderRadius: '28px 28px 0 0',
          paddingBottom: 26,
          animation: 'rise .3s ease',
        }}
      >
        {children}
      </div>
    </div>
  );
}
