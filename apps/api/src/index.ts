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
