import { assertProductionReady, config } from './config.js';
import { buildServer } from './server.js';
import { startReconciliation, stopReconciliation } from './domain/reconcile.js';
import { closePool, pool } from './db/pool.js';
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
    // Template-status logging is now handled by WA_STATUS (db/waTemplateStatus.ts);
    // the old logWhatsAppTemplateStatusesFromEnv duplicate is no longer wired.
    const { sealWhatsAppBacklogFromEnv } = await import('./db/whatsappGoLive.js');
    await sealWhatsAppBacklogFromEnv().catch((err) => console.error('[wa-seal] failed:', err));
    // Drivers roster (Shan + freelance own-car / van drivers) from DRIVERS_SEED.
    const { seedDriversFromEnv } = await import('./db/seedDrivers.js');
    await seedDriversFromEnv().catch((err) => console.error('[drivers] failed:', err));
    // Part-timer contacts (clowns / face-painters) from PARTTIMERS_SEED.
    const { seedPartTimersFromEnv } = await import('./db/seedPartTimers.js');
    await seedPartTimersFromEnv().catch((err) => console.error('[part-timers] failed:', err));
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
    // Read-only Home/Upcoming audit (TODAY_AUDIT=true) — lists upcoming events and
    // flags any the old Home query dropped (missing order row / undated).
    const { todayAuditFromEnv } = await import('./db/todayAudit.js');
    await todayAuditFromEnv().catch((err) => console.error('[today-audit] failed:', err));
    // Staff any upcoming event that has an EMPTY team (STAFF_EMPTY_FIX=true) —
    // fixes converted/imported bookings; never overwrites a manual roster.
    const { staffEmptyFixFromEnv } = await import('./db/staffEmptyFix.js');
    await staffEmptyFixFromEnv().catch((err) => console.error('[staff-empty] failed:', err));
    // Owner-approved corrected receipt re-send to Ghaya (RESEND_GHAYA=true) —
    // verifies the live data (12 Sep, 5 PM) BEFORE sending; aborts if anything
    // is off. Marsha is BCC'd automatically.
    const { resendGhayaFromEnv } = await import('./db/resendGhaya.js');
    await resendGhayaFromEnv().catch((err) => console.error('[resend-ghaya] failed:', err));
    // Read-only customer-data integrity audit (DATA_AUDIT=true) — per-event
    // verdict across event/receipt/cart/customer; the pre-send safety gate.
    const { dataIntegrityAuditFromEnv } = await import('./db/dataIntegrityAudit.js');
    await dataIntegrityAuditFromEnv().catch((err) => console.error('[data-audit] failed:', err));
    // One-off integrity repairs (INTEGRITY_FIX=true) — align carts to events,
    // suppress pending sends for unreachable customers. Changes data, sends nothing.
    const { integrityFixFromEnv } = await import('./db/integrityFix.js');
    await integrityFixFromEnv().catch((err) => console.error('[integrity-fix] failed:', err));
    // Read-only: full notification history for one event (BOOKING_HISTORY=<id>) —
    // exactly what was emailed/WhatsApp'd to the customer and when.
    const { bookingHistoryFromEnv } = await import('./db/bashayerCheck.js');
    await bookingHistoryFromEnv().catch((err) => console.error('[booking-history] failed:', err));
    // Owner-approved: schedule the notification lifecycle for existing event(s)
    // that never got it (ENQUEUE_LIFECYCLE=<id>[,<id>...]).
    const { enqueueLifecycleFromEnv } = await import('./db/enqueueLifecycle.js');
    await enqueueLifecycleFromEnv().catch((err) => console.error('[enqueue-lifecycle] failed:', err));
    // Log the signed My-Event/feedback link for an event (FEEDBACK_LINK=<id>[,..]).
    const { feedbackLinkFromEnv } = await import('./db/feedbackLink.js');
    await feedbackLinkFromEnv().catch((err) => console.error('[feedback-link] failed:', err));
    // WhatsApp token validity/expiry + template approval status (WA_TOKEN_CHECK=true).
    const { waTokenCheckFromEnv } = await import('./db/waCheck.js');
    await waTokenCheckFromEnv().catch((err) => console.error('[wa-check] failed:', err));
    const { waEditFeedbackFromEnv } = await import('./db/waEditTemplate.js');
    await waEditFeedbackFromEnv().catch((err) => console.error('[wa-edit] failed:', err));
    // Owner-only: create ONE test booking to trial the customer flow (MAKE_TEST_EVENT=true).
    const { makeTestEventFromEnv } = await import('./db/makeTestEvent.js');
    await makeTestEventFromEnv().catch((err) => console.error('[test-event] failed:', err));
    const { setEventPhaseFromEnv } = await import('./db/setPhase.js');
    await setEventPhaseFromEnv().catch((err) => console.error('[set-phase] failed:', err));
    const { sqlCheckFromEnv } = await import('./db/sqlCheck.js');
    await sqlCheckFromEnv().catch((err) => console.error('[sql-check] failed:', err));
    const { diagFromEnv } = await import('./db/diag.js');
    await diagFromEnv().catch((err) => console.error('[diag] failed:', err));
    const { diagCeoFromEnv } = await import('./db/diagCeo.js');
    await diagCeoFromEnv().catch((err) => console.error('[diag-ceo] failed:', err));
    const { themeSheetFromEnv } = await import('./db/themeSheet.js');
    await themeSheetFromEnv().catch((err) => console.error('[theme-sheet] failed:', err));
    const { receiptSyncFromEnv } = await import('./db/receiptSync.js');
    await receiptSyncFromEnv().catch((err) => console.error('[receipt-sync] failed:', err));
    const { integritySweepFromEnv } = await import('./db/integritySweep.js');
    await integritySweepFromEnv().catch((err) => console.error('[integrity] failed:', err));
    const { refundWaGuardOnBoot } = await import('./db/refundWaGuard.js');
    await refundWaGuardOnBoot().catch((err) => console.error('[refund-wa-guard] failed:', err));
    const { sendUserManualFromEnv } = await import('./db/sendUserManual.js');
    await sendUserManualFromEnv().catch((err) => console.error('[user-manual] failed:', err));
    const { sendBnplRequestFromEnv } = await import('./db/sendBnplRequest.js');
    await sendBnplRequestFromEnv().catch((err) => console.error('[bnpl-request] failed:', err));
    const { addMarshaTaskFromEnv } = await import('./db/addMarshaTask.js');
    await addMarshaTaskFromEnv().catch((err) => console.error('[add-marsha-task] failed:', err));
    const { addMarshaThemesTaskFromEnv } = await import('./db/addMarshaThemesTask.js');
    await addMarshaThemesTaskFromEnv().catch((err) => console.error('[marsha-themes] failed:', err));
    const { addMarshaTransfersTaskFromEnv } = await import('./db/addMarshaTransfersTask.js');
    await addMarshaTransfersTaskFromEnv().catch((err) => console.error('[marsha-transfers] failed:', err));
    const { addWhereWeBuyTaskFromEnv } = await import('./db/addWhereWeBuyTask.js');
    await addWhereWeBuyTaskFromEnv().catch((err) => console.error('[wwb-task] failed:', err));
    const { cancelWhereWeBuyTaskFromEnv } = await import('./db/cancelWhereWeBuyTask.js');
    await cancelWhereWeBuyTaskFromEnv().catch((err) => console.error('[wwb-cancel] failed:', err));
    const { addOwnerWwbTaskFromEnv } = await import('./db/addOwnerWwbTask.js');
    await addOwnerWwbTaskFromEnv().catch((err) => console.error('[owner-wwb] failed:', err));
    const { moveThemesTaskFromEnv } = await import('./db/moveThemesTask.js');
    await moveThemesTaskFromEnv().catch((err) => console.error('[themes-move] failed:', err));
    const { seedOwnerTasksFromEnv } = await import('./db/seedOwnerTasks.js');
    await seedOwnerTasksFromEnv().catch((err) => console.error('[seed-owner-tasks] failed:', err));
    const { diagMemberPointsFromEnv } = await import('./db/diagMemberPoints.js');
    await diagMemberPointsFromEnv().catch((err) => console.error('[diag-points] failed:', err));
    const { diagStaffWaFromEnv } = await import('./db/diagStaffWa.js');
    await diagStaffWaFromEnv().catch((err) => console.error('[diag-wa] failed:', err));
    const { notifyGloriaFixFromEnv } = await import('./db/notifyGloriaFix.js');
    await notifyGloriaFixFromEnv().catch((err) => console.error('[gloria-fix] failed:', err));
    const { diagDayOffFromEnv } = await import('./db/diagDayOff.js');
    await diagDayOffFromEnv().catch((err) => console.error('[diag-dayoff] failed:', err));
    const { diagTamaraFromEnv } = await import('./db/diagTamara.js');
    await diagTamaraFromEnv().catch((err) => console.error('[diag-tamara] failed:', err));
    const { applyTrelloThemesFromEnv } = await import('./db/applyTrelloThemes.js');
    await applyTrelloThemesFromEnv().catch((err) => console.error('[trello-themes] failed:', err));
    const { diagThemesFromEnv } = await import('./db/diagThemes.js');
    await diagThemesFromEnv().catch((err) => console.error('[diag-themes] failed:', err));
    const { setThemesManualFromEnv } = await import('./db/setThemesManual.js');
    await setThemesManualFromEnv().catch((err) => console.error('[manual-themes] failed:', err));
    const { copyThemeTwinsFromEnv } = await import('./db/copyThemeTwins.js');
    await copyThemeTwinsFromEnv().catch((err) => console.error('[theme-twins] failed:', err));
    const { diagThemeNamesFromEnv } = await import('./db/diagThemeNames.js');
    await diagThemeNamesFromEnv().catch((err) => console.error('[theme-names] failed:', err));
    const { cleanThemeNamesFromEnv } = await import('./db/cleanThemeNames.js');
    await cleanThemeNamesFromEnv().catch((err) => console.error('[clean-themes] failed:', err));
    const { addSuppliersFromEnv } = await import('./db/addSuppliers.js');
    await addSuppliersFromEnv().catch((err) => console.error('[add-suppliers] failed:', err));
    const { diagExpenseCategoriesFromEnv } = await import('./db/diagExpenseCategories.js');
    await diagExpenseCategoriesFromEnv().catch((err) => console.error('[exp-cats] failed:', err));
    const { diagReceiptUrlsFromEnv } = await import('./db/diagReceiptUrls.js');
    await diagReceiptUrlsFromEnv().catch((err) => console.error('[receipts] failed:', err));
    const { receiptOcrFromEnv } = await import('./db/receiptOcr.js');
    await receiptOcrFromEnv().catch((err) => console.error('[receipt-ocr] failed:', err));
    const { buildSupplierMemoryFromEnv } = await import('./db/buildSupplierMemory.js');
    await buildSupplierMemoryFromEnv().catch((err) => console.error('[sup-memory] failed:', err));
    const { diagSupplierProfilesFromEnv } = await import('./db/diagSupplierProfiles.js');
    await diagSupplierProfilesFromEnv().catch((err) => console.error('[sup-profiles] failed:', err));
    const { diagRawOcrFromEnv } = await import('./db/diagRawOcr.js');
    await diagRawOcrFromEnv().catch((err) => console.error('[raw-ocr] failed:', err));
    const { applySupplierCleanupFromEnv } = await import('./db/applySupplierCleanup.js');
    await applySupplierCleanupFromEnv().catch((err) => console.error('[sup-clean] failed:', err));
    const { diagTransferRecipientsFromEnv } = await import('./db/diagTransferRecipients.js');
    await diagTransferRecipientsFromEnv().catch((err) => console.error('[transfers] failed:', err));
    const { diagResolveNamesFromEnv } = await import('./db/diagResolveNames.js');
    await diagResolveNamesFromEnv().catch((err) => console.error('[resolve] failed:', err));
    const { recategorizeExpensesFromEnv } = await import('./db/recategorizeExpenses.js');
    await recategorizeExpensesFromEnv().catch((err) => console.error('[recat] failed:', err));
    const { dumpSuppliersFromEnv } = await import('./db/dumpSuppliers.js');
    await dumpSuppliersFromEnv().catch((err) => console.error('[sup-dump] failed:', err));
    const { dumpSupplierSheetFromEnv } = await import('./db/dumpSupplierSheet.js');
    await dumpSupplierSheetFromEnv().catch((err) => console.error('[sheet-dump] failed:', err));
    const { dumpReceiptUrlsFromEnv } = await import('./db/dumpReceiptUrls.js');
    await dumpReceiptUrlsFromEnv().catch((err) => console.error('[rcpt-dump] failed:', err));
    const { dumpExpenseAuditFromEnv } = await import('./db/dumpExpenseAudit.js');
    await dumpExpenseAuditFromEnv().catch((err) => console.error('[exp-audit] failed:', err));
    const { dumpAllVendorsFromEnv } = await import('./db/dumpAllVendors.js');
    await dumpAllVendorsFromEnv().catch((err) => console.error('[vend-dump] failed:', err));
    const { dumpNamedReceiptsFromEnv } = await import('./db/dumpNamedReceipts.js');
    await dumpNamedReceiptsFromEnv().catch((err) => console.error('[named-rcpt] failed:', err));
    const { dumpVendorDescsFromEnv } = await import('./db/dumpVendorDescs.js');
    await dumpVendorDescsFromEnv().catch((err) => console.error('[vdesc] failed:', err));
    const { dumpCheckJaneFromEnv } = await import('./db/dumpCheckJane.js');
    await dumpCheckJaneFromEnv().catch((err) => console.error('[cjane] failed:', err));
    const { applySupplierMappingFromEnv } = await import('./db/applySupplierMapping.js');
    await applySupplierMappingFromEnv().catch((err) => console.error('[map-apply] failed:', err));
    const { combLeftoverFromEnv } = await import('./db/combLeftover.js');
    await combLeftoverFromEnv().catch((err) => console.error('[comb] failed:', err));
    const { dumpUncat3FromEnv } = await import('./db/dumpUncat3.js');
    await dumpUncat3FromEnv().catch((err) => console.error('[uncat3] failed:', err));
    const { applyFinalFixesFromEnv } = await import('./db/applyFinalFixes.js');
    await applyFinalFixesFromEnv().catch((err) => console.error('[final-fix] failed:', err));
    const { dumpBlankVendorFromEnv } = await import('./db/dumpBlankVendor.js');
    await dumpBlankVendorFromEnv().catch((err) => console.error('[blankv] failed:', err));
    const { blankFix1FromEnv } = await import('./db/blankFix1.js');
    await blankFix1FromEnv().catch((err) => console.error('[blankfix1] failed:', err));
    const { dumpBlankReceiptsFromEnv } = await import('./db/dumpBlankReceipts.js');
    await dumpBlankReceiptsFromEnv().catch((err) => console.error('[blankr] failed:', err));
    const { blankFix2FromEnv } = await import('./db/blankFix2.js');
    await blankFix2FromEnv().catch((err) => console.error('[blankfix2] failed:', err));
    const { blankFix3FromEnv } = await import('./db/blankFix3.js');
    await blankFix3FromEnv().catch((err) => console.error('[blankfix3] failed:', err));
    const { sendMarshaMissingSupplierOnce } = await import('./db/sendMarshaMissingSupplier.js');
    await sendMarshaMissingSupplierOnce().catch((err) => console.error('[marsha-missing] failed:', err));
    const { supplierRemoveEmployeesFromEnv } = await import('./db/supplierRemoveEmployees.js');
    await supplierRemoveEmployeesFromEnv().catch((err) => console.error('[sup-rm] failed:', err));
    const { supplierRemoveStaff2FromEnv } = await import('./db/supplierRemoveStaff2.js');
    await supplierRemoveStaff2FromEnv().catch((err) => console.error('[sup-rm2] failed:', err));
    const { mergeDupVendorsFromEnv } = await import('./db/mergeDupVendors.js');
    await mergeDupVendorsFromEnv().catch((err) => console.error('[merge-vend] failed:', err));
    const { ownerSpotFixesFromEnv } = await import('./db/ownerSpotFixes.js');
    await ownerSpotFixesFromEnv().catch((err) => console.error('[spot-fix] failed:', err));
    const { vanInstallmentsFromEnv } = await import('./db/vanInstallments.js');
    await vanInstallmentsFromEnv().catch((err) => console.error('[van] failed:', err));
    const { resyncCartTimesFromEnv } = await import('./db/resyncCartTimes.js');
    await resyncCartTimesFromEnv().catch((err) => console.error('[cart-resync] failed:', err));
    const { clearEchoDescsFromEnv } = await import('./db/clearEchoDescs.js');
    await clearEchoDescsFromEnv().catch((err) => console.error('[echo-desc] failed:', err));
    const { enrichVendorsFromEnv } = await import('./db/enrichVendors.js');
    await enrichVendorsFromEnv().catch((err) => console.error('[enrich] failed:', err));
    const { cleanVendorDirectoryFromEnv } = await import('./db/cleanVendorDirectory.js');
    await cleanVendorDirectoryFromEnv().catch((err) => console.error('[clean-vendors] failed:', err));
    const { reReadBankRowsFromEnv } = await import('./db/reReadBankRows.js');
    await reReadBankRowsFromEnv().catch((err) => console.error('[reread-bank] failed:', err));
    const { addWioManualFromEnv } = await import('./db/addWioManual.js');
    await addWioManualFromEnv().catch((err) => console.error('[add-wio-manual] failed:', err));
    const { rebuildVanLoanFromEnv } = await import('./db/rebuildVanLoan.js');
    await rebuildVanLoanFromEnv().catch((err) => console.error('[rebuild-van] failed:', err));
    const { clearTabbyFromEnv } = await import('./db/clearTabby.js');
    await clearTabbyFromEnv().catch((err) => console.error('[clear-tabby] failed:', err));
    const { fixZedDateFromEnv } = await import('./db/fixZedDate.js');
    await fixZedDateFromEnv().catch((err) => console.error('[fix-zed-date] failed:', err));
    const { recordTabbyFeesFromEnv } = await import('./db/recordTabbyFees.js');
    await recordTabbyFeesFromEnv().catch((err) => console.error('[record-tabby] failed:', err));
    const { recordMissing1FromEnv } = await import('./db/recordMissing1.js');
    await recordMissing1FromEnv().catch((err) => console.error('[missing1] failed:', err));
    const { fixCommunityNameFromEnv } = await import('./db/fixCommunityName.js');
    await fixCommunityNameFromEnv().catch((err) => console.error('[fix-community] failed:', err));
    const { recordMissing2FromEnv } = await import('./db/recordMissing2.js');
    await recordMissing2FromEnv().catch((err) => console.error('[missing2] failed:', err));
    const { recordMissing3FromEnv } = await import('./db/recordMissing3.js');
    await recordMissing3FromEnv().catch((err) => console.error('[missing3] failed:', err));
    const { recordMissing4FromEnv } = await import('./db/recordMissing4.js');
    await recordMissing4FromEnv().catch((err) => console.error('[missing4] failed:', err));
    const { stripeFeesFromEnv } = await import('./db/stripeFees.js');
    await stripeFeesFromEnv().catch((err) => console.error('[stripe-fees] failed:', err));
    const { recordMissing5FromEnv } = await import('./db/recordMissing5.js');
    await recordMissing5FromEnv().catch((err) => console.error('[missing5] failed:', err));
    const { qbSubAuditFromEnv } = await import('./db/qbSubAudit.js');
    await qbSubAuditFromEnv().catch((err) => console.error('[qb-sub] failed:', err));
    const { deleteQuickBookSubFromEnv } = await import('./db/deleteQuickBookSub.js');
    await deleteQuickBookSubFromEnv().catch((err) => console.error('[del-qbsub] failed:', err));
    const { recordMissing6FromEnv } = await import('./db/recordMissing6.js');
    await recordMissing6FromEnv().catch((err) => console.error('[missing6] failed:', err));
    const { cashNowFromEnv } = await import('./db/cashNow.js');
    await cashNowFromEnv().catch((err) => console.error('[cash-now] failed:', err));
    const { clearStripeThrottleFromEnv } = await import('./db/clearStripeThrottle.js');
    await clearStripeThrottleFromEnv().catch((err) => console.error('[clear-stripe-throttle] failed:', err));
    const { placesEnrichFromEnv } = await import('./db/placesEnrich.js');
    await placesEnrichFromEnv().catch((err) => console.error('[places] failed:', err));
    const { prepAuditFromEnv } = await import('./db/prepAudit.js');
    await prepAuditFromEnv().catch((err) => console.error('[prep-audit] failed:', err));
    const { generatePrepMissingFromEnv } = await import('./db/generatePrepMissing.js');
    await generatePrepMissingFromEnv().catch((err) => console.error('[prep-gen] failed:', err));
    const { lineItemsAuditFromEnv } = await import('./db/lineItemsAudit.js');
    await lineItemsAuditFromEnv().catch((err) => console.error('[line-items] failed:', err));
    const { prepListFromEnv } = await import('./db/prepList.js');
    await prepListFromEnv().catch((err) => console.error('[prep-list] failed:', err));
    const { histCheckFromEnv } = await import('./db/histCheck.js');
    await histCheckFromEnv().catch((err) => console.error('[hist-check] failed:', err));
    const { winbackTestFromEnv } = await import('./db/winbackTest.js');
    await winbackTestFromEnv().catch((err) => console.error('[winback-test] failed:', err));
    const { winbackRolloutFromEnv } = await import('./db/winbackRollout.js');
    await winbackRolloutFromEnv().catch((err) => console.error('[winback-rollout] failed:', err));
    const { winbackRegenFromEnv } = await import('./db/winbackRegen.js');
    await winbackRegenFromEnv().catch((err) => console.error('[winback-regen] failed:', err));
    const { qbMigrateFromEnv } = await import('./db/winbackMigrateQb.js');
    await qbMigrateFromEnv().catch((err) => console.error('[qb-migrate] failed:', err));
    const { winbackCampaignFromEnv } = await import('./db/winbackCampaign.js');
    await winbackCampaignFromEnv().catch((err) => console.error('[winback-campaign] failed:', err));
    const { cleanupTestEventFromEnv } = await import('./db/cleanupTestEvent.js');
    await cleanupTestEventFromEnv().catch((err) => console.error('[del-event] failed:', err));
    const { receiptEventAuditFromEnv } = await import('./db/receiptEventAudit.js');
    await receiptEventAuditFromEnv().catch((err) => console.error('[rcpt-event] failed:', err));
    const { restoreEv1724FromEnv, restoreCrew1724FromEnv, setReview1724FromEnv } = await import('./db/restoreEv1724.js');
    await restoreEv1724FromEnv().catch((err) => console.error('[restore-1724] failed:', err));
    await restoreCrew1724FromEnv().catch((err) => console.error('[restore-1724] crew failed:', err));
    await setReview1724FromEnv().catch((err) => console.error('[restore-1724] review failed:', err));
    const { winbackEnsureFromEnv } = await import('./db/winbackEnsure.js');
    await winbackEnsureFromEnv().catch((err) => console.error('[winback-ensure] failed:', err));
    // One-time bulk send of the held win-back code emails (WINBACK_SEND_ALL=
    // list|send) now the Resend daily cap is gone. list previews the count;
    // send delivers every never-emailed code once.
    const { winbackSendAllFromEnv } = await import('./db/winbackSendAll.js');
    await winbackSendAllFromEnv().catch((err) => console.error('[winback-all] failed:', err));
    // URGENT read-only: find customers wrongly carrying the owner's email.
    const { emailAuditFromEnv } = await import('./db/emailAudit.js');
    await emailAuditFromEnv().catch((err) => console.error('[email-audit] failed:', err));
    const { deliverNowFromEnv } = await import('./db/deliverNow.js');
    await deliverNowFromEnv().catch((err) => console.error('[deliver-now] failed:', err));
    // On-demand reconciliation & audit email for the CURRENT month (RECON_SEND_NOW
    // =true) — a live snapshot to the owner + Marsha on request.
    if (String(process.env.RECON_SEND_NOW ?? '').toLowerCase() === 'true') {
      const now = new Date();
      const m = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const { sendReconReport } = await import('./domain/reconReport.js');
      // record=false — a preview send must not consume the real end-of-month slot.
      await sendReconReport(m, false).then((r) => console.log(`[recon-report] on-demand sent to ${r.sent} recipient(s)`)).catch((err) => console.error('[recon-report] on-demand failed:', err));
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
    // Feedback reminders (FEEDBACK_REMINDERS=list|send) — list shows which
    // recent unrated parties WOULD be reminded (sends nothing) for owner
    // approval; send queues them + activates the recurring 3-day sweep.
    const { feedbackRemindersFromEnv } = await import('./domain/feedbackReminders.js');
    await feedbackRemindersFromEnv().catch((err) => console.error('[feedback-reminder] failed:', err));
    // Convert the QuickBooks party backlog (Jul–Aug 2026) into first-class
    // events so those WhatsApp customers are reachable for feedback. QB_TO_EVENTS
    // =list previews the parties (creates nothing); =apply creates the events
    // (sends nothing — feedback still waits behind FEEDBACK_REMINDERS=send).
    const { qbBacklogToEventsFromEnv } = await import('./db/qbBacklogToEvents.js');
    await qbBacklogToEventsFromEnv().catch((err) => console.error('[qb-to-events] failed:', err));
    // One-time scheduled feedback backlog send (FEEDBACK_SCHEDULE=HH:MM, Dubai
    // today). Runs AFTER the QB conversion so the new events are already there.
    // Sends nothing itself — it queues rows timed for HH:MM; delivery fires then.
    const { scheduleFeedbackBacklogFromEnv, rescheduleFeedbackFromEnv } = await import('./domain/feedbackReminders.js');
    await scheduleFeedbackBacklogFromEnv().catch((err) => console.error('[feedback-reminder] schedule failed:', err));
    // Repair mistimed batches (FEEDBACK_RESCHEDULE=HH:MM) — runs before the
    // reconcile/delivery loop starts, so nothing goes out at the wrong time.
    await rescheduleFeedbackFromEnv().catch((err) => console.error('[feedback-reminder] reschedule failed:', err));
    // One-off WhatsApp test send (WA_TEST=<phone>) to confirm customer WhatsApp
    // works + surface Meta's exact error. Owner's own number; no customer send.
    const { waTestFromEnv, waPhoneStatusFromEnv, waRegisterFromEnv } = await import('./db/waTest.js');
    await waPhoneStatusFromEnv().catch((err) => console.error('[wa-phone] failed:', err));
    await waRegisterFromEnv().catch((err) => console.error('[wa-register] failed:', err));
    await waTestFromEnv().catch((err) => console.error('[wa-test] failed:', err));
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
    // Regenerate existing auto occasion drafts from the current email templates
    // after a template change (REGEN_OCCASION_DRAFTS=on). One-shot; safe to leave
    // off afterwards. Skips sent campaigns; only rewrites editable drafts.
    {
      // Always refresh STALE drafts at boot so a template change takes effect
      // immediately (stale-only ⇒ never clobbers a manual edit).
      const { regenerateOccasionDrafts } = await import('./domain/marketingCalendar.js');
      await regenerateOccasionDrafts().catch((err) => console.error('[marketing] boot regen failed:', err));
      // Remove zero-amount pending bank rows (non-transaction emails mis-captured).
      await pool.query(`DELETE FROM bank_transactions WHERE status = 'pending' AND (amount_fils IS NULL OR amount_fils <= 0)`).catch(() => {});
      // Remove junk payment-provider rows that leaked into the services catalogue
      // ("stripe" / "tamara" are payment methods, not sellable services). Delete if
      // unreferenced; otherwise just deactivate so they leave the customer catalogue.
      await pool.query(`DELETE FROM services WHERE lower(name) IN ('stripe','tamara')`).catch(async () => {
        await pool.query(`UPDATE services SET active = false WHERE lower(name) IN ('stripe','tamara')`).catch(() => {});
      });
      // One-time import of QuickBooks products missing from the app catalogue
      // (owner-approved 2026-09-20). Guarded by app_kv, so it runs once.
      try {
        const { importQbProductsOnce } = await import('./db/importQbProducts.js');
        await importQbProductsOnce();
      } catch (e) { console.error('[qb-import] failed:', (e as Error).message); }
      // One-time: send a preview of every sector's B2B first email to the owner
      // + Marsha for review (before any live sending). Guarded, runs once.
      try {
        const { sendCorpPreviewsOnce } = await import('./db/sendCorpPreviews.js');
        await sendCorpPreviewsOnce();
      } catch (e) { console.error('[corp-previews] failed:', (e as Error).message); }
      // One-time: email Marsha (CC owner) the B2B campaign guide. Guarded.
      try {
        const { sendCampaignGuideOnce } = await import('./db/sendCampaignGuide.js');
        await sendCampaignGuideOnce();
      } catch (e) { console.error('[campaign-guide] failed:', (e as Error).message); }
      // One-time RESET (owner "start fresh"): wipe every auto-generated occasion
      // campaign that hasn't been sent + its review tasks, so the calendar starts
      // clean and re-prepares fresh drafts with the new templates. Sent history is
      // untouched. Guarded so it runs once.
      try {
        const g = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'occasion_reset_20260920'`).catch(() => ({ rowCount: 0 }));
        if (!g.rowCount) {
          const del = await pool.query(`DELETE FROM email_campaigns WHERE source IN ('occasion','occasion_corp') AND status <> 'sent'`).catch(() => ({ rowCount: 0 }));
          await pool.query(`DELETE FROM focus_tasks WHERE link_key LIKE 'mktg|%'`).catch(() => {});
          await pool.query(`INSERT INTO app_kv (k, v) VALUES ('occasion_reset_20260920', now()) ON CONFLICT (k) DO UPDATE SET v = now()`).catch(() => {});
          console.log(`[occasion-reset] cleared ${del.rowCount ?? 0} unsent occasion draft(s)`);
        }
      } catch (e) { console.error('[occasion-reset] failed:', (e as Error).message); }
      // Zero-price imported items must NOT be bookable at AED 0 on the customer
      // site — hide them (they still show in the internal New-Order builder as
      // "OFF", where the owner types the price on selection). Idempotent.
      await pool.query(
        `UPDATE services SET active = false
          WHERE active = true AND price_fils = 0
            AND lower(name) IN ('balloon services','sheshah','new born set up','character cut out','customize gender reveal box','graduation silver pakage','main stand service')`,
      ).catch(() => {});
      // One-time seed: an ADNOC AED 200 spend on the Wio card the owner forwarded
      // manually → PENDING in the approval queue. Idempotent (dedupe_key), safe to
      // leave; can be removed after it's approved.
      try {
        const { ingestExternalTxn } = await import('./domain/bankInbox.js');
        await ingestExternalTxn({
          amountFils: 20000, direction: 'debit', kind: 'purchase', merchant: 'ADNOC',
          postedOn: '2026-09-20', raw: 'Payment of 200 AED at ADNOC using your Wio card 6295 with Own AED funds.',
          source: 'wio', dedupeKey: 'manual|wio6295|adnoc|200|2026-09-20',
        });
      } catch (e) { console.error('[seed] adnoc wio expense failed:', (e as Error).message); }
      if (String(process.env.REGEN_OCCASION_DRAFTS ?? '').toLowerCase() === 'on') {
        await regenerateOccasionDrafts({ all: true }).catch((err) => console.error('[marketing] regen failed:', err));
      }
    }
    // Read the REAL payment method for QuickBooks receipts from QuickBooks itself
    // (QB_METHODS=preview logs what it finds; =apply writes finance_receipts.paid_with).
    const { qbMethodsFromEnv } = await import('./domain/quickbooks.js');
    await qbMethodsFromEnv().catch((err) => console.error('[qb-methods] failed:', err));
    // Store the team's WhatsApp numbers so the staff WhatsApp mirror can reach
    // them (SET_STAFF_PHONES=true). Idempotent; sends nothing.
    const { setStaffPhonesFromEnv } = await import('./db/setStaffPhones.js');
    await setStaffPhonesFromEnv().catch((err) => console.error('[staff-phones] failed:', err));
    // Owner decision: the whole team's weekly day off is Tuesday (SET_TEAM_DAYOFF=true).
    const { setTeamDayOffFromEnv } = await import('./db/setTeamDayOff.js');
    await setTeamDayOffFromEnv().catch((err) => console.error('[team-dayoff] failed:', err));
    // Re-submit the staff_alert WhatsApp template with a name variable (WA_RESEED_STAFF=true).
    const { reseedStaffAlertFromEnv } = await import('./db/reseedStaffAlert.js');
    await reseedStaffAlertFromEnv().catch((err) => console.error('[wa-reseed] failed:', err));
    // Edit staff_notify to drop the "please let us know" closing (WA_EDIT_STAFF=true).
    const { waEditStaffNotifyFromEnv } = await import('./db/waEditStaffNotify.js');
    await waEditStaffNotifyFromEnv().catch((err) => console.error('[wa-edit-staff] failed:', err));
    // Push reworded customer templates (links removed, typo fixed, etc.) to Meta (WA_EDIT_BATCH=true).
    const { waEditBatchFromEnv } = await import('./db/waEditBatch.js');
    await waEditBatchFromEnv().catch((err) => console.error('[wa-edit-batch] failed:', err));
    // Submit the warm staff birthday WhatsApp template (WA_SEED_BIRTHDAY=true).
    const { seedStaffBirthdayFromEnv } = await import('./db/seedStaffBirthday.js');
    await seedStaffBirthdayFromEnv().catch((err) => console.error('[wa-birthday] failed:', err));
    // Submit the warm staff day-off WhatsApp template (WA_SEED_DAYOFF=true).
    const { seedStaffDayoffFromEnv } = await import('./db/seedStaffDayoff.js');
    await seedStaffDayoffFromEnv().catch((err) => console.error('[wa-dayoff] failed:', err));
    // Email "The Eventana Week" schedule to the team (SEND_TEAM_SCHEDULE=true).
    const { sendTeamScheduleFromEnv } = await import('./db/sendTeamSchedule.js');
    await sendTeamScheduleFromEnv().catch((err) => console.error('[team-schedule] failed:', err));
    // READ-ONLY feedback rollout report (FEEDBACK_AUDIT=true).
    const { feedbackAuditFromEnv } = await import('./db/feedbackAudit.js');
    await feedbackAuditFromEnv().catch((err) => console.error('[feedback-audit] failed:', err));
    // READ-ONLY customer-list health report (CUSTOMER_AUDIT=true).
    const { customerAuditFromEnv } = await import('./db/customerAudit.js');
    await customerAuditFromEnv().catch((err) => console.error('[customer-audit] failed:', err));
    // READ-ONLY exact-dup customers + unpaid orders, for owner review (CLEANUP_CANDIDATES=true).
    const { cleanupCandidatesFromEnv } = await import('./db/cleanupCandidates.js');
    await cleanupCandidatesFromEnv().catch((err) => console.error('[cleanup-cand] failed:', err));
    // Owner-approved cleanup: soft-cancel test orders + delete the empty duplicate (CLEANUP_APPLY=true).
    const { cleanupApplyFromEnv } = await import('./db/cleanupApply.js');
    await cleanupApplyFromEnv().catch((err) => console.error('[cleanup-apply] failed:', err));
    // Create day_off_change_requests table + remove Razan/Noon completely (DAYOFF_MIGRATE=true).
    const { applyDayOffMigrateFromEnv } = await import('./db/dayOffMigrate.js');
    await applyDayOffMigrateFromEnv().catch((err) => console.error('[dayoff-migrate] failed:', err));
    // One-shot: email Marsha (cc Sheem) about the prep-task/design-upload fix (EMAIL_MARSHA_TASKFIX=true).
    const { sendTaskFixEmailFromEnv } = await import('./db/sendTaskFixEmail.js');
    await sendTaskFixEmailFromEnv().catch((err) => console.error('[taskfix-email] failed:', err));
    // One-shot: email Gloria explaining points count from 1 Sep + per-month + can see ratings (EMAIL_GLORIA_POINTS=true).
    const { sendGloriaPointsEmailFromEnv } = await import('./db/sendGloriaPointsEmail.js');
    await sendGloriaPointsEmailFromEnv().catch((err) => console.error('[gloria-email] failed:', err));
    // READ-ONLY prep diagnostic for one event (PREP_DEBUG=<receipt number or event id>).
    const { prepDebugFromEnv, prepRegenFromEnv } = await import('./db/prepDebug.js');
    await prepDebugFromEnv().catch((err) => console.error('[prep-debug] failed:', err));
    await prepRegenFromEnv().catch((err) => console.error('[prep-regen] failed:', err));
    // One-shot: add the Cricut design task to upcoming backdrop events that predate the rule (PREP_CRICUT_BACKFILL=true).
    const { prepBackfillCricutFromEnv } = await import('./db/prepBackfillCricut.js');
    await prepBackfillCricutFromEnv().catch((err) => console.error('[cricut-backfill] failed:', err));
    // One-shot: drop the remote designer from the day-of team on custom-theme-only events (STAFF_DESIGN_CLEANUP=true).
    const { staffDesignCleanupFromEnv } = await import('./db/staffDesignCleanup.js');
    await staffDesignCleanupFromEnv().catch((err) => console.error('[design-cleanup] failed:', err));
    // READ-ONLY: ratings report — counts + full per-rating detail + Google status (RATINGS_REPORT=true).
    const { ratingsReportFromEnv } = await import('./db/ratingsReport.js');
    await ratingsReportFromEnv().catch((err) => console.error('[ratings-report] failed:', err));
    // READ-ONLY: list the 5★ good-feedback rewards with their real event + dates (REWARDS_DEBUG=true).
    const { rewardsDebugFromEnv, rewardsCleanupFromEnv } = await import('./db/rewardsDebug.js');
    await rewardsDebugFromEnv().catch((err) => console.error('[rewards-debug] failed:', err));
    await rewardsCleanupFromEnv().catch((err) => console.error('[rewards-cleanup] failed:', err));
    // READ-ONLY: how many customers miss a phone + how many are backfillable from QB (CUSTOMER_PHONE_AUDIT=true).
    const { customerPhoneAuditFromEnv } = await import('./db/customerPhoneAudit.js');
    await customerPhoneAuditFromEnv().catch((err) => console.error('[phone-audit] failed:', err));
    // READ-ONLY: dump customers + historical_customers as JSON for the QB reconciliation (RECON_DUMP=customers).
    const { reconDumpFromEnv } = await import('./db/reconDump.js');
    await reconDumpFromEnv().catch((err) => console.error('[recon-dump] failed:', err));
    // Owner-approved recon actions: backfill 12 phones + add 2 customers + email/task Marsha (RECON_APPLY=true).
    const { reconApplyFromEnv } = await import('./db/reconApply.js');
    await reconApplyFromEnv().catch((err) => console.error('[recon-apply] failed:', err));
    // Round 2: sync phones into historical_customers (profile source) + add Sara + clean test accounts (RECON_APPLY2=true).
    const { reconApply2FromEnv } = await import('./db/reconApply2.js');
    await reconApply2FromEnv().catch((err) => console.error('[recon-apply2] failed:', err));
    // Targeted English booking-confirmation WhatsApp re-send to the "مهيره"/K-Pop
    // customer whose receipt-created event had the wrong (placeholder) time, now
    // corrected. RESEND_MAHIRA=find (read-only list) or =send (verify + send one).
    const { resendMahiraFromEnv } = await import('./db/resendMahira.js');
    await resendMahiraFromEnv().catch((err) => console.error('[resend-mahira] failed:', err));
    // Make Shan the leader of every upcoming event he's on (SET_SHAN_LEADER=true).
    const { setShanLeaderFromEnv } = await import('./db/setShanLeader.js');
    await setShanLeaderFromEnv().catch((err) => console.error('[shan-leader] failed:', err));
    // Log every account's role to confirm the owner login is `owner` (ROLE_AUDIT=true).
    const { roleAuditFromEnv } = await import('./db/roleAudit.js');
    await roleAuditFromEnv().catch((err) => console.error('[role-audit] failed:', err));
    // READ-ONLY customer + supplier reconciliation report (CUSTOMER_SUPPLIER_RECON=true).
    const { customerSupplierReconFromEnv } = await import('./db/customerSupplierRecon.js');
    await customerSupplierReconFromEnv().catch((err) => console.error('[recon] failed:', err));
    // Seed the owner's first manual tasks for Marsha (SEED_MARSHA_TASKS=true).
    const { seedMarshaTasksFromEnv } = await import('./db/seedMarshaTasks.js');
    await seedMarshaTasksFromEnv().catch((err) => console.error('[seed-marsha-tasks] failed:', err));
    // READ-ONLY: verify supplier is saved on reported missing items (MISSING_AUDIT=true).
    const { missingItemsAuditFromEnv } = await import('./db/missingItemsAudit.js');
    await missingItemsAuditFromEnv().catch((err) => console.error('[missing-audit] failed:', err));
    // READ-ONLY: log every WhatsApp template's Meta approval status (WA_STATUS=true).
    const { waTemplateStatusFromEnv } = await import('./db/waTemplateStatus.js');
    await waTemplateStatusFromEnv().catch((err) => console.error('[wa-status] failed:', err));
    // Google Business Profile reviews: GOOGLE_REVIEWS=discover logs the
    // accounts/locations so we can pin GOOGLE_BUSINESS_LOCATION; =list previews
    // current reviews (posts nothing). =poll is handled by the reconcile sweep.
    const { googleReviewsFromEnv } = await import('./domain/googleReviews.js');
    await googleReviewsFromEnv().catch((err) => console.error('[google-reviews] failed:', err));
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
    // One-time: exchange a Zoho grant code (set in the env) for a permanent
    // refresh token so the bank feed (RAKBANK + Wio) can sync. Idempotent.
    const { zohoBootstrapFromEnv } = await import('./db/zohoBootstrap.js');
    await zohoBootstrapFromEnv().catch((err) => console.error('[zoho-bootstrap] failed:', err));
  }

  const app = await buildServer();
  await app.listen({ port: config.port, host: config.host });

  startReconciliation();

  // Read bank@eventanauae.com over IMAP and turn each new bank-alert email into
  // a PENDING bank_transactions row for the owner to approve. No-op unless
  // BANK_IMAP_POLL=true with a mailbox password set in the environment.
  const { startBankImapPolling, rereadRecentInboxFromEnv } = await import('./domain/bankImapPoll.js');
  startBankImapPolling();
  // One-time re-read of recent mail (env BANK_IMAP_REREAD=true) so receipts the
  // poller dropped before the parser learned their format get a second chance.
  rereadRecentInboxFromEnv().catch((err) => console.error('[bank-imap] reread failed:', err));

  // Pull the Wio bank feed from Wafeq into the pending-expenses queue. No-op
  // unless WAFEQ_API_KEY is set.
  const { startWafeqPolling } = await import('./domain/wafeqPoll.js');
  startWafeqPolling();

  app.log.info(
    { integrations: integrationStatus().map((i) => `${i.name}:${i.mode}`) },
    'Eventana engine ready',
  );

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    stopReconciliation();
    (await import('./domain/bankImapPoll.js')).stopBankImapPolling();
    (await import('./domain/wafeqPoll.js')).stopWafeqPolling();
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
