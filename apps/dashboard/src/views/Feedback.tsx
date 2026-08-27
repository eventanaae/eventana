import { useEffect, useState } from 'react';
import { api } from '../api';
import { Button, C, fredoka, Panel, Spinner } from '../ui';
import { FeedbackCard } from './Today';

/**
 * The full customer-feedback page — every review customers left about our
 * events, newest first. Reached from the "Show more" on Home; it deliberately
 * has no bottom-nav tab of its own.
 */
export function Feedback({ onBack, onOpenEvent }: { onBack: () => void; onOpenEvent: (id: string) => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api.customerFeedback(100).then((r) => setRows(r.rows)).catch(() => setRows([])); }, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button tone="ghost" onClick={onBack}>← Back</Button>
        <div style={fredoka(20)}>💬 What customers say</div>
      </div>
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Panel><div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No customer feedback yet — it’ll appear here as customers review their events. 🌟</div></Panel>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r) => <FeedbackCard key={r.id} r={r} onOpen={() => onOpenEvent(r.event_id)} />)}
        </div>
      )}
    </div>
  );
}
