import { createApp } from './app.ts';
import { initRateLimit } from '#rateLimiter';
import { initIdempotency } from '#idempotency';
import { getLogger } from '#lib/logger/index';
import ENV_CONSTANTS from '#constants/env/index';
import { createHttpServer } from '#lib/http/createHttpServer';
import { registerProcessHandler } from '#lib/lifecycle/index';
import { closeRedisClient, createRedisClient } from '#lib/redis/index';
import type { ReadinessCheck } from '#lib/health/index';

const logger = getLogger('server');

const authUsesRedis = ENV_CONSTANTS.AUTH_STORE === 'redis';
const sharesRedis =
  authUsesRedis ||
  (ENV_CONSTANTS.RATE_LIMIT_ENABLED && ENV_CONSTANTS.RATE_LIMIT_STORE === 'redis') ||
  (ENV_CONSTANTS.IDEMPOTENCY_ENABLED && ENV_CONSTANTS.IDEMPOTENCY_STORE === 'redis');

const redis =
  sharesRedis && ENV_CONSTANTS.REDIS_URL
    ? await createRedisClient(ENV_CONSTANTS.REDIS_URL, logger, {
        connectTimeoutMs: ENV_CONSTANTS.REDIS_CONNECT_TIMEOUT_MS,
      })
    : undefined;

export const rateLimiter = await initRateLimit(ENV_CONSTANTS, logger, redis);
export const idempotency = await initIdempotency(ENV_CONSTANTS, logger, redis);

if (!authUsesRedis && ENV_CONSTANTS.NODE_ENV === 'production')
  logger.warn(
    'Refresh tokens use the in-memory store: sessions are per instance and end on restart',
  );

// Critical: without the session store nobody can log in or refresh, so this instance should
// leave rotation. Access tokens keep working, since checking them needs no store.
const authReadiness: ReadinessCheck[] =
  authUsesRedis && redis ? [{ name: 'auth-store', critical: true, run: () => redis.ping() }] : [];

const { app } = createApp({
  env: ENV_CONSTANTS,
  rl: rateLimiter,
  idempotency,
  redis,
  readinessChecks: [
    ...rateLimiter.readinessChecks,
    ...idempotency.readinessChecks,
    ...authReadiness,
  ],
});

const server = createHttpServer({ app, env: ENV_CONSTANTS });

server.listen(ENV_CONSTANTS.PORT, () => {
  logger.info({ port: ENV_CONSTANTS.PORT, env: ENV_CONSTANTS.NODE_ENV }, 'server started');
});

registerProcessHandler({
  server,
  hooks: [
    () => rateLimiter.close(),
    () => idempotency.close(),
    async () => {
      if (redis) await closeRedisClient(redis);
    },
  ],
});
