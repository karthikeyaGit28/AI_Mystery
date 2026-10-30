import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { GoogleGenAI } from '@google/genai';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

const root = new URL('../', import.meta.url);
const files = [
  'tsconfig.base.json',
  'apps/web/dist/index.html',
  'apps/api/src/server.ts',
  'apps/worker/src/worker.ts',
  'apps/worker/src/ai/cloudflare.ts',
  'scripts/start-combined.mjs',
  'packages/server/src/index.ts',
  'packages/shared/src/index.ts',
  ...[
    'blueprint',
    'reviewer',
    'chat-evidence',
    'document-evidence',
    'photo',
    'cctv',
    'capability',
  ].map((name) => `apps/worker/src/prompts/${name}.system.md`),
];
for (const file of files) await access(new URL(file, root));
for (const name of [
  'tsx',
  'express',
  'mongoose',
  'zod',
  'bullmq',
  'ioredis',
  'sharp',
  '@google/genai',
  '@aws-sdk/client-s3',
])
  import.meta.resolve(name);
const html = await readFile(new URL('apps/web/dist/index.html', root), 'utf8');
if (!html.includes('/assets/'))
  throw new Error('The production React entry point has no bundled assets.');
const sdk = new GoogleGenAI({ apiKey: 'offline-runtime-check-no-network' });
if (typeof sdk.interactions.create !== 'function')
  throw new Error('Gemini Interactions support is missing.');
const binaries = [
  process.env.FFMPEG_PATH && process.env.FFMPEG_PATH !== 'ffmpeg'
    ? process.env.FFMPEG_PATH
    : ffmpegInstaller.path,
  process.env.FFPROBE_PATH && process.env.FFPROBE_PATH !== 'ffprobe'
    ? process.env.FFPROBE_PATH
    : ffprobeInstaller.path,
];
for (const binary of binaries) {
  const result = spawnSync(binary, ['-version'], {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw new Error('A required media binary did not start.');
}
console.log(
  'Runtime ready: built React app, workspace modules, prompts, SDK, ffmpeg, and ffprobe.',
);
console.log(`Checked source root: ${fileURLToPath(root)}`);
console.log('Offline check only: no databases, storage, or paid AI requests were contacted.');
