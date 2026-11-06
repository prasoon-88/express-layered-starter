import type { Env } from '#constants/env/schema';
import type { Redis } from '#lib/redis/index';
import type { Logger } from 'pino';
import { concatenateStrings } from '#utils/concateStrings';
import { createIdempotent } from './middleware.ts';
import { buildDefaultPolicies, createPolicyRegistry } from './policies.ts';
import { createStoreReadinessCheck } from './readiness.ts';
import { createRun, type Run } from './run.ts';
import { createMemoryStore } from './memory.store.ts';
import { createRedisStore } from './redis.store.ts';

export const initIdempotency = (env: Env, log: Logger, redis?: Redis) => {
  const store =
    env.IDEMPOTENCY_STORE === 'redis' && redis ? createRedisStore(redis) : createMemoryStore();

  if (
    env.IDEMPOTENCY_ENABLED &&
    !(env.IDEMPOTENCY_STORE === 'redis' && redis) &&
    env.NODE_ENV === 'production'
  )
    log.warn(
      'Idempotency uses the in-memory store: keys are per instance, not shared across replicas',
    );

  const policies = createPolicyRegistry(buildDefaultPolicies(env));
  const prefix = concatenateStrings([env.SERVICE_NAME, 'idem'], ':');
  const passthrough: Run = async (_name, _options, work) => ({
    skipped: false,
    value: await work(),
  });

  const idempotent = createIdempotent({
    enabled: env.IDEMPOTENCY_ENABLED,
    store,
    policies,
    prefix,
    maxBodyBytes: env.IDEMPOTENCY_MAX_BODY_BYTES,
    onStoreError: env.IDEMPOTENCY_ON_STORE_ERROR,
    log,
  });

  const readinessChecks = store.ping
    ? [
        createStoreReadinessCheck({
          ping: store.ping,
          onStoreError: env.IDEMPOTENCY_ON_STORE_ERROR,
        }),
      ]
    : [];

  return Promise.resolve({
    idempotent,
    run: env.IDEMPOTENCY_ENABLED ? createRun({ store, prefix, log }) : passthrough,
    close: () => Promise.resolve(),
    readinessChecks,
  });
};

export type Idempotency = ReturnType<typeof initIdempotency>;
