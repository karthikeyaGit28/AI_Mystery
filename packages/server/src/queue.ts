import { Queue, type JobsOptions } from 'bullmq';
import { config } from './config.js';
export function parseRedisConnection(url: string) {
  const parsed = new URL(url);
  if (
    !['redis:', 'rediss:'].includes(parsed.protocol) ||
    !/^\/(?:0|[1-9]\d{0,4})?$/.test(parsed.pathname || '/')
  )
    throw new Error('REDIS_URL must use redis:// or rediss:// with a numeric database path.');
  const db = Number(parsed.pathname.slice(1) || 0);
  if (db > 65535) throw new Error('REDIS_URL database must be between 0 and 65535.');
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    db,
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
export const redisConnection = parseRedisConnection(config.REDIS_URL);
const clients: Queue[] = [];
function lazyQueue(name: string) {
  let instance: Queue | undefined;
  function get() {
    if (!instance) {
      instance = new Queue(name, {
        connection: {
          ...redisConnection,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 1500,
        },
      });
      // Producers must fail boundedly when Redis is down; workers use the separately exported retrying connection.
      instance.on('error', () => {
        /* API turns producer failures into safe 503 responses. */
      });
      clients.push(instance);
    }
    return instance;
  }
  return {
    name,
    add: (jobName: string, data: Record<string, unknown>, options?: JobsOptions) =>
      get().add(jobName, data, options),
    getJob: (id: string) => get().getJob(id),
    waitUntilReady: () => get().waitUntilReady(),
    close: () => instance?.close() ?? Promise.resolve(),
    get client() {
      return get().client;
    },
  };
}
export const generateQueue = lazyQueue('case-generation');
export const cleanupQueue = lazyQueue('case-cleanup');
export async function closeQueues() {
  await Promise.all(clients.map((queue) => queue.close()));
}
export async function assertQueueAvailable() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      generateQueue.client.then((client) =>
        (client as unknown as { ping(): Promise<string> }).ping(),
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Queue unavailable')), 1800);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
