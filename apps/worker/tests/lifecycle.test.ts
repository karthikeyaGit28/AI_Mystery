import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeStartupCode, shutdownWorkers, WorkerStartupError } from '../src/lifecycle.js';

afterEach(() => vi.useRealTimers());
describe('production worker lifecycle', () => {
  it('stops fetching, drains active work, then closes database and queue connections', async () => {
    const calls: string[] = [];
    let finish!: () => void;
    const task = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const worker = {
      pause: vi.fn(async () => {
        calls.push('pause');
      }),
      close: vi.fn(async () => {
        calls.push('worker-close');
      }),
    };
    const stop = shutdownWorkers({
      workers: [worker],
      activeTasks: new Set([task]),
      closeQueues: async () => {
        calls.push('queue-close');
      },
      disconnectDatabase: async () => {
        calls.push('database-close');
      },
    });
    await Promise.resolve();
    expect(calls).toEqual(['pause']);
    finish();
    await expect(stop).resolves.toEqual({ forced: false });
    expect(worker.pause).toHaveBeenCalledWith(true);
    expect(worker.close).toHaveBeenCalledWith(false);
    expect(calls.indexOf('database-close')).toBeGreaterThan(calls.indexOf('worker-close'));
  });
  it('bounds shutdown for long provider calls without closing Mongo underneath checkpoints', async () => {
    vi.useFakeTimers();
    const worker = { pause: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const closeQueues = vi.fn(async () => {});
    const disconnectDatabase = vi.fn(async () => {});
    const stop = shutdownWorkers({
      workers: [worker],
      activeTasks: new Set([new Promise(() => {})]),
      closeQueues,
      disconnectDatabase,
      drainMilliseconds: 18000,
    });
    await vi.advanceTimersByTimeAsync(18001);
    await expect(stop).resolves.toEqual({ forced: true });
    expect(worker.close).toHaveBeenCalledWith(true);
    expect(disconnectDatabase).not.toHaveBeenCalled();
    expect(closeQueues).not.toHaveBeenCalled();
  });
  it('also bounds queue close when Redis is unreachable', async () => {
    vi.useFakeTimers();
    const disconnectDatabase = vi.fn(async () => {});
    const stop = shutdownWorkers({
      workers: [{ pause: async () => {}, close: () => new Promise(() => {}) }],
      activeTasks: new Set(),
      closeQueues: async () => {},
      disconnectDatabase,
      resourceMilliseconds: 2000,
    });
    await vi.advanceTimersByTimeAsync(2001);
    await expect(stop).resolves.toEqual({ forced: true });
    expect(disconnectDatabase).not.toHaveBeenCalled();
  });
  it('emits only allowlisted startup codes rather than provider or configuration content', () => {
    expect(safeStartupCode(new WorkerStartupError('WORKER_GEMINI_UNAVAILABLE'))).toBe(
      'WORKER_GEMINI_UNAVAILABLE',
    );
    expect(safeStartupCode({ name: 'ZodError', message: 'private configuration' })).toBe(
      'WORKER_CONFIGURATION_INVALID',
    );
    expect(safeStartupCode({ code: 'sensitive provider output', message: 'secret' })).toBe(
      'WORKER_STARTUP_FAILED',
    );
  });
});
