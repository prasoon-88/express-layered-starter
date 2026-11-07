import { Queue } from 'bullmq';
import type { Redis } from '#lib/redis/index';

export type FailedJob = {
  queue: string;
  id: string;
  name: string;
  /** Runs it had, the last included. */
  attempts: number;
  reason: string;
  /** When it failed for good, ISO 8601. */
  failedAt: string | undefined;
};

type AdminOptions = { redis: Redis; prefix: string };

const withQueue = async <T>(
  { redis, prefix }: AdminOptions,
  name: string,
  use: (queue: Queue) => Promise<T>,
) => {
  const queue = new Queue(name, { connection: redis, prefix, skipVersionCheck: true });
  try {
    return await use(queue);
  } finally {
    await queue.close();
  }
};

/** The most recent failed jobs of each queue, newest first, at most `limit` per queue. */
export const listFailedJobs = async (
  options: AdminOptions,
  queues: readonly string[],
  limit: number,
): Promise<FailedJob[]> => {
  const found: FailedJob[] = [];
  for (const name of queues)
    await withQueue(options, name, async (queue) => {
      for (const job of await queue.getFailed(0, limit - 1))
        found.push({
          queue: name,
          id: job.id!,
          name: job.name,
          attempts: job.attemptsMade,
          reason: job.failedReason,
          failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : undefined,
        });
    });
  return found;
};

/**
 * Puts failed jobs back in their queue with all their attempts again: one by id, or every failed
 * one. Resolves with the ids retried. A job that is not in the failed set is left alone, so a job
 * a worker is already running again is never run twice by this.
 */
export const retryFailedJobs = (
  options: AdminOptions,
  queueName: string,
  which: { jobId: string } | { all: true },
): Promise<string[]> =>
  withQueue(options, queueName, async (queue) => {
    const jobs =
      'jobId' in which
        ? [await queue.getJob(which.jobId)].filter((job) => job !== undefined)
        : await queue.getFailed(0, -1);
    const retried: string[] = [];
    for (const job of jobs) {
      if ((await job.getState()) !== 'failed') continue;
      await job.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
      retried.push(job.id!);
    }
    return retried;
  });

export type ScheduleEntry = {
  queue: string;
  id: string;
  job: string;
  every: number | undefined;
  cron: string | undefined;
  timezone: string | undefined;
  /** Its next run, ISO 8601. */
  next: string | undefined;
};

/** The schedules Redis holds for these queues, declared in code or not. */
export const listSchedules = async (
  options: AdminOptions,
  queues: readonly string[],
): Promise<ScheduleEntry[]> => {
  const found: ScheduleEntry[] = [];
  for (const name of queues)
    await withQueue(options, name, async (queue) => {
      for (const scheduler of await queue.getJobSchedulers(0, -1))
        found.push({
          queue: name,
          id: scheduler.id ?? scheduler.key,
          job: scheduler.name,
          every: scheduler.every,
          cron: scheduler.pattern,
          timezone: scheduler.tz,
          next: scheduler.next ? new Date(scheduler.next).toISOString() : undefined,
        });
    });
  return found;
};

/** Removes a schedule from Redis; true when there was one. Its jobs already waiting stay. */
export const removeSchedule = (options: AdminOptions, queue: string, id: string) =>
  withQueue(options, queue, (q) => q.removeJobScheduler(id));

const USAGE = `Usage:
  jobs failed [--queue <name>] [--limit <n>]   list failed jobs, newest first (20 per queue by default)
  jobs retry <queue> <jobId>                   put one failed job back, with all its attempts
  jobs retry <queue> --all                     put every failed job of the queue back
  jobs schedules                               list the schedules in Redis, with their next run
  jobs unschedule <queue> <id>                 remove a schedule no code declares any more`;

type Output = { write: (line: string) => void };

/**
 * The `pnpm jobs` command: lists and retries failed jobs. Returns the exit code. Every job is one
 * line of JSON, so the output can be read by people and piped to `jq` alike.
 */
export const runJobsAdmin = async (
  argv: readonly string[],
  {
    options,
    queues,
    out,
    err,
  }: { options: AdminOptions; queues: readonly string[]; out: Output; err: Output },
): Promise<number> => {
  const [command, ...rest] = argv;
  const flag = (name: string) => {
    const at = rest.indexOf(name);
    return at === -1 ? undefined : rest[at + 1];
  };

  if (command === 'failed') {
    const only = flag('--queue');
    const limit = Number(flag('--limit') ?? 20);
    if (!Number.isSafeInteger(limit) || limit < 1) {
      err.write(`--limit must be a whole number of at least 1\n${USAGE}`);
      return 2;
    }
    if (only !== undefined && !queues.includes(only)) {
      err.write(`No handler runs on queue "${only}"; the queues are: ${queues.join(', ')}`);
      return 2;
    }
    const failed = await listFailedJobs(options, only ? [only] : queues, limit);
    for (const job of failed) out.write(JSON.stringify(job));
    err.write(`${failed.length} failed job(s)`);
    return 0;
  }

  if (command === 'retry') {
    const [queue, target] = rest;
    if (!queue || !target || !queues.includes(queue)) {
      err.write(
        `${queue ? `Unknown queue "${queue}"; the queues are: ${queues.join(', ')}\n` : ''}${USAGE}`,
      );
      return 2;
    }
    const retried = await retryFailedJobs(
      options,
      queue,
      target === '--all' ? { all: true } : { jobId: target },
    );
    for (const id of retried) out.write(JSON.stringify({ queue, id, retried: true }));
    if (target !== '--all' && retried.length === 0) {
      err.write(`Job "${target}" is not in the failed set of queue "${queue}"`);
      return 1;
    }
    err.write(`${retried.length} job(s) put back`);
    return 0;
  }

  if (command === 'schedules') {
    const schedules = await listSchedules(options, queues);
    for (const schedule of schedules) out.write(JSON.stringify(schedule));
    err.write(`${schedules.length} schedule(s)`);
    return 0;
  }

  if (command === 'unschedule') {
    const [queue, id] = rest;
    if (!queue || !id || !queues.includes(queue)) {
      err.write(
        `${
          queue && !queues.includes(queue)
            ? `Unknown queue "${queue}"; the queues are: ${queues.join(', ')}
`
            : ''
        }${USAGE}`,
      );
      return 2;
    }
    if (!(await removeSchedule(options, queue, id))) {
      err.write(`No schedule "${id}" on queue "${queue}"`);
      return 1;
    }
    out.write(JSON.stringify({ queue, id, removed: true }));
    return 0;
  }

  err.write(USAGE);
  return 2;
};
