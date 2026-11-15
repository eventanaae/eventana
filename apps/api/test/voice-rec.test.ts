import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';

describe('voice-rec', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildServer(); });
  afterAll(async () => { await app.close(); });

  it('rejects a wrong key', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/voice-rec?k=wrongwrongwrong' });
    expect(r.statusCode).toBe(403);
    const p = await app.inject({ method: 'POST', url: '/api/voice-rec?k=nope12345&ad=a1', headers: { 'content-type': 'audio/mp4' }, payload: Buffer.alloc(5000) });
    expect(p.statusCode).toBe(403);
  });

  it.skipIf(!process.env.VOICE_KEY_FOR_TEST)('lists takes with the right key and validates uploads', async () => {
    const k = process.env.VOICE_KEY_FOR_TEST as string;
    const r = await app.inject({ method: 'GET', url: `/api/voice-rec?k=${k}` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, takes: {} });
    const bad = await app.inject({ method: 'POST', url: `/api/voice-rec?k=${k}&ad=zz`, headers: { 'content-type': 'audio/mp4' }, payload: Buffer.alloc(5000) });
    expect(bad.statusCode).toBe(400);
    const empty = await app.inject({ method: 'POST', url: `/api/voice-rec?k=${k}&ad=a1`, headers: { 'content-type': 'audio/webm' }, payload: Buffer.alloc(10) });
    expect(empty.json().error).toBe('empty_audio');
    // No Cloudinary creds in tests → storage_failed, but the body parsed.
    const big = await app.inject({ method: 'POST', url: `/api/voice-rec?k=${k}&ad=a1`, headers: { 'content-type': 'audio/mp4' }, payload: Buffer.alloc(3_000_000) });
    expect(big.json().error).toBe('storage_failed');
  });
});
