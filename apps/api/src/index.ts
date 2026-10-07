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
    const { diagMemberPointsFromEnv, diagAllPointsFromEnv, diagAuthFromEnv } = await import('./db/diagMemberPoints.js');
    await diagMemberPointsFromEnv().catch((err) => console.error('[diag-points] failed:', err));
    await diagAllPointsFromEnv().catch((err) => console.error('[diag-all] failed:', err));
    await diagAuthFromEnv().catch((err) => console.error('[diag-auth] failed:', err));
    const { diagFeedbackFromEnv, diagFeedbackLinkFromEnv } = await import('./db/diagMemberPoints.js');
    await diagFeedbackFromEnv().catch((err) => console.error('[diag-fb] failed:', err));
    await diagFeedbackLinkFromEnv().catch((err) => console.error('[diag-fblink] failed:', err));
    const { diagDeleteRatingFromEnv, diagGoogleFromEnv } = await import('./db/diagMemberPoints.js');
    await diagDeleteRatingFromEnv().catch((err) => console.error('[diag-del-rating] failed:', err));
    await diagGoogleFromEnv().catch((err) => console.error('[diag-google] failed:', err));
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
    // Set the BOOKING date (booked_on) on QuickBooks receipts from each document's
    // real entry date (QB_BOOKDATE=preview logs; =apply writes). Event date kept.
    const { qbBookingDatesFromEnv } = await import('./domain/quickbooks.js');
    await qbBookingDatesFromEnv().catch((err) => console.error('[qb-bookdate] failed:', err));
    const { qbLateEntriesFromEnv } = await import('./domain/quickbooks.js');
    await qbLateEntriesFromEnv().catch((err) => console.error('[qb-late] failed:', err));
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

  // One-shot: test whether the configured Meta token can READ ad performance
  // (ads_read) on the ad account. Set META_ADS_TEST=true for one deploy to log the
  // result, then unset. Tells us if the existing CAPI token works or a dedicated
  // ads_read token is needed — without exposing the token.
  if (String(process.env.META_ADS_TEST ?? '').toLowerCase() === 'true') {
    (async () => {
      try {
        const { metaAdsEnabled, fetchAdSummary } = await import('./integrations/metaAds.js');
        if (!metaAdsEnabled()) { console.log('[meta-ads] TEST: no token/account configured'); return; }
        const s = await fetchAdSummary('this_month');
        if (!s) { console.log('[meta-ads] TEST: FAILED — token likely lacks ads_read (see the error line above)'); return; }
        console.log(`[meta-ads] TEST OK: ${s.ads} ads, spend AED ${s.spendAed}, ${s.conversations} conversations; top: ${s.top.map((a) => `${a.ad}=AED${a.spendAed}/${a.conversations}`).join(' · ')}`);
      } catch (e) { console.error('[meta-ads] TEST crashed:', (e as Error).message); }
    })();
  }

  // One-shot: list THIS YEAR's live bookings (reference, customer, EVENT date,
  // current booked_on) so the owner can have Marsha fill in the real BOOKING date
  // per booking. Set LIST_YEAR_BOOKINGS=true for one deploy, read the logs, unset.
  if (String(process.env.LIST_YEAR_BOOKINGS ?? '').toLowerCase() === 'true') {
    (async () => {
      try {
        const { pool } = await import('./db/pool.js');
        const { rows } = await pool.query<{ number: string; customer_name: string; src: string | null; ev: string | null; booked: string | null }>(
          `SELECT number, customer_name, source src,
                  to_char(date,'YYYY-MM-DD') ev, to_char(booked_on,'YYYY-MM-DD') booked
             FROM finance_receipts
            WHERE date >= date_trunc('year', current_date)
              AND source IS DISTINCT FROM 'quickbooks'
            ORDER BY (source <> 'app'), booked_on`,
        );
        const needCheck = rows.filter((r) => r.src !== 'app').length;
        console.log(`[year-bookings] ${rows.length} booking(s) this year (${needCheck} not online-checkout → booking date needs owner confirm) — ref | customer | source | event_date | booked_on | RELIABLE?`);
        for (const r of rows) {
          console.log(`[year-bookings] EV-${r.number} | ${r.customer_name} | ${r.src ?? '—'} | ${r.ev ?? '—'} | ${r.booked ?? '—'} | ${r.src === 'app' ? 'online✓' : 'CONFIRM'}`);
        }
        console.log('[year-bookings] END');
      } catch (e) { console.error('[year-bookings] failed:', (e as Error).message); }
    })();
  }

  // One-shot: set the two entry-date-less 2023 receipts' booking day = event day
  // (owner's call), then log how booking vs event dates line up across ALL receipts.
  // Set QB_BOOKDATE_STATS=true for one deploy, then unset.
  if (String(process.env.QB_BOOKDATE_STATS ?? '').toLowerCase() === 'true') {
    (async () => {
      try {
        const { pool } = await import('./db/pool.js');
        await pool.query(`UPDATE finance_receipts SET booked_on = date WHERE number IN ('1100','1101')`);
        const { rows } = await pool.query<{ total: string; with_booked: string; same_day: string; before_ev: string; after_ev: string; blank: string }>(
          `SELECT count(*)::text total,
                  count(*) FILTER (WHERE booked_on IS NOT NULL)::text with_booked,
                  count(*) FILTER (WHERE booked_on = date)::text same_day,
                  count(*) FILTER (WHERE booked_on < date)::text before_ev,
                  count(*) FILTER (WHERE booked_on > date)::text after_ev,
                  count(*) FILTER (WHERE booked_on IS NULL)::text blank
             FROM finance_receipts`);
        const r = rows[0];
        console.log(`[bookdate-stats] total=${r.total} | withBookingDate=${r.with_booked} | SAME day (booking=event)=${r.same_day} | booked BEFORE event=${r.before_ev} | booked AFTER event=${r.after_ev} | blank=${r.blank}`);
      } catch (e) { console.error('[bookdate-stats] failed:', (e as Error).message); }
    })();
  }

  // One-shot: diagnose the "booked AFTER event" receipts (impossible in reality) —
  // break them down by EVENT year + show the create-vs-update gap on a sample, to
  // confirm they're old bulk-entry artifacts. QB_AFTER_STATS=true, then unset.
  if (String(process.env.QB_AFTER_STATS ?? '').toLowerCase() === 'true') {
    (async () => {
      try {
        const { pool } = await import('./db/pool.js');
        const byYear = await pool.query<{ y: string; n: string }>(
          `SELECT extract(year from date)::text y, count(*)::text n
             FROM finance_receipts WHERE booked_on > date GROUP BY 1 ORDER BY 1`);
        console.log('[after-stats] booked-after-event by EVENT year:');
        for (const r of byYear.rows) console.log(`[after-stats]   ${r.y}: ${r.n}`);
        const recent = await pool.query<{ n: string }>(
          `SELECT count(*)::text n FROM finance_receipts WHERE booked_on > date AND date >= '2025-01-01'`);
        console.log(`[after-stats] booked-after-event in 2025+ (should be ~0 if it's just old data): ${recent.rows[0].n}`);
      } catch (e) { console.error('[after-stats] failed:', (e as Error).message); }
    })();
  }

  // One-shot: a booking can't happen AFTER its event — cap every such receipt's
  // booking date at the event date (owner's choice). QB_CAP_AFTER=true, then unset.
  if (String(process.env.QB_CAP_AFTER ?? '').toLowerCase() === 'true') {
    (async () => {
      try {
        const { pool } = await import('./db/pool.js');
        const res = await pool.query(`UPDATE finance_receipts SET booked_on = date WHERE booked_on IS NOT NULL AND booked_on > date`);
        const { rows } = await pool.query<{ same: string; before: string; after: string; blank: string; total: string }>(
          `SELECT count(*) FILTER (WHERE booked_on = date)::text same,
                  count(*) FILTER (WHERE booked_on < date)::text before,
                  count(*) FILTER (WHERE booked_on > date)::text after,
                  count(*) FILTER (WHERE booked_on IS NULL)::text blank,
                  count(*)::text total FROM finance_receipts`);
        const r = rows[0];
        console.log(`[cap-after] capped ${res.rowCount} receipt(s) to event date. Now: total=${r.total} same=${r.same} before=${r.before} after=${r.after} blank=${r.blank}`);
      } catch (e) { console.error('[cap-after] failed:', (e as Error).message); }
    })();
  }

  // One-shot: email a month's finance report NOW with the current (booking-date)
  // calculation. Set SEND_FINANCE_REPORT=YYYY-MM for one deploy, then unset.
  if (/^\d{4}-\d{2}$/.test(String(process.env.SEND_FINANCE_REPORT ?? ''))) {
    (async () => {
      try {
        const month = String(process.env.SEND_FINANCE_REPORT);
        const { sendReport } = await import('./domain/financeReport.js');
        const r = await sendReport(month);
        console.log(`[finance-report] ${month} → recipients=${r.recipients} sent=${r.sent}`);
      } catch (e) { console.error('[finance-report] send failed:', (e as Error).message); }
    })();
  }

  // One-shot: dump a month's receipts both ways (booking basis vs event basis) so
  // the owner can verify the total + count. Set MONTH_STATS=YYYY-MM, then unset.
  if (/^\d{4}-\d{2}$/.test(String(process.env.MONTH_STATS ?? ''))) {
    (async () => {
      try {
        const m = String(process.env.MONTH_STATS);
        const { pool } = await import('./db/pool.js');
        const start = `${m}-01`;
        const end = (() => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10); })();
        const agg = await pool.query<{ k: string; n: string; v: string }>(
          `SELECT 'booking' k, count(*)::text n, COALESCE(SUM(total_fils),0)::text v FROM finance_receipts WHERE COALESCE(booked_on,date) >= $1 AND COALESCE(booked_on,date) < $2
           UNION ALL
           SELECT 'event' k, count(*)::text, COALESCE(SUM(total_fils),0)::text FROM finance_receipts WHERE date >= $1 AND date < $2`,
          [start, end]);
        for (const r of agg.rows) console.log(`[month-stats ${m}] basis=${r.k}: orders=${r.n} total=AED ${(Number(r.v)/100).toLocaleString('en-US')}`);
        const list = await pool.query<{ number: string; cust: string; v: string; ev: string | null; bk: string | null }>(
          `SELECT number, customer_name cust, total_fils v, to_char(date,'YYYY-MM-DD') ev, to_char(booked_on,'YYYY-MM-DD') bk
             FROM finance_receipts WHERE COALESCE(booked_on,date) >= $1 AND COALESCE(booked_on,date) < $2
            ORDER BY booked_on`, [start, end]);
        for (const r of list.rows) console.log(`[month-stats ${m}] EV-${r.number} | ${r.cust} | AED ${(Number(r.v)/100).toLocaleString('en-US')} | event ${r.ev ?? '—'} | booked ${r.bk ?? '—'}`);
        console.log(`[month-stats ${m}] END (${list.rows.length} rows)`);
      } catch (e) { console.error('[month-stats] failed:', (e as Error).message); }
    })();
  }

  // One-shot: owner's final call (2026-10-05) — revert EVERY existing receipt's
  // booking date back to its event date, so the historical accounts match the
  // old baseline exactly and nothing crosses a month. The "new method" (stamp the
  // real booking day) then only applies going FORWARD, to bookings captured from
  // now on for the new 2026 financial year. FULL_RESET_EVENTDATE=true for one
  // deploy, then unset.
  if (String(process.env.FULL_RESET_EVENTDATE ?? '').toLowerCase() === 'true') {
    (async () => {
      try {
        const { pool } = await import('./db/pool.js');
        const r = await pool.query(
          `UPDATE finance_receipts SET booked_on = date
            WHERE booked_on IS DISTINCT FROM date`);
        console.log(`[full-reset] reset ${r.rowCount} receipt(s): booked_on = event date (all receipts)`);
        const chk = await pool.query<{ mismatch: string; total: string }>(
          `SELECT COUNT(*) FILTER (WHERE booked_on IS DISTINCT FROM date)::text mismatch,
                  COUNT(*)::text total FROM finance_receipts`);
        console.log(`[full-reset] verify: ${chk.rows[0]?.mismatch} still differ out of ${chk.rows[0]?.total} total`);
        console.log('[full-reset] END');
      } catch (e) { console.error('[full-reset] failed:', (e as Error).message); }
    })();
  }

  // One-shot: apply the owner's confirmed September 2026 booking dates (returned
  // 2026-10-07; EV-2026-0215 left blank — still unknown). Also dumps that blank
  // one's customer email so she can identify her. APPLY_SEPT_BOOKDATES=true.
  if (String(process.env.APPLY_SEPT_BOOKDATES ?? '').toLowerCase() === 'true') {
    (async () => {
      const PAIRS: Array<[string, string]> = [
        ['1746', '2026-09-24'], ['EV-2026-0203', '2026-08-27'], ['EV-2026-0206', '2026-09-04'],
        ['EV-2026-0210', '2026-09-05'], ['EV-2026-0211', '2026-09-06'], ['EV-2026-0254', '2026-09-07'],
        ['EV-2026-0257', '2026-09-09'], ['EV-2026-0260', '2026-09-16'], ['EV-2026-0263', '2026-09-20'],
        ['EV-2026-0269', '2026-09-24'],
      ];
      try {
        const { pool } = await import('./db/pool.js');
        let ok = 0; const misses: string[] = [];
        for (const [ref, d] of PAIRS) {
          const q = ref.startsWith('EV-')
            ? { sql: `UPDATE finance_receipts SET booked_on = $2::date WHERE event_id = $1 OR order_id = (SELECT order_id FROM events WHERE id = $1)`, p: [ref, d] }
            : { sql: `UPDATE finance_receipts SET booked_on = $2::date WHERE number = $1`, p: [ref, d] };
          const r = await pool.query(q.sql, q.p);
          if (r.rowCount) ok++; else misses.push(ref);
          console.log(`[sept-bookdates] ${ref} → ${d} (${r.rowCount} row)`);
        }
        console.log(`[sept-bookdates] done: ${ok}/${PAIRS.length} applied${misses.length ? `; NO MATCH: ${misses.join(', ')}` : ''}`);
        // The still-blank one — show her email/phone so the owner can identify her.
        const m = await pool.query<{ name: string; email: string | null; phone: string | null; ev: string }>(
          `SELECT c.name, c.email, c.phone, to_char(e.event_date,'YYYY-MM-DD') ev
             FROM events e JOIN customers c ON c.id = e.customer_id WHERE e.id = 'EV-2026-0215'`);
        const row = m.rows[0];
        if (row) console.log(`[sept-bookdates] EV-2026-0215 = ${row.name} | email=${row.email ?? '—'} | phone=${row.phone ?? '—'} | event ${row.ev}`);
        else console.log('[sept-bookdates] EV-2026-0215 not found');
        console.log('[sept-bookdates] END');
      } catch (e) { console.error('[sept-bookdates] failed:', (e as Error).message); }
    })();
  }

  // One-shot: fix EV-2026-0215 — rename the customer to "Maryam Albloshi" (shows
  // on the event's "Booked by" + the receipt) and set her booking date to 1 Sep
  // (owner 2026-10-07). FIX_MARYAM_0215=true.
  if (String(process.env.FIX_MARYAM_0215 ?? '').toLowerCase() === 'true') {
    (async () => {
      const EVID = 'EV-2026-0215', NAME = 'Maryam Albloshi', BOOKED = '2026-09-01';
      try {
        const { pool } = await import('./db/pool.js');
        const ev = await pool.query<{ cid: string; oid: string }>(
          `SELECT customer_id cid, order_id oid FROM events WHERE id = $1`, [EVID]);
        const row = ev.rows[0];
        if (!row) { console.log(`[fix-maryam] ${EVID} not found`); console.log('[fix-maryam] END'); return; }
        const u1 = await pool.query(`UPDATE customers SET name = $2 WHERE id = $1`, [row.cid, NAME]);
        const u2 = await pool.query(
          `UPDATE finance_receipts SET customer_name = $2, booked_on = $3::date
            WHERE event_id = $1 OR order_id = $4`, [EVID, NAME, BOOKED, row.oid]);
        console.log(`[fix-maryam] ${EVID} → "${NAME}", booked ${BOOKED}; customers=${u1.rowCount}, receipts=${u2.rowCount}`);
        console.log('[fix-maryam] END');
      } catch (e) { console.error('[fix-maryam] failed:', (e as Error).message); }
    })();
  }

  // One-shot: set Aisha Ali Alqubaisi (EV-2026-0204) booking date = 28 Aug, and
  // dump Salama (#1721) email/phone so the owner can identify her. AUG_FIX=true.
  if (String(process.env.AUG_FIX ?? '').toLowerCase() === 'true') {
    (async () => {
      try {
        const { pool } = await import('./db/pool.js');
        const a = await pool.query(
          `UPDATE finance_receipts SET booked_on = '2026-08-28'::date
            WHERE event_id = 'EV-2026-0204' OR order_id = (SELECT order_id FROM events WHERE id = 'EV-2026-0204')`);
        console.log(`[aug-fix] Aisha EV-2026-0204 → 2026-08-28 (${a.rowCount} row)`);
        const s = await pool.query<{ nm: string; cid: string | null; email: string | null; phone: string | null; alt: string | null }>(
          `SELECT r.customer_name nm, r.customer_id::text cid, hc.email, hc.phone, hc.phone_alt alt
             FROM finance_receipts r LEFT JOIN historical_customers hc ON hc.id = r.customer_id
            WHERE r.number = '1721'`);
        const row = s.rows[0];
        if (row) console.log(`[aug-fix] #1721 = ${row.nm} | cid=${row.cid ?? '—'} | email=${row.email ?? '—'} | phone=${row.phone ?? row.alt ?? '—'}`);
        else console.log('[aug-fix] #1721 not found');
        console.log('[aug-fix] END');
      } catch (e) { console.error('[aug-fix] failed:', (e as Error).message); }
    })();
  }

  // One-shot (reusable): rename exact label(s) to "Eventana Exclusive Package"
  // everywhere — finance_receipts line_items (key 'name'), event_services.label,
  // services.name, historical_orders.product. UNIFY_EXCL="label1;label2;…".
  if (process.env.UNIFY_EXCL) {
    (async () => {
      const raw = String(process.env.UNIFY_EXCL).trim();
      // Full owner-confirmed package-name unification map (2026-10-07). Each old
      // label → the canonical package name, across receipts/events/services/history.
      const MAP: Array<[string, string]> = raw.toUpperCase() === 'MAP' ? [
        ['New Golden Package', 'Golden Birthday Package'],
        ['Golden Kids Package', 'Golden Birthday Package'],
        ['New Silver Package', 'Silver Birthday Package'],
        ['Silver Kids Package', 'Silver Birthday Package'],
        ['New Bronze Package', 'Bronze Birthday Package'],
        ['Bronze Kids Package', 'Bronze Birthday Package'],
        ['New  Bronze Pakage', 'Bronze Birthday Package'],
        ['Summer Package', 'Summer Birthday Package'],
        ['Summer Party', 'Summer Birthday Package'],
        ['3500 Offer', 'Eventana Exclusive Package'],
        ['Marwa Rateb Package', 'Eventana Exclusive Package'],
        ['Marwa Rateb Pakage', 'Eventana Exclusive Package'],
      ] : raw.split(';').map((s) => s.trim()).filter(Boolean).map((from) => [from, 'Eventana Exclusive Package'] as [string, string]);
      try {
        const { pool } = await import('./db/pool.js');
        for (const [from, N] of MAP) {
          const u1 = await pool.query(`UPDATE services SET name=$2 WHERE name ILIKE $1`, [from, N]);
          const u2 = await pool.query(
            `UPDATE finance_receipts SET line_items = (
                SELECT jsonb_agg(CASE WHEN li->>'name' ILIKE $1 THEN jsonb_set(li,'{name}',to_jsonb($2::text)) ELSE li END)
                  FROM jsonb_array_elements(line_items) li)
              WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(line_items) li WHERE li->>'name' ILIKE $1)`, [from, N]);
          const u3 = await pool.query(`UPDATE event_services SET label=$2 WHERE label ILIKE $1`, [from, N]);
          const u4 = await pool.query(`UPDATE historical_orders SET product=$2 WHERE product ILIKE $1`, [from, N]);
          console.log(`[unify-excl] "${from}" → "${N}": services=${u1.rowCount}, receipts=${u2.rowCount}, event_services=${u3.rowCount}, historical=${u4.rowCount}`);
        }
        if (raw.toUpperCase() === 'MAP') {
          const p = await pool.query(`UPDATE packages SET name='Summer Birthday Package' WHERE id='summer'`);
          console.log(`[unify-excl] packages row summer → Summer Birthday Package (${p.rowCount})`);
        }
        // After unifying, list ALL remaining offer/package-ish labels so the owner
        // can spot any other Exclusive variant still to merge.
        const rc = (await pool.query<{ nm: string; n: string }>(
          `SELECT li->>'name' nm, count(*)::text n FROM finance_receipts, jsonb_array_elements(line_items) li
            WHERE li->>'name' ILIKE '%offer%' OR li->>'name' ILIKE '%package%'
            GROUP BY 1 ORDER BY 2 DESC`)).rows;
        console.log(`[unify-excl] remaining receipt offer/package labels: ${rc.length}`);
        for (const r of rc) console.log(`[unify-excl] RCPT "${r.nm}" ×${r.n}`);
        const ho = (await pool.query<{ p: string; n: string }>(
          `SELECT product p, count(*)::text n FROM historical_orders
            WHERE product ILIKE '%offer%' OR product ILIKE '%package%' GROUP BY 1 ORDER BY 2 DESC`)).rows;
        console.log(`[unify-excl] remaining historical offer/package products: ${ho.length}`);
        for (const r of ho) console.log(`[unify-excl] HIST "${r.p}" ×${r.n}`);
        console.log('[unify-excl] END');
      } catch (e) { console.error('[unify-excl] failed:', (e as Error).message); }
    })();
  }

  // One-shot: look up what an old offer/package included — its historical_orders
  // rows (customer, date, total, memo) + any matching service with its detail.
  // OFFER_LOOKUP="<name>".
  if (process.env.OFFER_LOOKUP) {
    (async () => {
      const q = String(process.env.OFFER_LOOKUP).trim();
      const aed = (f: any) => `AED ${(Number(f) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
      try {
        const { pool } = await import('./db/pool.js');
        const ho = (await pool.query<{ cust: string; d: string; tot: string; memo: string | null }>(
          `SELECT customer_name cust, to_char(txn_date,'YYYY-MM-DD') d, total_fils tot, memo
             FROM historical_orders WHERE product ILIKE $1 ORDER BY txn_date`, [`%${q}%`])).rows;
        console.log(`[offer-lookup] "${q}" historical rows: ${ho.length}`);
        for (const r of ho) console.log(`[offer-lookup] ${r.d} | ${r.cust} | ${aed(r.tot)} | memo: ${r.memo ?? '—'}`);
        const sv = (await pool.query<{ id: string; name: string; detail: string | null; price: string }>(
          `SELECT id, name, detail, (price_fils/100)::text price FROM services WHERE name ILIKE $1`, [`%${q}%`])).rows;
        console.log(`[offer-lookup] matching services: ${sv.length}`);
        for (const s of sv) console.log(`[offer-lookup] SVC "${s.name}" AED ${s.price} | ${s.detail ?? '—'}`);
        console.log('[offer-lookup] END');
      } catch (e) { console.error('[offer-lookup] failed:', (e as Error).message); }
    })();
  }

  // One-shot: scan OLD (historical/QuickBooks) orders for the Exclusive package —
  // by name keyword and by ~3499/3500 order totals — so we see every old booking.
  // HIST_SCAN=true.
  if (String(process.env.HIST_SCAN ?? '').toLowerCase() === 'true') {
    (async () => {
      const aed = (f: any) => `AED ${(Number(f) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
      try {
        const { pool } = await import('./db/pool.js');
        const byName = (await pool.query<{ product: string; n: string; tot: string }>(
          `SELECT product, count(*)::text n, COALESCE(SUM(total_fils),0)::text tot
             FROM historical_orders
            WHERE product ILIKE ANY (ARRAY['%carnaval%','%carnival%','%3499%','%exclusive%','%offer%'])
            GROUP BY product ORDER BY 2 DESC`)).rows;
        console.log(`[hist-scan] historical products matching keywords: ${byName.length}`);
        for (const r of byName) console.log(`[hist-scan] NAME "${r.product}" ×${r.n} | ${aed(r.tot)}`);
        const byPrice = (await pool.query<{ product: string; n: string }>(
          `SELECT COALESCE(product,'(no product)') product, count(*)::text n
             FROM historical_orders
            WHERE total_fils BETWEEN 349000 AND 350500
            GROUP BY 1 ORDER BY 2 DESC`)).rows;
        console.log(`[hist-scan] historical orders with total ≈3499/3500: products:`);
        for (const r of byPrice) console.log(`[hist-scan] ~3500 product "${r.product}" ×${r.n}`);
        console.log('[hist-scan] END');
      } catch (e) { console.error('[hist-scan] failed:', (e as Error).message); }
    })();
  }

  // One-shot: who booked the Eventana Exclusive Package — list + count + total.
  // EXCL_LIST=true.
  if (String(process.env.EXCL_LIST ?? '').toLowerCase() === 'true') {
    (async () => {
      const aed = (f: any) => `AED ${(Number(f) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
      try {
        const { pool } = await import('./db/pool.js');
        const rows = (await pool.query<{ number: string; name: string; ev: string | null; bk: string | null; amt: string }>(
          `SELECT r.number, r.customer_name name, to_char(r.date,'YYYY-MM-DD') ev,
                  to_char(r.booked_on,'YYYY-MM-DD') bk,
                  COALESCE((SELECT SUM((li->>'priceFils')::numeric * COALESCE((li->>'qty')::numeric,1))
                            FROM jsonb_array_elements(r.line_items) li
                           WHERE li->>'name' ILIKE 'Eventana Exclusive%'),0)::text amt
             FROM finance_receipts r
            WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(r.line_items) li WHERE li->>'name' ILIKE 'Eventana Exclusive%')
            ORDER BY r.date`)).rows;
        let total = 0;
        console.log(`[excl-list] bookings with Eventana Exclusive Package: ${rows.length}`);
        for (const r of rows) { total += Number(r.amt); console.log(`[excl-list] #${r.number} | ${r.name} | event ${r.ev} | booked ${r.bk ?? '—'} | ${aed(r.amt)}`); }
        console.log(`[excl-list] TOTAL package value: ${aed(total)}`);
        console.log('[excl-list] END');
      } catch (e) { console.error('[excl-list] failed:', (e as Error).message); }
    })();
  }

  // One-shot: scan EVERYWHERE the "3499 Offer" / "Carnival/Carnaval Offer" package
  // appears — services.name, receipt line_items (key is 'name'), event_services.label
  // — so we rename them all to "Eventana Exclusive Package". SCAN_EXCL=true (list);
  // SCAN_EXCL=apply also renames all matches.
  if (process.env.SCAN_EXCL) {
    (async () => {
      const apply = String(process.env.SCAN_EXCL).toLowerCase() === 'apply';
      try {
        const { pool } = await import('./db/pool.js');
        const sv = (await pool.query<{ id: string; name: string; price: string }>(
          `SELECT id, name, (price_fils/100)::text price FROM services
            WHERE name ILIKE ANY (ARRAY['%3499%','%carnaval%','%carnival%'])`)).rows;
        console.log(`[scan-excl] services: ${sv.length}`);
        for (const s of sv) console.log(`[scan-excl] SVC ${s.id} | "${s.name}" | AED ${s.price}`);
        const rc = (await pool.query<{ nm: string; n: string }>(
          `SELECT li->>'name' nm, count(*)::text n
             FROM finance_receipts, jsonb_array_elements(line_items) li
            WHERE li->>'name' ILIKE ANY (ARRAY['%3499%','%carnaval%','%carnival%'])
            GROUP BY 1 ORDER BY 2 DESC`)).rows;
        console.log(`[scan-excl] receipt line-item names: ${rc.length}`);
        for (const r of rc) console.log(`[scan-excl] RCPT "${r.nm}" ×${r.n}`);
        const es = (await pool.query<{ label: string; n: string }>(
          `SELECT label, count(*)::text n FROM event_services
            WHERE label ILIKE ANY (ARRAY['%3499%','%carnaval%','%carnival%']) GROUP BY 1 ORDER BY 2 DESC`)).rows;
        console.log(`[scan-excl] event_services labels: ${es.length}`);
        for (const r of es) console.log(`[scan-excl] EVSVC "${r.label}" ×${r.n}`);
        if (apply) {
          const N = 'Eventana Exclusive Package';
          const u1 = await pool.query(`UPDATE services SET name=$1 WHERE name ILIKE ANY (ARRAY['%3499%','%carnaval%','%carnival%'])`, [N]);
          const u2 = await pool.query(
            `UPDATE finance_receipts SET line_items = (
                SELECT jsonb_agg(CASE WHEN li->>'name' ILIKE ANY (ARRAY['%3499%','%carnaval%','%carnival%'])
                                      THEN jsonb_set(li,'{name}',to_jsonb($1::text)) ELSE li END)
                  FROM jsonb_array_elements(line_items) li)
              WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(line_items) li
                             WHERE li->>'name' ILIKE ANY (ARRAY['%3499%','%carnaval%','%carnival%']))`, [N]);
          const u3 = await pool.query(`UPDATE event_services SET label=$1 WHERE label ILIKE ANY (ARRAY['%3499%','%carnaval%','%carnival%'])`, [N]);
          console.log(`[scan-excl] APPLIED: services=${u1.rowCount}, receipts=${u2.rowCount}, event_services=${u3.rowCount}`);
        }
        console.log('[scan-excl] END');
      } catch (e) { console.error('[scan-excl] failed:', (e as Error).message); }
    })();
  }

  // One-shot: rename the existing "Carnival Offer" service (= 3499 Offer / Carnaval
  // Package, AED 3500) to "Eventana Exclusive Package", and remove the duplicate
  // 'exclusive' packages row I mistakenly created. EXCLUSIVE_RENAME=true.
  if (String(process.env.EXCLUSIVE_RENAME ?? '').toLowerCase() === 'true') {
    (async () => {
      try {
        const { pool } = await import('./db/pool.js');
        await pool.query(`DELETE FROM package_items WHERE package_id='exclusive'`);
        const d = await pool.query(`DELETE FROM packages WHERE id='exclusive'`);
        console.log(`[excl-rename] removed duplicate 'exclusive' package row (${d.rowCount})`);
        const u = await pool.query(
          `UPDATE services SET name='Eventana Exclusive Package' WHERE id='carnival-offer-c6p1'`);
        console.log(`[excl-rename] "Carnival Offer" → "Eventana Exclusive Package" (${u.rowCount} row)`);
        console.log('[excl-rename] END');
      } catch (e) { console.error('[excl-rename] failed:', (e as Error).message); }
    })();
  }

  // One-shot: find the EXISTING ~3500 package (Marsha's "Carnaval"/Exclusive) so we
  // can RENAME it rather than add a duplicate, and remove the duplicate 'exclusive'
  // row I mistakenly created. FIND_PKG=true (lists only); FIND_PKG=delete-dup also
  // removes the 'exclusive' id I added.
  if (process.env.FIND_PKG) {
    (async () => {
      const mode = String(process.env.FIND_PKG).toLowerCase();
      try {
        const { pool } = await import('./db/pool.js');
        const pk = (await pool.query<{ id: string; name: string; price: string; active: boolean }>(
          `SELECT id, name, (price_fils/100)::text price, active FROM packages ORDER BY price_fils DESC`)).rows;
        console.log(`[find-pkg] packages table: ${pk.length}`);
        for (const p of pk) console.log(`[find-pkg] PKG id=${p.id} | "${p.name}" | AED ${p.price} | active=${p.active}`);
        const sv = (await pool.query<{ id: string; name: string; price: string; active: boolean }>(
          `SELECT id, name, (price_fils/100)::text price, active FROM services
            WHERE name ILIKE ANY (ARRAY['%carnaval%','%carnival%','%exclusive%','%ultra%','%package%','%باقة%'])
               OR price_fils BETWEEN 340000 AND 360000
            ORDER BY price_fils DESC`)).rows;
        console.log(`[find-pkg] candidate services: ${sv.length}`);
        for (const s of sv) console.log(`[find-pkg] SVC id=${s.id} | "${s.name}" | AED ${s.price} | active=${s.active}`);
        if (mode === 'delete-dup') {
          await pool.query(`DELETE FROM package_items WHERE package_id='exclusive'`);
          const d = await pool.query(`DELETE FROM packages WHERE id='exclusive'`);
          console.log(`[find-pkg] removed duplicate 'exclusive' packages row (${d.rowCount})`);
        }
        console.log('[find-pkg] END');
      } catch (e) { console.error('[find-pkg] failed:', (e as Error).message); }
    })();
  }

  // One-shot: rename the 5 packages in the packages table (catalogue.ts holds the
  // same names for the item sync) + dump the distinct package-ish labels used in
  // old receipts' line_items, so we can plan the old-receipt name unification.
  // RENAME_PACKAGES=true.
  if (String(process.env.RENAME_PACKAGES ?? '').toLowerCase() === 'true') {
    (async () => {
      const MAP: Array<[string, string]> = [
        ['golden', 'Golden Birthday Package'], ['silver', 'Silver Birthday Package'],
        ['bronze', 'Bronze Birthday Package'], ['spa', 'Spa Birthday Package'],
        ['movie', 'Movie Night Package'],
      ];
      try {
        const { pool } = await import('./db/pool.js');
        for (const [id, name] of MAP) {
          const r = await pool.query(`UPDATE packages SET name = $2 WHERE id = $1`, [id, name]);
          console.log(`[rename-pkg] ${id} → "${name}" (${r.rowCount} row)`);
        }
        const labels = (await pool.query<{ label: string; n: string }>(
          `SELECT li->>'label' label, count(*)::text n
             FROM finance_receipts, jsonb_array_elements(line_items) li
            WHERE li->>'label' ILIKE ANY (ARRAY['%birthday%','%spa%','%movie%','%summer%','%carnaval%','%carnival%','%exclusive%','%package%'])
            GROUP BY 1 ORDER BY 2 DESC`)).rows;
        console.log(`[rename-pkg] package-ish labels in old receipts: ${labels.length}`);
        for (const l of labels) console.log(`[rename-pkg] "${l.label}" ×${l.n}`);
        console.log('[rename-pkg] END');
      } catch (e) { console.error('[rename-pkg] failed:', (e as Error).message); }
    })();
  }

  // One-shot report: refunds in the last 14 days (who/what/why) + last month's
  // salary payments (recorded as expenses, category 'salaries'). REVIEW_REFUND_SALARY=true.
  if (String(process.env.REVIEW_REFUND_SALARY ?? '').toLowerCase() === 'true') {
    (async () => {
      const aed = (f: any) => `AED ${(Number(f) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
      try {
        const { pool } = await import('./db/pool.js');
        const rf = (await pool.query<{ when: string; oid: string; amt: string; cat: string; note: string | null; by: string | null; name: string | null }>(
          `SELECT to_char(r.created_at AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD HH24:MI') when, r.order_id oid,
                  r.amount_fils amt, r.reason_category cat, r.reason_note note, r.created_by by,
                  c.name
             FROM refunds r
             LEFT JOIN events e ON e.order_id = r.order_id
             LEFT JOIN customers c ON c.id = e.customer_id
            WHERE r.created_at >= now() - interval '14 days'
            ORDER BY r.created_at DESC`)).rows;
        console.log(`[review-rf] REFUNDS last 14 days: ${rf.length}`);
        for (const r of rf) console.log(`[review-rf] ${r.when} | ${r.name ?? r.oid} | ${aed(r.amt)} | ${r.cat}${r.note ? ' — '+r.note : ''} | by ${r.by ?? '—'}`);
        const sal = (await pool.query<{ d: string; desc: string; amt: string; vendor: string | null; by: string | null; pm: string | null }>(
          `SELECT to_char(spent_on,'YYYY-MM-DD') d, description desc, amount_fils amt, vendor, recorded_by by, payment_method pm
             FROM expenses
            WHERE category ILIKE '%salar%' AND spent_on >= '2026-09-01' AND spent_on < '2026-10-01'
            ORDER BY spent_on`)).rows;
        const salTotal = sal.reduce((s, r) => s + Number(r.amt), 0);
        console.log(`[review-rf] SALARIES recorded for September: ${sal.length} (total ${aed(salTotal)})`);
        for (const r of sal) console.log(`[review-rf] ${r.d} | ${r.desc}${r.vendor ? ' / '+r.vendor : ''} | ${aed(r.amt)} | ${r.pm ?? '—'} | by ${r.by ?? '—'}`);
        console.log('[review-rf] END');
      } catch (e) { console.error('[review-rf] failed:', (e as Error).message); }
    })();
  }

  // One-shot: Dindo's leave (4–30 Sep + 2–6 Oct 2026) + pay him as a PART-TIME
  // balloon artist (AED 350) for the 3 events he worked during that leave
  // (4/12/26 Sep). DINDO_FIX=true.
  if (String(process.env.DINDO_FIX ?? '').toLowerCase() === 'true') {
    (async () => {
      try {
        const { pool } = await import('./db/pool.js');
        await pool.query(
          `DELETE FROM staff_days_off WHERE member_id='tm-dindo'
             AND ((start_date='2026-09-04' AND end_date='2026-09-30')
               OR (start_date='2026-10-02' AND end_date='2026-10-06'))`);
        await pool.query(
          `INSERT INTO staff_days_off (member_id, start_date, end_date, reason, status) VALUES
             ('tm-dindo','2026-09-04','2026-09-30','Annual leave','approved'),
             ('tm-dindo','2026-10-02','2026-10-06','Annual leave','approved')`);
        console.log('[dindo-fix] leave set: 4–30 Sep + 2–6 Oct');
        for (const ev of ['EV-2026-0205', 'EV-2026-0203', 'EV-2026-0211']) {
          const r = await pool.query(
            `UPDATE event_staff SET part_time_name='Dindo', assignee_id=NULL, status='confirmed'
              WHERE event_id=$1 AND role='balloon_artist'`, [ev]);
          console.log(`[dindo-fix] ${ev} balloon_artist → part-time Dindo (${r.rowCount} row)`);
        }
        console.log('[dindo-fix] END');
      } catch (e) { console.error('[dindo-fix] failed:', (e as Error).message); }
    })();
  }

  // One-shot (reusable): set booking date(s) for specific receipts. Format:
  // SET_BOOKED="<ref>=<YYYY-MM-DD>;<ref>=<YYYY-MM-DD>" where ref is an EV id or a
  // receipt number. Matches by event_id/order_id for EV ids, by number otherwise.
  if (process.env.SET_BOOKED) {
    (async () => {
      try {
        const { pool } = await import('./db/pool.js');
        const pairs = String(process.env.SET_BOOKED).split(';').map((s) => s.trim()).filter(Boolean);
        for (const p of pairs) {
          const [ref, date] = p.split('=').map((x) => x.trim());
          if (!ref || !date) { console.log(`[set-booked] skip "${p}"`); continue; }
          const q = ref.startsWith('EV-')
            ? { sql: `UPDATE finance_receipts SET booked_on = $2::date WHERE event_id = $1 OR order_id = (SELECT order_id FROM events WHERE id = $1)`, v: [ref, date] }
            : { sql: `UPDATE finance_receipts SET booked_on = $2::date WHERE number = $1`, v: [ref, date] };
          const r = await pool.query(q.sql, q.v);
          console.log(`[set-booked] ${ref} → ${date} (${r.rowCount} row)`);
        }
        console.log('[set-booked] END');
      } catch (e) { console.error('[set-booked] failed:', (e as Error).message); }
    })();
  }

  // One-shot VERIFY: after setting the season booking dates, cross-check the
  // Oct–Dec 2026 bookings — list each with its final booked_on, show how the money
  // distributes by BOOKING month, the per-month report view, and flag anything
  // still unset/suspicious. VERIFY_SEASON=true.
  if (String(process.env.VERIFY_SEASON ?? '').toLowerCase() === 'true') {
    (async () => {
      const aed = (fils: number) => `AED ${(Number(fils) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
      const from = String(process.env.REVIEW_FROM ?? '2026-10-01');
      const to = String(process.env.REVIEW_TO ?? '2027-01-01');
      try {
        const { pool } = await import('./db/pool.js');
        // A) The season receipts (events in [from,to)), final dates.
        const rows = (await pool.query<{ evid: string | null; number: string; name: string; src: string | null; ev: string; bk: string | null; total: string }>(
          `SELECT e.id evid, r.number, r.customer_name name, r.source src,
                  to_char(r.date,'YYYY-MM-DD') ev, to_char(r.booked_on,'YYYY-MM-DD') bk, r.total_fils::text total
             FROM finance_receipts r LEFT JOIN events e ON e.id = r.event_id
            WHERE r.date >= $1::date AND r.date < $2::date ORDER BY r.booked_on NULLS FIRST, r.date`, [from, to])).rows;
        console.log(`[verify] ${rows.length} receipts (events in [${from}, ${to})):`);
        for (const r of rows) {
          const flag = !r.bk ? ' ⚠️BLANK' : (r.bk === r.ev && String(r.src).toLowerCase() !== 'app' ? ' ⚠️=event-date' : '');
          console.log(`[verify] ${r.evid ?? ('#'+r.number)} | ${r.name} | event ${r.ev} | booked ${r.bk ?? '—'} | ${aed(Number(r.total))} | ${r.src}${flag}`);
        }
        // B) Money distributed by BOOKING month (where it now lands).
        const byBk = (await pool.query<{ m: string; n: string; v: string }>(
          `SELECT to_char(booked_on,'YYYY-MM') m, count(*)::text n, COALESCE(SUM(total_fils),0)::text v
             FROM finance_receipts WHERE date >= $1::date AND date < $2::date
            GROUP BY 1 ORDER BY 1`, [from, to])).rows;
        console.log('[verify] — season money by BOOKING month —');
        for (const b of byBk) console.log(`[verify] booked ${b.m}: ${b.n} booking(s), ${aed(Number(b.v))}`);
        // C) The report view: EVERY receipt by booking month, Sep–Dec 2026.
        const rep = (await pool.query<{ m: string; n: string; v: string }>(
          `SELECT to_char(COALESCE(booked_on,date),'YYYY-MM') m, count(*)::text n, COALESCE(SUM(total_fils),0)::text v
             FROM finance_receipts
            WHERE COALESCE(booked_on,date) >= '2026-09-01' AND COALESCE(booked_on,date) < '2027-01-01'
            GROUP BY 1 ORDER BY 1`)).rows;
        console.log('[verify] — REPORT (all receipts by booking month) —');
        for (const b of rep) console.log(`[verify] ${b.m}: ${b.n} receipt(s), ${aed(Number(b.v))}`);
        console.log('[verify] END');
      } catch (e) { console.error('[verify] failed:', (e as Error).message); }
    })();
  }

  // One-shot: apply the owner's confirmed real booking dates for the 21 manually-
  // entered Oct–Dec 2026 events (she returned these 2026-10-06). Matches the
  // receipt by event_id OR the event's order_id. APPLY_OWNER_BOOKDATES=true.
  if (String(process.env.APPLY_OWNER_BOOKDATES ?? '').toLowerCase() === 'true') {
    (async () => {
      const PAIRS: Array<[string, string]> = [
        ['EV-2026-0274', '2026-10-03'], ['EV-2026-0282', '2026-10-05'], ['EV-2026-0278', '2026-10-05'],
        ['EV-2026-0275', '2026-10-05'], ['EV-2026-0277', '2026-10-03'], ['EV-2026-0281', '2026-10-05'],
        ['EV-2026-0279', '2026-10-05'], ['EV-2026-0280', '2026-10-05'], ['EV-2026-0276', '2026-10-05'],
        ['EV-2026-0255', '2026-09-07'], ['EV-2026-0256', '2026-09-08'], ['EV-2026-0258', '2026-09-10'],
        ['EV-2026-0259', '2026-09-15'], ['EV-2026-0262', '2026-09-16'], ['EV-2026-0261', '2026-09-16'],
        ['EV-2026-0264', '2026-09-21'], ['EV-2026-0265', '2026-09-21'], ['EV-2026-0272', '2026-09-28'],
        ['EV-2026-0271', '2026-09-28'], ['EV-2026-0273', '2026-10-02'], ['EV-2026-0207', '2026-09-04'],
      ];
      try {
        const { pool } = await import('./db/pool.js');
        let ok = 0; const misses: string[] = [];
        for (const [evid, d] of PAIRS) {
          const r = await pool.query(
            `UPDATE finance_receipts SET booked_on = $2::date
              WHERE event_id = $1 OR order_id = (SELECT order_id FROM events WHERE id = $1)`,
            [evid, d]);
          if (r.rowCount) ok++; else misses.push(evid);
          console.log(`[owner-bookdates] ${evid} → ${d} (${r.rowCount} row)`);
        }
        console.log(`[owner-bookdates] done: ${ok}/${PAIRS.length} applied${misses.length ? `; NO MATCH: ${misses.join(', ')}` : ''}`);
        console.log('[owner-bookdates] END');
      } catch (e) { console.error('[owner-bookdates] failed:', (e as Error).message); }
    })();
  }

  // One-shot: review (and optionally apply) the REAL booking date for every
  // Oct–Dec 2026 event — owner's plan (2026-10-06) to switch financial reports to
  // booking date from 1 Oct. Best source per row: QuickBooks entry date (QB), the
  // online-checkout timestamp (app/shop), or the typed date (dashboard/manual =
  // needs owner confirmation). REVIEW_SEASON_BOOKDATES=preview|apply.
  if (process.env.REVIEW_SEASON_BOOKDATES) {
    (async () => {
      const apply = String(process.env.REVIEW_SEASON_BOOKDATES).toLowerCase() === 'apply';
      // Default range = Oct–Dec 2026; override with REVIEW_FROM / REVIEW_TO (ISO).
      const from = String(process.env.REVIEW_FROM ?? '2026-10-01');
      const to = String(process.env.REVIEW_TO ?? '2027-01-01');
      try {
        const { pool } = await import('./db/pool.js');
        let qbMap = new Map<string, string>();
        try {
          const { fetchDocEntryDates } = await import('./domain/quickbooks.js');
          qbMap = await fetchDocEntryDates((m) => console.log(`[season-bk] ${m}`));
        } catch (e) { console.log(`[season-bk] QB entry dates unavailable: ${(e as Error).message}`); }
        const rows = (await pool.query<{ number: string; name: string; src: string | null; ev: string; booked: string | null; made: string | null; evid: string | null }>(
          `SELECT r.number, r.customer_name name, r.source src,
                  to_char(r.date,'YYYY-MM-DD') ev,
                  to_char(r.booked_on,'YYYY-MM-DD') booked,
                  to_char(r.created_at AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD') made,
                  e.id evid
             FROM finance_receipts r
             LEFT JOIN events e ON e.id = r.event_id
            WHERE r.date >= $1::date AND r.date < $2::date
            ORDER BY r.date`, [from, to])).rows;
        console.log(`[season-bk] ${apply ? 'APPLY' : 'PREVIEW'} — ${rows.length} receipt(s) in [${from}, ${to})`);
        const online = new Set(['app', 'shop', 'webhook', 'online', 'customer', 'checkout']);
        let applied = 0; const confirm: string[] = [];
        for (const r of rows) {
          const src = String(r.src ?? '').toLowerCase();
          let computed: string | null = null; let how = '';
          if (src === 'quickbooks') {
            computed = qbMap.get(String(r.number).trim()) ?? null;
            how = computed ? 'QB-entry' : 'UNKNOWN(needs owner)';
          } else if (online.has(src)) {
            computed = r.made; how = 'online-checkout';
          } else {
            computed = r.made; how = 'TYPED(confirm?)';
          }
          const reliable = how === 'QB-entry' || how === 'online-checkout';
          console.log(`[season-bk] ${r.evid ?? ('#'+r.number)} | ${r.name} | event ${r.ev} | src=${src || '—'} | nowBooked=${r.booked ?? '—'} | computed=${computed ?? '—'} | ${how}`);
          if (!reliable) confirm.push(`${r.evid ?? ('#'+r.number)} (${r.name}): event ${r.ev}, best-guess ${computed ?? '—'}`);
          // Only auto-write RELIABLE dates (QuickBooks entry / online checkout).
          // Typed dashboard/manual guesses wait for the owner's real dates.
          if (apply && computed && reliable) {
            await pool.query(`UPDATE finance_receipts SET booked_on = $2::date WHERE number = $1`, [r.number, computed]);
            applied++;
          }
        }
        console.log(`[season-bk] ${apply ? `applied booked_on to ${applied} receipt(s)` : 'preview only, no writes'}`);
        console.log(`[season-bk] NEEDS OWNER CONFIRMATION (${confirm.length}): typed/unknown booking dates`);
        for (const c of confirm) console.log(`[season-bk] CONFIRM ${c}`);
        console.log('[season-bk] END');
      } catch (e) { console.error('[season-bk] failed:', (e as Error).message); }
    })();
  }

  // One-shot diag: did a team member work on a day they were OFF? Lists that
  // member's assigned events in a month and flags any whose date is their weekly
  // day off OR inside an approved leave range. DIAG_WORKED_OFF=<name>
  // DIAG_WORKED_MONTH=YYYY-MM (defaults to 2026-09).
  if (process.env.DIAG_WORKED_OFF) {
    (async () => {
      const name = String(process.env.DIAG_WORKED_OFF).trim();
      const month = String(process.env.DIAG_WORKED_MONTH ?? '2026-09').trim();
      const WD = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      try {
        const { pool } = await import('./db/pool.js');
        const m = await pool.query<{ id: string; nm: string; wdo: number | null }>(
          `SELECT id, name nm, weekly_day_off wdo FROM team_members WHERE name ILIKE '%'||$1||'%' AND active ORDER BY name LIMIT 1`, [name]);
        const mem = m.rows[0];
        if (!mem) { console.log(`[worked-off] no active member matching "${name}"`); console.log('[worked-off] END'); return; }
        console.log(`[worked-off] ${mem.nm} (id=${mem.id}) weekly day off = ${mem.wdo == null ? 'none' : WD[mem.wdo]}`);
        const leave = await pool.query<{ s: string; e: string; st: string }>(
          `SELECT to_char(start_date,'YYYY-MM-DD') s, to_char(end_date,'YYYY-MM-DD') e, status st
             FROM staff_days_off WHERE member_id = $1 AND status = 'approved'
               AND start_date <= (($2||'-01')::date + interval '1 month' - interval '1 day')
               AND end_date >= ($2||'-01')::date ORDER BY start_date`, [mem.id, month]);
        for (const l of leave.rows) console.log(`[worked-off] approved leave: ${l.s} → ${l.e}`);
        // Day-off change history — tells us what the weekly day off WAS back then.
        const changes = await pool.query<{ rd: number; st: string; sub: string; dec: string | null }>(
          `SELECT requested_day rd, status st, to_char(submitted_at,'YYYY-MM-DD') sub, to_char(decided_at,'YYYY-MM-DD') dec
             FROM day_off_change_requests WHERE member_id = $1 ORDER BY submitted_at`, [mem.id]);
        console.log(`[worked-off] day-off change requests: ${changes.rowCount}`);
        for (const ch of changes.rows) console.log(`[worked-off] change → ${WD[ch.rd]} | ${ch.st} | submitted ${ch.sub} | decided ${ch.dec ?? '-'}`);
        const evs = await pool.query<{ id: string; d: string; wd: number; role: string; cust: string; onLeave: boolean }>(
          `SELECT e.id, to_char(e.event_date,'YYYY-MM-DD') d, extract(dow from e.event_date)::int wd,
                  es.role, c.name cust,
                  EXISTS (SELECT 1 FROM staff_days_off o WHERE o.member_id = $1 AND o.status='approved'
                            AND o.start_date <= e.event_date AND o.end_date >= e.event_date) AS "onLeave"
             FROM event_staff es JOIN events e ON e.id = es.event_id
             JOIN customers c ON c.id = e.customer_id
            WHERE es.assignee_id = $1 AND e.phase <> 'Cancelled'
              AND to_char(e.event_date,'YYYY-MM') = $2
            ORDER BY e.event_date`, [mem.id, month]);
        console.log(`[worked-off] ${mem.nm} assigned to ${evs.rowCount} event(s) in ${month}:`);
        for (const e of evs.rows) {
          const isWeeklyOff = mem.wdo != null && e.wd === mem.wdo;
          const flag = e.onLeave ? '⚠️ ON APPROVED LEAVE' : isWeeklyOff ? '⚠️ WEEKLY DAY OFF' : 'ok';
          console.log(`[worked-off] ${e.d} (${WD[e.wd]}) | ${e.id} | ${e.cust} | role=${e.role} | ${flag}`);
        }
        console.log('[worked-off] END');
      } catch (e) { console.error('[worked-off] failed:', (e as Error).message); }
    })();
  }

  // One-shot diag: inspect an event booked under the wrong customer. Dumps the
  // matching events (by customer name) with the customer id/phone/email, how many
  // events + receipts that customer row owns (so we know if a rename is safe or a
  // repoint is needed), and any candidate correct customer by name/phone.
  // DIAG_EVENT_NAME=<wrong name>  DIAG_EVENT_FIND=<correct name or phone digits>.
  if (process.env.DIAG_EVENT_NAME) {
    (async () => {
      const wrong = String(process.env.DIAG_EVENT_NAME);
      const find = String(process.env.DIAG_EVENT_FIND ?? '').trim();
      try {
        const { pool } = await import('./db/pool.js');
        const evs = await pool.query<{ id: string; cid: string; name: string; phone: string | null; email: string | null; d: string; ct: string }>(
          `SELECT e.id, e.customer_id cid, c.name, c.phone, c.email,
                  to_char(e.event_date,'YYYY-MM-DD') d, e.celebration_type ct
             FROM events e JOIN customers c ON c.id = e.customer_id
            WHERE c.name ILIKE '%' || $1 || '%' ORDER BY e.event_date`, [wrong]);
        console.log(`[diag-event] events under "${wrong}": ${evs.rowCount}`);
        for (const e of evs.rows) {
          // NB: events.customer_id is TEXT (customers.id); finance_receipts.customer_id
          // is BIGINT (historical_customers.id) — can't compare the two, so count
          // this customer's events by id and their receipts by matching name.
          const cnt = await pool.query<{ ev: string; rc: string }>(
            `SELECT (SELECT count(*) FROM events WHERE customer_id = $1)::text ev,
                    (SELECT count(*) FROM finance_receipts WHERE customer_name ILIKE $2)::text rc`, [e.cid, e.name]);
          console.log(`[diag-event] ${e.id} | cust=${e.cid} ${e.name} | phone=${e.phone ?? '—'} | email=${e.email ?? '—'} | event=${e.d} | type=${e.ct} | custHas ${cnt.rows[0]?.ev} events, ${cnt.rows[0]?.rc} receipts(by name)`);
        }
        if (find) {
          const digits = find.replace(/\D/g, '');
          const cand = await pool.query<{ id: string; name: string; phone: string | null; email: string | null; ev: string }>(
            `SELECT c.id, c.name, c.phone, c.email,
                    (SELECT count(*) FROM events WHERE customer_id = c.id)::text ev
               FROM customers c
              WHERE c.name ILIKE '%' || $1 || '%'
                 OR ($2 <> '' AND replace(c.phone,' ','') LIKE '%' || $2 || '%')
              ORDER BY c.name LIMIT 10`, [find, digits]);
          console.log(`[diag-event] candidate "${find}": ${cand.rowCount}`);
          for (const c of cand.rows) console.log(`[diag-event] CAND cust=${c.id} ${c.name} | phone=${c.phone ?? '—'} | email=${c.email ?? '—'} | ${c.ev} events`);
        }
        console.log('[diag-event] END');
      } catch (e) { console.error('[diag-event] failed:', (e as Error).message); }
    })();
  }

  // One-shot diag: the "Booked by" name on an event comes from customers.name
  // (TEXT CUST-… table), but the Customers/CRM tab edits historical_customers
  // (BIGINT). Dump both for a given phone/name so we can see the stale event name
  // vs the corrected CRM name. DIAG_BOOKEDBY=<phone digits or name>.
  if (process.env.DIAG_BOOKEDBY) {
    (async () => {
      const q = String(process.env.DIAG_BOOKEDBY).trim();
      const digits = q.replace(/\D/g, '');
      try {
        const { pool } = await import('./db/pool.js');
        const evs = await pool.query<{ id: string; cid: string; nm: string; ph: string | null; d: string }>(
          `SELECT e.id, e.customer_id cid, c.name nm, c.phone ph, to_char(e.event_date,'YYYY-MM-DD') d
             FROM events e JOIN customers c ON c.id = e.customer_id
            WHERE ($2 <> '' AND regexp_replace(COALESCE(c.phone,''),'\\D','','g') LIKE '%'||$2||'%')
               OR c.name ILIKE '%'||$1||'%' ORDER BY e.event_date`, [q, digits]);
        console.log(`[diag-bookedby] events (customers table): ${evs.rowCount}`);
        for (const e of evs.rows) console.log(`[diag-bookedby] EVENT ${e.id} | custRow=${e.cid} name="${e.nm}" phone=${e.ph ?? '—'} | date=${e.d}`);
        const hc = await pool.query<{ id: string; fn: string; ph: string | null; alt: string | null; em: string | null }>(
          `SELECT id::text, full_name fn, phone ph, phone_alt alt, email em FROM historical_customers
            WHERE ($2 <> '' AND regexp_replace(COALESCE(phone,''),'\\D','','g') LIKE '%'||$2||'%')
               OR full_name ILIKE '%'||$1||'%' ORDER BY id LIMIT 10`, [q, digits]);
        console.log(`[diag-bookedby] CRM rows (historical_customers): ${hc.rowCount}`);
        for (const h of hc.rows) console.log(`[diag-bookedby] CRM hc=${h.id} full_name="${h.fn}" phone=${h.ph ?? '—'} alt=${h.alt ?? '—'} email=${h.em ?? '—'}`);
        console.log('[diag-bookedby] END');
      } catch (e) { console.error('[diag-bookedby] failed:', (e as Error).message); }
    })();
  }

  // One-shot: correct an event booked under the wrong customer. Renames that
  // event's customer row (name + phone) and updates the matching receipt's
  // denormalised name, so the event, its title and the WhatsApp/feedback number
  // all point to the real person. SAFE ONLY for a one-off customer row (confirm
  // with DIAG_EVENT first that it owns just this one event). The event title
  // (e.g. "<name>'s Adult Birthday") derives from the customer, so it follows.
  // FIX_EVENT_ID=<EV-id> FIX_EVENT_NAME=<correct name> FIX_EVENT_PHONE=<+9715…>.
  if (process.env.FIX_EVENT_ID && process.env.FIX_EVENT_NAME) {
    (async () => {
      const evId = String(process.env.FIX_EVENT_ID).trim();
      const name = String(process.env.FIX_EVENT_NAME).trim();
      const phone = String(process.env.FIX_EVENT_PHONE ?? '').replace(/[^\d+]/g, '');
      // Explicit OLD name for the receipt fallback — needed because the customer
      // row may already be renamed from a previous run, so reading its current
      // name wouldn't match the still-old receipt. FIX_EVENT_OLD=<old name>.
      const oldName = String(process.env.FIX_EVENT_OLD ?? '').trim();
      try {
        const { pool } = await import('./db/pool.js');
        const ev = await pool.query<{ customer_id: string; order_id: string; old: string }>(
          `SELECT e.customer_id, e.order_id, c.name old
             FROM events e JOIN customers c ON c.id = e.customer_id WHERE e.id = $1`, [evId]);
        const row = ev.rows[0];
        if (!row) { console.log(`[fix-event] ${evId} not found`); console.log('[fix-event] END'); return; }
        // Guard: refuse if this customer row owns more than this one event (a
        // rename would then corrupt someone else's booking) — repoint by hand.
        const n = await pool.query<{ c: string }>(`SELECT count(*)::text c FROM events WHERE customer_id = $1`, [row.customer_id]);
        if (Number(n.rows[0]?.c ?? 0) > 1) {
          console.log(`[fix-event] ABORT: customer ${row.customer_id} owns ${n.rows[0]?.c} events — not a one-off, repoint manually`);
          console.log('[fix-event] END'); return;
        }
        const u1 = await pool.query(
          `UPDATE customers SET name = $2${phone ? ', phone = $3' : ''} WHERE id = $1`,
          phone ? [row.customer_id, name, phone] : [row.customer_id, name]);
        let u2 = await pool.query(`UPDATE finance_receipts SET customer_name = $2 WHERE order_id = $1`, [row.order_id, name]);
        // Some receipts aren't keyed by this event's order_id (imported/converted
        // rows carry no/other order_id). Fall back to the OLD name — safe here only
        // because DIAG confirmed exactly one receipt under it.
        const fallbackName = oldName || row.old;
        if (!u2.rowCount && fallbackName) {
          u2 = await pool.query(`UPDATE finance_receipts SET customer_name = $2 WHERE customer_name ILIKE $1`, [fallbackName, name]);
          console.log(`[fix-event] receipt not linked by order_id — matched by old name "${fallbackName}" instead`);
        }
        console.log(`[fix-event] ${evId}: customer "${row.old}" → "${name}"${phone ? ` (phone ${phone})` : ''}; customers updated=${u1.rowCount}, receipts updated=${u2.rowCount}`);
        console.log('[fix-event] END');
      } catch (e) { console.error('[fix-event] failed:', (e as Error).message); }
    })();
  }

  // One-shot: re-plan every upcoming, non-cancelled event under the CURRENT
  // staffing mode. With the mode defaulting to 'manual', this opens the slots on
  // events that were auto-staffed before, so the whole upcoming calendar switches
  // to owner/Marsha hand-picking. Confirmed part-timers are preserved.
  // REPLAN_UPCOMING=true for one deploy, then unset.
  if (String(process.env.REPLAN_UPCOMING ?? '').toLowerCase() === 'true') {
    (async () => {
      try {
        const { pool } = await import('./db/pool.js');
        const { assignStaffForEvent, getStaffingMode } = await import('./domain/staffing.js');
        const mode = await getStaffingMode();
        const { rows } = await pool.query<{ id: string }>(
          `SELECT id FROM events WHERE phase <> 'Cancelled' AND event_date >= CURRENT_DATE ORDER BY event_date`);
        let ok = 0;
        for (const r of rows) { try { await assignStaffForEvent(r.id); ok++; } catch { /* skip one */ } }
        console.log(`[replan-upcoming] mode=${mode} — re-planned ${ok}/${rows.length} upcoming event(s)`);
        console.log('[replan-upcoming] END');
      } catch (e) { console.error('[replan-upcoming] failed:', (e as Error).message); }
    })();
  }

  // One-shot diag: why a customer got the feedback EMAIL but not the WhatsApp.
  // Dumps their customer record (email/phone) + every feedback_request row with
  // its sent_at / whatsapp_sent_at / cancelled_at. DIAG_FEEDBACK_NAME=<name>.
  if (process.env.DIAG_FEEDBACK_NAME) {
    (async () => {
      const q = String(process.env.DIAG_FEEDBACK_NAME);
      try {
        const { pool } = await import('./db/pool.js');
        const rows = await pool.query<{
          event_id: string; name: string; email: string | null; phone: string | null;
          event_date: string | null; template: string | null; channel: string | null;
          scheduled_for: string | null; sent_at: string | null; wa_at: string | null; canc: string | null;
        }>(
          `SELECT e.id AS event_id, c.name, c.email, c.phone,
                  to_char(e.event_date,'YYYY-MM-DD') AS event_date,
                  n.template, n.channel,
                  to_char(n.scheduled_for,'YYYY-MM-DD HH24:MI') AS scheduled_for,
                  to_char(n.sent_at,'YYYY-MM-DD HH24:MI') AS sent_at,
                  to_char(n.whatsapp_sent_at,'YYYY-MM-DD HH24:MI') AS wa_at,
                  to_char(n.cancelled_at,'YYYY-MM-DD HH24:MI') AS canc
             FROM events e
             JOIN customers c ON c.id = e.customer_id
             LEFT JOIN notifications n ON n.event_id = e.id AND n.template = 'feedback_request'
            WHERE c.name ILIKE '%' || $1 || '%'
            ORDER BY e.event_date`, [q]);
        console.log(`[diag-feedback] "${q}" → ${rows.rowCount} row(s)`);
        for (const r of rows.rows) {
          console.log(`[diag-feedback] ${r.event_id} | ${r.name} | email=${r.email ?? '—'} | phone=${r.phone ?? '—'} | event=${r.event_date} | tpl=${r.template ?? 'NONE'} ch=${r.channel ?? '-'} | sched=${r.scheduled_for ?? '-'} | emailSent=${r.sent_at ?? '-'} | waSent=${r.wa_at ?? '-'} | cancelled=${r.canc ?? '-'}`);
        }
        console.log('[diag-feedback] END');
      } catch (e) { console.error('[diag-feedback] failed:', (e as Error).message); }
    })();
  }

  // One-shot: save a customer's phone (by email) and RE-ARM a specific
  // feedback_request WhatsApp that was marked handled only because there was no
  // number on file — so it re-sends on the next sweep, like every other
  // customer. FIX_FEEDBACK_EMAIL=<email> FIX_FEEDBACK_PHONE=<+9715…>
  // FIX_FEEDBACK_EVENT=<EV-id>. All three for one deploy, then unset.
  if (process.env.FIX_FEEDBACK_EMAIL && process.env.FIX_FEEDBACK_PHONE) {
    (async () => {
      const email = String(process.env.FIX_FEEDBACK_EMAIL).trim().toLowerCase();
      const phone = String(process.env.FIX_FEEDBACK_PHONE).replace(/[^\d+]/g, '');
      const evId = String(process.env.FIX_FEEDBACK_EVENT ?? '').trim();
      try {
        const { pool } = await import('./db/pool.js');
        const c = await pool.query(`UPDATE customers SET phone = $2 WHERE lower(email) = $1 RETURNING id, name`, [email, phone]);
        console.log(`[fix-feedback] set phone on ${c.rowCount} customer(s) for ${email} → ${phone}`);
        const h = await pool.query(`UPDATE historical_customers SET phone = $2 WHERE lower(email) = $1 AND (phone IS NULL OR phone = '')`, [email, phone]).catch(() => ({ rowCount: 0 }));
        if (h.rowCount) console.log(`[fix-feedback] also set phone on ${h.rowCount} historical_customers row(s)`);
        if (evId) {
          // Re-arm the WhatsApp ONLY (email already went out: sent_at stays set, so
          // the email sweep won't re-send). The WhatsApp sweep picks whatsapp_sent_at
          // IS NULL and now has a valid number to send to.
          const n = await pool.query(
            `UPDATE notifications SET whatsapp_sent_at = NULL
              WHERE event_id = $1 AND template = 'feedback_request' AND cancelled_at IS NULL
              RETURNING id`, [evId]);
          console.log(`[fix-feedback] re-armed feedback WhatsApp on ${n.rowCount} row(s) for ${evId} (sends next sweep, 10:00–20:00 Dubai)`);
        }
        console.log('[fix-feedback] END');
      } catch (e) { console.error('[fix-feedback] failed:', (e as Error).message); }
    })();
  }

  // One-shot (env-gated) UNDO of a mistaken manual refund: cancel the unsent
  // customer email/WhatsApp for that order AND reverse the recorded refund
  // (receipt, points, order status). Set UNDO_REFUND_ORDER=<order id> for one
  // deploy, then unset it.
  if (process.env.UNDO_REFUND_ORDER) {
    (async () => {
      const oid = String(process.env.UNDO_REFUND_ORDER);
      try {
        const { pool } = await import('./db/pool.js');
        const canc = await pool.query(
          `UPDATE notifications SET cancelled_at = now()
            WHERE template = 'refund_processed' AND sent_at IS NULL AND cancelled_at IS NULL
              AND payload->>'orderId' = $1 RETURNING id`, [oid]);
        // Give back the loyalty points the refund had deducted, then drop those rows.
        const pts = await pool.query<{ customer_id: string; add_back: number }>(
          `SELECT customer_id, COALESCE(SUM(-points),0)::int AS add_back
             FROM loyalty_transactions
            WHERE order_id = $1 AND reason = 'Refund reversal' AND created_at > now() - interval '6 hours'
            GROUP BY customer_id`, [oid]);
        for (const r of pts.rows) {
          if (r.customer_id && r.add_back > 0) {
            await pool.query(`UPDATE customers SET loyalty_points = loyalty_points + $2 WHERE id = $1`, [r.customer_id, r.add_back]);
          }
        }
        await pool.query(`DELETE FROM loyalty_transactions WHERE order_id = $1 AND reason = 'Refund reversal' AND created_at > now() - interval '6 hours'`, [oid]);
        const del = await pool.query(`DELETE FROM refunds WHERE order_id = $1 AND created_at > now() - interval '6 hours' RETURNING id`, [oid]);
        // Rebuild the receipt's refund totals from whatever refunds remain.
        await pool.query(
          `UPDATE finance_receipts SET
              refunded_fils = COALESCE((SELECT SUM(amount_fils) FROM refunds WHERE order_id = $1), 0),
              refunded_items = COALESCE((SELECT jsonb_agg(jsonb_build_object('label', item_label, 'amountFils', amount_fils, 'reasonCategory', reason_category)) FROM refunds WHERE order_id = $1), '[]'::jsonb)
            WHERE order_id = $1`, [oid]);
        await pool.query(`UPDATE orders SET status = 'paid' WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM refunds WHERE order_id = $1)`, [oid]);
        console.log(`[undo-refund] ${oid}: cancelled ${canc.rowCount} pending emails, deleted ${del.rowCount} refund rows`);
      } catch (e) {
        console.error('[undo-refund] failed:', (e as Error).message);
      }
    })();
  }

  // One-shot (env-gated) RE-RECORD of a corrected partial refund, reusing the
  // tested record-only refund path (books + points + status), but WITHOUT the
  // customer email — the owner sends one clarification herself so the customer
  // isn't double-emailed. Set REDO_REFUND_ORDER=<id>, REDO_REFUND_FILS=<fils>,
  // optional REDO_REFUND_LABEL, for one deploy, then unset.
  if (process.env.REDO_REFUND_ORDER && process.env.REDO_REFUND_FILS) {
    (async () => {
      const oid = String(process.env.REDO_REFUND_ORDER);
      const fils = Math.round(Number(process.env.REDO_REFUND_FILS));
      const label = (process.env.REDO_REFUND_LABEL || 'Tables & Chairs').trim();
      try {
        const { pool } = await import('./db/pool.js');
        // Idempotency guard: skip if this exact refund was already recorded recently.
        const dup = await pool.query(
          `SELECT 1 FROM refunds WHERE order_id = $1 AND amount_fils = $2 AND created_at > now() - interval '45 minutes' LIMIT 1`,
          [oid, fils]);
        if ((dup.rowCount ?? 0) > 0) { console.log(`[redo-refund] ${oid}: ${fils} fils already recorded — skip`); return; }
        const { refundOrderMoney } = await import('./domain/refund.js');
        const r = await refundOrderMoney({
          orderId: oid, amountFils: fils, recordOnly: true,
          reasonCategory: 'other', itemLabel: label, createdBy: 'owner',
          reason: `Partial refund — ${label}`,
        });
        // Suppress the auto refund email this just queued; the owner messages the customer.
        const supp = await pool.query(
          `UPDATE notifications SET cancelled_at = now()
            WHERE template = 'refund_processed' AND sent_at IS NULL AND cancelled_at IS NULL
              AND payload->>'orderId' = $1 AND created_at > now() - interval '5 minutes' RETURNING id`, [oid]);
        console.log(`[redo-refund] ${oid}: ${JSON.stringify(r)}; suppressed ${supp.rowCount} auto email(s)`);
      } catch (e) {
        console.error('[redo-refund] failed:', (e as Error).message);
      }
    })();
  }

  // One-shot READ-ONLY diagnostic: why does an event's "Booked services" sum differ
  // from the order/receipt total? Logs the event_services lines + the order total +
  // the receipt breakdown. Set DIAG_ORDER=<order id> for one deploy, then unset.
  if (process.env.DIAG_ORDER) {
    (async () => {
      const oid = String(process.env.DIAG_ORDER);
      try {
        const { pool } = await import('./db/pool.js');
        const ord = (await pool.query(`SELECT id, status, total_fils, event_id FROM orders WHERE id = $1`, [oid])).rows[0];
        const evId = ord?.event_id ?? (await pool.query(`SELECT id FROM events WHERE order_id = $1`, [oid])).rows[0]?.id ?? null;
        const svc = evId ? (await pool.query(`SELECT label, quantity, amount_fils, source, service_id FROM event_services WHERE event_id = $1 ORDER BY id`, [evId])).rows : [];
        const rc = (await pool.query(`SELECT number, subtotal_fils, discount_fils, shipping_fils, total_fils, refunded_fils, line_items FROM finance_receipts WHERE order_id = $1`, [oid])).rows[0];
        const svcSum = svc.reduce((s: number, r: any) => s + Number(r.amount_fils || 0), 0);
        console.log(`[diag-order] ${oid}: order.total=${ord?.total_fils} status=${ord?.status} event=${evId}`);
        console.log(`[diag-order] ${oid}: event_services (sum=${svcSum}) =`, JSON.stringify(svc));
        console.log(`[diag-order] ${oid}: receipt ${rc?.number} subtotal=${rc?.subtotal_fils} discount=${rc?.discount_fils} shipping=${rc?.shipping_fils} total=${rc?.total_fils} refunded=${rc?.refunded_fils}`);
        console.log(`[diag-order] ${oid}: receipt.line_items =`, JSON.stringify(rc?.line_items));
      } catch (e) {
        console.error('[diag-order] failed:', (e as Error).message);
      }
    })();
  }

  // One-shot READ-ONLY diagnostic: which events count as "Event Completed" THIS
  // month (the points source) and who worked them. Set DIAG_COMPLETED=true for one
  // deploy, then unset. Explains why the competition board shows points so early.
  if (String(process.env.DIAG_COMPLETED ?? '').toLowerCase() === 'true') {
    (async () => {
      try {
        const { pool } = await import('./db/pool.js');
        const r = await pool.query(
          `SELECT e.id, to_char(e.event_date,'YYYY-MM-DD') AS d, e.phase, e.source AS src,
                  MAX(COALESCE(NULLIF(btrim(initcap(o.cart->>'eventFor')),''), c.name)) AS evname,
                  COALESCE(array_agg(DISTINCT tm.name) FILTER (WHERE tm.name IS NOT NULL), '{}') AS crew
             FROM events e
             LEFT JOIN orders o ON o.id = e.order_id
             LEFT JOIN customers c ON c.id = e.customer_id
             LEFT JOIN event_staff es ON es.event_id = e.id AND es.assignee_id IS NOT NULL
             LEFT JOIN team_members tm ON tm.id = es.assignee_id
            WHERE e.phase = 'Event Completed'
              AND e.event_date >= date_trunc('month', CURRENT_DATE)
              AND e.event_date <  date_trunc('month', CURRENT_DATE) + interval '1 month'
            GROUP BY e.id, e.event_date, e.phase, e.source
            ORDER BY e.event_date`,
        );
        console.log(`[diag-completed] this month: ${r.rowCount} completed event(s)`);
        for (const row of r.rows as any[]) {
          console.log(`[diag-completed] ${row.d} · ${row.id} · src=${row.src} · "${row.evname}" · crew: ${(row.crew || []).join(', ')}`);
        }
      } catch (e) {
        console.error('[diag-completed] failed:', (e as Error).message);
      }
    })();
  }

  // One-shot READ-ONLY diagnostic: the real state of refunds (why the dashboard
  // "Total refunded" shows 0 and whether a given order has a refund). Set
  // DIAG_REFUNDS=true for one deploy, then unset.
  if (String(process.env.DIAG_REFUNDS ?? '').toLowerCase() === 'true') {
    (async () => {
      try {
        const { pool } = await import('./db/pool.js');
        const tot = await pool.query(`SELECT COUNT(*)::int c, COALESCE(SUM(amount_fils),0)::bigint s, COUNT(*) FILTER (WHERE event_id IS NULL)::int nullev FROM refunds`);
        console.log(`[diag-refunds] refunds table: ${tot.rows[0].c} rows, sum=${tot.rows[0].s} fils, ${tot.rows[0].nullev} with NULL event_id`);
        const recent = await pool.query(
          `SELECT order_id, event_id, amount_fils, reason_category, to_char(created_at,'YYYY-MM-DD HH24:MI') AS at FROM refunds ORDER BY created_at DESC LIMIT 10`);
        for (const r of recent.rows as any[]) console.log(`[diag-refunds] ${r.at} · order=${r.order_id} · event=${r.event_id} · ${r.amount_fils} · ${r.reason_category}`);
        // How the CEO dashboard counts it (JOIN events on event_id, by event_date this year):
        const dash = await pool.query(
          `SELECT COALESCE(SUM(r.amount_fils),0)::bigint v, COUNT(*)::int c FROM refunds r JOIN events e ON e.id = r.event_id
            WHERE e.event_date >= date_trunc('year', CURRENT_DATE) AND e.event_date < date_trunc('year', CURRENT_DATE) + interval '1 year'`);
        console.log(`[diag-refunds] CEO 'this year' (JOIN events by event_date): ${dash.rows[0].c} rows, ${dash.rows[0].v} fils`);
        const o48 = await pool.query(`SELECT status FROM orders WHERE id='EVT-ORD-000048'`);
        const r48 = await pool.query(`SELECT refunded_fils, total_fils FROM finance_receipts WHERE order_id='EVT-ORD-000048'`);
        console.log(`[diag-refunds] EVT-ORD-000048: order status=${o48.rows[0]?.status}; receipt refunded_fils=${r48.rows[0]?.refunded_fils}, total=${r48.rows[0]?.total_fils}`);
      } catch (e) {
        console.error('[diag-refunds] failed:', (e as Error).message);
      }
    })();
  }

  // One-shot: reflect an already-recorded refund onto an IMPORTED sales receipt
  // that isn't linked to the refunded order (so the refund never attached to it).
  // Set REFLECT_RECEIPT=<number>:<fils>:<label>:<reason> for one deploy, then unset.
  // Display-only (net total + refunded item) — the money is already in the refunds
  // ledger, so this never double-counts cash. Self-guards: only acts if the receipt
  // currently shows no refund.
  if (process.env.REFLECT_RECEIPT) {
    (async () => {
      try {
        const { pool } = await import('./db/pool.js');
        const [num, filsS, label, reason] = String(process.env.REFLECT_RECEIPT).split(':');
        const fils = Math.round(Number(filsS));
        const item = JSON.stringify([{ label: label || 'Refunded item', amountFils: fils, reasonCategory: reason || 'missing_item' }]);
        const r = await pool.query(
          `UPDATE finance_receipts
              SET refunded_fils = $2, refunded_items = $3::jsonb
            WHERE number = $1 AND COALESCE(refunded_fils,0) = 0
            RETURNING id, total_fils`,
          [num, fils, item]);
        console.log(`[reflect-receipt] EV-${num}: updated ${r.rowCount} row(s) (refunded ${fils}, net=${r.rows[0] ? Number(r.rows[0].total_fils) - fils : '?'})`);
      } catch (e) {
        console.error('[reflect-receipt] failed:', (e as Error).message);
      }
    })();
  }

  // One-shot: remove ALL refunds on one order (no time window) — e.g. a test
  // refund the owner wants un-counted. Reverses points, recomputes the receipt,
  // restores order status to paid. Set DELETE_REFUND_FOR_ORDER=<orderId>, unset after.
  if (process.env.DELETE_REFUND_FOR_ORDER) {
    (async () => {
      const oid = String(process.env.DELETE_REFUND_FOR_ORDER);
      try {
        const { pool } = await import('./db/pool.js');
        const pts = await pool.query<{ customer_id: string; add_back: number }>(
          `SELECT customer_id, COALESCE(SUM(-points),0)::int AS add_back FROM loyalty_transactions
            WHERE order_id = $1 AND reason = 'Refund reversal' GROUP BY customer_id`, [oid]);
        for (const r of pts.rows) if (r.customer_id && r.add_back > 0)
          await pool.query(`UPDATE customers SET loyalty_points = loyalty_points + $2 WHERE id = $1`, [r.customer_id, r.add_back]);
        await pool.query(`DELETE FROM loyalty_transactions WHERE order_id = $1 AND reason = 'Refund reversal'`, [oid]);
        const del = await pool.query(`DELETE FROM refunds WHERE order_id = $1 RETURNING id`, [oid]);
        await pool.query(
          `UPDATE finance_receipts SET refunded_fils = COALESCE((SELECT SUM(amount_fils) FROM refunds WHERE order_id=$1),0),
              refunded_items = COALESCE((SELECT jsonb_agg(jsonb_build_object('label',item_label,'amountFils',amount_fils,'reasonCategory',reason_category)) FROM refunds WHERE order_id=$1),'[]'::jsonb)
            WHERE order_id = $1`, [oid]);
        await pool.query(`UPDATE orders SET status='paid' WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM refunds WHERE order_id=$1)`, [oid]);
        console.log(`[del-refund] ${oid}: deleted ${del.rowCount} refund row(s), restored`);
      } catch (e) { console.error('[del-refund] failed:', (e as Error).message); }
    })();
  }

  // One-shot READ-ONLY diagnostic: the receipt↔order linkage gap. How many sales
  // receipts have no/for a non-existent order_id, and how many of those can be
  // SAFELY matched to exactly one order (same customer + same total). Set
  // DIAG_LINK=true for one deploy, then unset.
  if (String(process.env.DIAG_LINK ?? '').toLowerCase() === 'true') {
    (async () => {
      try {
        const { pool } = await import('./db/pool.js');
        const tot = await pool.query(`SELECT COUNT(*)::int c FROM finance_receipts`);
        const nullo = await pool.query(`SELECT COUNT(*)::int c FROM finance_receipts WHERE order_id IS NULL OR order_id = ''`);
        const orphan = await pool.query(`SELECT COUNT(*)::int c FROM finance_receipts r WHERE r.order_id IS NOT NULL AND r.order_id <> '' AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = r.order_id)`);
        // Of the unlinked receipts, how many match EXACTLY ONE order by customer+total?
        const matchable = await pool.query(
          `SELECT COUNT(*)::int c FROM finance_receipts r
            WHERE (r.order_id IS NULL OR r.order_id = '' OR NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = r.order_id))
              AND r.customer_id IS NOT NULL
              AND (SELECT COUNT(*) FROM orders o WHERE o.customer_id = r.customer_id AND o.total_fils = r.total_fils) = 1`);
        console.log(`[diag-link] receipts total=${tot.rows[0].c}; unlinked(null)=${nullo.rows[0].c}; orphan(order gone)=${orphan.rows[0].c}; safely-matchable(1 order by customer+total)=${matchable.rows[0].c}`);
      } catch (e) {
        console.error('[diag-link] failed:', (e as Error).message);
      }
    })();
  }

  // One-shot: link imported sales receipts to their order so EVERYTHING attaches
  // (refund, add-on, edit, receipt reflection), not just refunds. Matches a
  // receipt that has no valid order_id to EXACTLY ONE order with the same customer
  // + same total (any ambiguity → skipped). LINK_RECEIPTS=dry logs proposals;
  // LINK_RECEIPTS=apply performs the UPDATE. Read-only in dry mode.
  if (process.env.LINK_RECEIPTS === 'dry' || process.env.LINK_RECEIPTS === 'apply') {
    (async () => {
      const apply = process.env.LINK_RECEIPTS === 'apply';
      try {
        const { pool } = await import('./db/pool.js');
        const cand = await pool.query<{ id: string; number: string; customer_id: string; total_fils: string }>(
          `SELECT r.id, r.number, r.customer_id, r.total_fils FROM finance_receipts r
            WHERE r.customer_id IS NOT NULL
              AND (r.order_id IS NULL OR r.order_id = '' OR NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = r.order_id))`);
        let linked = 0, ambiguous = 0, none = 0;
        for (const r of cand.rows) {
          const m = await pool.query<{ id: string }>(
            `SELECT o.id FROM orders o WHERE o.customer_id = $1 AND o.total_fils::bigint = $2::bigint`,
            [r.customer_id, r.total_fils]);
          if (m.rowCount === 1) {
            linked++;
            if (apply) await pool.query(`UPDATE finance_receipts SET order_id = $2 WHERE id = $1`, [r.id, m.rows[0].id]);
            else if (linked <= 20) console.log(`[link-receipts] EV-${r.number} → ${m.rows[0].id} (cust=${r.customer_id}, total=${r.total_fils})`);
          } else if ((m.rowCount ?? 0) > 1) ambiguous++;
          else none++;
        }
        console.log(`[link-receipts] ${apply ? 'APPLIED' : 'DRY'}: ${cand.rowCount} unlinked receipts → ${linked} ${apply ? 'linked' : 'matchable'}, ${ambiguous} ambiguous (skipped), ${none} no-match`);
      } catch (e) { console.error('[link-receipts] failed:', (e as Error).message); }
    })();
  }

  // One-shot READ-ONLY diagnostic: how many customer records are duplicates of
  // the SAME person (the phone-format split), so a merge can be sized before any
  // write. Set DIAG_MERGE=true for one deploy, then unset.
  if (String(process.env.DIAG_MERGE ?? '').toLowerCase() === 'true') {
    (async () => {
      try {
        const { pool } = await import('./db/pool.js');
        // Canonical phone = last 9 digits (drops 0/+971 prefixes). Group historical
        // customers by it; any group of >1 is the same person split into dupes.
        const byPhone = await pool.query<{ groups: string; extra: string }>(
          `WITH g AS (
             SELECT right(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'),9) AS k, count(*) n
               FROM historical_customers
              WHERE COALESCE(phone,'') <> '' AND length(regexp_replace(COALESCE(phone,''),'[^0-9]','','g')) >= 9
              GROUP BY 1 HAVING count(*) > 1)
           SELECT count(*)::text groups, COALESCE(sum(n-1),0)::text extra FROM g`);
        const byEmail = await pool.query<{ groups: string; extra: string }>(
          `WITH g AS (
             SELECT lower(btrim(email)) AS k, count(*) n FROM historical_customers
              WHERE COALESCE(btrim(email),'') <> '' GROUP BY 1 HAVING count(*) > 1)
           SELECT count(*)::text groups, COALESCE(sum(n-1),0)::text extra FROM g`);
        const tot = await pool.query<{ c: string }>(`SELECT count(*)::text c FROM historical_customers`);
        console.log(`[diag-merge] historical_customers total=${tot.rows[0].c}; phone-dupe groups=${byPhone.rows[0].groups} (extra rows=${byPhone.rows[0].extra}); email-dupe groups=${byEmail.rows[0].groups} (extra=${byEmail.rows[0].extra})`);
        const sample = await pool.query<{ k: string; names: string[] }>(
          `SELECT right(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'),9) AS k,
                  array_agg(DISTINCT full_name) AS names
             FROM historical_customers
            WHERE COALESCE(phone,'') <> '' AND length(regexp_replace(COALESCE(phone,''),'[^0-9]','','g')) >= 9
            GROUP BY 1 HAVING count(*) > 1 LIMIT 8`);
        for (const r of sample.rows) console.log(`[diag-merge] sample phone ...${r.k}: ${JSON.stringify(r.names)}`);
      } catch (e) { console.error('[diag-merge] failed:', (e as Error).message); }
    })();
  }

  // One-shot customer de-dup: merge historical_customers that share the SAME
  // email (the safe dupe class — a shared email is almost certainly one person;
  // phone-only dupes are left alone because a family can share a number). For
  // each email group we keep the lowest id as canonical, repoint its receipts +
  // invoices onto it, backfill any blank contact field on the canonical from the
  // dupes, then delete the dupe rows. MERGE_CUSTOMERS=dry logs the plan only;
  // MERGE_CUSTOMERS=apply performs it in one transaction. Unset after.
  {
    const mcMode = String(process.env.MERGE_CUSTOMERS ?? '').toLowerCase();
    if (mcMode === 'dry' || mcMode === 'apply') {
      (async () => {
        const { pool } = await import('./db/pool.js');
        const client = await pool.connect();
        try {
          type HC = { id: string; full_name: string; phone: string | null; phone_alt: string | null; email: string | null; emirate: string | null; bill_address: string | null; ship_address: string | null };
          // All historical customers that share a (case-insensitive, trimmed)
          // non-empty email with at least one other row.
          const dupes = await client.query<HC>(
            `SELECT id::text, full_name, phone, phone_alt, email, emirate, bill_address, ship_address
               FROM historical_customers
              WHERE lower(btrim(email)) IN (
                      SELECT lower(btrim(email)) FROM historical_customers
                       WHERE COALESCE(btrim(email),'') <> ''
                       GROUP BY 1 HAVING count(*) > 1)
              ORDER BY lower(btrim(email)), id`);
          // Emails whose two rows are NOT the same person (different orgs, or
          // different first names likely sharing one inbox) — never auto-merge
          // these; the owner decides them by hand.
          const SKIP_EMAILS = new Set([
            'rea63@georgetown.edu',            // Georgetown University vs هيئة تنمية المجتمع (two orgs)
            'zakiya.hassan.1988@gmail.com',    // Reem Allanjawi vs Zakiya Hassan (different people)
            'aishadxb440@gmail.com',           // Aysha Ayoub vs Alia Ayoob (different first names)
          ]);
          const groups = new Map<string, HC[]>();
          for (const r of dupes.rows) {
            const k = (r.email || '').trim().toLowerCase();
            if (SKIP_EMAILS.has(k)) continue;
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k)!.push(r);
          }
          console.log(`[merge-customers] mode=${mcMode} email-dupe groups=${groups.size} rows=${dupes.rows.length}`);
          const firstNonEmpty = (vals: (string | null)[]) => { for (const v of vals) if (v && String(v).trim() !== '') return String(v).trim(); return null; };
          if (mcMode === 'apply') await client.query('BEGIN');
          let mergedGroups = 0, movedRcpt = 0, movedInv = 0, deleted = 0;
          for (const [k, rows] of groups) {
            const canonical = rows[0];               // lowest id (earliest import)
            const dupeIds = rows.slice(1).map((r) => r.id);
            if (dupeIds.length === 0) continue;
            // What would move, for the log.
            const rc = await client.query<{ c: string }>(`SELECT count(*)::text c FROM finance_receipts WHERE customer_id = ANY($1::bigint[])`, [dupeIds]);
            const iv = await client.query<{ c: string }>(`SELECT count(*)::text c FROM finance_invoices WHERE customer_id = ANY($1::bigint[])`, [dupeIds]);
            console.log(`[merge-customers] email=${k} keep id=${canonical.id} "${canonical.full_name}"; merge ids=[${dupeIds.join(',')}] names=${JSON.stringify(rows.slice(1).map((r) => r.full_name))} receipts=${rc.rows[0].c} invoices=${iv.rows[0].c}`);
            if (mcMode !== 'apply') continue;
            // Repoint finance docs onto the canonical, then backfill blanks.
            const rU = await client.query(`UPDATE finance_receipts SET customer_id=$1 WHERE customer_id = ANY($2::bigint[])`, [canonical.id, dupeIds]);
            const iU = await client.query(`UPDATE finance_invoices SET customer_id=$1 WHERE customer_id = ANY($2::bigint[])`, [canonical.id, dupeIds]);
            movedRcpt += rU.rowCount ?? 0; movedInv += iU.rowCount ?? 0;
            await client.query(
              `UPDATE historical_customers SET phone=$2, phone_alt=$3, emirate=$4, bill_address=$5, ship_address=$6 WHERE id=$1`,
              [canonical.id,
               firstNonEmpty(rows.map((r) => r.phone)),
               firstNonEmpty(rows.map((r) => r.phone_alt)),
               firstNonEmpty(rows.map((r) => r.emirate)),
               firstNonEmpty(rows.map((r) => r.bill_address)),
               firstNonEmpty(rows.map((r) => r.ship_address))]);
            const dU = await client.query(`DELETE FROM historical_customers WHERE id = ANY($1::bigint[])`, [dupeIds]);
            deleted += dU.rowCount ?? 0; mergedGroups++;
          }
          if (mcMode === 'apply') {
            await client.query('COMMIT');
            console.log(`[merge-customers] DONE groups=${mergedGroups} receiptsMoved=${movedRcpt} invoicesMoved=${movedInv} rowsDeleted=${deleted}`);
          } else {
            console.log('[merge-customers] DRY RUN — nothing written. Set MERGE_CUSTOMERS=apply to perform.');
          }
        } catch (e) {
          try { if (mcMode === 'apply') await client.query('ROLLBACK'); } catch {}
          console.error('[merge-customers] failed:', (e as Error).message);
        } finally { client.release(); }
      })();
    }
  }

  // Warm the WhatsApp auto-reply mode from the settings table so the very first
  // inbound message after a deploy honours the owner's dashboard choice rather
  // than the env default. Best-effort — agentMode() self-refreshes anyway.
  import('./integrations/whatsapp.js')
    .then((m) => m.refreshAgentMode())
    .catch(() => {});

  // One-time (env-gated) Tabby webhook re-registration: makes Tabby store & echo
  // our current TABBY_WEBHOOK_SECRET so live confirmations stop returning 401 and
  // bookings confirm instantly. Also logs the private QA link. Set
  // TABBY_REREGISTER_WEBHOOK=true for one deploy, then unset it.
  if (String(process.env.TABBY_REREGISTER_WEBHOOK ?? '').toLowerCase() === 'true') {
    (async () => {
      const base = String(config.publicAppUrl).replace(/\/$/, '');
      console.log('[tabby] QA link:', config.tabbyQaToken ? `${base}/?qa=${config.tabbyQaToken}` : '(TABBY_QA_TOKEN not set)');
      try {
        const { getProvider } = await import('./payments/index.js');
        const { TabbyProvider } = await import('./payments/tabby.js');
        const p = getProvider('tabby');
        const cfg = config.providers.tabby;
        if (!(p instanceof TabbyProvider) || !cfg.webhookSecret) {
          console.log('[tabby] skipped', JSON.stringify({ mode: cfg.mode, hasSecret: Boolean(cfg.webhookSecret) }));
          return;
        }
        // 1) See what Tabby already has (its stored header = the secret it echoes).
        const existing = await p.listWebhooks().catch((e) => ({ error: (e as Error).message }));
        console.log('[tabby] existing webhooks:', JSON.stringify(existing));
        // 2) Reset: delete any webhook pointing at our URL, then register fresh
        //    with OUR current secret so Tabby echoes it and deliveries verify 200.
        const ourUrl = `${config.publicApiUrl}/api/webhooks/tabby`;
        const list: any[] = Array.isArray(existing) ? existing : Array.isArray((existing as any)?.webhooks) ? (existing as any).webhooks : [];
        for (const w of list) {
          if (w?.id && (w.url === ourUrl || String(w.url || '').includes('/api/webhooks/tabby'))) {
            const del = await p.deleteWebhook(String(w.id)).catch((e) => ({ error: (e as Error).message }));
            console.log('[tabby] deleted webhook', w.id, JSON.stringify(del));
          }
        }
        const isTest = cfg.mode !== 'live';
        const res = await p.registerWebhook(ourUrl, isTest).catch((e) => ({ error: (e as Error).message }));
        console.log('[tabby] re-registered', JSON.stringify({ ourUrl, isTest, res }));
      } catch (e) {
        console.error('[tabby] reset failed:', (e as Error).message);
      }
    })();
  }

  // Read bank@eventanauae.com over IMAP and turn each new bank-alert email into
  // a PENDING bank_transactions row for the owner to approve. No-op unless
  // BANK_IMAP_POLL=true with a mailbox password set in the environment.
  const { startBankImapPolling, rereadRecentInboxFromEnv, startCorporateReplyPolling } = await import('./domain/bankImapPoll.js');
  startBankImapPolling();
  // Read the hello@ inbox for company REPLIES to our B2B outreach and record them
  // (replied/interested + notify owner). No-op unless CORP_REPLY_IMAP_POLL=true.
  startCorporateReplyPolling();
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
