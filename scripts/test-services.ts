/** Optional native test infrastructure; production uses docker-compose.yml or managed services. */
import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import S3rver from 's3rver';

const root = resolve('.');
await mkdir(join(root, '.runtime', 'redis'), { recursive: true });
await mkdir(join(root, '.runtime', 'storage'), { recursive: true });
await mkdir(join(root, '.runtime', 'mongodb'), { recursive: true });
async function findRedis(directory: string): Promise<string | undefined> {
  for (const file of await readdir(directory, { withFileTypes: true })) {
    if (file.name === 'redis-server.exe' || file.name === 'redis-server')
      return join(directory, file.name);
    if (file.isDirectory()) {
      const candidate = await findRedis(join(directory, file.name));
      if (candidate) return candidate;
    }
  }
}
const redisBinary =
  process.env.TEST_REDIS_BINARY ||
  (await findRedis(join(root, '.tools', 'redis')).catch(() => undefined));
if (!redisBinary)
  throw new Error(
    'Set TEST_REDIS_BINARY to an installed Redis server, or use docker compose up -d.',
  );
const mongo = await MongoMemoryServer.create({
  binary: { version: '8.0.17', downloadDir: join(root, '.tools', 'mongodb') },
  instance: { port: 27017, dbName: 'ai_mystery_room', dbPath: join(root, '.runtime', 'mongodb') },
});
const redis = spawn(
  redisBinary,
  ['--bind', '127.0.0.1', '--port', '6379', '--dir', '.', '--save', '', '--appendonly', 'yes'],
  { cwd: join(root, '.runtime', 'redis'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
);
redis.stdout.on('data', (data) => process.stdout.write(data));
redis.stderr.on('data', (data) => process.stderr.write(data));
redis.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
  void shutdown();
});
const s3 = new S3rver({
  port: 9000,
  address: '127.0.0.1',
  silent: true,
  directory: join(root, '.runtime', 'storage'),
  allowMismatchedSignatures: true,
  configureBuckets: [{ name: 'ai-mystery-private' }],
});
await s3.run();
console.log('Test services ready: real MongoDB :27017, Redis :6379, test S3 :9000.');
console.log('Run app/tests with STORAGE_ACCESS_KEY=S3RVER and STORAGE_SECRET_KEY=S3RVER.');
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  redis.kill();
  await s3.close();
  await mongo.stop();
}
process.on('SIGINT', () => {
  void shutdown().then(() => process.exit());
});
process.on('SIGTERM', () => {
  void shutdown().then(() => process.exit());
});
