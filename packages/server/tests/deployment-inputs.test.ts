import { describe, expect, it } from 'vitest';
import { checkFreeDeploymentInputs } from '../../../scripts/check-free-deployment.mjs';

const freeSettings = {
  FREE_TIER_ONLY: 'true',
  MEDIA_PROVIDER: 'cloudflare',
  GEMINI_TEXT_MODEL: 'gemini-3.8-flash',
  CLOUDFLARE_IMAGE_MODEL: '@cf/black-forest-labs/flux-1-schnell',
};
const valid = {
  ...freeSettings,
  MONGODB_URI:
    'mongodb+srv://amr-user:private-database-password-123@cluster0.fake.mongodb.net/ai_mystery_room?retryWrites=true&w=majority',
  REDIS_URL: 'rediss://default:private-redis-password-123@useful-cat-12345.upstash.io:6379',
  GEMINI_API_KEY: `AIza${'g'.repeat(35)}`,
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_API_TOKEN: 'cf-test-token-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
  STORAGE_ENDPOINT: 'https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/s3',
  STORAGE_REGION: 'ap-south-1',
  STORAGE_ACCESS_KEY: 'S3FAKEACCESSKEY12345',
  STORAGE_SECRET_KEY: 'private-generated-S3-secret-1234567890',
};
const keys = (source: Record<string, string>) =>
  checkFreeDeploymentInputs(source).map((issue: { key: string }) => issue.key);

describe('offline free deployment inputs', () => {
  it('accepts realistic formats while allowing local demo, development URLs, and development session settings', () => {
    expect(
      checkFreeDeploymentInputs({
        ...valid,
        AI_MODE: 'mock',
        NODE_ENV: 'development',
        WEB_ORIGIN: 'http://localhost:5173',
        SESSION_SECRET: 'local-development-only',
      }),
    ).toEqual([]);
  });
  it('reports the nine missing inputs by setting name', () => {
    expect(keys(freeSettings)).toEqual([
      'MONGODB_URI',
      'REDIS_URL',
      'GEMINI_API_KEY',
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_API_TOKEN',
      'STORAGE_ENDPOINT',
      'STORAGE_REGION',
      'STORAGE_ACCESS_KEY',
      'STORAGE_SECRET_KEY',
    ]);
  });
  it('treats generated credentials as opaque instead of assuming undocumented prefixes or lengths', () => {
    expect(
      checkFreeDeploymentInputs({
        ...valid,
        GEMINI_API_KEY: 'opaque-provider-key-format',
        CLOUDFLARE_API_TOKEN: 'opaque.provider.token',
        STORAGE_ACCESS_KEY: 'generated.key-id',
        STORAGE_SECRET_KEY: 'generated.secret',
      }),
    ).toEqual([]);
  });
  it.each([
    ['MONGODB_URI', 'mongodb://localhost:27017/ai_mystery_room'],
    ['MONGODB_URI', 'mongodb+srv://user:password@cluster0.fake.mongodb.net/'],
    ['MONGODB_URI', 'mongodb+srv://user:password@cluster0.fake.mongodb.net.evil.test/db'],
    ['REDIS_URL', 'https://useful-cat-12345.upstash.io'],
    ['REDIS_URL', 'redis://localhost:6379'],
    ['REDIS_URL', 'rediss://default@useful-cat-12345.upstash.io:6379'],
    ['GEMINI_API_KEY', 'YOUR_API_KEY'],
    ['CLOUDFLARE_ACCOUNT_ID', '<YOUR_ACCOUNT_ID>'],
    ['CLOUDFLARE_API_TOKEN', 'replace-me'],
    ['STORAGE_ENDPOINT', 'http://localhost:9000'],
    [
      'STORAGE_ENDPOINT',
      'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/evidence',
    ],
    ['STORAGE_ENDPOINT', 'https://user:private@abcdefghijklmnopqrst.supabase.co/storage/v1/s3'],
    ['STORAGE_ENDPOINT', 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/s3?secret=private'],
    ['STORAGE_REGION', 'auto'],
    ['STORAGE_ACCESS_KEY', 'local-dev-only'],
    ['STORAGE_SECRET_KEY', 'local-dev-only'],
  ])('rejects malformed or local %s', (key, value) => {
    expect(keys({ ...valid, [key]: value })).toContain(key);
  });
  it.each(['eyJheader.eyJpayload.signature', 'sb_secret_private-test-api-key'])(
    'rejects Supabase API keys used as S3 credentials',
    (value) => {
      const issues = keys({ ...valid, STORAGE_ACCESS_KEY: value, STORAGE_SECRET_KEY: value });
      expect(issues).toContain('STORAGE_ACCESS_KEY');
      expect(issues).toContain('STORAGE_SECRET_KEY');
    },
  );
  it('detects a database password copied into the S3 secret field', () => {
    expect(keys({ ...valid, STORAGE_SECRET_KEY: 'private-database-password-123' })).toContain(
      'STORAGE_SECRET_KEY',
    );
  });
  it('accepts the alternate standard Supabase S3 hostname', () => {
    expect(
      checkFreeDeploymentInputs({
        ...valid,
        STORAGE_ENDPOINT: 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/s3',
      }),
    ).toEqual([]);
  });
  it('checks the free flags and both model choices', () => {
    expect(
      keys({
        ...valid,
        FREE_TIER_ONLY: 'false',
        MEDIA_PROVIDER: 'gemini',
        GEMINI_TEXT_MODEL: 'other-model',
        CLOUDFLARE_IMAGE_MODEL: 'other-model',
      }),
    ).toEqual(['FREE_TIER_ONLY', 'MEDIA_PROVIDER', 'GEMINI_TEXT_MODEL', 'CLOUDFLARE_IMAGE_MODEL']);
  });
  it('returns fixed safe messages without echoing credential values or malformed URLs', () => {
    const source = {
      ...valid,
      REDIS_URL: 'https://private-redis-token@invalid.example',
      STORAGE_ENDPOINT: 'https://private-storage-secret@invalid.example/storage/v1/s3',
      GEMINI_API_KEY: 'private-invalid-gemini-key',
    };
    const output = JSON.stringify(checkFreeDeploymentInputs(source));
    for (const value of Object.values(source)) expect(output).not.toContain(value);
    expect(output).not.toContain('private-redis-token');
    expect(output).not.toContain('private-storage-secret');
  });
});
