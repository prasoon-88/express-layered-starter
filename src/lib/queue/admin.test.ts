import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Queue } from 'bullmq';
import pino from 'pino';
import * as z from 'zod';
import { closeRedisClient, createRedisClient, type Redis } from '#lib/redis/index';
import { freePort, redisSkip, startRedisServer } from '#testing/redisServer';
import { listFailedJobs, retryFailedJobs, runJobsAdmin } from './admin.ts';
import { PermanentJobError } from './errors.ts';
import { connectWorkerRedis } from './index.ts';
import { defineJob } from './job.ts';
import { defineQueue } from './queue.ts';
import { defineSchedule, syncJobSchedules } from './schedule.ts';
import { createJobProducer } from './producer.ts';
import { handleJob, startJobWorkers } from './worker.ts';

const silent = pino({ level: 'silent' });

const defaultQueue = defineQueue({ name: 'default' });

const lines = () => {
  const written: string[] = [];
  return { written, write: (line: string) => void written.push(line) };
};

describe('failed-job admin', { skip: redisSkip }, () => {
  let url = '';
  let redis: Redis;

  before(async () => {
    const port = await freePort();
    await startRedisServer(port);
    url = `redis://127.0.0.1:${port}`;
    redis = await createRedisClient(url, silent, { connectTimeoutMs: 1_000 });
  });

  after(async () => {
    await closeRedisClient(redis);
  });

  /**
   * A queue holding two failed jobs, made to fail by a handler that refuses until told otherwise.
   * Returns a worker that will then succeed, to run whatever is retried.
   */
  const withFailedJobs = async () => {
    const prefix = `admin-${randomUUID()}`;
    const job = defineJob({
      name: 'test.refused',
      queue: defaultQueue,
      schema: z.object({ n: z.number() }),
    });
    let accept = false;
    const ran: number[] = [];
    const workerRedis = connectWorkerRedis(url, silent);
    const workers = startJobWorkers({
      redis: workerRedis,
      prefix,
      handlers: [
        handleJob(job, ({ n }) => {
          if (!accept) return Promise.reject(new PermanentJobError(`refused ${n}`));
          ran.push(n);
          return Promise.resolve();
        }),
      ],
      concurrency: 1,
      shutdownTimeoutMs: 1_000,
      log: silent,
    });
    const producer = createJobProducer({ redis, prefix, timeoutMs: 2_000, log: silent });
    const ids = [
      await producer.jobs.enqueue(job, { n: 1 }, { jobId: 'refused-1' }),
      await producer.jobs.enqueue(job, { n: 2 }, { jobId: 'refused-2' }),
    ];
    const view = new Queue('default', { connection: redis, prefix, skipVersionCheck: true });
    for (let attempt = 0; (await view.getFailedCount()) < 2; attempt++) {
      if (attempt === 200) assert.fail('the jobs did not fail');
      await sleep(10);
    }
    return {
      options: { redis, prefix },
      ids,
      ran,
      view,
      accept: () => (accept = true),
      close: async () => {
        await workers.close();
        await producer.close();
        await view.close();
        await workerRedis.quit();
      },
    };
  };

  it('lists failed jobs, newest first, with why and when they failed', async () => {
    const setup = await withFailedJobs();
    try {
      const failed = await listFailedJobs(setup.options, ['default'], 10);
      assert.deepEqual(
        failed.map(({ id, name, attempts, reason }) => ({ id, name, attempts, reason })),
        [
          { id: 'refused-2', name: 'test.refused', attempts: 1, reason: 'refused 2' },
          { id: 'refused-1', name: 'test.refused', attempts: 1, reason: 'refused 1' },
        ],
      );
      assert.ok(failed.every((job) => job.queue === 'default' && job.failedAt?.endsWith('Z')));
      assert.equal((await listFailedJobs(setup.options, ['default'], 1)).length, 1);
    } finally {
      await setup.close();
    }
  });

  it('puts one failed job back, with all its attempts, and leaves the others', async () => {
    const setup = await withFailedJobs();
    try {
      setup.accept();
      assert.deepEqual(await retryFailedJobs(setup.options, 'default', { jobId: 'refused-1' }), [
        'refused-1',
      ]);
      for (let attempt = 0; setup.ran.length < 1; attempt++) {
        if (attempt === 200) assert.fail('the retried job did not run');
        await sleep(10);
      }
      assert.deepEqual(setup.ran, [1]);
      assert.equal(await (await setup.view.getJob('refused-2'))?.getState(), 'failed');
      assert.deepEqual(
        await retryFailedJobs(setup.options, 'default', { jobId: 'refused-1' }),
        [],
        'no longer failed, so not retried again',
      );
      assert.deepEqual(await retryFailedJobs(setup.options, 'default', { jobId: 'missing' }), []);
    } finally {
      await setup.close();
    }
  });

  it('puts every failed job of a queue back', async () => {
    const setup = await withFailedJobs();
    try {
      setup.accept();
      const retried = await retryFailedJobs(setup.options, 'default', { all: true });
      assert.deepEqual(retried.sort(), ['refused-1', 'refused-2']);
      for (let attempt = 0; setup.ran.length < 2; attempt++) {
        if (attempt === 200) assert.fail('the retried jobs did not run');
        await sleep(10);
      }
    } finally {
      await setup.close();
    }
  });

  describe('runJobsAdmin, the `pnpm jobs` command', () => {
    it('prints each failed job as a line of JSON, and a count on stderr', async () => {
      const setup = await withFailedJobs();
      const [out, err] = [lines(), lines()];
      try {
        const code = await runJobsAdmin(['failed', '--limit', '5'], {
          options: setup.options,
          queues: ['default'],
          out,
          err,
        });
        assert.equal(code, 0);
        assert.deepEqual(
          out.written.map((line) => (JSON.parse(line) as { id: string }).id),
          ['refused-2', 'refused-1'],
        );
        assert.deepEqual(err.written, ['2 failed job(s)']);
      } finally {
        await setup.close();
      }
    });

    it('retries one job or all, and fails for a job that is not failed', async () => {
      const setup = await withFailedJobs();
      const run = (argv: string[]) => {
        const [out, err] = [lines(), lines()];
        return runJobsAdmin(argv, { options: setup.options, queues: ['default'], out, err }).then(
          (code) => ({ code, out: out.written, err: err.written }),
        );
      };
      // Retried jobs now succeed, so one never returns to the failed set before the next check.
      setup.accept();
      try {
        assert.deepEqual(await run(['retry', 'default', 'refused-1']), {
          code: 0,
          out: ['{"queue":"default","id":"refused-1","retried":true}'],
          err: ['1 job(s) put back'],
        });
        assert.equal((await run(['retry', 'default', 'refused-1'])).code, 1);
        assert.equal((await run(['retry', 'default', '--all'])).code, 0);
      } finally {
        await setup.close();
      }
    });

    it('lists the schedules in Redis, and removes one by id', async () => {
      const prefix = `admin-${randomUUID()}`;
      const job = defineJob({ name: 'test.tick', queue: defaultQueue, schema: z.object({}) });
      await syncJobSchedules({
        redis,
        prefix,
        schedules: [
          defineSchedule({ id: 'nightly', job, payload: {}, cron: '0 3 * * *', timezone: 'UTC' }),
        ],
        queues: ['default'],
        handled: ['test.tick'],
        version: '1.0.0',
        log: silent,
      });
      const run = async (argv: string[]) => {
        const [out, err] = [lines(), lines()];
        const code = await runJobsAdmin(argv, {
          options: { redis, prefix },
          queues: ['default'],
          out,
          err,
        });
        return { code, out: out.written, err: err.written };
      };

      const listed = await run(['schedules']);
      assert.equal(listed.code, 0);
      const [entry] = listed.out.map((line) => JSON.parse(line) as Record<string, unknown>);
      assert.deepEqual(
        { ...entry, next: typeof entry?.next },
        {
          queue: 'default',
          id: 'nightly',
          job: 'test.tick',
          cron: '0 3 * * *',
          timezone: 'UTC',
          next: 'string',
        },
      );

      assert.deepEqual(await run(['unschedule', 'default', 'nightly']), {
        code: 0,
        out: ['{"queue":"default","id":"nightly","removed":true}'],
        err: [],
      });
      assert.equal((await run(['unschedule', 'default', 'nightly'])).code, 1);
      assert.deepEqual((await run(['schedules'])).out, []);
    });

    it('answers a mistaken command with its usage and exit code 2', async () => {
      const options = { redis, prefix: 'unused' };
      for (const argv of [
        [],
        ['unknown'],
        ['failed', '--limit', '0'],
        ['failed', '--queue', 'email'],
        ['retry', 'default'],
        ['retry', 'email', '1'],
        ['unschedule', 'default'],
        ['unschedule', 'email', 'x'],
      ]) {
        const [out, err] = [lines(), lines()];
        assert.equal(
          await runJobsAdmin(argv, { options, queues: ['default'], out, err }),
          2,
          argv.join(' '),
        );
        assert.deepEqual(out.written, []);
      }
    });
  });
});
