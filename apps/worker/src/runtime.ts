import { Worker } from 'bullmq';
import type { Logger } from 'pino';
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
import {
  settlesWithin,
  shutdownWorkers,
  WorkerStartupError,
  type StartupFailureCode,
} from './lifecycle.js';

export async function startWorker(logger: Logger) {
  const workers: Worker<{ caseId: string }>[] = [];
  const activeTasks = new Set<Promise<unknown>>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopping = false;
  let stage: StartupFailureCode = 'WORKER_DATABASE_UNAVAILABLE';
  async function track<T>(operation: () => Promise<T>): Promise<T> {
    const task = operation();
    activeTasks.add(task);
    try {
      return await task;
    } finally {
      activeTasks.delete(task);
    }
  }
  function shutdown() {
    if (stopping) return;
    stopping = true;
    if (timer) clearInterval(timer);
    logger.info('Worker is draining active jobs');
    const deadline = setTimeout(() => {
      logger.warn('Worker shutdown deadline reached; unfinished jobs remain recoverable');
      logger.flush();
      process.exit(0);
    }, 25000);
    void shutdownWorkers({ workers, activeTasks, closeQueues, disconnectDatabase })
      .then(({ forced }) => {
        clearTimeout(deadline);
        logger.info(
          { unfinishedJobs: activeTasks.size, forced },
          forced
            ? 'Worker stopped; unfinished jobs will resume from checkpoints'
            : 'Worker stopped',
        );
        logger.flush();
        process.exit(0);
      })
      .catch(() => {
        clearTimeout(deadline);
        logger.error(
          { errorCode: 'WORKER_SHUTDOWN_FAILED' },
          'Worker stopped with recoverable jobs',
        );
        logger.flush();
        process.exit(0);
      });
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await connectDatabase();
    if (stopping) return;
    stage = 'WORKER_STORAGE_UNAVAILABLE';
    await ensureStorageBucket();
    if (stopping) return;
    stage = 'WORKER_GEMINI_UNAVAILABLE';
    if (config.AI_MODE === 'gemini') {
      const provider = new GeminiAIProvider();
      provider.checkLocalCapability();
      if (config.FREE_TIER_ONLY)
        logger.info('Free AI capability is checked when a case is generated');
      else await provider.checkCapability();
    }
    if (stopping) return;
    stage = 'WORKER_QUEUE_UNAVAILABLE';
    const worker = new Worker<{ caseId: string }>(
      'case-generation',
      (job) =>
        track(async () => {
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
        }),
      {
        connection: redisConnection,
        concurrency: config.WORKER_CONCURRENCY,
        lockDuration: 120000,
        maxStalledCount: 2,
        drainDelay: config.WORKER_DRAIN_DELAY_SECONDS,
        stalledInterval: config.WORKER_STALLED_INTERVAL_MS,
      },
    );
    const cleanup = new Worker<{ caseId: string }>(
      'case-cleanup',
      (job) => track(() => cleanupCase(job.data.caseId)),
      {
        connection: redisConnection,
        concurrency: 1,
        drainDelay: config.WORKER_DRAIN_DELAY_SECONDS,
        stalledInterval: config.WORKER_STALLED_INTERVAL_MS,
      },
    );
    workers.push(worker, cleanup);
    worker.on('error', () =>
      logger.error({ errorCode: 'GENERATION_QUEUE_ERROR' }, 'Generation queue error'),
    );
    cleanup.on('error', () =>
      logger.error({ errorCode: 'CLEANUP_QUEUE_ERROR' }, 'Cleanup queue error'),
    );
    cleanup.on('failed', (job) =>
      logger.error({ caseId: job?.data.caseId }, 'Cleanup will be retried by maintenance'),
    );
    if (
      !(await settlesWithin(
        Promise.all(workers.map((instance) => instance.waitUntilReady())),
        10000,
      ))
    )
      throw new WorkerStartupError(stage);
    if (stopping) return;
    let sweeping = false;
    const sweep = async () => {
      if (sweeping || stopping) return;
      sweeping = true;
      try {
        await track(maintenanceSweep);
      } catch (error) {
        logger.error({ errorCode: safeGenerationCode(error) }, 'Maintenance failed');
      } finally {
        sweeping = false;
      }
    };
    await sweep();
    if (stopping) return;
    timer = setInterval(() => void sweep(), 60000);
    logger.info({ mode: config.AI_MODE, concurrency: config.WORKER_CONCURRENCY }, 'Worker ready');
  } catch {
    if (stopping) return;
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    await settlesWithin(Promise.all(workers.map((worker) => worker.close(true))), 2000);
    await settlesWithin(Promise.all([closeQueues(), disconnectDatabase()]), 2000);
    throw new WorkerStartupError(stage);
  }
}
