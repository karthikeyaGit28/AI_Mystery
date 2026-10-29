import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from '@amr/server';
import { publicReviewInput, validateBlueprint } from './ai/contracts.js';
import { GeminiAIProvider } from './ai/gemini.js';
import { MediaPipeline, normalizedPhoto } from './media/pipeline.js';
import { renderTextEvidence } from './pipeline/generate.js';

if (config.AI_MODE !== 'gemini')
  throw new Error(
    'Provider checks require AI_MODE=gemini and a valid GEMINI_API_KEY. Demo mode is not a live capability check.',
  );
const provider = new GeminiAIProvider();
await provider.checkCapability();
console.log('Gemini text and Interactions API capability verified.');
if (process.argv.includes('--full')) {
  const blueprint = validateBlueprint(
    await provider.generateBlueprint({
      premise:
        'At a fictional mountain observatory, a telescope calibration module vanishes from the locked control room before an important demonstration.',
      difficulty: 'medium',
    }),
  );
  const review = await provider.reviewSolvability(publicReviewInput(blueprint));
  if (
    review.verdict !== 'ACCEPT' ||
    review.ambiguous ||
    review.suspectId !== blueprint.culpritSuspectId
  )
    throw new Error('Live mystery failed the blind solver check.');
  const textEvidence = await renderTextEvidence(provider, blueprint);
  const directory = resolve(process.cwd(), '.artifacts/provider-smoke');
  await mkdir(directory, { recursive: true });
  for (const plan of blueprint.evidencePlans.filter((p) => p.type === 'PHOTO')) {
    const image = await normalizedPhoto(await provider.generatePhoto({ blueprint, plan }));
    await writeFile(resolve(directory, `${plan.id}.webp`), image.data);
  }
  const cctv = await new MediaPipeline(provider).createCctv({
    blueprint,
    plan: blueprint.evidencePlans.find((p) => p.type === 'CCTV')!,
  });
  await writeFile(resolve(directory, 'cctv.mp4'), cctv.data);
  await writeFile(resolve(directory, 'cctv-poster.webp'), cctv.poster);
  await writeFile(
    resolve(directory, 'public-text.json'),
    JSON.stringify(
      { title: blueprint.title, suspects: blueprint.suspects, evidence: textEvidence },
      null,
      2,
    ),
  );
  console.log(
    `Live case, two photos and playable ${cctv.method} CCTV verified. Artifacts: ${directory}`,
  );
} else
  console.log(
    'Run npm run provider:check --workspace @amr/worker -- --full to test paid case, photo and video/fallback generation.',
  );
