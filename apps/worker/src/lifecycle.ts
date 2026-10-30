export type ManagedWorker = {
  pause(doNotWaitActive: boolean): Promise<unknown>;
  close(force?: boolean): Promise<unknown>;
};

export function settlesWithin(operation: Promise<unknown>, milliseconds: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), milliseconds);
    operation.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

export async function shutdownWorkers(options: {
  workers: ManagedWorker[];
  activeTasks: Set<Promise<unknown>>;
  closeQueues: () => Promise<unknown>;
  disconnectDatabase: () => Promise<unknown>;
  drainMilliseconds?: number;
  resourceMilliseconds?: number;
}) {
  const resourceMilliseconds = options.resourceMilliseconds ?? 2000;
  // BullMQ pause(true) stops fetching without waiting for paid AI work to finish.
  await settlesWithin(
    Promise.all(options.workers.map((worker) => worker.pause(true))),
    Math.min(1000, resourceMilliseconds),
  );
  const drained = await settlesWithin(
    Promise.allSettled([...options.activeTasks]),
    options.drainMilliseconds ?? 18000,
  );
  const closed = await settlesWithin(
    Promise.all(options.workers.map((worker) => worker.close(!drained))),
    resourceMilliseconds,
  );
  if (!drained || !closed) {
    // Do not close Mongo underneath an active processor: its catch handler would
    // incorrectly turn an interrupted generation into FAILED. The process exits
    // immediately after this result; BullMQ recovers the stalled job and the
    // next worker reuses the persisted canon, text and completed assets.
    return { forced: true };
  }
  const resourcesClosed = await settlesWithin(
    Promise.all([options.closeQueues(), options.disconnectDatabase()]),
    resourceMilliseconds,
  );
  return { forced: !resourcesClosed };
}

export const StartupFailureCodes = [
  'WORKER_CONFIGURATION_INVALID',
  'WORKER_DATABASE_UNAVAILABLE',
  'WORKER_STORAGE_UNAVAILABLE',
  'WORKER_GEMINI_UNAVAILABLE',
  'WORKER_QUEUE_UNAVAILABLE',
  'WORKER_STARTUP_FAILED',
] as const;
export type StartupFailureCode = (typeof StartupFailureCodes)[number];
export class WorkerStartupError extends Error {
  constructor(public readonly code: StartupFailureCode) {
    super(code);
    this.name = 'WorkerStartupError';
  }
}
export function safeStartupCode(error: unknown): StartupFailureCode {
  if (error && typeof error === 'object') {
    if ('name' in error && error.name === 'ZodError') return 'WORKER_CONFIGURATION_INVALID';
    if ('code' in error && StartupFailureCodes.includes(error.code as StartupFailureCode))
      return error.code as StartupFailureCode;
  }
  return 'WORKER_STARTUP_FAILED';
}
