import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { parseEnv } from '#constants/env/schema';
import { freePort, redisSkip, startRedisServer } from '#testing/redisServer';
import * as z from 'zod';
import {
  connectWorkerRedis,
  defineJob,
  defineQueue,
  initJobs,
  JobsUnavailableError,
  queuePrefix,
} from './index.ts';

const silent = pino({ level: 'silent' });

const exampleJob = defineJob({
  name: 'test.init',
  queue: defineQueue({ name: 'default' }),
  schema: z.object({ message: z.string() }),
});

const env = (overrides: Record<string, string> = {}) =>
  parseEnv({ NODE_ENV: 'test', SERVICE_NAME: `jobs-${randomUUID()}`, ...overrides });

describe('initJobs', () => {
  it('boots without a queue, and rejects every enqueue then', async () => {
    const { jobs, readinessChecks, close } = await initJobs(env(), silent);
    assert.deepEqual(readinessChecks, []);
    await assert.rejects(jobs.enqueue(exampleJob, { message: 'hi' }), JobsUnavailableError);
    await close();
  });

  it('prefixes every queue key with SERVICE_NAME', () => {
    assert.equal(queuePrefix({ SERVICE_NAME: 'billing' }), 'billing:jobs');
  });

  describe('with a queue Redis', { skip: redisSkip }, () => {
    let url = '';

    before(async () => {
      const port = await freePort();
      await startRedisServer(port);
      url = `redis://127.0.0.1:${port}`;
    });

    for (const [setting, name] of [
      ['QUEUE_REDIS_URL', 'its own'],
      ['REDIS_URL', 'the shared one'],
    ] as const)
      it(`enqueues on ${name} (${setting}), and reports it in readiness`, async () => {
        const config = env({ [setting]: url });
        const { jobs, readinessChecks, close } = await initJobs(config, silent);
        const check = connectWorkerRedis(url, silent);
        try {
          const id = await jobs.enqueue(exampleJob, { message: 'hi' });
          assert.equal(await check.exists(`${queuePrefix(config)}:default:${id}`), 1);
          assert.deepEqual(
            readinessChecks.map(({ name, critical }) => ({ name, critical })),
            [{ name: 'job-queue', critical: false }],
          );
          await readinessChecks[0]!.run();
        } finally {
          await close();
          check.disconnect();
        }
      });
  });
});
