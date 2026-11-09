/**
 * READ-ONLY one-shot: why a month-end day went missing from the emailed reports.
 * Prints when each monthly report was sent, what happened on the last day of
 * Sep/Oct (part-timer/driver jobs, deliveries, bookings, expenses, refunds) and
 * when those records were entered, plus October's staff-pay totals now vs paid.
 * Gated by SET_SHAN_LEADER='monthchk'. Blank it after.
 */
import { pool } from './pool.js';
import { buildStaffPayReport } from '../domain/staffPayReport.js';

export async function dumpMonthCheckFromEnv(): Promise<void> {
  if (String(process.env.SET_SHAN_LEADER ?? '').toLowerCase() !== 'monthchk') return;
  const clean = (v: unknown) => String(v ?? '').replace(/[\s|]+/g, ' ').trim();
  const ts = `to_char(%s AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD HH24:MI')`;
  const t = (c: string) => ts.replace('%s', c);
  try {
    for (const tbl of ['staff_pay_reports', 'recon_reports', 'finance_reports']) {
      const { rows } = await pool.query(`SELECT month, ${t('sent_at')} s FROM ${tbl} WHERE month >= '2026-08' ORDER BY month`);
      for (const r of rows) console.log(`MCHK|sent|${tbl}|${r.month}|${r.s} Dubai`);
    }
    for (const day of ['2026-09-30', '2026-10-31']) {
      const st = await pool.query(
        `SELECT e.id, COALESCE((SELECT c.name FROM customers c WHERE c.id = e.customer_id),'') nm, e.phase, e.date_tbd, es.role, COALESCE(tm.name, es.part_time_name, '(empty)') who,
                ${t('es.created_at')} added
           FROM events e JOIN event_staff es ON es.event_id = e.id LEFT JOIN team_members tm ON tm.id = es.assignee_id
          WHERE e.event_date = $1 AND es.role IN ('clown','acrobat_clown','face_painting','balloon_artist','balloon_twisting','driver','pt_driver')
          ORDER BY e.id, es.role`, [day]);
      for (const r of st.rows) console.log(`MCHK|staff|${day}|${r.id}|${clean(r.nm)}|phase ${r.phase}|tbd ${r.date_tbd}|${r.role}|${clean(r.who)}|slot added ${r.added}`);
      const dl = await pool.query(
        `SELECT id, event_id, driver_name, driver_type, emirate, truck, ${t('created_at')} added FROM deliveries WHERE del_date = $1 OR event_id IN (SELECT id FROM events WHERE event_date = $1)`, [day]);
      for (const r of dl.rows) console.log(`MCHK|delivery|${day}|${r.id}|ev ${r.event_id ?? '-'}|${clean(r.driver_name)}|${r.driver_type ?? '-'}|${r.emirate ?? '-'}|${r.truck ?? '-'}|added ${r.added}`);
      const rc = await pool.query(`SELECT COUNT(*)::int n, COALESCE(SUM(total_fils),0)::bigint v FROM finance_receipts WHERE COALESCE(booked_on,date) = $1`, [day]);
      const ex = await pool.query(`SELECT COUNT(*)::int n, COALESCE(SUM(amount_fils),0)::bigint v FROM expenses WHERE spent_on = $1`, [day]);
      const rf = await pool.query(`SELECT COUNT(*)::int n, COALESCE(SUM(amount_fils),0)::bigint v FROM refunds WHERE (created_at AT TIME ZONE 'Asia/Dubai')::date = $1`, [day]);
      console.log(`MCHK|day|${day}|bookings ${rc.rows[0].n} AED ${(Number(rc.rows[0].v) / 100).toFixed(2)}|expenses ${ex.rows[0].n} AED ${(Number(ex.rows[0].v) / 100).toFixed(2)}|refunds ${rf.rows[0].n} AED ${(Number(rf.rows[0].v) / 100).toFixed(2)}`);
    }
    const rep = await buildStaffPayReport('2026-10-01');
    for (const p of rep.partTimers) console.log(`MCHK|oct-pt|${clean(p.name)}|${p.entries.length} jobs|due ${p.totalDisplay}|paid ${p.paidDisplay ?? 'not marked'}|${p.entries.map((e) => e.date + ' ' + e.job).join('; ')}`);
    for (const d of rep.driverPayouts) console.log(`MCHK|oct-drv|${clean(d.name)}|${d.type}|${d.count} trips|due ${d.suggestedDisplay}|paid ${d.paidDisplay ?? 'not marked'}|${d.entries.map((e) => e.date + ' ' + e.emirate).join('; ')}`);
    console.log('MCHK|END');
  } catch (err) {
    console.error('[monthchk] failed:', (err as Error).message);
  }
}
