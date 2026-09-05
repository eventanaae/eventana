/**
 * Dump the booked line items (label + service id + whether the catalogue knows
 * the service, its category, inflatable flag) for given events, so we can see
 * why prep generation produced no tasks. Gated by LINE_ITEMS=<id>[,<id>...].
 * Read-only.
 */
import { pool } from './pool.js';
import { config } from '../config.js';
import { issueFeedbackToken } from '../domain/customerAuth.js';

const P = (s: string) => console.log(`[line-items] ${s}`);

export async function lineItemsAuditFromEnv(): Promise<void> {
  const raw = String(process.env.LINE_ITEMS ?? '').trim();
  if (!raw) return;
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const base = (config.publicAppUrl || '').replace(/\/$/, '');
  const { loadConfig } = await import('../domain/settings.js');
  const cfg = await loadConfig();
  for (const id of ids) {
    try {
      const ev = await pool.query(
        `SELECT e.id, p.name AS package, e.custom_theme, o.cart,
                t.name AS theme, to_char(e.event_date,'YYYY-MM-DD') AS date,
                c.name AS customer
           FROM events e LEFT JOIN packages p ON p.id = e.package_id
           LEFT JOIN themes t ON t.id = e.theme_id
           LEFT JOIN customers c ON c.id = e.customer_id
           LEFT JOIN orders o ON o.id = e.order_id WHERE e.id = $1`, [id]);
      const r = ev.rows[0];
      if (!r) { P(`${id}: NOT FOUND`); continue; }
      P(`${id} "${r.customer}" date=${r.date} package=${r.package ?? '—'} theme=${r.theme ?? '—'} customTheme=${!!r.custom_theme}`);
      if (base) P(`  RATE link: ${base}/?event=${encodeURIComponent(id)}&fb=${encodeURIComponent(issueFeedbackToken(id))}&rate=1`);
      const cart = (r.cart ?? {}) as { services?: Array<{ serviceId: string; quantity: number }> };
      if (Array.isArray(cart.services) && cart.services.length) {
        for (const s of cart.services) {
          const svc = cfg.services.get(s.serviceId) as any;
          P(`  cart svc=${s.serviceId} x${s.quantity} known=${!!svc} cat=${svc?.categoryId ?? '—'} inflatable=${!!svc?.isInflatable} name=${svc?.name ?? '?'}`);
        }
      } else {
        P(`  (no cart.services)`);
      }
      const es = await pool.query(`SELECT label, service_id FROM event_services WHERE event_id = $1`, [id]);
      if (!es.rowCount) P(`  (no event_services rows)`);
      for (const row of es.rows) {
        const svc = row.service_id ? (cfg.services.get(row.service_id) as any) : null;
        P(`  item label="${row.label ?? ''}" service_id=${row.service_id ?? '—'} known=${!!svc} cat=${svc?.categoryId ?? '—'} inflatable=${!!svc?.isInflatable}`);
      }
    } catch (err) {
      P(`${id} failed: ${(err as Error).message}`);
    }
  }
  P('DONE');
}
