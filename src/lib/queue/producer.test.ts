import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import pino from 'pino';
import * as z from 'zod';
import { closeRedisClient, createRedisClient, type Redis } from '#lib/redis/index';
import { freePort, holdDeadPort, redisSkip, startRedisServer } from '#testing/redisServer';
import { JobConfigError, JobEnqueueError, JobsUnavailableError } from './errors.ts';
import { defineJob } from './job.ts';
import { defineQueue } from './queue.ts';
import { BACKOFF_TYPE, createJobProducer } from './producer.ts';

const silent = pino({ level: 'silent' });

const defaultQueue = defineQueue({ name: 'default' });

const job = defineJob({
  name: 'test.produce',
  queue: defaultQueue,
  schema: z.object({ n: z.number() }),
  attempts: 4,
});

describe('createJobProducer without a queue', () => {
  const { jobs } = createJobProducer({
    redis: undefined,
    prefix: 'p',
    timeoutMs: 100,
    log: silent,
  });

  it('rejects every enqueue with JobsUnavailableError', async () => {
    await assert.rejects(jobs.enqueue(job, { n: 1 }), JobsUnavailableError);
  });

  it("checks the payload and the jobId first, which are the caller's mistakes", async () => {
    await assert.rejects(jobs.enqueue(job, { n: 'one' } as never), JobConfigError);
    const large = defineJob({
      name: 'test.large',
      queue: defaultQueue,
      schema: z.object({ text: z.string() }),
      maxPayloadBytes: 100,
    });
    await assert.rejects(
      jobs.enqueue(large, { text: 'x'.repeat(100) }),
      (err) => err instanceof JobConfigError && /maxPayloadBytes \(100\)/.test(err.message),
    );
    for (const jobId of ['a:b', '42', '', 'x'.repeat(129), 'with space'])
      await assert.rejects(jobs.enqueue(job, { n: 1 }, { jobId }), JobConfigError, jobId);
  });
});

describe('createJobProducer', { skip: redisSkip }, () => {
  let redis: Redis;

  before(async () => {
    const port = await freePort();
    await startRedisServer(port);
    redis = await createRedisClient(`redis://127.0.0.1:${port}`, silent, {
      connectTimeoutMs: 1_000,
    });
  });

  after(async () => {
    await closeRedisClient(redis);
  });

  it('adds the job with its policy, and keeps what it was given', async () => {
    const prefix = `produce-${randomUUID()}`;
    const producer = createJobProducer({ redis, prefix, timeoutMs: 2_000, log: silent });
    const view = new Queue('default', { connection: redis, prefix, skipVersionCheck: true });
    try {
      const id = await producer.jobs.enqueue(job, { n: 1 }, { jobId: 'produce-1', delayMs: 500 });
      assert.equal(id, 'produce-1');
      const added = await view.getJob(id);
      assert.equal(added?.name, 'test.produce');
      assert.deepEqual(added?.data, { n: 1 });
      assert.equal(added?.opts.attempts, 4);
      assert.equal(added?.opts.sizeLimit, 65_536);
      assert.deepEqual(added?.opts.backoff, { type: BACKOFF_TYPE });
      assert.equal(added?.opts.delay, 500);
      assert.equal(await added?.getState(), 'delayed');
    } finally {
      await producer.close();
      await view.close();
    }
  });

  it('rejects with JobEnqueueError, within its timeout, while Redis is down', async () => {
    const { port } = await holdDeadPort();
    const down = await createRedisClient(`redis://127.0.0.1:${port}`, silent, {
      connectTimeoutMs: 100,
    });
    const producer = createJobProducer({
      redis: down,
      prefix: 'down',
      timeoutMs: 200,
      log: silent,
    });
    try {
      const started = Date.now();
      await assert.rejects(producer.jobs.enqueue(job, { n: 1 }), JobEnqueueError);
      assert.ok(Date.now() - started < 2_000, 'it did not wait for Redis');
    } finally {
      await producer.close().catch(() => undefined);
      await closeRedisClient(down);
    }
  });
});
