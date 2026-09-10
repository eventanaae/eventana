/**
 * READ-ONLY prep diagnostic. Gated by PREP_DEBUG=<receipt number or event id>.
 * Logs exactly the inputs generatePrepTasks reads for that event — the order
 * cart, every event_services line (label + service_id), the package name and
 * custom_theme flag — plus the backdrop/category signals derived from them, so
 * we can see why a template (e.g. design_cricut) did or didn't fire. Writes
 * NOTHING. Turn the flag off after reading.
 */
import { pool } from './pool.js';

/**
 * One-shot: actually (re)generate prep for one event and log the resulting task
 * keys. Gated by PREP_REGEN=<receipt number or event id>. Idempotent (keeps
 * completed work). Proves the design_cricut-on-backdrop fix and surfaces the new
 * task without the owner pressing Re-generate. Turn the flag off after.
 */
export async function prepRegenFromEnv(): Promise<void> {
  const q = String(process.env.PREP_REGEN ?? '').trim();
  if (!q) return;
  const L = (s: string) => console.log(`[prep-regen] ${s}`);
  try {
    const evId = (await pool.query<{ id: string }>(
      `SELECT id FROM events WHERE id = $1
         OR id = (SELECT event_id FROM finance_receipts WHERE number = $1 LIMIT 1) LIMIT 1`,
      [q.replace(/^EV-/i, '')],
    )).rows[0]?.id;
    if (!evId) { L(`no event for "${q}"`); return; }
    const { generatePrepTasks } = await import('../domain/prep.js');
    const r = await generatePrepTasks(evId);
    L(`event=${evId} created=${r?.created ?? 'null'}`);
    const tasks = (await pool.query(
      `SELECT key, title, category, status FROM prep_tasks WHERE event_id = $1 ORDER BY category DESC, key`,
      [evId],
    )).rows;
    L(`tasks now=${tasks.length}`);
    for (const t of tasks) L(`  • ${t.key} | "${t.title}" | ${t.category} | ${t.status}`);
    L('DONE');
  } catch (e) {
    console.error('[prep-regen] failed:', (e as Error).message);
  }
}

export async function prepDebugFromEnv(): Promise<void> {
  const q = String(process.env.PREP_DEBUG ?? '').trim();
  if (!q) return;
  const L = (s: string) => console.log(`[prep-debug] ${s}`);
  try {
    // Resolve the event: by internal id, or by the receipt number behind EV-<n>.
    const ev = (await pool.query(
      `SELECT e.id, to_char(e.event_date,'YYYY-MM-DD') AS date, e.custom_theme, e.package_id,
              p.name AS package_name, o.cart
         FROM events e
         JOIN orders o ON o.id = e.order_id
         LEFT JOIN packages p ON p.id = e.package_id
        WHERE e.id = $1
           OR e.id = (SELECT event_id FROM finance_receipts WHERE number = $1 LIMIT 1)
        LIMIT 1`,
      [q.replace(/^EV-/i, '')],
    )).rows[0];
    if (!ev) { L(`no event for "${q}"`); return; }

    L(`event=${ev.id} date=${ev.date} custom_theme=${ev.custom_theme} package_name=${ev.package_name ?? 'NULL'}`);
    const cart = (ev.cart ?? {}) as any;
    L(`cart.services=${JSON.stringify(cart.services ?? null)}`);
    L(`cart keys=${JSON.stringify(Object.keys(cart))}`);

    const es = (await pool.query(
      `SELECT id, label, service_id FROM event_services WHERE event_id = $1 ORDER BY id`,
      [ev.id],
    )).rows;
    L(`event_services rows=${es.length}`);
    for (const r of es) L(`  • label="${r.label}" service_id=${r.service_id ?? 'NULL'}`);

    // Reproduce the backdrop signal the templates check.
    const labels = es.map((r: any) => String(r.label ?? '').toLowerCase());
    const anyBackdropLabel = labels.some((n: string) => /backdrop/.test(n));
    const svcIds = es.map((r: any) => r.service_id).filter(Boolean);
    L(`derived: anyBackdropLabel=${anyBackdropLabel} service_ids=${JSON.stringify(svcIds)}`);
    L('DONE');
  } catch (e) {
    console.error('[prep-debug] failed:', (e as Error).message);
  }
}
