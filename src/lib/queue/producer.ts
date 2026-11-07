import { Queue, type JobsOptions, type Telemetry } from 'bullmq';
import type { Logger } from 'pino';
import {
  JOB_ID_PATTERN,
  KEEP_COMPLETED_JOBS_S,
  KEEP_FAILED_JOBS_S,
} from '#constants/queue.constant';
import type { Redis } from '#lib/redis/index';
import { JobConfigError, JobEnqueueError, JobsUnavailableError } from './errors.ts';
import { checkPayloadSize, type AnyJob, type JobInput } from './job.ts';

/** The backoff type every job is added with; the worker resolves it from the job's policy. */
export const BACKOFF_TYPE = 'policy';

/** What every job of a definition is added with, by `enqueue` and by its schedules. */
export const jobOptions = (job: AnyJob) => ({
  attempts: job.policy.attempts,
  // BullMQ's own check, behind ours: it refuses the same payloads, by the same measure.
  sizeLimit: job.policy.maxPayloadBytes,
  backoff: { type: BACKOFF_TYPE },
  removeOnComplete: { age: KEEP_COMPLETED_JOBS_S },
  removeOnFail: { age: KEEP_FAILED_JOBS_S },
});

export type EnqueueOptions = {
  /**
   * Makes enqueueing idempotent: a job with this id that is waiting, running or completed in the
   * last KEEP_COMPLETED_JOBS_S is not added again. Derive it from what the job is about (e.g.
   * `welcome-<userId>`) so a retried request enqueues it once. Letters, digits, `.`, `_` and `-`,
   * up to 128, and not all digits (BullMQ's own ids are).
   */
  jobId?: string;
  /** Runs it no sooner than this many ms from now. */
  delayMs?: number;
};

export type Jobs = {
  /**
   * Validates the payload and adds the job to its queue; resolves with its id once Redis took it.
   * Rejects with JobEnqueueError when it did not, so the caller knows nothing was enqueued.
   *
   * This is not atomic with a database write made before it: a crash between the two loses the
   * job. Enqueuing in the same transaction as the write (a database outbox, like the cache's)
   * needs a real database, so it comes with the database branch.
   */
  enqueue: <J extends AnyJob>(
    job: J,
    payload: JobInput<J>,
    options?: EnqueueOptions,
  ) => Promise<string>;
};

type ProducerOptions = {
  /** Undefined when no queue Redis is configured: every enqueue then rejects. */
  redis: Redis | undefined;
  prefix: string;
  /** Longest an enqueue waits for Redis before it rejects. */
  timeoutMs: number;
  log: Logger;
  /** Carries the caller's trace into the job, so a request and the jobs it enqueued are one trace. */
  telemetry?: Telemetry;
};

const withTimeout = <T>(promise: Promise<T>, ms: number, message: string) => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

export const createJobProducer = ({
  redis,
  prefix,
  timeoutMs,
  log,
  telemetry,
}: ProducerOptions) => {
  // One Queue per queue name, all on the one connection: a Queue only sends commands, it never
  // blocks, so they can share it.
  const queues = new Map<string, Queue>();
  const queueFor = (name: string) => {
    let queue = queues.get(name);
    if (!queue) {
      // The Redis version is checked by the worker at startup, through the logger (checkQueueRedis).
      queue = new Queue(name, { connection: redis!, prefix, telemetry, skipVersionCheck: true });
      queue.on('error', (err) => log.error({ err, queue: name }, 'job queue error'));
      queues.set(name, queue);
    }
    return queue;
  };

  const jobs: Jobs = {
    enqueue: async (job, payload, { jobId, delayMs } = {}) => {
      const parsed = job.schema.safeParse(payload);
      if (!parsed.success)
        throw new JobConfigError(`Job "${job.name}": the payload does not match its schema`, {
          cause: parsed.error,
        });
      checkPayloadSize(job, payload, `Job "${job.name}"`);
      if (jobId !== undefined && !JOB_ID_PATTERN.test(jobId))
        throw new JobConfigError(
          `Job "${job.name}": jobId must be letters, digits, ., _ or -, not all digits: ${JSON.stringify(jobId)}`,
        );
      if (!redis)
        throw new JobsUnavailableError(
          `Job "${job.name}" cannot be enqueued: set QUEUE_REDIS_URL or REDIS_URL`,
        );

      const options: JobsOptions = { ...jobOptions(job), jobId, delay: delayMs };
      try {
        // The payload as given, not as parsed: the worker parses it again with the same schema.
        const added = await withTimeout(
          queueFor(job.queue.name).add(job.name, payload, options),
          timeoutMs,
          `the queue did not answer within ${timeoutMs} ms`,
        );
        return added.id!;
      } catch (err) {
        throw new JobEnqueueError(`Job "${job.name}" was not enqueued`, { cause: err });
      }
    },
  };

  return {
    jobs,
    close: async () => {
      await Promise.all([...queues.values()].map((queue) => queue.close()));
    },
  };
};
