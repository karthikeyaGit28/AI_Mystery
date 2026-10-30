import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startCombined } from '../../../scripts/start-combined.mjs';

function setup() {
  const runtime = Object.assign(new EventEmitter(), {
    execPath: '/node',
    env: { FREE_TIER_ONLY: 'true' },
    exit: vi.fn(),
  });
  const children = [0, 1].map(() => Object.assign(new EventEmitter(), { kill: vi.fn() }));
  let index = 0;
  const spawnImpl = vi.fn(() => children[index++]);
  const result = startCombined({ runtime, spawnImpl, timeoutMs: 100 });
  return { runtime, children, spawnImpl, result };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('single-container API and worker supervision', () => {
  it('runs separate bounded-memory children with the same environment and web hosting only on API', () => {
    vi.useFakeTimers();
    const { spawnImpl, children, result } = setup();
    expect(spawnImpl).toHaveBeenCalledTimes(2);
    expect(spawnImpl.mock.calls[0][1]).toContain('--max-old-space-size=96');
    expect(spawnImpl.mock.calls[1][1]).toContain('--max-old-space-size=160');
    expect(spawnImpl.mock.calls[0][2].env).toMatchObject({
      FREE_TIER_ONLY: 'true',
      SERVE_WEB: 'true',
    });
    expect(spawnImpl.mock.calls[1][2].env.SERVE_WEB).toBe('false');
    result.stop();
    children.forEach((child) => child.emit('exit', 0));
  });
  it('drains both children on SIGTERM and exits only after both finish', () => {
    vi.useFakeTimers();
    const { runtime, children } = setup();
    runtime.emit('SIGTERM');
    children.forEach((child) => expect(child.kill).toHaveBeenCalledWith('SIGTERM'));
    children[0].emit('exit', 0);
    expect(runtime.exit).not.toHaveBeenCalled();
    children[1].emit('exit', 0);
    expect(runtime.exit).toHaveBeenCalledWith(0);
  });
  it('stops the sibling and fails the container if either application process crashes', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { runtime, children } = setup();
    children[1].emit('exit', 2);
    expect(children[0].kill).toHaveBeenCalledWith('SIGTERM');
    children[0].emit('exit', 0);
    expect(runtime.exit).toHaveBeenCalledWith(2);
  });
  it('bounds shutdown instead of leaving an orphaned worker running', async () => {
    vi.useFakeTimers();
    const { runtime, children, result } = setup();
    result.stop();
    await vi.advanceTimersByTimeAsync(100);
    children.forEach((child) => expect(child.kill).toHaveBeenCalledWith('SIGKILL'));
    expect(runtime.exit).toHaveBeenCalledWith(1);
  });
});
