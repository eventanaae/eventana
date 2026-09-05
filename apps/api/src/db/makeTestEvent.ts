/**
 * Create ONE test booking (owner-only, for trying the customer flow end to end:
 * confirmation email → My-Event page → team → stars → Google → tip → feedback).
 * Gated by MAKE_TEST_EVENT=true. Uses the owner's own email so only she gets it.
 */
import { pool } from './pool.js';
import { config } from '../config.js';
import { issueFeedbackToken } from '../domain/customerAuth.js';

const P = (s: string) => console.log(`[test-event] ${s}`);

export async function makeTestEventFromEnv(): Promise<void> {
  if (String(process.env.MAKE_TEST_EVENT ?? '').toLowerCase() !== 'true') return;
  try {
    const email = 'shaima-ak@hotmail.com';
    const phone = '+971566069616';
    const name = 'Sheem Test';
    const dateStr = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10); // +3 days

    const { createReceipt } = await import('../domain/finance.js');
    const receipt: any = await createReceipt({
      customerId: null,
      customerName: name,
      items: [{ name: 'Test Birthday Package', qty: 1, priceFils: 150000 }],
      eventFor: 'Hoor',
      theme: 'Spa Day',
      age: '5',
      eventTime: '17:00',
      date: dateStr,
      paidWith: 'Debit',
      dateTbd: false,
    } as any);
    P(`receipt EV-${receipt?.number} created`);

    // ensureEventForReceipt (fired by createReceipt) makes the event + customer.
    let eventId: string | null = null;
    for (let i = 0; i < 10 && !eventId; i++) {
      const r = await pool.query(`SELECT event_id FROM finance_receipts WHERE id = $1`, [receipt.id]);
      eventId = r.rows[0]?.event_id ?? null;
      if (!eventId) await new Promise((res) => setTimeout(res, 400));
    }
    if (!eventId) { P('event not created yet — re-run in a moment'); return; }

    // Put the owner's own contact on the event's customer, then schedule the
    // lifecycle (now that a valid email exists) so the confirmation actually goes.
    await pool.query(
      `UPDATE customers SET email = $2, phone = $3
        WHERE id = (SELECT customer_id FROM events WHERE id = $1)`,
      [eventId, email, phone],
    );
    const { enqueueBookingLifecycle } = await import('../domain/lifecycle.js');
    const res = await enqueueBookingLifecycle(eventId);
    P(`lifecycle: [${res.scheduled.join(', ') || '—'}]${res.skipped ? ' — ' + res.skipped : ''}`);

    const base = (config.publicAppUrl || '').replace(/\/$/, '');
    const link = `${base}/?event=${encodeURIComponent(eventId)}&fb=${encodeURIComponent(issueFeedbackToken(eventId))}`;
    P(`TEST event=${eventId} · ref=EV-${receipt.number} · date=${dateStr} 5:00 PM · to ${email}`);
    P(`  FEEDBACK/MY-EVENT LINK: ${link}`);
    P('DONE');
  } catch (err) {
    console.error('[test-event] failed:', (err as Error).message);
  }
}
