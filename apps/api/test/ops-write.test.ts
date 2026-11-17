/** Full-access support window: dry run by default, copy before change, audit. */
import { afterAll, describe, expect, it } from 'vitest';
import { closePool, pool } from '../src/db/pool.js';
import { beforeImageSql, writeGate } from '../src/routes/opsWrite.js';

afterAll(async () => {
  await closePool();
});

describe('writeGate', () => {
  it('allows reads and row changes', () => {
    expect(writeGate('UPDATE promo_codes SET active = false WHERE code = $1')).toMatchObject({ ok: true, kind: 'update' });
    expect(writeGate('delete from promo_codes where code = $1')).toMatchObject({ ok: true, kind: 'delete' });
    expect(writeGate('insert into promo_codes (code) values ($1)')).toMatchObject({ ok: true, kind: 'insert' });
    expect(writeGate('select 1')).toMatchObject({ ok: true, kind: 'read' });
  });
  it('refuses dropping/emptying tables, roles, settings and multi-statements', () => {
    for (const sql of ['DROP TABLE customers', 'truncate orders', 'grant all on customers to x', 'alter table customers drop column name',
      'create role x', 'select 1; delete from customers', 'select pg_terminate_backend(1)', 'copy customers to program \'x\'']) {
      expect(writeGate(sql).ok, sql).toBe(false);
    }
  });
  it('builds the copy-SELECT for UPDATE and DELETE', () => {
    expect(beforeImageSql('UPDATE promo_codes SET active = false WHERE code = $1')).toMatch(/^SELECT \* FROM promo_codes\s+WHERE code = \$1/);
    expect(beforeImageSql('DELETE FROM promo_codes WHERE code = $1 RETURNING code')).toMatch(/^SELECT \* FROM promo_codes\s+WHERE code = \$1\s*$/);
  });
});

describe('POST /api/ops/rw-query', () => {
  const KEY = process.env.TEST_RW_KEY ?? '';
  async function app() {
    const { opsWriteRoutes } = await import('../src/routes/opsWrite.js');
    const a = (await import('fastify')).default();
    await a.register(opsWriteRoutes);
    return a;
  }
  const call = async (payload: Record<string, unknown>, key = KEY) =>
    (await app()).inject({ method: 'POST', url: '/api/ops/rw-query', headers: { 'x-eventana-rw-key': key }, payload });

  it('refuses a request without the key', async () => {
    expect((await call({ sql: 'select 1' }, 'wrong-key-wrong-key')).statusCode).toBe(403);
  });

  it.skipIf(!KEY)('dry-runs by default, commits only on request, and keeps a copy of the old row', async () => {
    const code = 'QA-RW-' + Date.now();
    await pool.query(`INSERT INTO promo_codes (code, kind, value) VALUES ($1, 'fixed', 100)`, [code]);
    const dry = await call({ sql: 'UPDATE promo_codes SET value = 999 WHERE code = $1', params: [code] });
    expect(dry.json()).toMatchObject({ ok: true, committed: false, dryRun: true, rowCount: 1 });
    expect((await pool.query('SELECT value FROM promo_codes WHERE code = $1', [code])).rows[0].value).toBe(100);

    const done = await call({ sql: 'UPDATE promo_codes SET value = 999 WHERE code = $1', params: [code], commit: true });
    expect(done.json()).toMatchObject({ ok: true, committed: true, beforeRowsSaved: 1 });
    expect((await pool.query('SELECT value FROM promo_codes WHERE code = $1', [code])).rows[0].value).toBe(999);
    const audit = await pool.query(`SELECT before_rows FROM ops_sql_audit WHERE committed AND params->>0 = $1`, [code]);
    expect(audit.rows[0].before_rows[0].value).toBe(100);
    await pool.query('DELETE FROM promo_codes WHERE code = $1', [code]);
  });
});
