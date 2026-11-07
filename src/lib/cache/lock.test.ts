import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import pino from 'pino';
import { closeRedisClient, createRedisClient, type Redis } from '#lib/redis/index';
import { freePort, redisSkip, startRedisServer } from '#testing/redisServer';
import { createRedisKeyLock } from './lock.ts';

describe('createRedisKeyLock', { skip: redisSkip }, () => {
  let redis: Redis;

  before(async () => {
    const port = await freePort();
    await startRedisServer(port);
    redis = await createRedisClient(`redis://127.0.0.1:${port}`, pino({ level: 'silent' }), {
      connectTimeoutMs: 1_000,
    });
  });

  after(async () => {
    await closeRedisClient(redis);
  });

  const lock = () => createRedisKeyLock(redis, { prefix: `lock-test-${randomUUID()}:` });

  it('gives the lock to one caller at a time, until it is released', async () => {
    const keys = lock();
    const token = await keys.acquire('k', 5_000);
    assert.ok(token);
    assert.equal(await keys.acquire('k', 5_000), undefined);
    assert.ok(await keys.acquire('other', 5_000), 'per key');

    await keys.release('k', token);
    assert.ok(await keys.acquire('k', 5_000));
  });

  it('lapses by itself, and a lapsed holder cannot free the next one', async () => {
    const keys = lock();
    const lapsed = await keys.acquire('k', 20);
    assert.ok(lapsed);
    await sleep(40);

    const next = await keys.acquire('k', 5_000);
    assert.ok(next);
    await keys.release('k', lapsed);
    assert.equal(await keys.acquire('k', 5_000), undefined, 'still held by the next one');
  });
});
