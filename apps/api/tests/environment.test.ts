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
