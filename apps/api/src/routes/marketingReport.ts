/**
 * Read-only marketing report for the AI marketing assistant.
 *
 * GET /api/marketing/report?key=<MARKETING_REPORT_KEY>[&from=YYYY-MM-DD&to=YYYY-MM-DD]
 *
 * - Aggregates only: counts and AED totals. No customer names, phones,
 *   addresses or any other personal data ever leave this route.
 * - SELECT queries only; nothing is written.
 * - Bookings are dated by WHEN THE BOOKING ENTERED THE SYSTEM
 *   (finance_receipts.booked_on), never by the event date — that is the date
 *   an ad actually "produced" the sale, so it is what spend is compared to.
 * - Requires the report key (matches REPORT_KEY_SHA256 or the optional
 *   MARKETING_REPORT_KEY env var). Send it as ?key= or the x-report-key header.
 */
import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';
import { createHash } from 'node:crypto';
import { safeEqual } from '../payments/provider.js';

// SHA-256 of the report key (the key itself is not in git). Lets the route work
// without a Render env var; MARKETING_REPORT_KEY, if set, is accepted too.
const REPORT_KEY_SHA256 = 'd7adf93428c04153d718ec5a4d1084a9c5b78e63be712d392de4edf49b112ed9';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const fils = (v: unknown) => Math.round(Number(v ?? 0)) / 100; // fils → AED

export async function marketingReportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/marketing/report', async (request, reply) => {
    const q = (request.query ?? {}) as Record<string, string | undefined>;
    const hdr = request.headers['x-report-key'];
    const given = q.key ?? (Array.isArray(hdr) ? hdr[0] : hdr);
    const envKey = process.env.MARKETING_REPORT_KEY;
    const ok = (!!envKey && envKey.length >= 24 && safeEqual(given, envKey))
      || (!!given && safeEqual(createHash('sha256').update(given).digest('hex'), REPORT_KEY_SHA256));
    if (!ok) return reply.code(401).send({ error: 'unauthorized' });

    const today = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10); // Dubai, no DST
    const to = q.to && ISO.test(q.to) ? q.to : today;
    const from = q.from && ISO.test(q.from) ? q.from : '2025-11-01';

    // Net of refunds; a fully refunded sale is not counted as a booking.
    const bookingsBase = `
      FROM finance_receipts
     WHERE booked_on BETWEEN $1::date AND $2::date
       AND total_fils - COALESCE(refunded_fils,0) > 0`;
    const net = `COALESCE(SUM(total_fils - COALESCE(refunded_fils,0)),0)::bigint`;
    // Owner rule: the Eventana Exclusive Package (a.k.a. Carnival/Carnaval Offer,
    // 3499/3500 Offer, Marwa Rateb Package) is the ONLY sale that does not come
    // from Meta ads. Everything else is attributed to Meta.
    // Also her own WhatsApp offers (2900 AED Offer, 2999 Offer). The pattern can
    // be overridden per request with ?nonMeta=<regex> (bound as a parameter).
    const DEFAULT_NON_META = '(exclusive|carn[ai]v[ae]l|349[89]|3500|marwa|مروة|2900|2999)';
    const nonMeta = q.nonMeta && q.nonMeta.length <= 300 ? q.nonMeta : DEFAULT_NON_META;
    const exclusive = `EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(line_items)='array' THEN line_items ELSE '[]'::jsonb END) li
       WHERE li->>'name' ~* $3)`;

    const [byMonth, byDay, byCelebration, byTheme, leadsByMonth, leadsByAd, leadsByDay, byPackage] = await Promise.all([
      pool.query(`SELECT to_char(booked_on,'YYYY-MM') m, COUNT(*)::int n, ${net} v,
                         COUNT(*) FILTER (WHERE ${exclusive})::int xn,
                         COALESCE(SUM(total_fils - COALESCE(refunded_fils,0)) FILTER (WHERE ${exclusive}),0)::bigint xv
                    ${bookingsBase} GROUP BY 1 ORDER BY 1`, [from, to, nonMeta]),
      pool.query(`SELECT booked_on::text d, COUNT(*)::int n, ${net} v ${bookingsBase}
                    AND booked_on > $2::date - 60 GROUP BY 1 ORDER BY 1`, [from, to]),
      pool.query(`SELECT to_char(booked_on,'YYYY-MM') m, COALESCE(NULLIF(celebration_type,''),'unknown') c,
                         COUNT(*)::int n, ${net} v ${bookingsBase} GROUP BY 1,2 ORDER BY 1,2`, [from, to]),
      pool.query(`SELECT COALESCE(NULLIF(theme,''),'unknown') t, COUNT(*)::int n, ${net} v ${bookingsBase}
                   GROUP BY 1 ORDER BY 2 DESC LIMIT 40`, [from, to]),
      pool.query(`SELECT to_char((first_message_at AT TIME ZONE 'Asia/Dubai')::date,'YYYY-MM') m,
                         COUNT(*)::int leads,
                         COUNT(*) FILTER (WHERE status IN ('quoted','confirmed','booked'))::int quoted,
                         COUNT(*) FILTER (WHERE status = 'booked' OR order_id IS NOT NULL)::int booked,
                         COUNT(*) FILTER (WHERE source_ad_id IS NOT NULL)::int from_ads
                    FROM whatsapp_leads
                   WHERE (first_message_at AT TIME ZONE 'Asia/Dubai')::date BETWEEN $1::date AND $2::date
                   GROUP BY 1 ORDER BY 1`, [from, to]),
      pool.query(`SELECT COALESCE(source_ad_id,'none') ad_id, MAX(source_headline) headline,
                         COUNT(*)::int leads,
                         COUNT(*) FILTER (WHERE status = 'booked' OR order_id IS NOT NULL)::int booked
                    FROM whatsapp_leads
                   WHERE (first_message_at AT TIME ZONE 'Asia/Dubai')::date BETWEEN $1::date AND $2::date
                   GROUP BY 1 ORDER BY 3 DESC LIMIT 50`, [from, to]),
      pool.query(`SELECT (first_message_at AT TIME ZONE 'Asia/Dubai')::date::text d, COUNT(*)::int leads,
                         COUNT(*) FILTER (WHERE status = 'booked' OR order_id IS NOT NULL)::int booked
                    FROM whatsapp_leads
                   WHERE (first_message_at AT TIME ZONE 'Asia/Dubai')::date BETWEEN GREATEST($1::date, $2::date - 60) AND $2::date
                   GROUP BY 1 ORDER BY 1`, [from, to]),
      pool.query(`SELECT li->>'name' p, COUNT(DISTINCT finance_receipts.id)::int n
                    FROM finance_receipts, jsonb_array_elements(CASE WHEN jsonb_typeof(line_items)='array' THEN line_items ELSE '[]'::jsonb END) li
                   WHERE booked_on BETWEEN $1::date AND $2::date AND total_fils - COALESCE(refunded_fils,0) > 0
                   GROUP BY 1 ORDER BY 2 DESC LIMIT 60`, [from, to]),
    ]);

    // Optional diagnostic for one booking day (?inspect=YYYY-MM-DD): how that
    // day's receipts were created. Counts only — no names, numbers or amounts per row.
    let inspect: unknown = undefined;
    if (q.inspect && ISO.test(q.inspect)) {
      const d = await pool.query(
        `SELECT source, paid_with, date::text receipt_date, (created_at AT TIME ZONE 'Asia/Dubai')::date::text created_on,
                (event_id IS NOT NULL) has_event, (order_id IS NOT NULL) has_order, COUNT(*)::int n
           FROM finance_receipts WHERE booked_on = $1::date
          GROUP BY 1,2,3,4,5,6 ORDER BY n DESC LIMIT 100`, [q.inspect]);
      inspect = { day: q.inspect, groups: d.rows };
    }

    reply.header('cache-control', 'no-store');
    return {
      inspect,
      generatedAt: new Date().toISOString(),
      range: { from, to },
      dateBasis: 'booking entered system (finance_receipts.booked_on), not event date',
      attribution: 'all bookings are from Meta ads EXCEPT line items matching nonMetaPattern (Exclusive/Carnival/3499/3500/Marwa Rateb, 2900/2999 WhatsApp offers)',
      nonMetaPattern: nonMeta,
      currency: 'AED',
      bookings: {
        byMonth: byMonth.rows.map((r) => ({
          month: r.m, bookings: r.n, revenue: fils(r.v),
          exclusiveBookings: r.xn, exclusiveRevenue: fils(r.xv),
          metaBookings: r.n - r.xn, metaRevenue: fils(Number(r.v) - Number(r.xv)),
        })),
        lineItemNames: byPackage.rows.map((r) => ({ name: r.p, bookings: r.n })),
        byDayLast60: byDay.rows.map((r) => ({ date: r.d, bookings: r.n, revenue: fils(r.v) })),
        byMonthAndCelebration: byCelebration.rows.map((r) => ({ month: r.m, celebration: r.c, bookings: r.n, revenue: fils(r.v) })),
        topThemes: byTheme.rows.map((r) => ({ theme: r.t, bookings: r.n, revenue: fils(r.v) })),
      },
      whatsappLeads: {
        byMonth: leadsByMonth.rows,
        byDayLast60: leadsByDay.rows,
        byAd: leadsByAd.rows.map((r) => ({ adId: r.ad_id, headline: r.headline, leads: r.leads, booked: r.booked })),
      },
    };
  });
}
