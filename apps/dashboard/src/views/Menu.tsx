import type { View } from '../App';
import { clearStaffToken } from '../api';
import { C, fredoka } from '../ui';

type Item = { id: View; icon: string; label: string };
const GROUPS: Array<{ label: string; items: Item[] }> = [
  { label: 'Sales & Customers', items: [
    { id: 'finance', icon: '💸', label: 'Sales' },
    { id: 'customers', icon: '👥', label: 'Customers' },
    { id: 'products', icon: '🎁', label: 'Products' },
    { id: 'suppliers', icon: '🚚', label: 'Suppliers' },
  ] },
  { label: 'Marketing', items: [
    { id: 'marketing', icon: '📣', label: 'Marketing' },
    { id: 'leads', icon: '💬', label: 'Leads' },
  ] },
  { label: 'Staff', items: [
    { id: 'kpis', icon: '⭐', label: 'Achievements' },
    { id: 'team', icon: '😊', label: 'Team' },
  ] },
  { label: '', items: [
    { id: 'settings', icon: '⚙️', label: 'Settings' },
  ] },
];

/**
 * The manager's menu — a full page (opened from the top-right icon) grouping the
 * business tools, so the bottom bar can stay to four simple tabs.
 */
export function Menu({ onGoto, isVisible, staffName, onSignedOut }: {
  onGoto: (v: View) => void;
  isVisible: (v: View) => boolean;
  staffName?: string;
  onSignedOut?: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {GROUPS.map((g, gi) => {
        const items = g.items.filter((it) => isVisible(it.id));
        if (items.length === 0) return null;
        return (
          <div key={gi}>
            {g.label && <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: C.muted, margin: '0 2px 8px' }}>{g.label}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {items.map((it) => (
                <button key={it.id} onClick={() => onGoto(it.id)} style={{ display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', cursor: 'pointer', border: `1px solid ${C.line}`, background: '#fff', borderRadius: 16, padding: '15px 15px' }}>
                  <span style={{ fontSize: 19 }}>{it.icon}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{it.label}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, paddingTop: 16, borderTop: `1px solid ${C.line}` }}>
        <div style={{ width: 38, height: 38, borderRadius: '50%', background: C.pink, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, flex: 'none' }}>
          {(staffName || 'M')[0]?.toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...fredoka(15) }}>{staffName || 'Manager'}</div>
        </div>
        <button onClick={() => { clearStaffToken(); onSignedOut?.(); window.location.reload(); }} style={{ border: `1px solid ${C.line}`, background: '#fff', borderRadius: 10, padding: '8px 14px', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', color: C.ink }}>Sign out</button>
      </div>
    </div>
  );
}
