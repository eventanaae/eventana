/**
 * The reconciliation safety net (spec §6, boxed note).
 *
 * Webhooks get missed — providers retry, networks drop, deploys restart
 * processes mid-flight. Every 5 minutes this sweep asks the provider
 * directly about anything stuck in Processing for more than 10 minutes,
 * and alerts operations about anything still unresolved after 30.
 *
 * It resolves through the SAME code path as a webhook, so a booking
 * confirmed by reconciliation is indistinguishable from one confirmed by
 * a webhook — same audit trail, same idempotency, same Event ID rules.
 */
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { expireStaleHolds } from './inventory.js';
import { recordPaymentEvent } from './orders.js';
import { processDelivery } from './webhooks.js';
import { sweepScheduledCampaigns, sweepVoucherReminders, sweepAnniversarySuggestions } from './marketing.js';
import { sweepMonthlyReport } from './financeReport.js';
import { deliverPendingNotifications } from './notify.js';

export interface ReconcileReport {
  expiredHolds: number;
  chased: number;
  resolved: number;
  alerted: number;
}

export async function reconcileOnce(): Promise<ReconcileReport> {
  const report: ReconcileReport = { expiredHolds: 0, chased: 0, resolved: 0, alerted: 0 };

  // Lapsed holds are released first, so a chase that ends in a late
  // success sees the true availability picture.
  report.expiredHolds = await expireStaleHolds(pool);

  // Auto-complete events whose end time (in UAE) has passed. base_end_time
  // already reflects any extra hours the customer bought, so this respects a
  // longer party. Never touches cancelled events. Non-fatal.
  await pool.query(
    `UPDATE events SET phase = 'Event Completed'
      WHERE phase NOT IN ('Event Completed', 'Cancelled')
        AND cancelled_at IS NULL
        AND base_end_time ~ '^[0-2][0-9]:[0-5][0-9]$'
        AND ((event_date + base_end_time::time) AT TIME ZONE 'Asia/Dubai') < now()`,
  ).then((r) => { if (r.rowCount) console.log(`[events] auto-completed ${r.rowCount} finished event(s)`); })
    .catch((err) => console.error('[events] auto-complete failed:', err));

  const stuckSince = new Date(Date.now() - config.reconcileStuckAfterMs);
  const { rows } = await pool.query(
    `SELECT p.id, p.provider, p.provider_payment_id, p.order_id, o.updated_at
       FROM payments p
       JOIN orders o ON o.id = p.order_id
      WHERE o.status = 'processing'
        AND p.provider_payment_id IS NOT NULL
        AND o.updated_at < $1
      ORDER BY o.updated_at ASC
      LIMIT 100`,
    [stuckSince],
  );

  for (const row of rows) {
    report.chased += 1;
    try {
      const { outcome } = await processDelivery(null, row.provider, row.provider_payment_id);
      if (outcome === 'accepted') report.resolved += 1;

      const age = Date.now() - new Date(row.updated_at).getTime();
      if (outcome !== 'accepted' && age > config.reconcileAlertAfterMs) {
        report.alerted += 1;
        await pool.query(
          `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
           SELECT NULL, 'ops_alert', 'payment_unresolved', now(), $1
            WHERE NOT EXISTS (
              SELECT 1 FROM notifications
               WHERE template = 'payment_unresolved' AND payload->>'orderId' = $2)`,
          [
            JSON.stringify({
              orderId: row.order_id,
              provider: row.provider,
              minutesStuck: Math.round(age / 60_000),
              outcome,
            }),
            row.order_id,
          ],
        );
      }
    } catch (err) {
      await recordPaymentEvent(pool, {
        paymentId: row.id,
        orderId: row.order_id,
        provider: row.provider,
        newStatus: 'reconcile_error',
        source: 'poll',
        note: (err as Error).message,
      });
    }
  }

  // Send any marketing campaigns whose scheduled time has arrived. Non-fatal:
  // a mail hiccup must never disturb payment reconciliation.
  await sweepScheduledCampaigns().catch((err) => console.error('[marketing] sweep failed:', err));

  // Nudge customers about an unused 20%-off reward every ~6 months.
  await sweepVoucherReminders().catch((err) => console.error('[marketing] voucher reminders failed:', err));

  // Once a month, draft an anniversary re-engagement campaign for review (never
  // auto-sent — it waits for Manager/CEO approval).
  await sweepAnniversarySuggestions().catch((err) => console.error('[marketing] anniversary sweep failed:', err));

  // Mail the previous month's finance report once the month turns over.
  await sweepMonthlyReport().catch((err) => console.error('[finance-report] sweep failed:', err));

  // Flag any event within 3 days whose preparation isn't finished, so the
  // Owner + Manager see "Event Preparation At Risk" in time to act.
  await import('./prep.js')
    .then(({ sweepPrepAtRisk }) => sweepPrepAtRisk())
    .catch((err) => console.error('[prep] at-risk sweep failed:', err));

  // Deliver queued customer emails (booking confirmation, reminders,
  // cancellation) and staff tip pushes. Non-fatal.
  await deliverPendingNotifications()
    .then((r) => {
      if (r.emails || r.pushes) console.log(`[notify] delivered ${r.emails} email(s), ${r.pushes} push(es)`);
    })
    .catch((err) => console.error('[notify] delivery failed:', err));

  return report;
}

let timer: NodeJS.Timeout | null = null;

export function startReconciliation(): void {
  if (timer) return;
  // Run once shortly after boot so a fresh/restarted instance doesn't wait a
  // full interval before delivering queued emails or chasing stuck payments.
  setTimeout(() => {
    reconcileOnce().catch((err) => console.error('[reconcile] boot sweep failed:', err));
  }, 15_000).unref();
  timer = setInterval(() => {
    reconcileOnce().catch((err) => {
      console.error('[reconcile] sweep failed:', err);
    });
  }, config.reconcileIntervalMs);
  // Never hold the process open just for the sweep.
  timer.unref();
}

export function stopReconciliation(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
