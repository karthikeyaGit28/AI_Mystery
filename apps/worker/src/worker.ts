import { Worker } from 'bullmq';
import pino from 'pino';
import {
  closeQueues,
  config,
  connectDatabase,
  disconnectDatabase,
  ensureStorageBucket,
  redisConnection,
} from '@amr/server';
import { GeminiAIProvider } from './ai/gemini.js';
import { generateCase, safeGenerationCode } from './pipeline/generate.js';
import { cleanupCase, maintenanceSweep } from './pipeline/cleanup.js';

const logger = pino({
  name: 'amr-worker',
  redact: ['key', 'apiKey', 'GEMINI_API_KEY', 'prompt', 'blueprint'],
});
await connectDatabase();
await ensureStorageBucket();
if (config.AI_MODE === 'gemini') await new GeminiAIProvider().checkCapability();
const worker = new Worker<{ caseId: string }>(
  'case-generation',
  async (job) => {
    const started = Date.now();
    try {
      await generateCase(job.data.caseId);
      logger.info(
        { caseId: job.data.caseId, durationMs: Date.now() - started },
        'Generation finished',
      );
    } catch (error) {
      logger.error(
        { caseId: job.data.caseId, errorCode: safeGenerationCode(error) },
        'Generation failed',
      );
      throw new Error(safeGenerationCode(error));
    }
  },
  {
    connection: redisConnection,
    concurrency: config.WORKER_CONCURRENCY,
    lockDuration: 120000,
    maxStalledCount: 2,
  },
);
const cleanup = new Worker<{ caseId: string }>(
  'case-cleanup',
  async (job) => cleanupCase(job.data.caseId),
  { connection: redisConnection, concurrency: 1 },
);
worker.on('error', (error) => logger.error({ errorCode: error.name }, 'Generation queue error'));
cleanup.on('error', (error) => logger.error({ errorCode: error.name }, 'Cleanup queue error'));
cleanup.on('failed', (job) =>
  logger.error({ caseId: job?.data.caseId }, 'Cleanup will be retried by maintenance'),
);
let sweeping = false;
const sweep = async () => {
  if (sweeping) return;
  sweeping = true;
  try {
    await maintenanceSweep();
  } catch (error) {
    logger.error({ errorCode: safeGenerationCode(error) }, 'Maintenance failed');
  } finally {
    sweeping = false;
  }
};
await sweep();
const timer = setInterval(() => void sweep(), 60000);
logger.info({ mode: config.AI_MODE, concurrency: config.WORKER_CONCURRENCY }, 'Worker ready');
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(timer);
  await Promise.all([worker.close(), cleanup.close()]);
  await closeQueues();
  await disconnectDatabase();
  logger.info('Worker stopped');
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
