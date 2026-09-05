import { assertProductionReady, config } from './config.js';
import { buildServer } from './server.js';
import { startReconciliation, stopReconciliation } from './domain/reconcile.js';
import { closePool } from './db/pool.js';
import { integrationStatus } from './payments/index.js';

async function main() {
  // A provider without secrets must never quietly take real money.
  assertProductionReady();

  /**
   * Managed hosting without a pre-deploy hook needs the schema applied
   * at boot. Both steps are safe to repeat: the migration is CREATE …
   * IF NOT EXISTS throughout, and the seed only runs against an empty
   * catalogue so it can never overwrite Eventana's own price edits.
   */
  if ((process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() === 'true') {
    const { migrate } = await import('./db/migrate.js');
    const { seedIfEmpty } = await import('./db/seed.js');
    const { seedTeamFromEnv } = await import('./db/seedTeam.js');
    const { inviteStaffFromEnv } = await import('./db/inviteStaff.js');
    const { productionReconcile } = await import('./db/productionReconcile.js');
    const { applyThemeGallery } = await import('./db/themeGallery.js');
    const { applyPackageAssets } = await import('./db/packageAssets.js');
    const { syncCatalogueContent } = await import('./db/syncCatalogue.js');
    await migrate();
    await seedIfEmpty();
    // Re-sync catalogue content (categories, services, package items) from the
    // shared catalogue so in-code edits go live without wiping the database.
    await syncCatalogueContent();
    // Load real staff + birthdays from TEAM_SEED (kept in the environment,
    // never the repo). No-op when the variable is unset.
    await seedTeamFromEnv();
    // Provision staff testers from STAFF_INVITES: mint a personal token and
    // email it with links to both apps. No-op when the variable is unset.
    await inviteStaffFromEnv().catch((err) => console.error('[invite] failed:', err));
    // Issue staff referral codes (name + "SALE") from STAFF_REFERRAL_CODES and
    // email each crew member their code the first time. No-op when unset.
    const { issueReferralCodesFromEnv } = await import('./db/issueReferralCodes.js');
    await issueReferralCodesFromEnv().catch((err) => console.error('[referral] failed:', err));
    // Set employment start/end dates (for annual-leave accrual) from
    // STAFF_EMPLOYMENT. No-op when unset.
    const { setEmploymentDatesFromEnv } = await import('./db/setEmploymentDates.js');
    await setEmploymentDatesFromEnv().catch((err) => console.error('[employment] failed:', err));
    // Seed/adjust disciplinary warnings (points-wipe or on-record) from
    // STAFF_WARNINGS. No-op when unset.
    const { applyWarningsFromEnv } = await import('./db/applyWarnings.js');
    await applyWarningsFromEnv().catch((err) => console.error('[warnings] failed:', err));
    // Backfill past leave as visible history rows from STAFF_LEAVE_HISTORY.
    const { applyLeaveHistoryFromEnv } = await import('./db/applyLeaveHistory.js');
    await applyLeaveHistoryFromEnv().catch((err) => console.error('[leave-history] failed:', err));
    // Create the customer WhatsApp message templates in Meta (WHATSAPP_WABA_ID).
    const { seedWhatsAppTemplatesFromEnv } = await import('./db/seedWhatsAppTemplates.js');
    await seedWhatsAppTemplatesFromEnv().catch((err) => console.error('[wa-templates] failed:', err));
    // Log template approval status (read-only) and — when WHATSAPP_BACKLOG_SEAL
    // is set — seal the past notification backlog so enabling customer WhatsApp
    // never fires messages about parties that already happened. Both no-op unless
    // their env is set; the seal runs BEFORE startReconciliation() below.
    const { logWhatsAppTemplateStatusesFromEnv, sealWhatsAppBacklogFromEnv } = await import('./db/whatsappGoLive.js');
    await logWhatsAppTemplateStatusesFromEnv().catch((err) => console.error('[wa-status] failed:', err));
    await sealWhatsAppBacklogFromEnv().catch((err) => console.error('[wa-seal] failed:', err));
    // Drivers roster (Shan + freelance own-car / van drivers) from DRIVERS_SEED.
    const { seedDriversFromEnv } = await import('./db/seedDrivers.js');
    await seedDriversFromEnv().catch((err) => console.error('[drivers] failed:', err));
    // Read-only audit report (AUDIT_REPORT=true) — logs the notification/sales
    // picture for review. Sends nothing, changes nothing.
    const { auditReportFromEnv } = await import('./db/auditReport.js');
    await auditReportFromEnv().catch((err) => console.error('[audit] failed:', err));
    // Read-only TIME/DATE audit (TIME_AUDIT=true) — finds any event whose stored
    // time/date differs from the customer's checkout choice. Logs only.
    const { timeAuditFromEnv } = await import('./db/timeAudit.js');
    await timeAuditFromEnv().catch((err) => console.error('[time-audit] failed:', err));
    // Read-only MONTHLY REPORT audit (REPORT_AUDIT=true) — logs old vs new
    // revenue/expenses/events per month so the finance-report fix can be verified.
    const { reportAuditFromEnv } = await import('./db/reportAudit.js');
    await reportAuditFromEnv().catch((err) => console.error('[report-audit] failed:', err));
    // Read-only TASK-PROBLEM audit (TASK_AUDIT=true) — finds stale problem rows
    // (orphaned prep_issue alerts, event_tasks that kept a blocked_reason).
    const { taskAuditFromEnv } = await import('./db/taskAudit.js');
    await taskAuditFromEnv().catch((err) => console.error('[task-audit] failed:', err));
    // Read-only customer lookup (CUSTOMER_LOOKUP=<name/phone/email>) — "did they
    // book, is their receipt right?". Logs only; sends/changes nothing.
    const { customerLookupFromEnv } = await import('./db/customerLookup.js');
    await customerLookupFromEnv().catch((err) => console.error('[cust-lookup] failed:', err));
    // Phone maintenance (PHONE_MAINTENANCE=clean|clean+email) — safe normalise +
    // email Marsha the numbers that still need a human check. Owner-approved.
    const { phoneMaintenanceFromEnv } = await import('./db/phoneMaintenance.js');
    await phoneMaintenanceFromEnv().catch((err) => console.error('[phone-fix] failed:', err));
    // Title-case every name across the system (NORMALIZE_NAMES=true). Idempotent.
    const { normalizeNamesFromEnv } = await import('./db/normalizeNames.js');
    await normalizeNamesFromEnv().catch((err) => console.error('[names] failed:', err));
    // Re-run crew auto-assignment for all upcoming events with the corrected
    // engine (REASSIGN_ALL=true) — fixes teams assigned by the older logic.
    const { reassignAllFromEnv } = await import('./db/reassignAll.js');
    await reassignAllFromEnv().catch((err) => console.error('[reassign] failed:', err));
    // Read-only duplicate-events audit (EVENTS_AUDIT=true) — diagnoses the
    // "same pink card 10+ times on Home" report.
    const { eventsAuditFromEnv } = await import('./db/eventsAudit.js');
    await eventsAuditFromEnv().catch((err) => console.error('[events-audit] failed:', err));
    // Re-pick the Event Leader for upcoming events from their current roster
    // (LEADER_FIX=true) — preserves manual crew, only fixes a stale leader badge.
    const { leaderFixFromEnv } = await import('./db/leaderFix.js');
    await leaderFixFromEnv().catch((err) => console.error('[leader-fix] failed:', err));
    // On-demand reconciliation & audit email for the CURRENT month (RECON_SEND_NOW
    // =true) — a live snapshot to the owner + Marsha on request.
    if (String(process.env.RECON_SEND_NOW ?? '').toLowerCase() === 'true') {
      const now = new Date();
      const m = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const { sendReconReport } = await import('./domain/reconReport.js');
      await sendReconReport(m).then((r) => console.log(`[recon-report] on-demand sent to ${r.sent} recipient(s)`)).catch((err) => console.error('[recon-report] on-demand failed:', err));
    }
    // Self-heal: clear any prep_issue alert whose task is no longer an issue, so a
    // resolved/completed task never keeps showing as an open problem. Idempotent.
    const { clearResolvedPrepIssueAlerts } = await import('./domain/prep.js');
    await clearResolvedPrepIssueAlerts()
      .then((n) => n && console.log(`[prep] cleared ${n} resolved prep_issue alert(s)`))
      .catch((err) => console.error('[prep] clear alerts failed:', err));
    // Abandoned-cart recovery (CART_REMINDERS=list|send) — list shows who WOULD be
    // emailed (sends nothing) for owner approval; send delivers once. Off by default.
    const { abandonedCartFromEnv } = await import('./domain/abandonedCart.js');
    await abandonedCartFromEnv().catch((err) => console.error('[cart-reminder] failed:', err));
    // Owner-approved one-time booking-data corrections (FIX_BOOKINGS=true).
    // Guarded + idempotent; sends nothing to customers.
    const { fixBookingDataFromEnv } = await import('./db/fixBookingData.js');
    await fixBookingDataFromEnv().catch((err) => console.error('[fix-bookings] failed:', err));
    // Backfill real payment method onto older order-linked receipts (BACKFILL_PAID_WITH=true).
    const { backfillPaidWithFromEnv } = await import('./db/backfillPaidWith.js');
    await backfillPaidWithFromEnv().catch((err) => console.error('[paid-with] failed:', err));
    // Owner-approved backfill of the standard notification set for upcoming
    // events that never got one (QuickBooks-converted bookings). Gated by
    // BACKFILL_EVENT_NOTIFS=true; idempotent and skips past-dated reminders.
    const { backfillEventNotificationsFromEnv } = await import('./db/backfillEventNotifs.js');
    await backfillEventNotificationsFromEnv().catch((err) => console.error('[backfill-notif] failed:', err));
    // Owner-approved: finish importing QuickBooks receipt images. The sync is
    // resumable (skips receipts already downloaded), so it continues across
    // restarts until every image is re-hosted. Gated by SYNC_QB_RECEIPTS=true;
    // fire-and-forget so a slow image download never blocks boot / health checks.
    if (String(process.env.SYNC_QB_RECEIPTS ?? '').toLowerCase() === 'true') {
      const { startExpenseSync } = await import('./domain/quickbooks.js');
      console.log('[qb-sync] boot trigger:', startExpenseSync());
    }
    // Read the REAL payment method for QuickBooks receipts from QuickBooks itself
    // (QB_METHODS=preview logs what it finds; =apply writes finance_receipts.paid_with).
    const { qbMethodsFromEnv } = await import('./domain/quickbooks.js');
    await qbMethodsFromEnv().catch((err) => console.error('[qb-methods] failed:', err));
    // Reconcile the live roster to the real team and purge demo/QA data so the
    // apps never show mock data. Runs last; idempotent and non-fatal.
    await productionReconcile();
    // Remove duplicate/test staff rows (smoke-test login, second Sheem owner,
    // duplicate Shan). Guarded + idempotent — see purgeOrphanStaff.
    const { purgeOrphanStaff } = await import('./db/purgeOrphanStaff.js');
    await purgeOrphanStaff().catch((err) => console.error('[cleanup] failed:', err));
    // Owner-approved one-off data corrections (dedupe auto receipts, fix seeded
    // event times). Idempotent — see runOneTimeFixes.
    const { runOneTimeFixes } = await import('./db/oneTimeFixes.js');
    await runOneTimeFixes().catch((err) => console.error('[fix] failed:', err));
    // Ensure the internal crew + their skills exist for the smart staff-assignment
    // engine (Jane, Dindo, Gloria, Diana, Marsha). Idempotent.
    const { seedStaffSkills, syncAllEventTeams } = await import('./domain/staffing.js');
    await seedStaffSkills().catch((err) => console.error('[staff-skills] failed:', err));
    // Make event_team mirror the real roster (event_staff) for all events, so
    // "My jobs", incentive KPIs, alerts, notifications and feedback rewards read
    // the correct crew instead of the stale checkout placeholder. Idempotent.
    await syncAllEventTeams().then((r) => console.log(`[event-team] synced ${r.synced} membership(s)`)).catch((err) => console.error('[event-team] sync failed:', err));
    // Attach real theme cover photos + inspiration galleries. No-op if the
    // generated data file is empty.
    await applyThemeGallery();
    await applyPackageAssets();
  }

  const app = await buildServer();
  await app.listen({ port: config.port, host: config.host });

  startReconciliation();

  app.log.info(
    { integrations: integrationStatus().map((i) => `${i.name}:${i.mode}`) },
    'Eventana engine ready',
  );

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    stopReconciliation();
    await app.close();
    await closePool();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start Eventana engine:', err);
  process.exit(1);
});
