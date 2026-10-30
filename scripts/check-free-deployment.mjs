import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const placeholders =
  /^(?:<.*>|\[.*\]|your(?:[-_ ].*)?|replace(?:[-_ ].*)?|change[-_ ]?me.*|paste(?:[-_ ].*)?|placeholder.*|example.*|password|username|local-dev-only|s3rver|anon|service_role|x{3,}|0+)$/i;
const missing = (value) => !value || placeholders.test(value);
const apiKeyInsteadOfS3 = (value) =>
  /^eyJ[^.]*\.[^.]+\.[^.]+$/.test(value) || /^sb_(?:publishable|secret)_/.test(value);

/** Check format only. Never returns source values or contacts a provider. */
export function checkFreeDeploymentInputs(source) {
  const issues = [];
  const get = (key) => (typeof source?.[key] === 'string' ? source[key].trim() : '');
  const add = (key, message) => issues.push({ key, message });
  const parse = (value) => {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  };
  const decode = (value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return '';
    }
  };

  const mongo = parse(get('MONGODB_URI'));
  const mongoPassword = mongo ? decode(mongo.password) : '';
  if (
    !mongo ||
    mongo.protocol !== 'mongodb+srv:' ||
    !mongo.hostname.endsWith('.mongodb.net') ||
    mongo.port ||
    mongo.hash ||
    missing(decode(mongo.username)) ||
    missing(mongoPassword) ||
    !/^\/[A-Za-z0-9_-]+$/.test(mongo.pathname) ||
    missing(mongo.pathname.slice(1))
  )
    add(
      'MONGODB_URI',
      'Use an Atlas mongodb+srv URL with a database username, URL-encoded password, mongodb.net host, and database name.',
    );

  const redis = parse(get('REDIS_URL'));
  if (
    !redis ||
    redis.protocol !== 'rediss:' ||
    !redis.hostname.endsWith('.upstash.io') ||
    missing(decode(redis.password)) ||
    redis.search ||
    redis.hash ||
    !['', '/', '/0'].includes(redis.pathname)
  )
    add(
      'REDIS_URL',
      'Use the Upstash rediss Redis connection URL with its password; the HTTPS REST URL is not a Redis URL.',
    );

  const geminiKey = get('GEMINI_API_KEY');
  // Provider keys are opaque; their prefixes and lengths can change. Avoid
  // rejecting a valid new key format while checking obvious copy/paste mistakes.
  if (missing(geminiKey) || /\s/.test(geminiKey))
    add(
      'GEMINI_API_KEY',
      'Paste a Gemini API key from Google AI Studio, not a model name or placeholder.',
    );

  const account = get('CLOUDFLARE_ACCOUNT_ID');
  if (missing(account) || !/^[a-f0-9]{32}$/i.test(account))
    add('CLOUDFLARE_ACCOUNT_ID', 'Use the 32-character hexadecimal Cloudflare account ID.');
  const token = get('CLOUDFLARE_API_TOKEN');
  if (missing(token) || token === account || /\s/.test(token))
    add(
      'CLOUDFLARE_API_TOKEN',
      'Use a scoped Workers AI API token, not the account ID or a placeholder.',
    );

  const endpoint = parse(get('STORAGE_ENDPOINT'));
  if (
    !endpoint ||
    endpoint.protocol !== 'https:' ||
    !/^[a-z0-9-]+(?:\.storage)?\.supabase\.co$/.test(endpoint.hostname) ||
    endpoint.port ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== '/storage/v1/s3' ||
    endpoint.search ||
    endpoint.hash
  )
    add(
      'STORAGE_ENDPOINT',
      'Copy the Supabase HTTPS S3 endpoint ending exactly in /storage/v1/s3, without credentials, query strings, or fragments.',
    );

  const region = get('STORAGE_REGION');
  if (missing(region) || !/^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/.test(region))
    add('STORAGE_REGION', 'Copy the region shown with the Supabase S3 connection settings.');
  const access = get('STORAGE_ACCESS_KEY');
  if (missing(access) || apiKeyInsteadOfS3(access) || /\s/.test(access))
    add(
      'STORAGE_ACCESS_KEY',
      'Use the generated Supabase S3 access key ID, not an anon, publishable, or service-role API key.',
    );
  const secret = get('STORAGE_SECRET_KEY');
  if (
    missing(secret) ||
    apiKeyInsteadOfS3(secret) ||
    /\s/.test(secret) ||
    secret === access ||
    (mongoPassword && secret === mongoPassword)
  )
    add(
      'STORAGE_SECRET_KEY',
      'Use the generated Supabase S3 secret access key, not an API key, database password, or copy of the access key ID.',
    );

  if (get('FREE_TIER_ONLY') !== 'true')
    add('FREE_TIER_ONLY', 'Set FREE_TIER_ONLY=true for this free deployment route.');
  if (get('MEDIA_PROVIDER') !== 'cloudflare')
    add(
      'MEDIA_PROVIDER',
      'Set MEDIA_PROVIDER=cloudflare to avoid Gemini paid image and video APIs.',
    );
  if (get('GEMINI_TEXT_MODEL') !== 'gemini-3.8-flash')
    add('GEMINI_TEXT_MODEL', 'Use gemini-3.8-flash for the supported free deployment route.');
  if (get('CLOUDFLARE_IMAGE_MODEL') !== '@cf/black-forest-labs/flux-1-schnell')
    add(
      'CLOUDFLARE_IMAGE_MODEL',
      'Use the supported free-tier @cf/black-forest-labs/flux-1-schnell model.',
    );
  return issues;
}

async function run() {
  try {
    // Resolve dotenv from its declaring workspace; this works with hoisted or
    // workspace-local installs and does not load the server configuration.
    const require = createRequire(new URL('../packages/server/package.json', import.meta.url));
    const { parse } = require('dotenv');
    let local = {};
    try {
      local = parse(await readFile(new URL('../.env', import.meta.url), 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      console.log('No .env file found; checking process environment only.');
    }
    const issues = checkFreeDeploymentInputs({ ...local, ...process.env });
    if (issues.length) {
      console.error('Offline deployment preflight found settings to fix:');
      for (const issue of issues) console.error(`- ${issue.key}: ${issue.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      'Offline deployment input formats passed. This does not verify credentials, provider access, free plans, quotas, or network connectivity.',
    );
  } catch {
    console.error(
      'Offline deployment preflight could not run. Check local file access and install project dependencies with npm install.',
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
