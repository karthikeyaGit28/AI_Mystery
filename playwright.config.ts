import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: [
    {
      command: 'npx concurrently -k "npm run dev -w @amr/api" "npm run dev -w @amr/worker"',
      url: 'http://localhost:4000/api/v1/health',
      timeout: 60000,
      reuseExistingServer: !process.env.CI,
      env: { NODE_ENV: 'test', AI_MODE: 'mock', MAX_NEW_CASES_PER_SESSION_PER_24H: '20' },
    },
    {
      command: 'npm run dev -w @amr/web',
      url: 'http://localhost:5173',
      timeout: 60000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
