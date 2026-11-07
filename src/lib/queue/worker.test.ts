import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Queue, Worker } from 'bullmq';
import pino from 'pino';
import * as z from 'zod';
import { closeRedisClient, createRedisClient, type Redis } from '#lib/redis/index';
import { freePort, redisSkip, startRedisServer } from '#testing/redisServer';
import { JobConfigError, PermanentJobError } from './errors.ts';
import { connectWorkerRedis } from './index.ts';
import { defineJob } from './job.ts';
import { defineQueue } from './queue.ts';
import { createJobProducer } from './producer.ts';
import { handleJob, startJobWorkers, type JobContext, type JobHandler } from './worker.ts';

const silent = pino({ level: 'silent' });

const defaultQueue = defineQueue({ name: 'default' });

/** A meter that keeps job outcomes, and runs the gauge callback on demand. */
const recordingMeter = () => {
  const outcomes: string[] = [];
  const stalls: string[] = [];
  const waits: number[] = [];
  let callback:
    | ((result: {
        observe: (gauge: string, value: number, attrs?: object) => void;
      }) => Promise<void>)
    | undefined;
  const meter = {
    createCounter: (name: string) => ({
      add: (_n: number, attrs?: { outcome?: string; queue?: string }) =>
        name === 'jobs.stalled' ? stalls.push(attrs!.queue!) : outcomes.push(attrs!.outcome!),
    }),
    createHistogram: (name: string) => ({
      record: (value: number) => (name === 'jobs.queue_wait' ? waits.push(value) : undefined),
    }),
    createObservableGauge: (name: string) => name,
    addBatchObservableCallback: (cb: typeof callback) => (callback = cb),
    removeBatchObservableCallback: () => (callback = undefined),
  } as unknown as NonNullable<Parameters<typeof startJobWorkers>[0]['meter']>;
  const collect = async () => {
    const observed: Record<string, number> = {};
    await callback?.({
      observe: (gauge, value, attrs) => (observed[`${gauge} ${JSON.stringify(attrs)}`] = value),
    });
    return observed;
  };
  return { meter, outcomes, stalls, waits, collect };
};

const until = async (condition: () => boolean | Promise<boolean>, what: string, ms = 5_000) => {
  const deadline = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > deadline) assert.fail(`timed out waiting until ${what}`);
    await sleep(10);
  }
};

describe('job workers', { skip: redisSkip }, () => {
  let url = '';
  let producerRedis: Redis;
  const open: { close: () => Promise<void> }[] = [];

  before(async () => {
    const port = await freePort();
    await startRedisServer(port);
    url = `redis://127.0.0.1:${port}`;
    producerRedis = await createRedisClient(url, silent, { connectTimeoutMs: 1_000 });
  });

  afterEach(async () => {
    for (const resource of open.splice(0).reverse()) await resource.close();
  });

  after(async () => {
    await closeRedisClient(producerRedis);
  });

  /** A producer and its workers on a prefix of their own, closed after the test. */
  const setup = (
    handlers: readonly JobHandler[],
    options: Partial<Parameters<typeof startJobWorkers>[0]> = {},
  ) => {
    const prefix = `jobs-test-${randomUUID()}`;
    const recording = recordingMeter();
    const producer = createJobProducer({
      redis: producerRedis,
      prefix,
      timeoutMs: 2_000,
      log: silent,
    });
    const redis = connectWorkerRedis(url, silent);
    const workers = startJobWorkers({
      redis,
      prefix,
      handlers,
      concurrency: 1,
      shutdownTimeoutMs: 2_000,
      log: silent,
      meter: recording.meter,
      ...options,
    });
    open.push(producer, { close: async () => void (await redis.quit()) }, workers);
    const view = new Queue(handlers[0]?.job.queue.name ?? 'default', {
      connection: producerRedis,
      prefix,
      skipVersionCheck: true,
    });
    open.push(view);
    return { ...recording, jobs: producer.jobs, workers, view, prefix, redis };
  };

  const stateOf = async (view: Queue, id: string) => (await view.getJob(id))?.getState();

  // Fast retries: the wait before each is under 1 ms.
  const quick = { attempts: 3, backoffMs: 1, maxBackoffMs: 1 };

  it('runs an enqueued job with its parsed payload, its id and its attempt', async () => {
    const job = defineJob({
      name: 'test.greet',
      queue: defaultQueue,
      schema: z.object({ name: z.string().trim() }),
    });
    const seen: { name: string; ctx: Omit<JobContext, 'log' | 'signal'> }[] = [];
    const { jobs, outcomes } = setup([
      handleJob(job, ({ name }, { jobId, attempt }) => {
        seen.push({ name, ctx: { jobId, attempt } });
        return Promise.resolve();
      }),
    ]);

    const id = await jobs.enqueue(job, { name: '  Ada ' });
    await until(() => seen.length === 1, 'the job ran');
    assert.deepEqual(seen, [{ name: 'Ada', ctx: { jobId: id, attempt: 1 } }]);
    await until(() => outcomes.length === 1, 'the outcome was counted');
    assert.deepEqual(outcomes, ['completed']);
  });

  it('retries a failing job, then counts it completed', async () => {
    const job = defineJob({
      name: 'test.flaky',
      queue: defaultQueue,
      schema: z.object({}),
      ...quick,
    });
    const attempts: number[] = [];
    const { jobs, outcomes, view } = setup([
      handleJob(job, (_payload, { attempt }) => {
        attempts.push(attempt);
        return attempt < 3 ? Promise.reject(new Error('flaky')) : Promise.resolve();
      }),
    ]);

    const id = await jobs.enqueue(job, {});
    await until(async () => (await stateOf(view, id)) === 'completed', 'the job completed');
    assert.deepEqual(attempts, [1, 2, 3]);
    assert.deepEqual(outcomes, ['retried', 'retried', 'completed']);
  });

  it('fails a job for good once its attempts are spent', async () => {
    const job = defineJob({
      name: 'test.broken',
      queue: defaultQueue,
      schema: z.object({}),
      ...quick,
    });
    const { jobs, outcomes, view } = setup([
      handleJob(job, () => Promise.reject(new Error('broken'))),
    ]);

    const id = await jobs.enqueue(job, {});
    await until(async () => (await stateOf(view, id)) === 'failed', 'the job failed');
    assert.deepEqual(outcomes, ['retried', 'retried', 'failed']);
    assert.equal((await view.getJob(id))?.failedReason, 'broken');
  });

  it('fails a job at once on PermanentJobError, without retries', async () => {
    const job = defineJob({
      name: 'test.gone',
      queue: defaultQueue,
      schema: z.object({}),
      ...quick,
    });
    let runs = 0;
    const { jobs, outcomes, view } = setup([
      handleJob(job, () => {
        runs++;
        return Promise.reject(new PermanentJobError('the record is gone'));
      }),
    ]);

    const id = await jobs.enqueue(job, {});
    await until(async () => (await stateOf(view, id)) === 'failed', 'the job failed');
    assert.equal(runs, 1);
    assert.deepEqual(outcomes, ['failed']);
  });

  it('stops a run at its timeoutMs, aborting its signal, and retries it', async () => {
    const job = defineJob({
      name: 'test.slow',
      queue: defaultQueue,
      schema: z.object({}),
      ...quick,
      attempts: 2,
      timeoutMs: 50,
    });
    const reasons: unknown[] = [];
    const { jobs, outcomes, view } = setup([
      handleJob(
        job,
        (_payload, { signal }) =>
          new Promise((_, reject) =>
            signal.addEventListener('abort', () => {
              reasons.push(signal.reason);
              reject(new Error('stopped'));
            }),
          ),
      ),
    ]);

    const id = await jobs.enqueue(job, {});
    await until(async () => (await stateOf(view, id)) === 'failed', 'the job failed');
    assert.equal(reasons.length, 2, 'the signal fired on both attempts');
    assert.deepEqual(outcomes, ['retried', 'failed']);
    assert.match((await view.getJob(id))!.failedReason, /longer than its timeoutMs \(50\)/);
  });

  it('fails for good a job no handler knows, and one whose payload does not match', async () => {
    const known = defineJob({
      name: 'test.known',
      queue: defaultQueue,
      schema: z.object({ n: z.number() }),
      ...quick,
    });
    const unknown = defineJob({
      name: 'test.unknown',
      queue: defaultQueue,
      schema: z.object({}),
      ...quick,
    });
    const { jobs, outcomes, view } = setup([handleJob(known, () => Promise.resolve())]);

    const orphan = await jobs.enqueue(unknown, {});
    // Written past the producer\'s check, as an older deploy with another schema would have.
    const malformed = (await view.add('test.known', { n: 'one' }, { attempts: 3 })).id!;
    await until(async () => (await stateOf(view, orphan)) === 'failed', 'the orphan failed');
    await until(async () => (await stateOf(view, malformed)) === 'failed', 'the malformed failed');
    assert.deepEqual(outcomes, ['failed', 'failed']);
  });

  it('runs a job once however often it is enqueued with one jobId', async () => {
    const job = defineJob({ name: 'test.once', queue: defaultQueue, schema: z.object({}) });
    let runs = 0;
    const { jobs, view } = setup([
      handleJob(job, () => {
        runs++;
        return Promise.resolve();
      }),
    ]);

    const first = await jobs.enqueue(job, {}, { jobId: 'once-1' });
    const second = await jobs.enqueue(job, {}, { jobId: 'once-1' });
    assert.equal(first, second);
    await until(async () => (await stateOf(view, first)) === 'completed', 'the job completed');
    await jobs.enqueue(job, {}, { jobId: 'once-1' });
    await sleep(100);
    assert.equal(runs, 1, 'a completed job is kept, so the same id is not run again');
  });

  it('measures the wait of a delayed job from when it was due, not when it was enqueued', async () => {
    const job = defineJob({ name: 'test.due', queue: defaultQueue, schema: z.object({}) });
    let ranAt = 0;
    const { jobs, waits } = setup([
      handleJob(job, () => {
        ranAt = Date.now();
        return Promise.resolve();
      }),
    ]);

    const enqueuedAt = Date.now();
    await jobs.enqueue(job, {}, { delayMs: 400 });
    await until(() => ranAt > 0, 'the job ran');
    // A delayed job can run well after its due time (on Redis below 6.0, BullMQ waits in whole
    // seconds); whatever it took, the wait recorded is that time less the 400 ms delay.
    const pastDue = ranAt - enqueuedAt - 400;
    assert.equal(waits.length, 1);
    assert.ok(
      Math.abs(waits[0]! - pastDue) < 50,
      `recorded ${waits[0]} ms, ran ${pastDue} ms past due`,
    );
  });

  it('runs a delayed job no sooner than its delay', async () => {
    const job = defineJob({ name: 'test.later', queue: defaultQueue, schema: z.object({}) });
    let ranAt = 0;
    const { jobs } = setup([
      handleJob(job, () => {
        ranAt = Date.now();
        return Promise.resolve();
      }),
    ]);

    const enqueuedAt = Date.now();
    await jobs.enqueue(job, {}, { delayMs: 300 });
    await until(() => ranAt > 0, 'the job ran');
    assert.ok(ranAt - enqueuedAt >= 300, `ran after ${ranAt - enqueuedAt} ms`);
  });

  it('waits for a running job when it closes', async () => {
    const job = defineJob({ name: 'test.finish', queue: defaultQueue, schema: z.object({}) });
    let finished = false;
    let started = false;
    const { jobs, workers } = setup([
      handleJob(job, async () => {
        started = true;
        await sleep(200);
        finished = true;
      }),
    ]);

    await jobs.enqueue(job, {});
    await until(() => started, 'the job started');
    assert.equal(workers.ready(), true);
    await workers.close();
    assert.equal(finished, true, 'close resolved only after the job finished');
    assert.equal(workers.ready(), false);
  });

  it('puts back a job still running past shutdownTimeoutMs, its attempt not spent', async () => {
    const job = defineJob({
      name: 'test.stuck',
      queue: defaultQueue,
      schema: z.object({}),
      attempts: 1,
    });
    const runs: { worker: string; attempt: number }[] = [];
    const first = setup(
      [
        handleJob(job, async (_payload, { attempt }) => {
          runs.push({ worker: 'first', attempt });
          // Ignores its signal, as a handler stuck in a call without a timeout would.
          await sleep(60_000, undefined, { ref: false });
        }),
      ],
      { shutdownTimeoutMs: 100 },
    );

    const id = await first.jobs.enqueue(job, {});
    await until(() => runs.length === 1, 'the first worker took the job');
    const startedClosing = Date.now();
    await first.workers.close();
    assert.ok(Date.now() - startedClosing < 2_000, 'close did not wait for the stuck job');
    assert.deepEqual(first.outcomes, ['interrupted']);
    assert.equal(await stateOf(first.view, id), 'waiting');

    const second = startJobWorkers({
      redis: first.redis,
      prefix: first.prefix,
      handlers: [
        handleJob(job, (_payload, { attempt }) => {
          runs.push({ worker: 'second', attempt });
          return Promise.resolve();
        }),
      ],
      concurrency: 1,
      shutdownTimeoutMs: 2_000,
      log: silent,
      meter: recordingMeter().meter,
    });
    open.push(second);
    await until(() => runs.length === 2, 'another worker ran the job');
    // With attempts: 1, a spent attempt would have failed it for good instead.
    assert.deepEqual(runs[1], { worker: 'second', attempt: 1 });
  });

  it('runs again a job whose worker died mid-run, once its lock lapses', async () => {
    const job = defineJob({ name: 'test.orphaned', queue: defaultQueue, schema: z.object({}) });
    const locks = { lockDurationMs: 300, stalledIntervalMs: 200 };
    const prefix = `jobs-test-${randomUUID()}`;
    const runs: string[] = [];
    const producer = createJobProducer({
      redis: producerRedis,
      prefix,
      timeoutMs: 2_000,
      log: silent,
    });
    open.push(producer);

    // The worker that dies: plain BullMQ, killed with close(true), which stops renewing its lock
    // and drops its connection without finishing or failing the job, as a crash would.
    const doomedRedis = connectWorkerRedis(url, silent);
    const doomed = new Worker(
      'default',
      async () => {
        runs.push('doomed');
        await sleep(60_000, undefined, { ref: false });
      },
      // Every worker on a queue shares one stall-check schedule, so it gets the same settings.
      {
        connection: doomedRedis,
        prefix,
        lockDuration: locks.lockDurationMs,
        stalledInterval: locks.stalledIntervalMs,
        skipVersionCheck: true,
      },
    );
    await producer.jobs.enqueue(job, {});
    await until(() => runs.length === 1, 'the doomed worker took the job');
    await doomed.close(true);
    doomedRedis.disconnect();

    const { meter, stalls } = recordingMeter();
    const survivorRedis = connectWorkerRedis(url, silent);
    const survivor = startJobWorkers({
      redis: survivorRedis,
      prefix,
      handlers: [
        handleJob(job, () => {
          runs.push('survivor');
          return Promise.resolve();
        }),
      ],
      concurrency: 1,
      shutdownTimeoutMs: 2_000,
      log: silent,
      meter,
      locks,
    });
    open.push({ close: async () => void (await survivorRedis.quit()) }, survivor);
    await until(() => runs.includes('survivor'), 'the survivor ran the orphaned job');
    assert.deepEqual(runs, ['doomed', 'survivor']);
    assert.deepEqual(stalls, ['default'], 'counted as stalled');
  });

  it('stops reporting the queues once closed', async () => {
    const job = defineJob({ name: 'test.count', queue: defaultQueue, schema: z.object({}) });
    const { collect, workers } = setup([handleJob(job, () => Promise.resolve())]);
    await workers.close();
    assert.deepEqual(await collect(), {}, 'the gauge callback is removed on close');
  });

  it("reports each queue's jobs by state, and the age of the oldest waiting", async () => {
    const job = defineJob({
      name: 'test.waiting',
      queue: defineQueue({ name: 'paused' }),
      schema: z.object({}),
    });
    const { jobs, collect, view } = setup([handleJob(job, () => Promise.resolve())]);
    await view.pause();

    await jobs.enqueue(job, {});
    await sleep(30);
    const observed = await collect();
    assert.equal(observed['jobs.count {"queue":"paused","state":"waiting"}'], 1);
    assert.ok(observed['jobs.oldest_waiting_age {"queue":"paused"}']! >= 0);
  });

  it('refuses two handlers for one job, and a queue no handler runs on', () => {
    const job = defineJob({ name: 'test.twice', queue: defaultQueue, schema: z.object({}) });
    const handler = handleJob(job, () => Promise.resolve());
    const base = {
      redis: producerRedis,
      prefix: 'unused',
      concurrency: 1,
      shutdownTimeoutMs: 1,
      log: silent,
    };
    assert.throws(() => startJobWorkers({ ...base, handlers: [handler, handler] }), JobConfigError);
    assert.throws(
      () => startJobWorkers({ ...base, handlers: [handler], queues: ['email'] }),
      /No handler runs on queue\(s\) email/,
    );
  });

  it('keeps to the rate limit of a queue across every worker process together', async () => {
    const limited = defineQueue({
      name: 'limited',
      concurrency: 10,
      rateLimit: { max: 2, perMs: 1_000 },
    });
    const job = defineJob({ name: 'test.limited', queue: limited, schema: z.object({}) });
    const startedAt: number[] = [];
    const handler = handleJob(job, () => {
      startedAt.push(Date.now());
      return Promise.resolve();
    });
    // Two worker processes in effect: each its own BullMQ workers and connection.
    const first = setup([handler]);
    const secondRedis = connectWorkerRedis(url, silent);
    const second = startJobWorkers({
      redis: secondRedis,
      prefix: first.prefix,
      handlers: [handler],
      concurrency: 1,
      shutdownTimeoutMs: 1_000,
      log: silent,
      meter: recordingMeter().meter,
    });
    open.push({ close: async () => void (await secondRedis.quit()) }, second);

    const enqueuedAt = Date.now();
    for (let i = 0; i < 6; i++) await first.jobs.enqueue(job, {});
    await until(() => startedAt.length === 6, 'all six ran', 10_000);
    const inFirstWindow = startedAt.filter((at) => at - enqueuedAt < 900).length;
    assert.ok(inFirstWindow <= 2, `${inFirstWindow} started in the first second, the limit is 2`);
    assert.ok(Math.max(...startedAt) - enqueuedAt >= 2_000, 'six at two a second take two seconds');
  });

  it('runs as many jobs at once as the concurrency of the queue, else the process default', async () => {
    const wide = defineQueue({ name: 'wide', concurrency: 3 });
    const narrow = defineQueue({ name: 'narrow' });
    const most: Record<string, number> = { wide: 0, narrow: 0 };
    const running: Record<string, number> = { wide: 0, narrow: 0 };
    const slow = (queue: 'wide' | 'narrow') => async () => {
      most[queue] = Math.max(most[queue]!, ++running[queue]!);
      await sleep(100);
      running[queue]!--;
    };
    const onWide = defineJob({ name: 'test.wide', queue: wide, schema: z.object({}) });
    const onNarrow = defineJob({ name: 'test.narrow', queue: narrow, schema: z.object({}) });
    const done: string[] = [];
    const { jobs } = setup([
      handleJob(onWide, async () => (await slow('wide')(), void done.push('wide'))),
      handleJob(onNarrow, async () => (await slow('narrow')(), void done.push('narrow'))),
    ]);

    for (let i = 0; i < 3; i++) {
      await jobs.enqueue(onWide, {});
      await jobs.enqueue(onNarrow, {});
    }
    await until(() => done.length === 6, 'all six ran');
    assert.equal(most.wide, 3);
    assert.equal(most.narrow, 1, 'concurrency 1, the process default given to setup');
  });

  it('refuses two different queue definitions under one name', () => {
    const one = defineJob({
      name: 'test.one',
      queue: defineQueue({ name: 'twin' }),
      schema: z.object({}),
    });
    const two = defineJob({
      name: 'test.two',
      queue: defineQueue({ name: 'twin' }),
      schema: z.object({}),
    });
    assert.throws(
      () =>
        startJobWorkers({
          redis: producerRedis,
          prefix: 'unused',
          handlers: [
            handleJob(one, () => Promise.resolve()),
            handleJob(two, () => Promise.resolve()),
          ],
          concurrency: 1,
          shutdownTimeoutMs: 1,
          log: silent,
        }),
      /Two different queue definitions are named "twin"/,
    );
  });
});
