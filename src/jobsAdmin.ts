// `pnpm jobs failed` / `pnpm jobs retry <queue> <jobId|--all>`: looks at and retries failed jobs.
// In a container: `docker compose exec worker node dist/jobsAdmin.js failed`.
import { ENV_CONSTANTS } from '#constants/env/index';
import { getLogger } from '#lib/logger/index';
import { queueDefinitions, queuePrefix } from '#lib/queue/index';
import { runJobsAdmin } from '#lib/queue/admin';
import { closeRedisClient, createRedisClient } from '#lib/redis/index';
import { createJobHandlers } from '#workers/index';

const url = ENV_CONSTANTS.QUEUE_REDIS_URL ?? ENV_CONSTANTS.REDIS_URL;
if (!url) {
  process.stderr.write('Set QUEUE_REDIS_URL, or REDIS_URL\n');
  process.exit(2);
}

const write = (stream: NodeJS.WriteStream) => ({
  write: (line: string) => stream.write(`${line}\n`),
});
const redis = await createRedisClient(url, getLogger('jobs-admin'), {
  connectTimeoutMs: ENV_CONSTANTS.REDIS_CONNECT_TIMEOUT_MS,
});
try {
  process.exitCode = await runJobsAdmin(process.argv.slice(2), {
    options: { redis, prefix: queuePrefix(ENV_CONSTANTS) },
    queues: [...queueDefinitions(createJobHandlers({})).keys()],
    out: write(process.stdout),
    err: write(process.stderr),
  });
} finally {
  await closeRedisClient(redis);
}
