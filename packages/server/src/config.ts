import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
export const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: number(4000),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  API_BASE_URL: z.url().default('http://localhost:4000'),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/ai_mystery_room'),
  REDIS_URL: z.url().default('redis://localhost:6379'),
  SESSION_COOKIE_NAME: z.string().default('amr_guest'),
  SESSION_SECRET: z.string().min(32).default('local-development-only-change-this-secret-32'),
  AI_MODE: z.enum(['mock', 'gemini']).default('mock'),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_TEXT_MODEL: z.string().default('gemini-3.8-flash'),
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
  MAX_MEDIA_BYTES: number(50 * 1024 * 1024),
});
export const config = EnvironmentSchema.parse(process.env);
if (
  config.NODE_ENV === 'production' &&
  (config.AI_MODE !== 'gemini' ||
    !config.GEMINI_API_KEY ||
    config.SESSION_SECRET.startsWith('local-'))
) {
  throw new Error('Production requires Gemini, GEMINI_API_KEY, and a unique SESSION_SECRET.');
}
