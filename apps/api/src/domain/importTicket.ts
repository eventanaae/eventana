import { randomBytes } from 'node:crypto';

/**
 * Short-lived, single-purpose tickets for the one-time data migration from the
 * owner's QuickBooks browser into her own database. A Manager/Owner mints a
 * ticket from the authenticated dashboard; the browser-side collector then POSTs
 * the scraped rows to the PUBLIC /api/import route carrying that ticket. This
 * lets QuickBooks data flow straight into the database without exposing the
 * staff token to the qbo.intuit.com page, and without the data passing through
 * any third party. Tickets expire quickly and are held only in memory (a single
 * API instance), which is exactly the right scope for a supervised migration.
 */
const TTL_MS = 30 * 60 * 1000; // 30 minutes
const tickets = new Map<string, number>(); // ticket -> expiry epoch ms

export function issueImportTicket(): { ticket: string; expiresInMs: number } {
  // prune expired
  const now = Date.now();
  for (const [t, exp] of tickets) if (exp < now) tickets.delete(t);
  const ticket = randomBytes(24).toString('base64url');
  tickets.set(ticket, now + TTL_MS);
  return { ticket, expiresInMs: TTL_MS };
}

export function isImportTicketValid(ticket: unknown): boolean {
  if (typeof ticket !== 'string' || !ticket) return false;
  const exp = tickets.get(ticket);
  if (!exp) return false;
  if (exp < Date.now()) { tickets.delete(ticket); return false; }
  return true;
}
