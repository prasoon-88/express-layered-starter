import { metrics, type Meter } from '@opentelemetry/api';
import { Queue, UnrecoverableError, WaitingError, Worker, type Job, type Telemetry } from 'bullmq';
import type { Logger } from 'pino';
import type { Redis } from '#lib/redis/index';
import { JobConfigError, JobTimeoutError, PermanentJobError } from './errors.ts';
import { retryDelay, type AnyJob, type JobPayload } from './job.ts';
import type { QueueDefinition } from './queue.ts';

export type JobContext = {
  jobId: string;
  /** 1 on the first run. */
  attempt: number;
  /** Fires at the job's `timeoutMs`, or when the worker is forced to stop. Pass it on. */
  signal: AbortSignal;
  /** Carries the queue, the job name, its id and the attempt. */
  log: Logger;
};

/**
 * Runs one kind of job. A job runs at least once and may run again (a retry, or a worker that
 * died mid-run), so a handler must be safe to run twice: check before doing, or make the effect
 * idempotent.
 */
export type JobHandler<J extends AnyJob = AnyJob> = {
  readonly job: J;
  // A method, so a handler of one job is a JobHandler: it is called only with its own payload.
  run(payload: JobPayload<J>, ctx: JobContext): Promise<void>;
};

export const handleJob = <J extends AnyJob>(
  job: J,
  run: (payload: JobPayload<J>, ctx: JobContext) => Promise<void>,
): JobHandler<J> => Object.freeze({ job, run });

type Outcome = 'completed' | 'retried' | 'failed' | 'interrupted';

type WorkerMeter = Pick<
  Meter,
  | 'createCounter'
  | 'createHistogram'
  | 'createObservableGauge'
  | 'addBatchObservableCallback'
  | 'removeBatchObservableCallback'
>;

type JobWorkersOptions = {
  /** With `maxRetriesPerRequest: null`, as BullMQ requires for its blocking reads. */
  redis: Redis;
  prefix: string;
  handlers: readonly JobHandler[];
  /** The queues to serve; every queue a handler runs on when not given. */
  queues?: readonly string[];
  /** Jobs a queue runs at once in this process, when its definition sets no concurrency. */
  concurrency: number;
  /** How long `close` waits for running jobs before it stops them. */
  shutdownTimeoutMs: number;
  log: Logger;
  meter?: WorkerMeter;
  telemetry?: Telemetry;
  /** BullMQ's lock and stall settings; its defaults (30 s) unless a test needs them short. */
  locks?: { lockDurationMs: number; stalledIntervalMs: number };
};

export type JobWorkers = {
  readonly queues: readonly string[];
  /** True while every worker runs and its connection is up. */
  ready: () => boolean;
  /**
   * Stops taking jobs and waits up to `shutdownTimeoutMs` for those running; any still running
   * then is cancelled and put back in the queue, its attempt not counted.
   */
  close: () => Promise<void>;
};

/**
 * When a job became due: its creation, plus the delay it was enqueued with. BullMQ resets the job's
 * `delay` field once the delay passes, but keeps the requested one in `opts`. A retried job counts
 * from the same time, since BullMQ records nothing for when its backoff ended.
 */
const dueAt = (job: Pick<Job, 'timestamp' | 'opts'>) => job.timestamp + (job.opts.delay ?? 0);

/** Each queue the handlers run on, by name; two different definitions under one name are refused. */
export const queueDefinitions = (handlers: readonly JobHandler[]) => {
  const byName = new Map<string, QueueDefinition>();
  for (const { job } of handlers) {
    const known = byName.get(job.queue.name);
    if (known && known !== job.queue)
      throw new JobConfigError(
        `Two different queue definitions are named "${job.queue.name}"; define it once and share it`,
      );
    byName.set(job.queue.name, job.queue);
  }
  return byName;
};

/** Rejects with JobTimeoutError (or the worker's abort) as soon as `signal` fires. */
const untilAborted = <T>(work: Promise<T>, signal: AbortSignal, timeoutMs: number) =>
  new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(
        signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
          ? new JobTimeoutError(`the job ran longer than its timeoutMs (${timeoutMs})`)
          : new Error('the worker stopped the job', { cause: signal.reason }),
      );
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });

export const startJobWorkers = ({
  redis,
  prefix,
  handlers,
  queues: only,
  concurrency,
  shutdownTimeoutMs,
  log,
  meter = metrics.getMeter('jobs'),
  telemetry,
  locks,
}: JobWorkersOptions): JobWorkers => {
  const byName = new Map<string, JobHandler>();
  for (const handler of handlers) {
    if (byName.has(handler.job.name))
      throw new JobConfigError(`Two handlers for job "${handler.job.name}"`);
    byName.set(handler.job.name, handler);
  }
  const definitions = queueDefinitions(handlers);
  const served = [...definitions.keys()];
  const queues = only ?? served;
  const unknown = queues.filter((queue) => !served.includes(queue));
  if (unknown.length > 0)
    throw new JobConfigError(
      `No handler runs on queue(s) ${unknown.join(', ')}; the handlers serve: ${served.join(', ')}`,
    );

  const processed = meter.createCounter('jobs.processed', {
    description: 'Job runs, by queue, job and outcome: completed, retried, or failed for good',
  });
  const duration = meter.createHistogram('jobs.duration', {
    description: 'How long a job run took',
    unit: 'ms',
  });
  const queueWait = meter.createHistogram('jobs.queue_wait', {
    description: 'How long a job waited, from when it was due to its first run',
    unit: 'ms',
  });
  const stalled = meter.createCounter('jobs.stalled', {
    description: 'Jobs whose worker stopped renewing their lock (it died or hung); they run again',
  });
  const counts = meter.createObservableGauge('jobs.count', {
    description: 'Jobs in each state, by queue',
  });
  const oldestWaiting = meter.createObservableGauge('jobs.oldest_waiting_age', {
    description: 'Age of the oldest job waiting to run, by queue',
    unit: 'ms',
  });

  // Set when close gave up waiting: the jobs still running are cancelled and put back.
  let stopping = false;

  const processorFor =
    (queue: string) =>
    async (job: Job, token?: string, stop?: AbortSignal): Promise<void> => {
      const attempt = job.attemptsMade + 1;
      const jobLog = log.child({ queue, job: job.name, jobId: job.id, attempt });
      const handler = byName.get(job.name);
      const started = performance.now();
      // First runs only: BullMQ keeps no record of when a retry became due.
      if (attempt === 1)
        queueWait.record(Math.max(Date.now() - dueAt(job), 0), { queue, job: job.name });
      const record = (outcome: Outcome) => {
        const attributes = { queue, job: job.name, outcome };
        processed.add(1, attributes);
        duration.record(performance.now() - started, attributes);
      };

      if (!handler) {
        record('failed');
        throw new UnrecoverableError(`No handler for job "${job.name}" on queue "${queue}"`);
      }
      const parsed = handler.job.schema.safeParse(job.data);
      if (!parsed.success) {
        record('failed');
        jobLog.error({ issues: parsed.error.issues }, 'job payload does not match its schema');
        throw new UnrecoverableError(`Job "${job.name}": the payload does not match its schema`);
      }

      const { timeoutMs } = handler.job.policy;
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = stop ? AbortSignal.any([stop, timeout]) : timeout;
      try {
        await untilAborted(
          handler.run(parsed.data, { jobId: job.id!, attempt, signal, log: jobLog }),
          signal,
          timeoutMs,
        );
        record('completed');
      } catch (err) {
        if (stopping && stop?.aborted) {
          // Stopped by shutdown, not failed: back to waiting, without spending an attempt, for
          // the next worker. A handler that ignored its signal may still be running; the process
          // exits right after.
          record('interrupted');
          jobLog.warn('job interrupted by shutdown; it is back in the queue');
          await job.moveToWait(token);
          throw new WaitingError();
        }
        const permanent = err instanceof PermanentJobError;
        const last = permanent || attempt >= (job.opts.attempts ?? 1);
        record(last ? 'failed' : 'retried');
        if (last) jobLog.error({ err }, 'job failed for good');
        else jobLog.warn({ err }, 'job failed; it is retried');
        throw permanent ? new UnrecoverableError(err.message) : err;
      }
    };

  const workers = queues.map((queue) => {
    const { concurrency: own, rateLimit } = definitions.get(queue)!;
    const worker = new Worker(queue, processorFor(queue), {
      connection: redis,
      prefix,
      concurrency: own ?? concurrency,
      ...(rateLimit && { limiter: { max: rateLimit.max, duration: rateLimit.perMs } }),
      telemetry,
      // Checked once at startup by checkQueueRedis, which logs through pino, not the console.
      skipVersionCheck: true,
      ...(locks && {
        lockDuration: locks.lockDurationMs,
        stalledInterval: locks.stalledIntervalMs,
      }),
      settings: {
        backoffStrategy: (attemptsMade, _type, _err, job) => {
          const policy = job && byName.get(job.name)?.job.policy;
          // A job no handler knows was failed for good above, so it is never retried.
          return policy ? retryDelay(policy, attemptsMade) : 0;
        },
      },
    });
    worker.on('error', (err) => log.error({ err, queue }, 'job worker error'));
    worker.on('stalled', (jobId) => {
      stalled.add(1, { queue });
      log.warn(
        { queue, jobId },
        'job stalled: its worker stopped renewing the lock; it runs again',
      );
    });
    return worker;
  });

  // Read-only views of the queues, for the gauges, on the same connection.
  const views = queues.map(
    (queue) => new Queue(queue, { connection: redis, prefix, skipVersionCheck: true }),
  );
  const observe: Parameters<WorkerMeter['addBatchObservableCallback']>[0] = async (result) => {
    await Promise.all(
      views.map(async (view) => {
        try {
          const [byState, [oldest]] = await Promise.all([
            view.getJobCounts('waiting', 'active', 'delayed', 'failed'),
            view.getJobs(['wait'], 0, 0, true),
          ]);
          for (const [state, count] of Object.entries(byState))
            result.observe(counts, count, { queue: view.name, state });
          result.observe(oldestWaiting, oldest ? Math.max(Date.now() - dueAt(oldest), 0) : 0, {
            queue: view.name,
          });
        } catch (err) {
          log.warn({ err, queue: view.name }, 'job queue counts unavailable');
        }
      }),
    );
  };
  meter.addBatchObservableCallback(observe, [counts, oldestWaiting]);

  log.info({ queues, concurrency }, 'job workers started');

  return {
    queues,
    ready: () => redis.status === 'ready' && workers.every((worker) => worker.isRunning()),
    close: async () => {
      meter.removeBatchObservableCallback(observe, [counts, oldestWaiting]);
      let timer: NodeJS.Timeout | undefined;
      const finished = await Promise.race([
        Promise.all(workers.map((worker) => worker.close())).then(() => true),
        new Promise<false>(
          (resolve) => (timer = setTimeout(() => resolve(false), shutdownTimeoutMs)),
        ),
      ]).finally(() => clearTimeout(timer));
      if (!finished) {
        log.warn({ shutdownTimeoutMs }, 'jobs still running at shutdown; putting them back');
        stopping = true;
        // Aborts each running job's signal; its processor puts it back and returns, which lets the
        // close begun above finish. (A second close(true) would not: BullMQ reuses the first.)
        for (const worker of workers) worker.cancelAllJobs('shutdown');
        await Promise.all(workers.map((worker) => worker.close()));
      }
      await Promise.all(views.map((view) => view.close()));
    },
  };
};
