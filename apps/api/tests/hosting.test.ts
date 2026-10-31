import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '@amr/server';
import { createApp } from '../src/app.js';
import { configureProxyTrust } from '../src/hosting.js';

const directory = mkdtempSync(join(tmpdir(), 'amr-hosting-'));
const webDist = join(directory, 'web');
const outside = join(directory, 'private');
mkdirSync(join(webDist, 'assets'), { recursive: true });
mkdirSync(outside);
writeFileSync(
  join(webDist, 'index.html'),
  '<!doctype html><html><title>Production app fixture</title><body><div id="root"></div></body></html>',
);
writeFileSync(join(webDist, 'assets', 'app-abcdefgh.js'), 'console.log("public fixture");');
writeFileSync(join(webDist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
writeFileSync(join(webDist, '.env'), 'SECRET=private-fixture');
writeFileSync(join(webDist, 'spec.md'), 'private source fixture');
writeFileSync(join(outside, 'private.js'), 'private source outside build root');
symlinkSync(outside, join(webDist, 'assets', 'outside'), 'junction');
const app = createApp({ serveWeb: true, webDistPath: webDist, trustProxyHops: 0 });
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('same-origin production web hosting', () => {
  it('reports a public release hash without reflecting other environment values', async () => {
    const previous = process.env.RENDER_GIT_COMMIT;
    try {
      process.env.RENDER_GIT_COMMIT = 'a'.repeat(40);
      const released = await request(app).get('/api/v1/health');
      expect(released.headers['x-app-revision']).toBe('a'.repeat(40));
      expect(released.body).toEqual({ status: 'ok' });
      process.env.RENDER_GIT_COMMIT = 'private-configuration-fixture';
      const invalid = await request(app).get('/api/v1/health');
      expect(invalid.headers).not.toHaveProperty('x-app-revision');
      expect(invalid.body).toEqual({ status: 'ok' });
    } finally {
      if (previous === undefined) delete process.env.RENDER_GIT_COMMIT;
      else process.env.RENDER_GIT_COMMIT = previous;
    }
  });
  it.each(['/', '/create', '/history', '/cases/example/investigate'])(
    'serves the HTML app on a direct GET to %s',
    async (path) => {
      const response = await request(app).get(path).set('Accept', 'text/html');
      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');
      expect(response.text).toContain('Production app fixture');
      expect(response.headers['cache-control']).toBe('no-store');
    },
  );
  it('keeps API misses and unsupported SPA methods out of the HTML fallback', async () => {
    for (const path of ['/api/v1/unknown', '/api/v2/unknown']) {
      const response = await request(app).get(path).set('Accept', 'text/html');
      expect(response.status).toBe(404);
      expect(response.type).toBe('application/json');
      expect(response.body.error.code).toBe('NOT_FOUND');
    }
    expect((await request(app).get('/history').set('Accept', 'application/json')).status).toBe(404);
    expect((await request(app).head('/history').set('Accept', 'text/html')).status).toBe(404);
    expect(
      (
        await request(app)
          .post('/history')
          .set('Origin', config.WEB_ORIGIN)
          .set('Accept', 'text/html')
      ).status,
    ).toBe(404);
  });
  it('caches fingerprinted assets and preserves sensible public-file caching', async () => {
    const asset = await request(app).get('/assets/app-abcdefgh.js');
    expect(asset.status).toBe(200);
    expect(asset.type).toMatch(/javascript/);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await request(app).get('/favicon.svg')).headers['cache-control']).toBe(
      'public, max-age=3600',
    );
    expect((await request(app).get('/index.html')).headers['cache-control']).toBe('no-store');
  });
  it.each([
    '/.env',
    '/spec.md',
    '/assets/missing.js',
    '/assets/outside/private.js',
    '/assets/%2e%2e/%2e%2e/private.js',
  ])('does not expose private source or escape the build directory through %s', async (path) => {
    const response = await request(app).get(path).set('Accept', 'text/html');
    expect(response.status).toBe(404);
    expect(response.text).not.toContain('private source');
    expect(response.text).not.toContain('private-fixture');
  });
  it('uses a CSP that supports the actual app without inline scripts or external connections', async () => {
    const response = await request(app).get('/').set('Accept', 'text/html');
    const csp = response.headers['content-security-policy'];
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("media-src 'self'");
    expect(csp).toContain('https://fonts.googleapis.com');
    expect(csp).toContain('https://fonts.gstatic.com');
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
  it('fails startup clearly when the frontend has not been built', () => {
    expect(() => createApp({ serveWeb: true, webDistPath: join(directory, 'missing') })).toThrow(
      /built frontend/,
    );
  });
});

describe('bounded reverse proxy trust', () => {
  function probe(hops: number) {
    const instance = express();
    configureProxyTrust(instance, hops);
    instance.get('/', (req, res) => res.json({ ip: req.ip, secure: req.secure }));
    return instance;
  }
  it('ignores spoofed forwarding headers when proxy trust is disabled', async () => {
    const response = await request(probe(0))
      .get('/')
      .set('X-Forwarded-For', '198.51.100.66')
      .set('X-Forwarded-Proto', 'https');
    expect(response.body.ip).not.toBe('198.51.100.66');
    expect(response.body.secure).toBe(false);
  });
  it('trusts only the configured nearest hop and ignores attacker entries farther left', async () => {
    const response = await request(probe(1))
      .get('/')
      .set('X-Forwarded-For', '198.51.100.66, 203.0.113.9')
      .set('X-Forwarded-Proto', 'https');
    expect(response.body.ip).toBe('203.0.113.9');
    expect(response.body.secure).toBe(true);
  });
  it.each([-1, 1.5, 6, NaN])('rejects unbounded or invalid trust settings %s', (hops) =>
    expect(() => probe(hops)).toThrow(),
  );
});
