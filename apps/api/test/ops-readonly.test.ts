/** The read-only support window refuses anything but one read. */
import { afterAll, describe, expect, it } from 'vitest';
import { closePool } from '../src/db/pool.js';
import { readOnlyGate } from '../src/routes/opsReadOnly.js';

afterAll(async () => {
  await closePool();
});

describe('readOnlyGate', () => {
  it('lets a plain read through', () => {
    expect(readOnlyGate('SELECT code FROM promo_codes WHERE code = $1').ok).toBe(true);
    expect(readOnlyGate('with x as (select 1) select * from x;').ok).toBe(true);
  });
  it('refuses writes, multi-statements and side-effect functions', () => {
    for (const sql of [
      'DELETE FROM promo_codes',
      'UPDATE customers SET name = 1',
      'SELECT 1; DELETE FROM customers',
      'select pg_terminate_backend(1)',
      'select set_config($1, $2, false)',
      'select * into t from customers',
      '/* select */ delete from customers',
      'select pg_sleep(30)',
      'select nextval($1)',
      '',
    ]) expect(readOnlyGate(sql).ok, sql).toBe(false);
  });
});

describe('POST /api/ops/ro-query', () => {
  async function app() {
    const { opsReadOnlyRoutes } = await import('../src/routes/opsReadOnly.js');
    const a = (await import('fastify')).default();
    await a.register(opsReadOnlyRoutes);
    return a;
  }
  it('refuses a request without the key', async () => {
    const res = await (await app()).inject({ method: 'POST', url: '/api/ops/ro-query', payload: { sql: 'select 1' } });
    expect(res.statusCode).toBe(403);
  });
  it('a write that passes the text gate is still refused by the read-only transaction', async () => {
    const { pool } = await import('../src/db/pool.js');
    const c = await pool.connect();
    try {
      await c.query('BEGIN READ ONLY');
      await expect(c.query(`WITH d AS (DELETE FROM promo_codes RETURNING 1) SELECT * FROM d`)).rejects.toThrow(/read-only/);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
