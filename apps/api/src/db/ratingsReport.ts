/**
 * READ-ONLY ratings report. Gated by RATINGS_REPORT=true. Answers:
 *  - how many customers have rated us (from the feedback links we sent).
 *  - the full report: each rating with the event, both dates, and the team.
 *  - whether any Google review exists (google_reviews) + if Google is connected.
 * Writes NOTHING. Turn the flag off after reading.
 */
import { pool } from './pool.js';

export async function ratingsReportFromEnv(): Promise<void> {
  if (String(process.env.RATINGS_REPORT ?? '').toLowerCase() !== 'true') return;
  const L = (s: string) => console.log(`[ratings-report] ${s}`);
  try {
    const stats = (await pool.query(
      `SELECT count(*)::int AS total,
              count(DISTINCT e.customer_id)::int AS customers,
              count(*) FILTER (WHERE r.stars = 5)::int AS s5,
              count(*) FILTER (WHERE r.stars = 4)::int AS s4,
              count(*) FILTER (WHERE r.stars = 3)::int AS s3,
              count(*) FILTER (WHERE r.stars = 2)::int AS s2,
              count(*) FILTER (WHERE r.stars = 1)::int AS s1,
              count(*) FILTER (WHERE btrim(coalesce(r.feedback,'')) <> '')::int AS with_comment,
              round(avg(r.stars)::numeric, 2) AS avg_stars
         FROM event_ratings r JOIN events e ON e.id = r.event_id`,
    )).rows[0];
    L(`TOTAL ratings=${stats.total} · distinct customers=${stats.customers} · avg=${stats.avg_stars}`);
    L(`stars → 5:${stats.s5} 4:${stats.s4} 3:${stats.s3} 2:${stats.s2} 1:${stats.s1} · with a written comment: ${stats.with_comment}`);

    // Google reviews (populated only once Google Business Profile is connected).
    const g = (await pool.query(`SELECT count(*)::int n FROM google_reviews`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0];
    const gconn = (await pool.query(`SELECT count(*)::int n FROM google_oauth_connection`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0];
    L(`GOOGLE reviews in system=${g.n} · Google connected=${gconn.n > 0 ? 'YES' : 'NO (not linked yet)'}`);

    // Full report rows.
    const rows = (await pool.query(
      `SELECT to_char(r.created_at,'YYYY-MM-DD') AS rated_on,
              to_char(e.event_date,'YYYY-MM-DD') AS event_date,
              r.stars, c.name AS customer,
              e.celebration_type,
              COALESCE(th.name, initcap(o.cart->>'customTheme')) AS theme,
              initcap(o.cart->>'eventFor') AS baby,
              (SELECT fr.number FROM finance_receipts fr
                 WHERE fr.event_id = e.id OR (e.order_id IS NOT NULL AND fr.order_id = e.order_id)
                 ORDER BY (fr.event_id = e.id) DESC, fr.id LIMIT 1) AS receipt_number,
              (SELECT string_agg(DISTINCT COALESCE(tm.name, es.part_time_name), ', ')
                 FROM event_staff es LEFT JOIN team_members tm ON tm.id = es.assignee_id
                WHERE es.event_id = e.id
                  AND (es.assignee_id IS NOT NULL OR (es.part_time_name IS NOT NULL AND es.status = 'confirmed'))) AS team,
              btrim(coalesce(r.feedback,'')) AS feedback
         FROM event_ratings r
         JOIN events e ON e.id = r.event_id
         JOIN customers c ON c.id = e.customer_id
         LEFT JOIN orders o ON o.id = e.order_id
         LEFT JOIN themes th ON th.id = e.theme_id
        ORDER BY r.created_at DESC`,
    )).rows;
    L(`rows=${rows.length}`);
    for (const r of rows) {
      const ref = r.receipt_number ? `EV-${r.receipt_number}` : '—';
      const what = [r.baby ? `${r.baby}'s` : '', r.celebration_type ?? '', r.theme ? `(${r.theme})` : ''].filter(Boolean).join(' ');
      L(`• ${r.stars}★ | ${r.customer} | ${what || '—'} | ${ref} | event ${r.event_date} | rated ${r.rated_on} | team: ${r.team ?? '—'}${r.feedback ? ` | "${r.feedback.slice(0, 120)}"` : ''}`);
    }
    L('DONE');
  } catch (e) {
    console.error('[ratings-report] failed:', (e as Error).message);
  }
}
