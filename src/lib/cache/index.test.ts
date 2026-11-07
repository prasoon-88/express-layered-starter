import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import pino, { type Logger } from 'pino';
import * as z from 'zod';
import { parseEnv } from '#constants/env/schema';
import { closeRedisClient, createRedisClient, type Redis } from '#lib/redis/index';
import type { ReadinessCheck } from '#lib/health/index';
import { freePort, holdDeadPort, redisSkip, startRedisServer } from '#testing/redisServer';
import { defineCacheSpec, initCache } from './index.ts';

const silent = pino({ level: 'silent' });

const recordingLog = () => {
  const warnings: string[] = [];
  const log = Object.assign(Object.create(silent) as Logger, {
    warn: (...args: unknown[]) => warnings.push(String(args.at(-1))),
  });
  return { log, warnings };
};

/** The cache opens its own connection; the first commands sent before it is up fall through. */
const connected = async (checks: readonly ReadinessCheck[]) => {
  for (let attempt = 0; ; attempt++) {
    try {
      await checks[0]!.run();
      return;
    } catch (err) {
      if (attempt === 100) throw err;
      await sleep(20);
    }
  }
};

const env = (overrides: Record<string, string> = {}) =>
  parseEnv({ NODE_ENV: 'test', SERVICE_NAME: `cache-test-${randomUUID()}`, ...overrides });

const production = (overrides: Record<string, string> = {}) =>
  env({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32), ...overrides });

const userSpec = defineCacheSpec({
  name: 'user',
  schema: z.object({ id: z.string(), name: z.string() }),
  ttlS: 60,
  tags: { one: (id: string) => [id] },
});

const ada = { id: 'u1', name: 'Ada' };
const byId = { key: ['byId', 'u1'], tags: [userSpec.tags.one('u1')] };

const counting = () => {
  let runs = 0;
  return {
    runs: () => runs,
    load: () => {
      runs++;
      return Promise.resolve(ada);
    },
  };
};

describe('initCache with the memory store', () => {
  it('caches in memory and reports no readiness check', async () => {
    const { cache, readinessChecks, close } = initCache(env(), silent);
    const loader = counting();
    const users = cache.entity(userSpec);
    await users.query(byId, loader.load);
    await users.query(byId, loader.load);
    assert.equal(loader.runs(), 1);
    assert.deepEqual(readinessChecks, []);
    await close();
  });

  it('runs every loader while CACHE_ENABLED=false', async () => {
    const { cache } = initCache(env({ CACHE_ENABLED: 'false' }), silent);
    const loader = counting();
    await cache.entity(userSpec).query(byId, loader.load);
    await cache.entity(userSpec).query(byId, loader.load);
    assert.equal(loader.runs(), 2);
  });

  it('warns in production, where replicas would not see each other’s invalidations', () => {
    const { log, warnings } = recordingLog();
    initCache(production(), log);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /in-memory store/);
  });

  it('does not warn when the cache is disabled', () => {
    const { log, warnings } = recordingLog();
    initCache(production({ CACHE_ENABLED: 'false' }), log);
    assert.deepEqual(warnings, []);
  });

  it('refuses CACHE_STORE=redis without a Redis client', () => {
    assert.throws(
      () => initCache(env({ CACHE_STORE: 'redis', REDIS_URL: 'redis://127.0.0.1:1' }), silent),
      /needs a Redis client/,
    );
  });
});

describe('initCache with the Redis store', { skip: redisSkip }, () => {
  let redis: Redis;
  let url = '';

  before(async () => {
    const port = await freePort();
    await startRedisServer(port);
    url = `redis://127.0.0.1:${port}`;
    redis = await createRedisClient(url, silent, { connectTimeoutMs: 1_000 });
  });

  after(async () => {
    await closeRedisClient(redis);
  });

  const redisEnv = (overrides: Record<string, string> = {}) =>
    env({ CACHE_STORE: 'redis', REDIS_URL: url, ...overrides });

  it('stores entries in the Redis it was given, under SERVICE_NAME:cache', async () => {
    // BentoCache falls back to its own client at 127.0.0.1:6379 when it does not recognise the
    // one it is given. The server here listens on another port, so finding the keys on it proves
    // the given connection was used.
    const shared = redisEnv();
    const { cache, readinessChecks, close } = initCache(shared, silent, redis);
    try {
      await connected(readinessChecks);
      await cache.entity(userSpec).query(byId, () => Promise.resolve(ada));
      const keys = await redis.keys(`${shared.SERVICE_NAME}:cache:*`);
      assert.ok(
        keys.some((key) => key.includes('user:')),
        keys.join(', '),
      );
    } finally {
      await close();
    }
  });

  it('shares entries and invalidations between instances, the way replicas do', async () => {
    const shared = redisEnv();
    const a = initCache(shared, silent, redis);
    const b = initCache(shared, silent, redis);
    try {
      await connected(a.readinessChecks);
      await connected(b.readinessChecks);
      const loader = counting();
      await a.cache.entity(userSpec).query(byId, loader.load);
      await b.cache.entity(userSpec).query(byId, loader.load);
      assert.equal(loader.runs(), 1, 'b reads what a stored');

      await b.cache.invalidate(userSpec.tags.one('u1'));
      await a.cache.entity(userSpec).query(byId, loader.load);
      assert.equal(loader.runs(), 2, 'a sees what b invalidated');
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('keeps the memory copies of every instance right, with CACHE_L1_ENABLED', async () => {
    const shared = redisEnv({ CACHE_L1_ENABLED: 'true' });
    const a = initCache(shared, silent, redis);
    const b = initCache(shared, silent, redis);
    try {
      await connected(a.readinessChecks);
      await connected(b.readinessChecks);
      // The bus subscribes on its own connections, as they come up.
      await sleep(200);
      const loader = counting();
      // Both hold the entry in memory now.
      await a.cache.entity(userSpec).query(byId, loader.load);
      await b.cache.entity(userSpec).query(byId, loader.load);
      await a.cache.entity(userSpec).query(byId, loader.load);
      assert.equal(loader.runs(), 1);

      // No wait for a bus message: the next read builds a new key, which no memory holds.
      await b.cache.invalidate(userSpec.tags.one('u1'));
      await a.cache.entity(userSpec).query(byId, loader.load);
      assert.equal(loader.runs(), 2);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('reports the store in readiness, as non-critical', async () => {
    const { readinessChecks, close } = initCache(redisEnv(), silent, redis);
    try {
      assert.equal(readinessChecks.length, 1);
      assert.equal(readinessChecks[0]?.name, 'cache-store');
      assert.equal(readinessChecks[0]?.critical, false);
      await connected(readinessChecks);
    } finally {
      await close();
    }
  });

  it('loads a key once across instances that miss it together, with clusterLockMs', async () => {
    const shared = redisEnv();
    const instances = Array.from({ length: 5 }, () => initCache(shared, silent, redis));
    const hotSpec = defineCacheSpec({
      name: 'hot',
      schema: userSpec.schema,
      ttlS: 60,
      clusterLockMs: 2_000,
    });
    try {
      for (const instance of instances) await connected(instance.readinessChecks);
      let runs = 0;
      const slowLoad = async () => {
        runs++;
        await sleep(100);
        return ada;
      };
      const results = await Promise.all(
        instances.map((instance) => instance.cache.entity(hotSpec).query({ key: ['k'] }, slowLoad)),
      );
      assert.equal(runs, 1);
      for (const result of results) assert.deepEqual(result, ada);
    } finally {
      for (const instance of instances) await instance.close();
    }
  });

  it('loads by itself when the lock holder never stores, once clusterLockMs passes', async () => {
    const shared = redisEnv();
    const [stuck, waiting] = [initCache(shared, silent, redis), initCache(shared, silent, redis)];
    const spec = defineCacheSpec({
      name: 'stuck',
      schema: userSpec.schema,
      ttlS: 60,
      clusterLockMs: 100,
    });
    let release = () => {};
    try {
      await connected(stuck.readinessChecks);
      await connected(waiting.readinessChecks);
      // The holder takes the lock and hangs, as an instance would that stalled or died mid-load.
      const hanging = stuck.cache
        .entity(spec)
        .query(
          { key: ['k'] },
          () => new Promise<typeof ada>((resolve) => (release = () => resolve(ada))),
        );
      await sleep(30);
      const loader = counting();
      assert.deepEqual(await waiting.cache.entity(spec).query({ key: ['k'] }, loader.load), ada);
      assert.equal(loader.runs(), 1);
      release();
      await hanging;
    } finally {
      await stuck.close();
      await waiting.close();
    }
  });

  it('reads nothing cached under another server, once it notices the server changed', async () => {
    const shared = redisEnv({ CACHE_PRIMARY_CHECK_MS: '20' });
    const { cache, readinessChecks, close } = initCache(shared, silent, redis);
    try {
      await connected(readinessChecks);
      const loader = counting();
      await cache.entity(userSpec).query(byId, loader.load);
      // As a promoted replica holds it after a failover: the epoch, made under the old primary.
      await redis.set(`${shared.SERVICE_NAME}:cache-v:epoch`, 'old-primary/epoch');
      for (let attempt = 0; attempt < 100; attempt++) {
        const epoch = await redis.get(`${shared.SERVICE_NAME}:cache-v:epoch`);
        if (!epoch?.startsWith('old-primary/')) break;
        await sleep(20);
      }
      await cache.entity(userSpec).query(byId, loader.load);
      assert.equal(loader.runs(), 2, 'every key moved with the new epoch');
    } finally {
      await close();
    }
  });

  it('closes cleanly before any use', async () => {
    const { close } = initCache(redisEnv(), silent, redis);
    await close();
  });

  describe('with Redis unreachable', () => {
    let down: Redis;
    let downUrl = '';

    before(async () => {
      const { port } = await holdDeadPort();
      downUrl = `redis://127.0.0.1:${port}`;
      down = await createRedisClient(downUrl, silent, { connectTimeoutMs: 200 });
    });

    after(async () => {
      await closeRedisClient(down);
    });

    it('serves every read from its loader, and rejects invalidations and the readiness check', async () => {
      const { cache, readinessChecks, close } = initCache(
        env({ CACHE_STORE: 'redis', REDIS_URL: downUrl }),
        silent,
        down,
      );
      try {
        const loader = counting();
        assert.deepEqual(await cache.entity(userSpec).query(byId, loader.load), ada);
        assert.deepEqual(await cache.entity(userSpec).query(byId, loader.load), ada);
        assert.equal(loader.runs(), 2);
        await assert.rejects(cache.invalidate(userSpec.tags.one('u1')));
        await assert.rejects(readinessChecks[0]!.run());
      } finally {
        await close();
      }
    });
  });
});
