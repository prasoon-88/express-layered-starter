import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { closeRedisClient, createRedisClient, type Redis } from '#lib/redis/index';
import { freePort, redisSkip, startRedisServer } from '#testing/redisServer';
import type { CacheTag } from './spec.ts';
import { createMemoryTagVersions, createRedisTagVersions, epochKey } from './versions.ts';

const tag = (name: string) => JSON.stringify([name]) as CacheTag;
const [a, b, c] = [tag('a'), tag('b'), tag('c')];

describe('createMemoryTagVersions', () => {
  it('keeps a token until it is bumped, then gives a new one', async () => {
    const versions = createMemoryTagVersions(10);
    const first = await versions.current([a, b]);
    assert.deepEqual(await versions.current([a, b]), first);

    await versions.bump([a]);
    const second = await versions.current([a, b]);
    assert.notEqual(second?.[0], first?.[0]);
    assert.equal(second?.[1], first?.[1]);
  });

  it('drops the oldest token past its cap, which then comes back new', async () => {
    const versions = createMemoryTagVersions(2);
    const [first] = (await versions.current([a]))!;
    await versions.current([b]);
    await versions.current([c]);
    assert.notEqual((await versions.current([a]))![0], first);
  });
});

describe('createRedisTagVersions', { skip: redisSkip }, () => {
  const silent = pino({ level: 'silent' });
  let redis: Redis;

  before(async () => {
    const port = await freePort();
    await startRedisServer(port);
    redis = await createRedisClient(`redis://127.0.0.1:${port}`, silent, {
      connectTimeoutMs: 1_000,
    });
  });

  after(async () => {
    await closeRedisClient(redis);
  });

  const setup = async ({ tokenTtlMs = 60_000, withEpoch = true } = {}) => {
    const prefix = `versions-${randomUUID()}:`;
    if (withEpoch) await redis.set(epochKey(prefix), 'run/epoch');
    return { prefix, versions: createRedisTagVersions(redis, { prefix, tokenTtlMs }) };
  };

  it('gives the epoch, then one stable token per tag, until a bump replaces it', async () => {
    const { versions } = await setup();
    const first = await versions.current([a, b]);
    assert.equal(first?.length, 3);
    assert.equal(first?.[0], 'run/epoch');
    assert.deepEqual(await versions.current([a, b]), first);

    await versions.bump([a]);
    const second = await versions.current([a, b]);
    assert.notEqual(second?.[1], first?.[1]);
    assert.equal(second?.[2], first?.[2]);
  });

  it('answers undefined while the epoch is not set, and makes no token then', async () => {
    const { prefix, versions } = await setup({ withEpoch: false });
    assert.equal(await versions.current([a]), undefined);
    assert.equal(await redis.exists(`${prefix}tag:${a}`), 0);
  });

  it('gives a token its lifetime, and renews it once half has passed', async () => {
    const { prefix, versions } = await setup({ tokenTtlMs: 10_000 });
    const key = `${prefix}tag:${a}`;
    await versions.current([a]);
    assert.ok((await redis.pttl(key)) > 9_000);

    await redis.pexpire(key, 4_000);
    await versions.current([a]);
    assert.ok((await redis.pttl(key)) > 9_000, 'renewed below half');

    await redis.pexpire(key, 6_000);
    await versions.current([a]);
    assert.ok((await redis.pttl(key)) <= 6_000, 'left alone above half');
  });

  it('rejects a bump the store did not take, and sends nothing for no tags', async () => {
    // A lifetime Redis refuses makes the SET in the transaction fail.
    const broken = createRedisTagVersions(redis, {
      prefix: `versions-${randomUUID()}:`,
      tokenTtlMs: 0,
    });
    await assert.rejects(broken.bump([a]), /invalid expire time/);
    await broken.bump([]);
  });
});
