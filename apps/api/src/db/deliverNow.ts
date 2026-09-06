/**
 * Flush the ENTIRE pending customer-email queue right now (owner-triggered after
 * lifting the daily email quota). Runs the normal delivery sweep in a loop until
 * it drains, so a backlog bigger than one batch (100) all goes out at once.
 * Gated by DELIVER_NOW=true. Idempotent — already-sent rows are skipped.
 */
const P = (s: string) => console.log(`[deliver-now] ${s}`);

export async function deliverNowFromEnv(): Promise<void> {
  if (String(process.env.DELIVER_NOW ?? '').toLowerCase() !== 'true') return;
  try {
    const { deliverPendingNotifications } = await import('../domain/notify.js');
    let totalEmails = 0, totalWa = 0, totalPush = 0, rounds = 0;
    // Up to 20 rounds (≈2000 emails) — far more than a day's real backlog.
    for (let i = 0; i < 20; i++) {
      const r = await deliverPendingNotifications();
      rounds++;
      totalEmails += r.emails; totalWa += r.whatsapps; totalPush += r.pushes;
      P(`round ${rounds}: ${r.emails} email(s), ${r.whatsapps} whatsapp(s), ${r.pushes} push(es)`);
      // Stop as soon as a round delivers nothing new.
      if (r.emails === 0 && r.whatsapps === 0 && r.pushes === 0) break;
      await new Promise((res) => setTimeout(res, 500));
    }
    P(`TOTAL: ${totalEmails} email(s), ${totalWa} whatsapp(s), ${totalPush} push(es) over ${rounds} round(s)`);
    P('DONE');
  } catch (err) {
    console.error('[deliver-now] failed:', (err as Error).message);
  }
}
