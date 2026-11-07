// The worker process: runs background jobs, apart from the API so a slow job never holds up a
// request and each scales on its own. Started with `pnpm start:worker` (`pnpm dev:worker` while
// developing); in Docker, the same image with `dist/worker.js` as its command.
import { ENV_CONSTANTS } from '#constants/env/index';
import { getLogger } from '#lib/logger/index';
import { registerProcessHandler } from '#lib/lifecycle/index';
import { lifecycleState } from '#lib/lifecycle/state';
import {
  checkQueueRedis,
  connectWorkerRedis,
  queuePrefix,
  queueTelemetry,
  startJobWorkers,
  syncJobSchedules,
  queueDefinitions,
  type JobWorkers,
} from '#lib/queue/index';
import { createWorkerHealthServer } from '#lib/queue/health';
import { telemetryConfig } from '#config/telemetry.config';
import { isTelemetryStarted, shutdownTelemetry } from '#lib/telemetry/state';
import { createJobHandlers, createJobSchedules } from '#workers/index';

const logger = getLogger('worker');

if (telemetryConfig.enabled && !isTelemetryStarted())
  logger.warn(
    'OpenTelemetry is configured but was not started: run with `--import ./dist/instrumentation.js` (pnpm start:worker does)',
  );

const url = ENV_CONSTANTS.QUEUE_REDIS_URL ?? ENV_CONSTANTS.REDIS_URL;
if (!url) {
  logger.fatal('The worker needs a queue: set QUEUE_REDIS_URL, or REDIS_URL');
  process.exit(1);
}

const redis = connectWorkerRedis(url, logger);
let workers: JobWorkers | undefined;

// Up first, so probes answer (not ready) while Redis is still being reached.
const server = createWorkerHealthServer(() => workers?.ready() ?? false);
server.listen(ENV_CONSTANTS.WORKER_HEALTH_PORT, () => {
  logger.info({ port: ENV_CONSTANTS.WORKER_HEALTH_PORT }, 'worker health server started');
});

registerProcessHandler({
  server,
  // No load balancer sends a worker requests, so there is nothing to drain before stopping.
  drainDelayMs: 0,
  hooks: [
    () => workers?.close(),
    async () => {
      await redis.quit();
    },
    () => shutdownTelemetry(),
  ],
});

// Refuses an evicting Redis in production before taking a single job. Waits for Redis to answer.
await checkQueueRedis(redis, {
  production: ENV_CONSTANTS.NODE_ENV === 'production',
  log: logger,
});

const handlers = createJobHandlers({});
const prefix = queuePrefix(ENV_CONSTANTS);

// Before taking jobs: the schedules of the queues this worker serves. A deploy older than the one
// that last wrote them leaves them alone.
await syncJobSchedules({
  redis,
  prefix,
  schedules: createJobSchedules(),
  queues: ENV_CONSTANTS.WORKER_QUEUES ?? [...queueDefinitions(handlers).keys()],
  version: ENV_CONSTANTS.SERVICE_VERSION,
  handled: handlers.map((handler) => handler.job.name),
  log: logger,
});

// A stop signal while Redis was being reached: start nothing.
if (!lifecycleState.isShuttingDown())
  workers = startJobWorkers({
    redis,
    prefix,
    handlers,
    queues: ENV_CONSTANTS.WORKER_QUEUES,
    concurrency: ENV_CONSTANTS.WORKER_CONCURRENCY,
    shutdownTimeoutMs: ENV_CONSTANTS.WORKER_SHUTDOWN_TIMEOUT_MS,
    log: logger,
    telemetry: queueTelemetry(),
  });
