import ENV_CONSTANTS from '#constants/env/index';
import type { Env } from '#constants/env/schema';
import { createRedisClient } from '#lib/redis/index';
import type { Logger } from 'pino';
import { buildDefaultPolicies, createPolicyRegistry } from './policies.ts';
import { createRateLimitEngine } from './engine.ts';
import { concatenateStrings } from '#utils/concateStrings';
import { startPolicySync } from './policySync.ts';
import { createLimit } from './middleware.ts';

export const initRateLimit = async (env: Env, log: Logger) => {
  const redis =
    ENV_CONSTANTS.RATE_LIMIT_ENABLED && ENV_CONSTANTS.RATE_LIMIT_STORE === 'redis'
      ? await createRedisClient(ENV_CONSTANTS.REDIS_URL!, log)
      : undefined;

  if (ENV_CONSTANTS.RATE_LIMIT_ENABLED && !redis && env.NODE_ENV === 'production')
    log.warn(
      'Rate limiting uses the in-memory store: limits are per instance, not shared across replicas',
    );

  const policies = createPolicyRegistry(buildDefaultPolicies(env));

  const engine = createRateLimitEngine({
    policies,
    prefix: concatenateStrings([ENV_CONSTANTS.SERVICE_NAME, 'rl'], ':'),
    onStoreError: ENV_CONSTANTS.RATE_LIMIT_ON_STORE_ERROR,
    log,
  });

  const stopSync =
    redis && ENV_CONSTANTS.RATE_LIMIT_POLICY_REFRESH_S > 0
      ? startPolicySync({
          redis,
          registry: policies,
          hasKey: concatenateStrings([ENV_CONSTANTS.SERVICE_NAME, 'rl-config'], ':'),
          intervalS: ENV_CONSTANTS.RATE_LIMIT_POLICY_REFRESH_S,
          log,
        })
      : undefined;

  const limit = createLimit({
    enabled: ENV_CONSTANTS.RATE_LIMIT_ENABLED,
    engine,
    ipv6Subnet: ENV_CONSTANTS.RATE_LIMIT_IPV6_SUBNET,
    skipPaths: ENV_CONSTANTS.RATE_LIMIT_SKIP_PATHS,
  });

  const close = async () => {
    stopSync?.();
    await redis?.quit();
  };

  return {
    limit,
    close,
  };
};

export type RateLimiter = ReturnType<typeof initRateLimit>;
