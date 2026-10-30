import { readFile, writeFile } from 'node:fs/promises';

const file = new URL('../.env', import.meta.url);
let current;
try {
  current = await readFile(file, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  current = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
}
const values = new Map(
  Object.entries({
    FREE_TIER_ONLY: 'true',
    MEDIA_PROVIDER: 'cloudflare',
    GEMINI_TEXT_MODEL: 'gemini-3.8-flash',
    GEMINI_TEXT_MIN_INTERVAL_MS: '15000',
    CLOUDFLARE_IMAGE_MODEL: '@cf/black-forest-labs/flux-1-schnell',
    WORKER_DRAIN_DELAY_SECONDS: '60',
    WORKER_STALLED_INTERVAL_MS: '120000',
    WORKER_CONCURRENCY: '1',
    MAX_MEDIA_BYTES: '20971520',
  }),
);
const seen = new Set();
const newline = current.includes('\r\n') ? '\r\n' : '\n';
const lines = current.split(/\r?\n/).map((line) => {
  const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
  if (!match || !values.has(match[1])) return line;
  seen.add(match[1]);
  return `${match[1]}=${values.get(match[1])}`;
});
for (const [key, value] of values) if (!seen.has(key)) lines.push(`${key}=${value}`);
for (const key of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']) {
  if (!new RegExp(`^${key}=`, 'm').test(current)) lines.push(`${key}=`);
}
await writeFile(file, lines.join(newline).replace(/(?:\r?\n)*$/, newline));
console.log(
  'Free-mode flags configured. Existing API keys, passwords, database/storage settings, and AI_MODE were preserved.',
);
