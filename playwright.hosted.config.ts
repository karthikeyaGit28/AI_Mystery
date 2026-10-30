import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-hosted',
  outputDir: 'test-results-hosted',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4187',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'hosted-desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'hosted-mobile',
      use: {
        ...devices['iPhone 13'],
        defaultBrowserType: 'chromium',
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: {
    command: 'node --import tsx scripts/preview-built.ts',
    url: 'http://127.0.0.1:4187/api/v1/health',
    timeout: 30_000,
    reuseExistingServer: false,
  },
});
