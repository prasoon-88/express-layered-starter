import { BullMQOtel } from 'bullmq-otel';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Env } from '#constants/env/schema';
import { JOB_ENQUEUE_TIMEOUT_MS } from '#constants/queue.constant';
import type { ReadinessCheck } from '#lib/health/index';
import { closeRedisClient, createRedisClient } from '#lib/redis/index';
import { concatenateStrings } from '#utils/concatenateStrings.util';
import { createJobProducer, type Jobs } from './producer.ts';

export {
  JobConfigError,
  JobEnqueueError,
  JobTimeoutError,
  JobsUnavailableError,
  PermanentJobError,
} from './errors.ts';
export {
  defineJob,
  type AnyJob,
  type JobDefinition,
  type JobInput,
  type JobPayload,
  type JobPolicy,
} from './job.ts';
export type { EnqueueOptions, Jobs } from './producer.ts';
export { checkQueueRedis } from './redis.ts';
export { defineQueue, type QueueDefinition, type QueueRateLimit } from './queue.ts';
export { defineSchedule, syncJobSchedules, type JobSchedule } from './schedule.ts';
export {
  handleJob,
  queueDefinitions,
  startJobWorkers,
  type JobContext,
  type JobHandler,
  type JobWorkers,
} from './worker.ts';

const MAX_RECONNECT_DELAY_MS = 3_000;
const RECONNECT_STEP_MS = 100;

/** Every queue key starts with it, so services sharing a Redis never share a queue. */
export const queuePrefix = (env: Pick<Env, 'SERVICE_NAME'>) =>
  concatenateStrings([env.SERVICE_NAME, 'jobs'], ':');

/** Spans for enqueueing and running jobs, through the OpenTelemetry API (no-op until it starts). */
export const queueTelemetry = () => new BullMQOtel({ tracerName: 'bullmq', enableMetrics: false });

/**
 * The producer side, for the API process: `jobs.enqueue`, on a connection of its own to
 * QUEUE_REDIS_URL, or REDIS_URL when that is not set. With neither, every enqueue rejects with
 * JobsUnavailableError and the API still boots, as it does without Redis.
 */
export const initJobs = async (
  env: Env,
  log: Logger,
): Promise<{
  jobs: Jobs;
  readinessChecks: readonly ReadinessCheck[];
  close: () => Promise<void>;
}> => {
  const url = env.QUEUE_REDIS_URL ?? env.REDIS_URL;
  // Fails fast while disconnected (no offline queue), so an enqueue rejects instead of waiting.
  const connection = url
    ? await createRedisClient(url, log, { connectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS })
    : undefined;

  const producer = createJobProducer({
    redis: connection,
    prefix: queuePrefix(env),
    timeoutMs: JOB_ENQUEUE_TIMEOUT_MS,
    log,
    telemetry: queueTelemetry(),
  });

  return {
    jobs: producer.jobs,
    // Non-critical: only the routes that enqueue need it, and they answer 503 meanwhile.
    readinessChecks: connection
      ? [{ name: 'job-queue', critical: false, run: async () => void (await connection.ping()) }]
      : [],
    close: async () => {
      await producer.close();
      if (connection) await closeRedisClient(connection);
    },
  };
};

/**
 * The worker side's connection. BullMQ requires `maxRetriesPerRequest: null` on a connection it
 * blocks on; commands then wait out a disconnect instead of failing, which is what a worker wants.
 */
export const connectWorkerRedis = (url: string, log: Logger) => {
  const redis = new Redis(url, {
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => Math.min(attempt * RECONNECT_STEP_MS, MAX_RECONNECT_DELAY_MS),
  });
  redis.on('error', (err: unknown) => log.error({ err, connection: 'jobs' }, 'redis error'));
  return redis;
};
