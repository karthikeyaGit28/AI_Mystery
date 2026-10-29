import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('development source isolation protects worker prompts and server modules', async ({
  page,
}) => {
  await page.goto('/create');
  await expect(page.getByLabel('Your mystery premise')).toBeVisible();
  const directory = process.cwd().replaceAll('\\', '/');
  for (const source of [
    'apps/worker/src/prompts/blueprint.system.md',
    'node_modules/@amr/worker/src/prompts/blueprint.system.md',
    'packages/server/src/models.ts',
    'node_modules/@amr/server/src/config.ts',
  ]) {
    const response = await page.request.get(`/@fs/${directory}/${source}`);
    expect([403, 404]).toContain(response.status());
  }
});

const API = 'http://localhost:4000/api/v1';
const origin = { Origin: 'http://localhost:5173' };
const forbidden = new Set([
  'culpritSuspectId',
  'solution',
  'canonicalFacts',
  'hintTexts',
  'supportingEvidenceIds',
  'verdictExplanation',
  'suspectEliminationReasons',
  'redHerringExplanations',
  'evidenceFactMap',
  'factIds',
  'renderBrief',
]);
function noSecrets(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    expect(forbidden.has(key), `Private key leaked: ${key}`).toBe(false);
    noSecrets(entry);
  }
}
async function openEvidence(page: Page, id: string, mobile: boolean) {
  if (mobile) {
    const back = page.getByRole('button', { name: 'Evidence locker', exact: true });
    if (await back.isVisible()) await back.click();
    await page.getByRole('tab', { name: 'Evidence', exact: true }).click();
  }
  await page.getByTestId(`evidence-${id}`).click();
}

test('a player creates, inspects, resumes and solves a complete case', async ({
  page,
  browser,
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile';
  await page.goto('/');
  await expect(page.getByText('Demo Mode', { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: `.runtime/home-${testInfo.project.name}.png`, fullPage: true });
  await page.goto('/create');
  await page.getByRole('button', { name: 'Generate My Case' }).click();
  await expect(page.getByText('Use between 30 and 1,200 characters.')).toBeVisible();
  await page
    .getByLabel('Your mystery premise')
    .fill(
      'At a fictional university festival, a trophy disappears from a locked backstage room minutes before the awards. Four organizers had access.',
    );
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact || '')),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Generate My Case' }).click();
  await page.waitForURL(/\/cases\/[^/]+\/investigate/, { timeout: 150_000 });
  const id = page.url().split('/cases/')[1].split('/')[0];
  const publicResponse = await page.request.get(`${API}/cases/${id}`);
  expect(publicResponse.status()).toBe(200);
  const dossier = await publicResponse.json();
  await expect(page.getByRole('heading', { name: dossier.title, exact: true })).toBeVisible();
  await page.screenshot({ path: `.runtime/room-${testInfo.project.name}.png`, fullPage: true });
  expect(dossier.suspects).toHaveLength(4);
  expect(dossier.evidence).toHaveLength(8);
  expect(dossier.evidence.map((e: { type: string }) => e.type).sort()).toEqual(
    ['CHAT', 'CHAT', 'CCTV', 'DOCUMENT', 'DOCUMENT', 'DOCUMENT', 'PHOTO', 'PHOTO'].sort(),
  );
  noSecrets(dossier);
  expect((await page.request.get(`${API}/cases/${id}/result`)).status()).toBe(403);

  const other = await browser.newContext();
  await other.request.post(`${API}/sessions/guest`, { headers: origin });
  expect((await other.request.get(`${API}/cases/${id}`)).status()).toBe(404);
  for (const suffix of [
    '/status',
    '/evidence/EV-01',
    '/result',
    `/assets/${dossier.evidence.find((e: { type: string }) => e.type === 'PHOTO').payload.assetId}/access`,
  ])
    expect((await other.request.get(`${API}/cases/${id}${suffix}`)).status()).toBe(404);
  await other.close();

  for (const evidence of dossier.evidence) {
    await openEvidence(page, evidence.id, mobile);
    if (evidence.type === 'PHOTO') {
      const photo = page.locator('.viewer-panel img').first();
      await expect(photo).toBeVisible();
      await expect
        .poll(() => photo.evaluate((element: HTMLImageElement) => element.naturalWidth))
        .toBeGreaterThan(0);
    }
    if (evidence.type === 'CCTV') {
      const video = page.locator('video');
      await expect(video).toBeVisible();
      await expect
        .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
        .toBeGreaterThanOrEqual(1);
      await video.evaluate((element: HTMLVideoElement) => element.play());
      await expect
        .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
        .toBeGreaterThan(0);
    }
  }
  await openEvidence(page, 'EV-01', mobile);
  await page.getByTestId('mark-reviewed').click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${API}/cases/${id}`)).json()).progress.reviewedEvidenceIds,
    )
    .toContain('EV-01');
  await page.getByTestId('bookmark-evidence').click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${API}/cases/${id}`)).json()).progress
          .bookmarkedEvidenceIds,
    )
    .toContain('EV-01');
  await page.reload();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${API}/cases/${id}`)).json()).progress.reviewedEvidenceIds,
    )
    .toContain('EV-01');
  const accusation = page.getByRole('button', { name: 'Accuse a Suspect', exact: true });
  await accusation.filter({ visible: true }).first().click();
  await page.locator('input[name="accused-suspect"][value="S-03"]').check();
  const dialog = page.getByRole('dialog');
  const dialogAccessibility = await new AxeBuilder({ page }).include('dialog').analyze();
  expect(
    dialogAccessibility.violations.filter((item) =>
      ['critical', 'serious'].includes(item.impact || ''),
    ),
  ).toEqual([]);
  await dialog.getByLabel(/EV-01/).check();
  await dialog.getByLabel(/EV-07/).check();
  await page.getByRole('button', { name: 'Review accusation' }).click();
  await page.getByTestId('submit-accusation').click();
  await page.waitForURL(/\/result/);
  const result = await (await page.request.get(`${API}/cases/${id}/result`)).json();
  await page.screenshot({ path: `.runtime/result-${testInfo.project.name}.png`, fullPage: true });
  expect(result.score).toBe(100);
  expect(result.isCorrect).toBe(true);
  expect(result.culpritSuspectId).toBe('S-03');
  await expect(page.getByText('100/100', { exact: true })).toBeVisible();
  const repeated = await page.request.post(`${API}/cases/${id}/solve`, {
    headers: { ...origin, 'Idempotency-Key': crypto.randomUUID() },
    data: { suspectId: 'S-02', evidenceIds: [] },
  });
  expect(repeated.status()).toBe(409);
  expect((await page.request.delete(`${API}/cases/${id}`, { headers: origin })).status()).toBe(202);
  expect((await page.request.get(`${API}/cases/${id}`)).status()).toBe(404);
});

test('ordered hints are idempotent, bounded, and affect a fixed verdict', async ({ request }) => {
  await request.post(`${API}/sessions/guest`, { headers: origin });
  const create = await request.post(`${API}/cases`, {
    headers: { ...origin, 'Idempotency-Key': crypto.randomUUID() },
    data: {
      premise:
        'At a fictional science exhibition, a prototype is sabotaged while four adult researchers prepare the demonstration.',
      difficulty: 'hard',
    },
  });
  expect(create.status()).toBe(202);
  const { caseId } = await create.json();
  await expect
    .poll(async () => (await (await request.get(`${API}/cases/${caseId}/status`)).json()).status, {
      timeout: 150_000,
    })
    .toBe('READY');
  const hintKey = crypto.randomUUID();
  const hint = () =>
    request.post(`${API}/cases/${caseId}/hints`, {
      headers: { ...origin, 'Idempotency-Key': hintKey },
      data: {},
    });
  expect((await (await hint()).json()).hintNumber).toBe(1);
  expect((await (await hint()).json()).hintNumber).toBe(1);
  const solve = await request.post(`${API}/cases/${caseId}/solve`, {
    headers: { ...origin, 'Idempotency-Key': crypto.randomUUID() },
    data: { suspectId: 'S-03', evidenceIds: [] },
  });
  expect(solve.status()).toBe(201);
  expect((await solve.json()).score).toBe(75);
  await request.delete(`${API}/cases/${caseId}`, { headers: origin });

  const another = await request.post(`${API}/cases`, {
    headers: { ...origin, 'Idempotency-Key': crypto.randomUUID() },
    data: {
      premise:
        'At a fictional theatre, the lead performer disappears before the final act, leaving four adult crew members with conflicting accounts.',
      difficulty: 'medium',
    },
  });
  expect(another.status()).toBe(202);
  const nextId = (await another.json()).caseId;
  await expect
    .poll(async () => (await (await request.get(`${API}/cases/${nextId}/status`)).json()).status, {
      timeout: 150_000,
    })
    .toBe('READY');
  const texts = [];
  for (let number = 1; number <= 3; number++) {
    const response = await request.post(`${API}/cases/${nextId}/hints`, {
      headers: { ...origin, 'Idempotency-Key': crypto.randomUUID() },
      data: {},
    });
    const value = await response.json();
    expect(value.hintNumber).toBe(number);
    texts.push(value.text);
  }
  expect(new Set(texts).size).toBe(3);
  expect(
    (
      await request.post(`${API}/cases/${nextId}/hints`, {
        headers: { ...origin, 'Idempotency-Key': crypto.randomUUID() },
        data: {},
      })
    ).status(),
  ).toBe(409);
  const wrong = await request.post(`${API}/cases/${nextId}/solve`, {
    headers: { ...origin, 'Idempotency-Key': crypto.randomUUID() },
    data: { suspectId: 'S-01', evidenceIds: ['EV-01'] },
  });
  expect(wrong.status()).toBe(201);
  expect((await wrong.json()).score).toBe(0);
  await request.delete(`${API}/cases/${nextId}`, { headers: origin });
});
