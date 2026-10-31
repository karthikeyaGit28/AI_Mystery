import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { isVerifiedFreeTextModel } from './free-text-models.mjs';

const root = new URL('../', import.meta.url);
const schema = JSON.parse(await readFile(new URL('deploy/render.schema.json', root), 'utf8'));
const blueprint = parse(await readFile(new URL('render.yaml', root), 'utf8'), { uniqueKeys: true });
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validate = ajv.compile(schema);
if (!validate(blueprint)) {
  // Describe schema locations without printing any environment variable values.
  for (const issue of validate.errors ?? [])
    console.error(`${issue.instancePath || '/'}: ${issue.message}`);
  process.exit(1);
}
const services = blueprint.services;
if (services.length !== 1 || blueprint.databases?.length)
  throw new Error(
    'Free deployment allows only one free web service and no paid database resources.',
  );
const service = services[0];
if (
  service.type !== 'web' ||
  service.name !== 'amr-web' ||
  service.runtime !== 'docker' ||
  service.plan !== 'free' ||
  service.disk ||
  service.scaling ||
  (service.numInstances ?? 1) !== 1
)
  throw new Error(
    'The app must use one explicitly free Docker web service, without paid disks or autoscaling.',
  );
if (service.dockerCommand !== 'node --max-old-space-size=48 scripts/start-combined.mjs')
  throw new Error('The free host must supervise both API and worker inside its one container.');
if (Object.hasOwn(service, 'maxShutdownDelaySeconds'))
  throw new Error('Render Free does not support maxShutdownDelaySeconds; omit that setting.');
const variables = new Map((service.envVars ?? []).map((variable) => [variable.key, variable]));
if (!isVerifiedFreeTextModel(variables.get('GEMINI_TEXT_MODEL')?.value))
  throw new Error('Missing or unsafe free-profile setting: GEMINI_TEXT_MODEL.');
for (const [key, value] of Object.entries({
  AI_MODE: 'gemini',
  FREE_TIER_ONLY: 'true',
  MEDIA_PROVIDER: 'cloudflare',
  CLOUDFLARE_IMAGE_MODEL: '@cf/black-forest-labs/flux-1-schnell',
  WORKER_CONCURRENCY: '1',
  MAX_MEDIA_BYTES: '20971520',
})) {
  if (variables.get(key)?.value !== value)
    throw new Error(`Missing or unsafe free-profile setting: ${key}.`);
}
const privateKeys = new Set([
  'MONGODB_URI',
  'REDIS_URL',
  'GEMINI_API_KEY',
  'CLOUDFLARE_API_TOKEN',
  'SESSION_SECRET',
  'STORAGE_ACCESS_KEY',
  'STORAGE_SECRET_KEY',
]);
for (const service of services) {
  for (const variable of service.envVars ?? []) {
    if (privateKeys.has(variable.key) && Object.hasOwn(variable, 'value'))
      throw new Error(`Enter ${variable.key} in Render; do not commit a literal secret.`);
    const source = variable.fromService;
    if (
      source &&
      !services.some(
        (candidate) => candidate.name === source.name && candidate.type === source.type,
      )
    )
      throw new Error(`Invalid service reference for ${variable.key}.`);
  }
}
console.log(
  'Free-only Render Blueprint matches the official schema: one free web service, no paid resources, and free-provider guards.',
);
console.log('No cloud services were provisioned. Account-level validation happens in Render.');
