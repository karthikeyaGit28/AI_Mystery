import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

let directory = resolve(process.cwd());
for (let i = 0; i < 5; i += 1) {
  const file = join(directory, '.env');
  if (existsSync(file)) {
    dotenv.config({ path: file, quiet: true });
    break;
  }
  directory = dirname(directory);
}

const number = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const origin = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  }, 'Use an HTTP(S) origin without a path, credentials, query, or fragment.')
  .transform((value) => new URL(value).origin);
export const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: number(4000),
  HOST: z.string().trim().min(1).max(255).default('0.0.0.0'),
  SERVE_WEB: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  WEB_DIST_PATH: z
    .string()
    .trim()
    .min(1)
    .default('apps/web/dist')
    .transform((value) => resolve(repositoryRoot, value)),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  WEB_ORIGIN: origin.default('http://localhost:5173'),
  API_BASE_URL: origin.default('http://localhost:4000'),
  RENDER_EXTERNAL_URL: origin.optional(),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/ai_mystery_room'),
  REDIS_URL: z.url().default('redis://localhost:6379'),
  SESSION_COOKIE_NAME: z.string().default('amr_guest'),
  SESSION_SECRET: z.string().min(32).default('local-development-only-change-this-secret-32'),
  AI_MODE: z.enum(['mock', 'gemini']).default('mock'),
  FREE_TIER_ONLY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  MEDIA_PROVIDER: z.enum(['gemini', 'cloudflare']).default('gemini'),
  CLOUDFLARE_ACCOUNT_ID: z.string().trim().default(''),
  CLOUDFLARE_API_TOKEN: z.string().trim().default(''),
  CLOUDFLARE_IMAGE_MODEL: z.string().trim().default('@cf/black-forest-labs/flux-1-schnell'),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_TEXT_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_TEXT_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(0),
  GEMINI_IMAGE_MODEL: z.string().default('gemini-nano-banana-2.1'),
  GEMINI_VIDEO_MODEL: z.string().default('gemini-omni-1.1-flash'),
  STORAGE_ENDPOINT: z.url().default('http://localhost:9000'),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_BUCKET: z.string().default('ai-mystery-private'),
  STORAGE_ACCESS_KEY: z.string().default('local-dev-only'),
  STORAGE_SECRET_KEY: z.string().default('local-dev-only'),
  STORAGE_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  FFMPEG_PATH: z.string().default(''),
  FFPROBE_PATH: z.string().default(''),
  MAX_ACTIVE_GENERATIONS_PER_SESSION: number(1),
  MAX_NEW_CASES_PER_SESSION_PER_24H: number(3),
  GENERATION_WATCHDOG_MINUTES: number(20),
  CASE_RETENTION_DAYS: number(30),
  WORKER_CONCURRENCY: number(1),
  WORKER_DRAIN_DELAY_SECONDS: number(5),
  WORKER_STALLED_INTERVAL_MS: number(30000),
  MAX_MEDIA_BYTES: number(50 * 1024 * 1024),
});
export function parseEnvironment(source: Record<string, unknown>) {
  const production = source.NODE_ENV === 'production';
  const freeOnly = source.FREE_TIER_ONLY === 'true';
  const webOrigin = source.WEB_ORIGIN || source.RENDER_EXTERNAL_URL;
  const apiOrigin = source.API_BASE_URL || source.WEB_ORIGIN || source.RENDER_EXTERNAL_URL;
  if (production && (!webOrigin || !apiOrigin))
    throw new Error('Production requires public WEB_ORIGIN/API_BASE_URL or RENDER_EXTERNAL_URL.');
  const result = EnvironmentSchema.parse({
    ...source,
    ...(freeOnly
      ? {
          GEMINI_TEXT_MIN_INTERVAL_MS: source.GEMINI_TEXT_MIN_INTERVAL_MS ?? 15000,
          WORKER_DRAIN_DELAY_SECONDS: source.WORKER_DRAIN_DELAY_SECONDS ?? 60,
          WORKER_STALLED_INTERVAL_MS: source.WORKER_STALLED_INTERVAL_MS ?? 120000,
          MAX_MEDIA_BYTES: source.MAX_MEDIA_BYTES ?? 20 * 1024 * 1024,
        }
      : {}),
    ...(production ? { WEB_ORIGIN: webOrigin, API_BASE_URL: apiOrigin } : {}),
  });
  if (production) {
    if (
      result.AI_MODE !== 'gemini' ||
      !result.GEMINI_API_KEY.trim() ||
      result.SESSION_SECRET.startsWith('local-')
    )
      throw new Error('Production requires Gemini, GEMINI_API_KEY, and a unique SESSION_SECRET.');
    if (!result.WEB_ORIGIN.startsWith('https://') || !result.API_BASE_URL.startsWith('https://'))
      throw new Error('Production public origins must use HTTPS.');
    if (result.SERVE_WEB && result.WEB_ORIGIN !== result.API_BASE_URL)
      throw new Error(
        'SERVE_WEB requires WEB_ORIGIN and API_BASE_URL to use the same public origin.',
      );
  }
  if (result.FREE_TIER_ONLY) {
    if (result.MEDIA_PROVIDER !== 'cloudflare')
      throw new Error(
        'FREE_TIER_ONLY requires MEDIA_PROVIDER=cloudflare; paid Gemini image/video generation is disabled.',
      );
    if (result.GEMINI_TEXT_MODEL !== 'gemini-3.8-flash')
      throw new Error('FREE_TIER_ONLY permits only the verified free text model gemini-3.8-flash.');
    if (result.CLOUDFLARE_IMAGE_MODEL !== '@cf/black-forest-labs/flux-1-schnell')
      throw new Error(
        'FREE_TIER_ONLY permits only the free Cloudflare FLUX.1 Schnell image model.',
      );
    if (
      result.AI_MODE === 'gemini' &&
      (!result.CLOUDFLARE_ACCOUNT_ID || !result.CLOUDFLARE_API_TOKEN)
    )
      throw new Error(
        'FREE_TIER_ONLY live generation requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. Use accounts without paid billing enabled.',
      );
    if (result.WORKER_CONCURRENCY !== 1)
      throw new Error('FREE_TIER_ONLY requires WORKER_CONCURRENCY=1.');
    if (result.MAX_MEDIA_BYTES > 20 * 1024 * 1024)
      throw new Error('FREE_TIER_ONLY requires MAX_MEDIA_BYTES at most 20971520 (20 MiB).');
  }
  return result;
}
export const config = parseEnvironment(process.env);
