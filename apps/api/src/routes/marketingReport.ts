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
 * - Disabled (404) unless MARKETING_REPORT_KEY is set on the API service.
 *   The key may be sent as ?key= or the x-report-key header.
 */
import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';
import { safeEqual } from '../payments/provider.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const fils = (v: unknown) => Math.round(Number(v ?? 0)) / 100; // fils → AED

export async function marketingReportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/marketing/report', async (request, reply) => {
    const expected = process.env.MARKETING_REPORT_KEY;
    if (!expected || expected.length < 24) return reply.code(404).send({ error: 'not_found' });

    const q = (request.query ?? {}) as Record<string, string | undefined>;
    const hdr = request.headers['x-report-key'];
    const given = q.key ?? (Array.isArray(hdr) ? hdr[0] : hdr);
    if (!safeEqual(given, expected)) return reply.code(401).send({ error: 'unauthorized' });

    const today = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10); // Dubai, no DST
    const to = q.to && ISO.test(q.to) ? q.to : today;
    const from = q.from && ISO.test(q.from) ? q.from : '2025-11-01';

    // Net of refunds; a fully refunded sale is not counted as a booking.
    const bookingsBase = `
      FROM finance_receipts
     WHERE booked_on BETWEEN $1::date AND $2::date
       AND total_fils - COALESCE(refunded_fils,0) > 0`;
    const net = `COALESCE(SUM(total_fils - COALESCE(refunded_fils,0)),0)::bigint`;

    const [byMonth, byDay, byCelebration, byTheme, leadsByMonth, leadsByAd, leadsByDay] = await Promise.all([
      pool.query(`SELECT to_char(booked_on,'YYYY-MM') m, COUNT(*)::int n, ${net} v ${bookingsBase} GROUP BY 1 ORDER BY 1`, [from, to]),
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
    ]);

    reply.header('cache-control', 'no-store');
    return {
      generatedAt: new Date().toISOString(),
      range: { from, to },
      dateBasis: 'booking entered system (finance_receipts.booked_on), not event date',
      currency: 'AED',
      bookings: {
        byMonth: byMonth.rows.map((r) => ({ month: r.m, bookings: r.n, revenue: fils(r.v) })),
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
