/**
 * Owner-approved: schedule the full customer notification lifecycle for one (or
 * more, comma-separated) existing event(s) that never got it — e.g. a dashboard
 * booking. Gated by ENQUEUE_LIFECYCLE=<eventId>[,<eventId>...].
 *
 * It only schedules (confirmation now + reminders + feedback); the reconcile
 * delivery step sends what's due, and enqueueBookingLifecycle self-guards on a
 * valid email + a real (non-TBD) date, so nothing goes to an unreachable/TBD
 * booking.
 */
export async function enqueueLifecycleFromEnv(): Promise<void> {
  const raw = String(process.env.ENQUEUE_LIFECYCLE ?? '').trim();
  if (!raw) return;
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const { enqueueBookingLifecycle } = await import('../domain/lifecycle.js');
  for (const id of ids) {
    try {
      const res = await enqueueBookingLifecycle(id);
      console.log(`[enqueue-lifecycle] ${id}: scheduled [${res.scheduled.join(', ') || '—'}]${res.skipped ? ' — ' + res.skipped : ''}`);
    } catch (err) {
      console.error(`[enqueue-lifecycle] ${id} failed:`, (err as Error).message);
    }
  }
}
