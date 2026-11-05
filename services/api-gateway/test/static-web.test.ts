import Fastify from 'fastify';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerWebRoutes } from '../src/static-web';

describe('registerWebRoutes', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'ql-web-'));
  const dist = path.join(base, 'dist');
  const app = Fastify();

  beforeAll(async () => {
    mkdirSync(path.join(dist, 'assets'), { recursive: true });
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Quorumloop</title>');
    writeFileSync(path.join(dist, 'assets', 'index-abc.js'), 'console.log(1)');
    writeFileSync(path.join(base, 'secret.txt'), 'outside the build');
    app.setNotFoundHandler((_request, reply) =>
      reply.code(404).send({ error: { code: 'NOT_FOUND' } }),
    );
    app.get('/api/v1/session', async () => ({ ok: true }));
    registerWebRoutes(app, dist);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(base, { recursive: true, force: true });
  });

  it('serves index.html at the root with a strict policy', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('falls back to index.html for client-side routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/projects/0193/activity?x=1' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<title>Quorumloop</title>');
  });

  it('serves hashed assets as immutable', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/index-abc.js' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/javascript');
    expect(response.headers['cache-control']).toContain('immutable');
  });

  it('returns 404 for a missing asset instead of the dashboard', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/missing.js' });
    expect(response.statusCode).toBe(404);
  });

  it('never answers API or health paths, and API routes still win', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/unknown' })).json()).toEqual({
      error: { code: 'NOT_FOUND' },
    });
    expect((await app.inject({ method: 'GET', url: '/health/nope' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/session' })).json()).toEqual({
      ok: true,
    });
  });

  it('refuses path traversal out of the build directory', async () => {
    for (const url of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.body, url).not.toContain('outside the build');
    }
  });
});
