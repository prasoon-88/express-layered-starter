import type { Env } from '#constants/env/schema';
import { closeRedisClient, createRedisClient, type Redis } from '#lib/redis/index';
import type { Logger } from 'pino';
import { buildDefaultPolicies, createPolicyRegistry } from './policies.ts';
import { createRateLimitEngine } from './engine.ts';
import { concatenateStrings } from '#utils/concateStrings';
import { startPolicySync } from './policySync.ts';
import { createLimit } from './middleware.ts';
import { createStoreReadinessCheck } from './readiness.ts';

export const initRateLimit = async (env: Env, log: Logger, sharedRedis?: Redis) => {
  const ownedRedis =
    sharedRedis === undefined &&
    env.RATE_LIMIT_ENABLED &&
    env.RATE_LIMIT_STORE === 'redis' &&
    env.REDIS_URL
      ? await createRedisClient(env.REDIS_URL, log, {
          connectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS,
        })
      : undefined;

  const redis =
    env.RATE_LIMIT_ENABLED && env.RATE_LIMIT_STORE === 'redis'
      ? (sharedRedis ?? ownedRedis)
      : undefined;

  if (env.RATE_LIMIT_ENABLED && !redis && env.NODE_ENV === 'production')
    log.warn(
      'Rate limiting uses the in-memory store: limits are per instance, not shared across replicas',
    );

  const policies = createPolicyRegistry(buildDefaultPolicies(env));

  const engine = createRateLimitEngine({
    policies,
    prefix: concatenateStrings([env.SERVICE_NAME, 'rl'], ':'),
    onStoreError: env.RATE_LIMIT_ON_STORE_ERROR,
    log,
    redis,
  });

  const stopSync =
    redis && env.RATE_LIMIT_POLICY_REFRESH_S > 0
      ? startPolicySync({
          redis,
          registry: policies,
          hasKey: concatenateStrings([env.SERVICE_NAME, 'rl-config'], ':'),
          intervalS: env.RATE_LIMIT_POLICY_REFRESH_S,
          log,
        })
      : undefined;

  const limit = createLimit({
    enabled: env.RATE_LIMIT_ENABLED,
    engine,
    ipv6Subnet: env.RATE_LIMIT_IPV6_SUBNET,
    skipPaths: env.RATE_LIMIT_SKIP_PATHS,
  });

  const close = async () => {
    stopSync?.();
    if (ownedRedis) await closeRedisClient(ownedRedis);
  };

  const readinessChecks = redis
    ? [createStoreReadinessCheck({ redis, onStoreError: env.RATE_LIMIT_ON_STORE_ERROR })]
    : [];

  return {
    limit,
    close,
    readinessChecks,
  };
};

export type RateLimiter = ReturnType<typeof initRateLimit>;
