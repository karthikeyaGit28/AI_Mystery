import { describe, expect, it } from 'vitest';
import { isAbsolute, join } from 'node:path';
import { parseEnvironment } from '../../../packages/server/src/config.js';

const production = {
  NODE_ENV: 'production',
  AI_MODE: 'gemini',
  GEMINI_API_KEY: 'test-only-no-network',
  SESSION_SECRET: 'unique-production-test-secret-at-least-32-characters',
};

describe('production environment', () => {
  it('derives the public Render origin without needing the assigned URL at build time', () => {
    const result = parseEnvironment({
      ...production,
      RENDER_EXTERNAL_URL: 'https://mystery.example.onrender.com/',
      SERVE_WEB: 'true',
      TRUST_PROXY_HOPS: '1',
    });
    expect(result.WEB_ORIGIN).toBe('https://mystery.example.onrender.com');
    expect(result.API_BASE_URL).toBe(result.WEB_ORIGIN);
    expect(result.SERVE_WEB).toBe(true);
    expect(result.TRUST_PROXY_HOPS).toBe(1);
    expect(result.HOST).toBe('0.0.0.0');
  });
  it('prefers an explicit custom domain and supports worker origin inheritance', () => {
    const custom = parseEnvironment({
      ...production,
      WEB_ORIGIN: 'https://mystery.example.com/',
      RENDER_EXTERNAL_URL: 'https://assigned.onrender.com',
      SERVE_WEB: 'true',
    });
    expect(custom.WEB_ORIGIN).toBe('https://mystery.example.com');
    expect(custom.API_BASE_URL).toBe(custom.WEB_ORIGIN);
    expect(
      parseEnvironment({ ...production, WEB_ORIGIN: 'https://assigned.onrender.com' }).API_BASE_URL,
    ).toBe('https://assigned.onrender.com');
  });
  it('requires public HTTPS origins and a consistent origin when serving the frontend', () => {
    expect(() => parseEnvironment(production)).toThrow(/public WEB_ORIGIN/);
    expect(() => parseEnvironment({ ...production, WEB_ORIGIN: 'http://example.com' })).toThrow(
      /HTTPS/,
    );
    expect(() =>
      parseEnvironment({
        ...production,
        WEB_ORIGIN: 'https://app.example.com',
        API_BASE_URL: 'https://api.example.com',
        SERVE_WEB: 'true',
      }),
    ).toThrow(/same public origin/);
  });
  it.each([
    'https://example.com/api/v1',
    'https://example.com?key=value',
    'https://user:password@example.com',
    'https://example.com/#fragment',
  ])('rejects an origin with a path, query, credentials, or fragment: %s', (url) => {
    expect(() => parseEnvironment({ ...production, WEB_ORIGIN: url })).toThrow();
  });
  it('keeps local defaults and makes build paths independent of workspace cwd', () => {
    const result = parseEnvironment({
      NODE_ENV: 'test',
      RENDER_EXTERNAL_URL: 'https://unused.onrender.com',
    });
    expect(result.WEB_ORIGIN).toBe('http://localhost:5173');
    expect(result.API_BASE_URL).toBe('http://localhost:4000');
    expect(result.SERVE_WEB).toBe(false);
    expect(result.TRUST_PROXY_HOPS).toBe(0);
    expect(isAbsolute(result.WEB_DIST_PATH)).toBe(true);
    expect(result.WEB_DIST_PATH.endsWith(join('apps', 'web', 'dist'))).toBe(true);
  });
  it.each(['-1', '6', 'true', '1.5'])('rejects unsafe TRUST_PROXY_HOPS=%s', (value) => {
    expect(() => parseEnvironment({ NODE_ENV: 'test', TRUST_PROXY_HOPS: value })).toThrow();
  });
});

describe('free-tier-only generation configuration', () => {
  const freeLive = {
    ...production,
    WEB_ORIGIN: 'https://mystery.example.onrender.com',
    FREE_TIER_ONLY: 'true',
    MEDIA_PROVIDER: 'cloudflare',
    CLOUDFLARE_ACCOUNT_ID: 'test-account',
    CLOUDFLARE_API_TOKEN: 'test-token-never-sent',
  };
  it('preserves standard defaults outside the free profile', () => {
    const result = parseEnvironment({ NODE_ENV: 'test' });
    expect(result.FREE_TIER_ONLY).toBe(false);
    expect(result.MEDIA_PROVIDER).toBe('gemini');
    expect(result.GEMINI_TEXT_MIN_INTERVAL_MS).toBe(0);
    expect(result.WORKER_DRAIN_DELAY_SECONDS).toBe(5);
    expect(result.WORKER_STALLED_INTERVAL_MS).toBe(30000);
    expect(result.MAX_MEDIA_BYTES).toBe(50 * 1024 * 1024);
  });
  it('uses real free providers with slower queue polling and a smaller media cap', () => {
    const result = parseEnvironment(freeLive);
    expect(result.FREE_TIER_ONLY).toBe(true);
    expect(result.AI_MODE).toBe('gemini');
    expect(result.MEDIA_PROVIDER).toBe('cloudflare');
    expect(result.CLOUDFLARE_IMAGE_MODEL).toBe('@cf/black-forest-labs/flux-1-schnell');
    expect(result.GEMINI_TEXT_MODEL).toBe('gemini-3.8-flash');
    expect(result.GEMINI_TEXT_MIN_INTERVAL_MS).toBe(15000);
    expect(result.WORKER_DRAIN_DELAY_SECONDS).toBe(60);
    expect(result.WORKER_STALLED_INTERVAL_MS).toBe(120000);
    expect(result.WORKER_CONCURRENCY).toBe(1);
    expect(result.MAX_MEDIA_BYTES).toBe(20 * 1024 * 1024);
  });
  it('honors explicit conservative timing and lower media limits', () => {
    const result = parseEnvironment({
      ...freeLive,
      GEMINI_TEXT_MIN_INTERVAL_MS: '20000',
      WORKER_DRAIN_DELAY_SECONDS: '120',
      WORKER_STALLED_INTERVAL_MS: '180000',
      MAX_MEDIA_BYTES: String(10 * 1024 * 1024),
    });
    expect(result.GEMINI_TEXT_MIN_INTERVAL_MS).toBe(20000);
    expect(result.WORKER_DRAIN_DELAY_SECONDS).toBe(120);
    expect(result.WORKER_STALLED_INTERVAL_MS).toBe(180000);
    expect(result.MAX_MEDIA_BYTES).toBe(10 * 1024 * 1024);
  });
  it.each(['gemini-3.8-flash', 'gemini-3.6-flash'])(
    'accepts the explicitly selected verified free text model %s',
    (model) => {
      expect(parseEnvironment({ ...freeLive, GEMINI_TEXT_MODEL: model }).GEMINI_TEXT_MODEL).toBe(
        model,
      );
    },
  );
  it.each([
    { MEDIA_PROVIDER: 'gemini' },
    { GEMINI_TEXT_MODEL: 'gemini-pro-paid' },
    { GEMINI_TEXT_MODEL: 'gemini-3.9-flash' },
    { GEMINI_TEXT_MODEL: 'gemini-3.6-flash-preview' },
    { CLOUDFLARE_IMAGE_MODEL: '@cf/paid-image-model' },
    { WORKER_CONCURRENCY: '2' },
    { MAX_MEDIA_BYTES: String(20 * 1024 * 1024 + 1) },
  ])('fails closed on paid model choices or unsafe free-profile limits: %j', (override) => {
    expect(() => parseEnvironment({ ...freeLive, ...override })).toThrow(/FREE_TIER_ONLY/);
  });
  it.each(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'])(
    'requires %s for real free generation',
    (name) => {
      expect(() => parseEnvironment({ ...freeLive, [name]: '' })).toThrow(
        /CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN/,
      );
    },
  );
  it('still allows credential-free local mock tests with the free profile', () => {
    const result = parseEnvironment({
      NODE_ENV: 'test',
      AI_MODE: 'mock',
      FREE_TIER_ONLY: 'true',
      MEDIA_PROVIDER: 'cloudflare',
    });
    expect(result.AI_MODE).toBe('mock');
    expect(result.CLOUDFLARE_API_TOKEN).toBe('');
    expect(() => parseEnvironment({ ...freeLive, AI_MODE: 'mock' })).toThrow(
      /Production requires Gemini/,
    );
  });
});
