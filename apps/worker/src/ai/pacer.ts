import { setTimeout as sleep } from 'node:timers/promises';

export class RequestPacer {
  private nextAllowedAt = 0;
  private turn: Promise<void> = Promise.resolve();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly wait: (milliseconds: number) => Promise<unknown> = sleep,
  ) {}
  async pace(intervalMilliseconds: number): Promise<void> {
    if (intervalMilliseconds <= 0) return;
    const next = this.turn.then(async () => {
      const remaining = Math.max(0, this.nextAllowedAt - this.now());
      if (remaining) await this.wait(remaining);
      this.nextAllowedAt = this.now() + intervalMilliseconds;
    });
    this.turn = next.catch(() => {});
    await next;
  }
}

// Shared by capability checks and all provider instances in this worker process.
export const geminiTextPacer = new RequestPacer();
