import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { parse } from 'yaml';

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
const required = new Map([
  ['amr-web', 'web'],
  ['amr-worker', 'worker'],
  ['amr-queue', 'keyvalue'],
]);
const services = blueprint.services;
if (services.length !== required.size)
  throw new Error('The deployment requires one web service, one worker, and one queue.');
for (const [name, type] of required) {
  if (services.filter((service) => service.name === name && service.type === type).length !== 1)
    throw new Error(`Missing or duplicate deployment service: ${name}.`);
}
const region = services[0].region;
const privateKeys = new Set([
  'MONGODB_URI',
  'REDIS_URL',
  'GEMINI_API_KEY',
  'SESSION_SECRET',
  'STORAGE_ACCESS_KEY',
  'STORAGE_SECRET_KEY',
]);
for (const service of services) {
  if (service.region !== region)
    throw new Error('Web, worker, and queue must share a Render region.');
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
  if (
    service.type !== 'keyvalue' &&
    !service.envVars.some((variable) => variable.key === 'AI_MODE' && variable.value === 'gemini')
  )
    throw new Error('Production services must use Gemini.');
}
const queue = services.find((service) => service.type === 'keyvalue');
if (
  queue.maxmemoryPolicy !== 'noeviction' ||
  queue.persistenceMode !== 'journal-snapshot' ||
  queue.ipAllowList.length !== 0
)
  throw new Error('The queue must be persistent, private, and use noeviction.');
console.log(
  'Render Blueprint matches the vendored official schema and application deployment rules.',
);
console.log('No cloud services were provisioned. Account-level validation happens in Render.');
