/**
 * Make sure EVERY party customer has a win-back code, so the post-event sweep
 * (3 days after each event) always has a code to send — nobody is skipped just
 * because their booking came in by a path that didn't mint one (manual receipt,
 * converted sale, an old app order).
 *
 *   WINBACK_ENSURE=list   → DRY-RUN. Reports coverage for recent + upcoming
 *                           events (has code? already emailed? opted out?),
 *                           and calls out the 4 & 5 Sep bookings specifically.
 *   WINBACK_ENSURE=apply  → issues a win-back code (idempotent) for every
 *                           party customer with an email who has none yet.
 * Read-only in list mode. Never sends anything — sending stays with the gated
 * post-event / reminder sweeps.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[winback-ensure] ${s}`);

export async function winbackEnsureFromEnv(): Promise<void> {
  const mode = String(process.env.WINBACK_ENSURE ?? '').toLowerCase();
  if (mode !== 'list' && mode !== 'apply') return;

  try {
    // Coverage for events in a useful window: last 10 days (post-event sweep
    // still relevant) through the next 120 days.
    const cov = await pool.query<{
      id: string; d: string; name: string; email: string | null; opt_out: boolean;
      has_code: boolean; reminded: string | null;
    }>(
      `SELECT e.id, to_char(e.event_date,'YYYY-MM-DD') AS d, c.name, c.email,
              c.email_opt_out AS opt_out,
              EXISTS (
                SELECT 1 FROM promo_codes p
                 WHERE p.customer_id = c.id AND p.campaign = 'winback' AND p.active
                   AND (p.expires_at IS NULL OR p.expires_at > now())
                   AND (p.max_uses IS NULL OR p.uses < p.max_uses)
                   AND NOT EXISTS (SELECT 1 FROM promo_redemptions r WHERE r.code = p.code)
              ) AS has_code,
              (SELECT to_char(max(p.last_reminded_at),'MM-DD') FROM promo_codes p
                WHERE p.customer_id = c.id AND p.campaign = 'winback') AS reminded
         FROM events e
         JOIN customers c ON c.id = e.customer_id
        WHERE e.event_date >= (CURRENT_DATE - interval '10 days')
          AND e.event_date <= (CURRENT_DATE + interval '120 days')
          AND e.phase <> 'Cancelled'
        ORDER BY e.event_date`,
    );

    let missing = 0, noEmail = 0, optOut = 0, ready = 0;
    for (const r of cov.rows) {
      if (r.opt_out) optOut++;
      else if (!r.email) noEmail++;
      else if (!r.has_code) missing++;
      else ready++;
    }
    P(`window events=${cov.rowCount} · ready(code+email)=${ready} · MISSING code=${missing} · no-email=${noEmail} · opted-out=${optOut}`);

    // Call out the 4 & 5 Sep bookings the owner asked about explicitly.
    for (const r of cov.rows) {
      if (r.d === '2026-09-04' || r.d === '2026-09-05') {
        const status = r.opt_out ? 'OPTED-OUT' : !r.email ? 'NO EMAIL' : !r.has_code ? 'NEEDS CODE' : (r.reminded ? `emailed ${r.reminded}` : 'code ready, not yet emailed');
        P(`  ${r.d} · ${r.name} · ${r.email ?? '—'} → ${status}`);
      }
    }
    // List the ones missing a code (so we see who apply will fix).
    const miss = cov.rows.filter((r) => !r.opt_out && r.email && !r.has_code);
    if (miss.length) {
      P(`customers needing a code (${miss.length}):`);
      for (const r of miss) P(`  ${r.d} · ${r.name} · ${r.email}`);
    }

    if (mode === 'apply') {
      const { issueWinbackCode } = await import('../domain/winback.js');
      // Every party customer with an email + no active code, across ALL events
      // (not just the window) — so the whole book is covered, once.
      const todo = await pool.query<{ id: string; name: string }>(
        `SELECT DISTINCT c.id, c.name
           FROM customers c
           JOIN events e ON e.customer_id = c.id AND e.phase <> 'Cancelled'
          WHERE c.email IS NOT NULL AND c.email <> '' AND c.email_opt_out = FALSE
            AND NOT EXISTS (
              SELECT 1 FROM promo_codes p
               WHERE p.customer_id = c.id AND p.campaign = 'winback' AND p.active
                 AND (p.expires_at IS NULL OR p.expires_at > now())
                 AND (p.max_uses IS NULL OR p.uses < p.max_uses)
                 AND NOT EXISTS (SELECT 1 FROM promo_redemptions r WHERE r.code = p.code)
            )`,
      );
      P(`APPLY: ${todo.rowCount} customer(s) need a code`);
      let issued = 0;
      for (const c of todo.rows) {
        const res = await issueWinbackCode(pool, c.id).catch((e) => { P(`  ${c.name} failed: ${(e as Error).message.slice(0, 50)}`); return null; });
        if (res && !res.reused) { issued++; P(`  issued ${res.code} → ${c.name}`); }
      }
      P(`APPLY: issued ${issued} new code(s)`);
    }

    P('DONE');
  } catch (err) {
    console.error('[winback-ensure] failed:', (err as Error).message);
  }
}
