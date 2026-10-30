import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/tests/**/*.test.ts', 'packages/**/tests/**/*.test.ts'],
    environment: 'node',
    env: {
      AI_MODE: 'mock',
      FREE_TIER_ONLY: 'false',
      MEDIA_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'unit-test-offline-no-billing',
      GEMINI_TEXT_MODEL: 'gemini-3.8-flash',
      GEMINI_TEXT_MIN_INTERVAL_MS: '0',
      WEB_ORIGIN: 'http://localhost:5173',
      API_BASE_URL: 'http://localhost:4000',
      SERVE_WEB: 'false',
      TRUST_PROXY_HOPS: '0',
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    maxWorkers: 2,
  },
});
