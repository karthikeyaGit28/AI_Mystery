import { expect, test, type Page } from '@playwright/test';

type CspViolation = { directive: string; blocked: string };
type SmokeWindow = Window & { __hostingSmokeCsp?: CspViolation[] };
const pageErrors = new WeakMap<Page, string[]>();
const forbiddenRequests = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  const forbidden: string[] = [];
  pageErrors.set(page, errors);
  forbiddenRequests.set(page, forbidden);
  page.on('pageerror', (error) => errors.push(error.message));
  // Guard against accidentally exercising player persistence or a live provider.
  // A request attempt is still a test failure, but cannot reach those services.
  await page.route(/\/api\/v1\/(?:sessions\/guest|cases)(?:[/?]|$)/, async (route) => {
    forbidden.push(route.request().url());
    await route.abort('blockedbyclient');
  });
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    forbidden.push(route.request().url());
    await route.abort('blockedbyclient');
  });
  await page.addInitScript(() => {
    const smoke = window as SmokeWindow;
    smoke.__hostingSmokeCsp = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      // External font availability is optional; system font fallbacks remain usable.
      if (/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//.test(event.blockedURI)) return;
      smoke.__hostingSmokeCsp?.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
      });
    });
  });
});

test.afterEach(async ({ page }) => {
  expect.soft(pageErrors.get(page) ?? [], 'compiled application page errors').toEqual([]);
  expect
    .soft(
      forbiddenRequests.get(page) ?? [],
      'hosting smoke must not start guest, case, or Google requests',
    )
    .toEqual([]);
  if (!page.isClosed()) {
    const violations = await page.evaluate(() => (window as SmokeWindow).__hostingSmokeCsp ?? []);
    expect.soft(violations, 'CSP must allow the bundled application').toEqual([]);
  }
});

test('built home loads its local scripts and opens the interactive create form', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'AI Mystery Room home' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Every story');
  await expect(page.getByText('Demo Mode', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Create a Mystery', exact: true }).click();
  await expect(page).toHaveURL(/\/create$/);
  const premise = page.getByLabel('Your mystery premise', { exact: true });
  await expect(premise).toBeVisible();
  await expect(page.getByRole('radio', { name: /medium/i })).toBeChecked();
  await page.getByRole('radio', { name: /hard/i }).check();
  await expect(page.getByRole('radio', { name: /hard/i })).toBeChecked();
  await page.getByRole('button', { name: 'The missing trophy', exact: true }).click();
  await expect(premise).toHaveValue(/trophy disappears/);
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow, 'core controls fit the viewport').toBe(false);
});

test('compiled form rejects invalid lengths without any persistence request', async ({ page }) => {
  await page.goto('/create');
  const premise = page.getByLabel('Your mystery premise', { exact: true });
  const generate = page.getByRole('button', { name: 'Generate My Case', exact: true });
  for (const invalid of ['', 'x'.repeat(29), 'x'.repeat(1201)]) {
    await premise.fill(invalid);
    await generate.click();
    await expect(
      page.getByText('Use between 30 and 1,200 characters.', { exact: true }),
    ).toBeVisible();
    await expect(premise).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(/\/create$/);
  }
});

test('the live free profile is clearly labeled without presenting it as Demo Mode', async ({
  page,
}) => {
  await page.route('**/api/v1/config', async (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ aiMode: 'gemini', freeTierOnly: true, mediaProvider: 'cloudflare' }),
    }),
  );
  await page.goto('/');
  await expect(page.getByTestId('free-ai-banner')).toBeVisible();
  await expect(page.getByTestId('free-ai-banner')).toContainText('Free AI mode');
  await expect(page.getByText('Demo Mode', { exact: false })).toHaveCount(0);
});

test('same-origin health and unknown API remain JSON under the SPA host', async ({ page }) => {
  await page.goto('/');
  const health = await page.evaluate(async () => {
    const response = await fetch('/api/v1/health');
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      body: await response.json(),
    };
  });
  expect(health.status).toBe(200);
  expect(health.contentType).toContain('application/json');
  expect(health.body).toEqual({ status: 'ok' });
  const missing = await page.request.get('/api/v1/not-a-real-endpoint', {
    headers: { Accept: 'text/html' },
  });
  expect(missing.status()).toBe(404);
  expect(missing.headers()['content-type']).toContain('application/json');
  expect(await missing.json()).toMatchObject({
    error: { code: 'NOT_FOUND', requestId: expect.any(String) },
  });
});

test('a busy AI service explains when to retry without starting a generation', async ({ page }) => {
  let canRetry = true;
  await page.route('**/api/v1/sessions/guest', (route) =>
    route.fulfill({ json: { sessionReady: true } }),
  );
  await page.route('**/api/v1/cases/*/status', (route) =>
    route.fulfill({
      json: {
        status: 'FAILED',
        generationStage: 'GENERATING_BLUEPRINT',
        errorCode: 'PROVIDER_BUSY',
        stageLabel: 'The AI provider is busy. Please wait before retrying.',
        canRetry,
      },
    }),
  );
  await page.goto('/cases/00000000-0000-4000-8000-000000000000/preparing');
  await expect(
    page.getByRole('heading', { name: 'The AI provider is busy right now.', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Your case is saved\. Wait a few minutes before retrying/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry generation', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  canRetry = false;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Retry generation', exact: true })).toHaveCount(0);
  await expect(
    page.getByText(
      'This case has no retries left. Wait for demand to ease before starting a new case.',
    ),
  ).toBeVisible();
});

test('deep links use the built HTML while hashed assets keep immutable caching', async ({
  request,
}) => {
  for (const route of [
    '/create',
    '/history',
    '/cases/00000000-0000-4000-8000-000000000000/investigate',
  ]) {
    const response = await request.get(route, { headers: { Accept: 'text/html' } });
    expect(response.status(), route).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    expect(response.headers()['cache-control']).toBe('no-store');
    const html = await response.text();
    expect(html).toContain('<div id="root"></div>');
    expect(html).not.toContain('/src/main.tsx');
    expect(response.headers()['content-security-policy']).toContain("script-src 'self'");
    expect(response.headers()['x-powered-by']).toBeUndefined();
    const scriptPath = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(scriptPath, 'compiled script reference').toBeTruthy();
    const asset = await request.get(scriptPath!);
    expect(asset.status()).toBe(200);
    expect(asset.headers()['cache-control']).toContain('max-age=31536000');
    expect(asset.headers()['cache-control']).toContain('immutable');
    expect(asset.headers()['content-type']).toMatch(/javascript/);
  }
});

test('private files, worker prompts, development paths, and missing assets are inaccessible', async ({
  request,
}) => {
  const paths = [
    '/.env',
    '/%2eenv',
    '/spec.md',
    '/package.json',
    '/src/App.tsx',
    '/apps/api/src/app.ts',
    '/apps/worker/src/prompts/blueprint.system.md',
    '/@fs/C:/Windows/win.ini',
    '/node_modules/@amr/server/src/config.ts',
    '/assets/missing-file.js',
    '/assets/missing-file.js.map',
  ];
  for (const path of paths) {
    const response = await request.get(path, { headers: { Accept: 'text/html' } });
    expect(response.status(), path).toBe(404);
    expect(response.headers()['content-type'], path).toContain('application/json');
    expect(await response.json(), path).toMatchObject({ error: { code: 'NOT_FOUND' } });
  }
});

test('an unknown browser route renders the compiled application not-found screen', async ({
  page,
}) => {
  await page.goto('/unlisted-mystery-room');
  await expect(
    page.getByRole('heading', { name: 'This trail ends here.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to the room', exact: true })).toBeVisible();
});
