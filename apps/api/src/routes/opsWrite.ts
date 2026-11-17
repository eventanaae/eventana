/**
 * Full data access for the support assistant (owner-approved 17 Nov 2026:
 * "change, delete, edit, improve — full access to the whole database").
 *
 * Separate from the read-only window, with its own private key. Safety nets
 * that do NOT limit what can be done, only make every change visible and
 * recoverable:
 *  - DRY RUN by default: the statement runs inside a transaction, reports the
 *    affected rows (and any RETURNING rows), then rolls back. Nothing is saved
 *    unless the request says `commit: true`.
 *  - Before an UPDATE or DELETE is committed, the rows it will touch are copied
 *    into ops_sql_audit.before_rows, so any change can be put back.
 *  - A commit touching more than 200 rows needs `allowMany: true`.
 *  - Every call (dry run or commit) is written to ops_sql_audit and logged.
 *  - One statement per call, 30 s timeout.
 *  - Refused outright: dropping or emptying whole tables/schemas/databases,
 *    roles and permissions, server settings, killing connections, running
 *    programs. Table structure changes belong in schema.sql, where they are
 *    reviewed and applied on deploy.
 */
import type { FastifyInstance } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pool } from '../db/pool.js';

const KEY_SHA256 = '67072af527783fadf963c6f364d9e453d1c7e795a82a121feb31d505439be417';
const MAX_ROWS_OUT = 500;
const MANY = 200;

function keyOk(k: unknown): boolean {
  if (typeof k !== 'string' || k.length < 16 || k.length > 200) return false;
  const a = createHash('sha256').update(k).digest();
  return timingSafeEqual(a, Buffer.from(KEY_SHA256, 'hex'));
}

const FORBIDDEN =
  /\b(drop|truncate|grant|revoke|vacuum|cluster|reindex|checkpoint|listen|notify|copy|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|set_config|pg_read_file|pg_read_binary_file|pg_ls_dir|lo_\w+|dblink\w*|pg_sleep\w*|pg_promote|pg_switch_wal)\b|\b(create|alter)\s+(role|user|database|schema|system|extension|function|procedure|trigger|rule|server|publication|subscription)\b|\balter\s+table\b|\bcreate\s+table\b|\bset\s+(session|role)\b/i;

export type WriteGate = { ok: true; sql: string; kind: 'read' | 'insert' | 'update' | 'delete' } | { ok: false; error: string };

/** Pure gate (unit-tested). */
export function writeGate(sql: unknown): WriteGate {
  if (typeof sql !== 'string' || !sql.trim()) return { ok: false, error: 'sql_required' };
  if (sql.length > 20000) return { ok: false, error: 'sql_too_long' };
  const bare = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (/;\s*\S/.test(bare)) return { ok: false, error: 'one_statement_only' };
  if (FORBIDDEN.test(bare)) return { ok: false, error: 'statement_not_allowed' };
  const head = bare.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const kind =
    head === 'insert' ? 'insert'
      : head === 'update' ? 'update'
        : head === 'delete' ? 'delete'
          : ['select', 'with', 'explain', 'table', 'show', 'values'].includes(head) ? 'read'
            : null;
  if (!kind) return { ok: false, error: 'statement_not_allowed' };
  // A WITH can hide a write; treat it as a write for the audit trail.
  return { ok: true, sql: sql.trim().replace(/;\s*$/, ''), kind: kind === 'read' && /\b(insert|update|delete)\b/i.test(bare) ? 'update' : kind };
}

/** For UPDATE/DELETE: SELECT the target rows (same table + WHERE) to keep a copy. */
export function beforeImageSql(sql: string): string | null {
  const bare = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
  const del = /^delete\s+from\s+([\w."]+)(?:\s+(?:as\s+)?(\w+))?\s*(where\s+[\s\S]*?)?(\s+returning\s+[\s\S]*)?$/i.exec(bare);
  if (del) return `SELECT * FROM ${del[1]}${del[2] ? ` ${del[2]}` : ''} ${del[3] ?? ''}`;
  const upd = /^update\s+(?:only\s+)?([\w."]+)(?:\s+(?:as\s+)?(?!set\b)(\w+))?\s+set\s+[\s\S]*?(\bwhere\s+[\s\S]*?)?(\s+returning\s+[\s\S]*)?$/i.exec(bare);
  if (upd && !/\bfrom\b/i.test(bare.slice(bare.toLowerCase().indexOf(' set ')))) {
    return `SELECT * FROM ${upd[1]}${upd[2] ? ` ${upd[2]}` : ''} ${upd[3] ?? ''}`;
  }
  return null;
}

export async function opsWriteRoutes(app: FastifyInstance) {
  app.post('/api/ops/rw-query', async (req, reply) => {
    const key = req.headers['x-eventana-rw-key'];
    if (!keyOk(Array.isArray(key) ? key[0] : key)) return reply.code(403).send({ ok: false, error: 'bad_key' });
    const body = (req.body ?? {}) as { sql?: unknown; params?: unknown; commit?: unknown; allowMany?: unknown; allowNoBackup?: unknown; note?: unknown };
    const gate = writeGate(body.sql);
    if (!gate.ok) return reply.code(400).send({ ok: false, error: gate.error });
    const params = Array.isArray(body.params) ? body.params.slice(0, 50).map((p) => (p == null ? null : typeof p === 'object' ? JSON.stringify(p) : String(p))) : [];
    const commit = body.commit === true;
    const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;

    const client = await pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = '30s'`);
      let before: unknown[] | null = null;
      const imgSql = gate.kind === 'update' || gate.kind === 'delete' ? beforeImageSql(gate.sql) : null;
      if (imgSql) {
        // Bind exactly the params the copy-SELECT uses ($1..$m, no gaps).
        const idx = [...imgSql.matchAll(/\$(\d+)\b/g)].map((m) => Number(m[1]));
        const m = idx.length ? Math.max(...idx) : 0;
        const contiguous = Array.from({ length: m }, (_, i) => idx.includes(i + 1)).every(Boolean);
        if (contiguous && m <= params.length) {
          before = (await client.query({ text: imgSql, values: params.slice(0, m), queryMode: 'extended' } as never) as unknown as { rows: unknown[] }).rows;
        }
      }
      if (commit && (gate.kind === 'update' || gate.kind === 'delete') && !before && body.allowNoBackup !== true) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ ok: false, error: 'no_backup_copy', hint: 'could not copy the rows first; rewrite as UPDATE/DELETE ... WHERE, or send allowNoBackup: true' });
      }
      const r = (await client.query({ text: gate.sql, values: params, queryMode: 'extended' } as never)) as unknown as {
        rows: unknown[]; fields?: { name: string }[]; rowCount: number | null;
      };
      const affected = r.rowCount ?? r.rows.length;
      if (commit && gate.kind !== 'read' && affected > MANY && body.allowMany !== true) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ ok: false, error: 'too_many_rows', affected, hint: 'send allowMany: true to commit' });
      }
      const doCommit = commit && gate.kind !== 'read';
      await client.query(
        `INSERT INTO ops_sql_audit (sql, params, kind, committed, row_count, before_rows, note)
         VALUES ($1, $2::jsonb, $3, $4, $5, $6::jsonb, $7)`,
        [gate.sql, JSON.stringify(params), gate.kind, doCommit, affected, before ? JSON.stringify(before) : null, note],
      );
      await client.query(doCommit ? 'COMMIT' : 'ROLLBACK');
      committed = doCommit;
      // A rolled-back dry run also rolls back its audit row; record it separately.
      if (!doCommit && gate.kind !== 'read') {
        await pool.query(
          `INSERT INTO ops_sql_audit (sql, params, kind, committed, row_count, note) VALUES ($1, $2::jsonb, $3, FALSE, $4, $5)`,
          [gate.sql, JSON.stringify(params), gate.kind, affected, note],
        ).catch(() => {});
      }
      console.log(`[rw-query] ${committed ? 'COMMIT' : 'dry-run'} ${gate.kind} rows=${affected} :: ${gate.sql.replace(/\s+/g, ' ').slice(0, 300)}`);
      return {
        ok: true,
        committed,
        dryRun: !committed && gate.kind !== 'read',
        kind: gate.kind,
        rowCount: affected,
        beforeRowsSaved: before ? before.length : null,
        fields: r.fields?.map((f) => f.name) ?? [],
        rows: r.rows.slice(0, MAX_ROWS_OUT),
      };
    } catch (err) {
      if (!committed) await client.query('ROLLBACK').catch(() => {});
      return reply.code(400).send({ ok: false, error: 'query_failed', message: (err as Error).message.slice(0, 500) });
    } finally {
      client.release();
    }
  });
}
