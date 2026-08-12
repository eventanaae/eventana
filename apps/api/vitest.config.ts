import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // The suite drives one shared Postgres database; running files in
    // parallel would let one test's inventory holds fail another's.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://postgres:postgres@localhost:5432/eventana_test',
      PUBLIC_API_URL: 'http://localhost:4000',
      PUBLIC_APP_URL: 'http://localhost:5173',
      LOG_LEVEL: 'silent',
    },
  },
});
