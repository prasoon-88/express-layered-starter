import { BentoCache, bentostore } from 'bentocache';
import { memoryDriver } from 'bentocache/drivers/memory';
import { redisBusDriver, redisDriver } from 'bentocache/drivers/redis';
import type { Logger } from 'pino';
import {
  CACHE_OUTBOX_BATCH_SIZE,
  CACHE_OUTBOX_LEASE_MS,
  CACHE_TOKEN_TTL_FACTOR,
} from '#constants/cache.constant';
import type { Env } from '#constants/env/schema';
import { MS_PER_SECOND } from '#constants/time.constant';
import type { ReadinessCheck } from '#lib/health/index';
import { duplicateRedisClient, type Redis } from '#lib/redis/index';
import { concatenateStrings } from '#utils/concatenateStrings.util';
import { createCache, type Cache } from './client.ts';
import { createRedisKeyLock } from './lock.ts';
import { createMemoryCacheOutbox, createOutboxRelay, type CacheOutboxStore } from './outbox.ts';
import { createPrimaryGuard } from './primary.ts';
import { createMemoryTagVersions, createRedisTagVersions, epochKey } from './versions.ts';

export type { Cache, EntityCache, QueryOptions } from './client.ts';
export { CacheConfigError, CacheLoadTimeoutError } from './errors.ts';
export {
  createMemoryCacheOutbox,
  type CacheOutboxStore,
  type MemoryCacheOutbox,
  type OutboxEntry,
} from './outbox.ts';
export {
  defineCacheSpec,
  type AnyCacheSpec,
  type CacheSpec,
  type CacheTag,
  type CacheTiming,
  type KeyPart,
  type SpecOutput,
} from './spec.ts';

// Its own logs at info are one line per load; warnings and errors are what an operator needs.
const BENTO_LOG_LEVEL = 'warn';

/** At least warn, and never louder than the logger it is made from. */
const bentoLogger = (log: Logger) =>
  log.child(
    { component: 'cache' },
    { level: log.levelVal > log.levels.values[BENTO_LOG_LEVEL]! ? log.level : BENTO_LOG_LEVEL },
  );

type InitCacheOptions = {
  /** Where invalidations recorded with a write wait for delivery. In memory by default. */
  outbox?: CacheOutboxStore;
};

export const initCache = (
  env: Env,
  log: Logger,
  redis?: Redis,
  { outbox = createMemoryCacheOutbox() }: InitCacheOptions = {},
): { cache: Cache; readinessChecks: readonly ReadinessCheck[]; close: () => Promise<void> } => {
  // A memory layer in front, sized in entries, is the whole store without Redis.
  const memory = () => memoryDriver({ maxItems: env.CACHE_MEMORY_MAX_ENTRIES });
  const prefix = concatenateStrings([env.SERVICE_NAME, 'cache'], ':');

  // Built even with CACHE_ENABLED=false: invalidations still reach it, so an instance that is
  // enabled later, or one enabled next to it in a rolling deploy, never serves what they removed.
  const store = bentostore();
  const readinessChecks: ReadinessCheck[] = [];
  let shared: ReturnType<typeof sharedParts> | undefined;

  if (env.CACHE_STORE === 'redis') {
    if (!redis) throw new Error('CACHE_STORE=redis needs a Redis client, and none was given');
    shared = sharedParts(env, log, redis, `${prefix}-v:`);
    store.useL2Layer(redisDriver({ connection: shared.connection }));
    // The bus tells the other instances to drop their memory copy of a key written again. It opens
    // a publisher and a subscriber from these options. Their commands queue while disconnected:
    // BentoCache neither awaits nor catches its SUBSCRIBE, so one that failed fast would be an
    // unhandled rejection, and ioredis subscribes again by itself after a reconnect.
    if (env.CACHE_L1_ENABLED)
      store.useL1Layer(memory()).useBus(
        redisBusDriver({
          connection: { ...redis.options, lazyConnect: false, enableOfflineQueue: true },
        }),
      );
    const { connection, guard } = shared;
    // Non-critical: until it passes, every lookup goes to its loader.
    readinessChecks.push({
      name: 'cache-store',
      critical: false,
      run: async () => {
        await connection.ping();
        if (!guard.usable()) throw new Error('cache epoch not checked against this Redis server');
      },
    });
  } else {
    store.useL1Layer(memory());
    if (env.CACHE_ENABLED && env.NODE_ENV === 'production')
      log.warn(
        'Cache uses the in-memory store: an invalidation on one instance does not reach the others, so they serve stale data until the TTL',
      );
  }

  const bento = new BentoCache({
    default: 'cache',
    stores: { cache: store },
    prefix,
    logger: bentoLogger(log),
  });

  const cache = createCache({
    bento,
    versions: shared?.versions ?? createMemoryTagVersions(env.CACHE_MEMORY_MAX_ENTRIES),
    usable: shared?.guard.usable,
    lock: shared?.lock,
    enabled: env.CACHE_ENABLED,
    maxTtlS: env.CACHE_MAX_TTL_S,
    log,
  });

  const relay = createOutboxRelay({
    store: outbox,
    invalidate: cache.invalidate,
    pollMs: env.CACHE_OUTBOX_POLL_MS,
    leaseMs: CACHE_OUTBOX_LEASE_MS,
    batchSize: CACHE_OUTBOX_BATCH_SIZE,
    log,
  });
  outbox.onEnqueue?.(relay.kick);
  shared?.guard.start();
  relay.start();

  return {
    cache,
    readinessChecks,
    close: async () => {
      await relay.stop();
      shared?.guard.stop();
      await bento.disconnectAll();
      // BentoCache drops the layers it has opened, which it does on first use, and this covers a
      // cache never used. Dropped, not quit: a write still in flight is only a cache write.
      shared?.connection.disconnect();
    },
  };
};

/** What instances sharing one Redis need: tag versions, the primary guard and the key lock. */
const sharedParts = (env: Env, log: Logger, redis: Redis, prefix: string) => {
  // Its own connection, with a per-command timeout, so a slow cache never queues the commands of
  // sessions, rate limits or idempotency behind it. Auto-pipelining sends the commands of
  // concurrent requests in one write: many small reads is what a cache does.
  const connection = duplicateRedisClient(redis, log, {
    commandTimeoutMs: env.CACHE_OP_TIMEOUT_MS,
    name: 'cache',
    autoPipelining: true,
  });
  // Longer than any entry lives, so a token lapses only when nothing has read it for that long.
  const tokenTtlMs = env.CACHE_MAX_TTL_S * MS_PER_SECOND * CACHE_TOKEN_TTL_FACTOR;
  return {
    connection,
    versions: createRedisTagVersions(connection, { prefix, tokenTtlMs }),
    guard: createPrimaryGuard(connection, {
      epochKey: epochKey(prefix),
      epochTtlMs: tokenTtlMs,
      checkMs: env.CACHE_PRIMARY_CHECK_MS,
      log,
    }),
    lock: createRedisKeyLock(connection, { prefix }),
  };
};
