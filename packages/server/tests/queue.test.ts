import { describe, expect, it } from 'vitest';
import { parseRedisConnection } from '../src/queue.js';

describe('Redis connection URL', () => {
  it('defaults to db0 and preserves a configured database and TLS credentials', () => {
    expect(parseRedisConnection('redis://localhost:6379').db).toBe(0);
    expect(parseRedisConnection('rediss://worker:p%40ss@cache.example:6380/12')).toMatchObject({
      host: 'cache.example',
      port: 6380,
      db: 12,
      username: 'worker',
      password: 'p@ss',
      tls: {},
    });
  });
  it.each([
    'redis://localhost/-1',
    'redis://localhost/65536',
    'redis://localhost/1/2',
    'redis://localhost/not-a-db',
    'http://localhost/0',
  ])('rejects an invalid connection %s', (url) => {
    expect(() => parseRedisConnection(url)).toThrow();
  });
});
