/**
 * Read-only name search for the owner (SET_SHAN_LEADER=find:<regex>). Looks for
 * the pattern (case-insensitive POSIX regex) across receipts, invoices,
 * customers, historical customers, orders, events, WhatsApp leads and corporate
 * leads, and LOGS the matches with their dates and amounts. Changes nothing.
 * Phones and emails are never logged.
 */
import { pool } from './pool.js';

const L = (s: string) => console.log(`[find] ${s}`);

export async function findNameFromEnv(pattern: string): Promise<void> {
  const q = async (label: string, sql: string) => {
    try {
      const { rows } = await pool.query(sql, [pattern]);
      L(`${label}: ${rows.length} match(es)`);
      for (const r of rows.slice(0, 25)) L(`${label} ${JSON.stringify(r)}`);
    } catch (e) { L(`${label}: query failed — ${(e as Error).message}`); }
  };
  L(`searching for /${pattern}/i`);
  await q('receipt', `SELECT number, customer_name, event_for, to_char(date,'YYYY-MM-DD') AS event_date,
      to_char(booked_on,'YYYY-MM-DD') AS booked_on, to_char(created_at,'YYYY-MM-DD HH24:MI') AS created, total_fils, source, event_id
      FROM finance_receipts
     WHERE customer_name ~* $1 OR COALESCE(event_for,'') ~* $1 OR COALESCE(message,'') ~* $1 OR line_items::text ~* $1
     ORDER BY date DESC`);
  await q('invoice', `SELECT number, customer_name, event_for, to_char(issue_date,'YYYY-MM-DD') AS issue_date,
      to_char(created_at,'YYYY-MM-DD HH24:MI') AS created, status, total_fils
      FROM finance_invoices
     WHERE customer_name ~* $1 OR COALESCE(event_for,'') ~* $1 OR COALESCE(message,'') ~* $1
     ORDER BY issue_date DESC`);
  await q('customer', `SELECT id, name FROM customers WHERE name ~* $1`);
  await q('hist_customer', `SELECT * FROM (SELECT id, to_jsonb(h) - 'phone' - 'email' - 'phone_alt' AS row FROM historical_customers h) x WHERE row::text ~* $1`);
  await q('order', `SELECT o.id, o.kind, o.status, o.source, to_char(o.created_at,'YYYY-MM-DD HH24:MI') AS created,
      o.cart->>'eventDate' AS event_date, o.cart->>'eventFor' AS event_for, o.total_fils, c.name AS customer
      FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
     WHERE COALESCE(c.name,'') ~* $1 OR COALESCE(o.cart->>'eventFor','') ~* $1 OR COALESCE(o.cart->>'notes','') ~* $1
        OR COALESCE(o.cart->>'companyName','') ~* $1
     ORDER BY o.created_at DESC`);
  await q('event', `SELECT e.id, to_char(e.event_date,'YYYY-MM-DD') AS event_date, e.phase, to_char(e.created_at,'YYYY-MM-DD HH24:MI') AS created,
      c.name AS customer FROM events e LEFT JOIN customers c ON c.id = e.customer_id
     WHERE COALESCE(c.name,'') ~* $1 ORDER BY e.event_date DESC`);
  await q('wa_lead', `SELECT id, name, status, to_char(created_at,'YYYY-MM-DD HH24:MI') AS created,
      (to_jsonb(w) ->> 'event_date') AS event_date FROM whatsapp_leads w
     WHERE COALESCE(name,'') ~* $1 OR to_jsonb(w)::text ~* $1 ORDER BY created_at DESC`);
  await q('corp_lead', `SELECT id, name, category, status, contact_name, to_char(created_at,'YYYY-MM-DD HH24:MI') AS created
      FROM corporate_leads WHERE name ~* $1 OR COALESCE(contact_name,'') ~* $1 ORDER BY created_at DESC`);
  L('done');
}
