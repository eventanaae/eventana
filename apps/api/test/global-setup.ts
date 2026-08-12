/** Rebuilds the test database once before the suite runs. */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/eventana_test';

export async function setup() {
  const { migrate } = await import('../src/db/migrate.js');
  const { seed } = await import('../src/db/seed.js');
  const { closePool } = await import('../src/db/pool.js');
  await migrate({ drop: true });
  await seed();
  await closePool();
}
