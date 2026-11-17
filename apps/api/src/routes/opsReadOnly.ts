/**
 * Read-only database window for support checks (owner-approved 17 Nov 2026).
 *
 * The database itself stays closed to the internet; this route lets the
 * support assistant run ONE read-only SQL statement through the API, e.g. to
 * see why a customer's code or booking was refused, without a redeploy.
 *
 * Guards, in depth:
 *  - A private key in `x-eventana-ro-key`; only its SHA-256 lives here.
 *  - One statement only (extended query protocol rejects multi-statements).
 *  - Must start with SELECT / WITH / EXPLAIN / TABLE / SHOW / VALUES.
 *  - Functions that act outside a read (cancel/terminate backends, config,
 *    file/large-object/dblink access, sleeping, advisory locks) are refused.
 *  - Runs inside BEGIN READ ONLY with a 10 s statement timeout, then ROLLBACK,
 *    so even a write that slipped through is refused by Postgres itself.
 *  - At most 500 rows returned; every call is logged (statement text only).
 */
import type { FastifyInstance } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pool } from '../db/pool.js';

const KEY_SHA256 = 'cb35dc74a75fc19d1a5e35338969863b848108b491ec61ef981c044f07fbba79';
const MAX_ROWS = 500;

function keyOk(k: unknown): boolean {
  if (typeof k !== 'string' || k.length < 16 || k.length > 200) return false;
  const a = createHash('sha256').update(k).digest();
  return timingSafeEqual(a, Buffer.from(KEY_SHA256, 'hex'));
}

const STARTS_OK = /^\s*(select|with|explain|table|show|values)\b/i;
const FORBIDDEN =
  /\b(pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|set_config|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_\w+|dblink\w*|pg_sleep\w*|pg_advisory\w*|pg_try_advisory\w*|copy|nextval|setval|pg_switch_wal|pg_create_\w+|pg_drop_\w+|pg_promote|txid_current|pg_notify|into)\b/i;

/** Pure gate so it can be unit-tested without a database. */
export function readOnlyGate(sql: unknown): { ok: true; sql: string } | { ok: false; error: string } {
  if (typeof sql !== 'string' || !sql.trim()) return { ok: false, error: 'sql_required' };
  if (sql.length > 8000) return { ok: false, error: 'sql_too_long' };
  // Strip comments before checking, so a comment can't hide or fake a keyword.
  const bare = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (!STARTS_OK.test(bare)) return { ok: false, error: 'read_only_statements_only' };
  if (FORBIDDEN.test(bare)) return { ok: false, error: 'function_not_allowed' };
  if (/;\s*\S/.test(bare)) return { ok: false, error: 'one_statement_only' };
  return { ok: true, sql: sql.trim().replace(/;\s*$/, '') };
}

export async function opsReadOnlyRoutes(app: FastifyInstance) {
  app.post('/api/ops/ro-query', async (req, reply) => {
    const key = req.headers['x-eventana-ro-key'];
    if (!keyOk(Array.isArray(key) ? key[0] : key)) return reply.code(403).send({ ok: false, error: 'bad_key' });
    const body = (req.body ?? {}) as { sql?: unknown; params?: unknown };
    const gate = readOnlyGate(body.sql);
    if (!gate.ok) return reply.code(400).send({ ok: false, error: gate.error });
    const params = Array.isArray(body.params) ? body.params.slice(0, 20).map((p) => (p == null ? null : String(p))) : [];

    console.log(`[ro-query] ${gate.sql.replace(/\s+/g, ' ').slice(0, 300)}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query(`SET LOCAL statement_timeout = '10s'`);
      await client.query(`SET LOCAL idle_in_transaction_session_timeout = '15s'`);
      const r = await client.query({ text: gate.sql, values: params, queryMode: 'extended' } as never);
      const res = r as unknown as { rows: unknown[]; fields: { name: string }[]; rowCount: number | null };
      return {
        ok: true,
        rowCount: res.rowCount ?? res.rows.length,
        truncated: res.rows.length > MAX_ROWS,
        fields: res.fields.map((f) => f.name),
        rows: res.rows.slice(0, MAX_ROWS),
      };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: 'query_failed', message: (err as Error).message.slice(0, 500) });
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });
}
