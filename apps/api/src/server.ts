import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { config, readinessSummary } from './config.js';
import { pool } from './db/pool.js';
import { publicRoutes } from './routes/public.js';
import { eventRoutes } from './routes/events.js';
import { webhookRoutes } from './routes/webhooks.js';
import { adminRoutes } from './routes/admin.js';
import { staffAuthRoutes } from './routes/staffAuth.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.nodeEnv === 'test' ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    // Providers sign the raw bytes; never reserialize before verifying.
    bodyLimit: 1_048_576,
  });

  await app.register(cors, {
    // Spread: `config` is a const assertion, so this is a readonly array.
    origin: [...config.corsOrigins],
    credentials: true,
    // `authorization` carries the signed customer session token — without it
    // every logged-in customer request fails CORS preflight ("Failed to fetch").
    allowedHeaders: ['content-type', 'authorization', 'x-staff-token', 'x-staff-name'],
  });

  /**
   * Webhook bodies arrive as raw text so the signature can be verified
   * over exactly the bytes the provider signed. Everything else parses
   * JSON normally.
   */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request, body: string, done) => {
      if (request.url.startsWith('/api/webhooks/')) {
        done(null, body);
        return;
      }
      try {
        done(null, body ? JSON.parse(body) : {});
      } catch (err) {
        (err as any).statusCode = 400;
        done(err as Error, undefined);
      }
    },
  );

  /**
   * The QuickBooks migration collector POSTs from the qbo.intuit.com page as a
   * "simple" cross-origin request, which forces Content-Type: text/plain (any
   * other type would trigger a CORS preflight the browser can't satisfy there).
   * Accept it as a raw string; the /api/import route JSON-parses it itself.
   */
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_request, body: string, done) => {
    done(null, body);
  });

  /**
   * Health check. Render polls this; it also states plainly whether this
   * deployment can take real money, so nobody has to guess from the URL.
   */
  app.get('/health', async () => {
    let database = 'ok';
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      database = `error: ${(err as Error).message}`;
    }
    return { ok: database === 'ok', database, ...readinessSummary() };
  });

  await app.register(publicRoutes);
  await app.register(staffAuthRoutes);
  await app.register(eventRoutes);
  await app.register(webhookRoutes);
  await app.register(adminRoutes);

  return app;
}
