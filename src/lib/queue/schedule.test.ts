import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Queue } from 'bullmq';
import pino from 'pino';
import * as z from 'zod';
import { closeRedisClient, createRedisClient, type Redis } from '#lib/redis/index';
import { freePort, redisSkip, startRedisServer } from '#testing/redisServer';
import { JobConfigError } from './errors.ts';
import { connectWorkerRedis } from './index.ts';
import { defineJob } from './job.ts';
import { defineQueue } from './queue.ts';
import { compareVersions, defineSchedule, syncJobSchedules, type JobSchedule } from './schedule.ts';
import { handleJob, startJobWorkers } from './worker.ts';

const silent = pino({ level: 'silent' });
const defaultQueue = defineQueue({ name: 'default' });
const otherQueue = defineQueue({ name: 'other' });
const tick = defineJob({
  name: 'test.tick',
  queue: defaultQueue,
  schema: z.object({ n: z.number() }),
});
const elsewhere = defineJob({ name: 'test.elsewhere', queue: otherQueue, schema: z.object({}) });

describe('defineSchedule', () => {
  it('describes a schedule by interval or by cron, its payload checked, frozen', () => {
    const every = defineSchedule({ id: 'tick', job: tick, payload: { n: 1 }, every: 1_000 });
    assert.deepEqual(every.repeat, { every: 1_000 });
    assert.ok(Object.isFrozen(every) && Object.isFrozen(every.repeat));
    const cron = defineSchedule({
      id: 'nightly',
      job: tick,
      payload: { n: 2 },
      cron: '0 3 * * *',
      timezone: 'Europe/Berlin',
    });
    assert.deepEqual(cron.repeat, { cron: '0 3 * * *', timezone: 'Europe/Berlin' });
  });

  it('refuses a schedule that could never run', () => {
    const bad = [
      { id: 'a:b', job: tick, payload: { n: 1 }, every: 1_000 },
      { id: '42', job: tick, payload: { n: 1 }, every: 1_000 },
      { id: 'x', job: tick, payload: { n: 'one' }, every: 1_000 },
      { id: 'x', job: tick, payload: { n: 1 }, every: 0 },
      {
        id: 'x',
        job: defineJob({
          name: 'test.big',
          queue: defaultQueue,
          schema: z.object({ s: z.string() }),
          maxPayloadBytes: 10,
        }),
        payload: { s: 'too long for ten' },
        every: 1_000,
      },
      { id: 'x', job: tick, payload: { n: 1 }, every: 1.5 },
      { id: 'x', job: tick, payload: { n: 1 }, cron: ' ' },
      { id: 'x', job: tick, payload: { n: 1 }, cron: '* * * * *', timezone: 'Mars/Olympus' },
    ];
    for (const spec of bad)
      assert.throws(() => defineSchedule(spec as never), JobConfigError, JSON.stringify(spec));
  });
});

describe('compareVersions', () => {
  it('orders dot-separated numbers as numbers, and anything else as text', () => {
    assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
    assert.ok(compareVersions('2.0.0', '10.0.0') < 0);
    assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
    assert.ok(compareVersions('1.2.3', '1.2') > 0);
    assert.ok(compareVersions('1.2.3-rc.2', '1.2.3-rc.1') > 0);
    assert.ok(compareVersions('abc', 'abd') < 0);
  });
});

describe('syncJobSchedules', { skip: redisSkip }, () => {
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

  const sync = (prefix: string, schedules: readonly JobSchedule[], version = '1.0.0', extra = {}) =>
    syncJobSchedules({
      redis,
      prefix,
      schedules,
      queues: ['default'],
      handled: ['test.tick', 'test.elsewhere'],
      version,
      log: silent,
      ...extra,
    });

  const schedulersOf = async (prefix: string, name = 'default') => {
    const queue = new Queue(name, { connection: redis, prefix, skipVersionCheck: true });
    try {
      return await queue.getJobSchedulers(0, -1);
    } finally {
      await queue.close();
    }
  };

  it('writes the schedules, which a worker then runs, again and again', async () => {
    const prefix = `schedule-${randomUUID()}`;
    const schedule = defineSchedule({ id: 'tick', job: tick, payload: { n: 7 }, every: 150 });
    const result = await sync(prefix, [schedule]);
    assert.deepEqual(result, { synced: true, written: ['tick'], unknown: [] });

    const runs: number[] = [];
    const workerRedis = connectWorkerRedis(url, silent);
    const workers = startJobWorkers({
      redis: workerRedis,
      prefix,
      handlers: [
        handleJob(tick, ({ n }) => {
          runs.push(n);
          return Promise.resolve();
        }),
      ],
      concurrency: 1,
      shutdownTimeoutMs: 1_000,
      log: silent,
    });
    try {
      for (let attempt = 0; runs.length < 2; attempt++) {
        if (attempt === 300) assert.fail('the schedule did not run twice');
        await sleep(10);
      }
      assert.deepEqual(runs.slice(0, 2), [7, 7]);
    } finally {
      await workers.close();
      await workerRedis.quit();
    }
  });

  it('writes the same schedule once however often it syncs', async () => {
    const prefix = `schedule-${randomUUID()}`;
    const schedule = defineSchedule({ id: 'tick', job: tick, payload: { n: 1 }, every: 60_000 });
    await sync(prefix, [schedule]);
    await sync(prefix, [schedule]);
    const schedulers = await schedulersOf(prefix);
    assert.equal(schedulers.length, 1);
    assert.equal(schedulers[0]?.every, 60_000);
  });

  it('lets a newer deploy change a schedule, and an older one leave it alone', async () => {
    const prefix = `schedule-${randomUUID()}`;
    const every = (ms: number) =>
      defineSchedule({ id: 'tick', job: tick, payload: { n: 1 }, every: ms });

    await sync(prefix, [every(60_000)], '1.0.0');
    await sync(prefix, [every(30_000)], '1.1.0');
    assert.deepEqual(await sync(prefix, [every(60_000)], '1.0.0'), {
      synced: false,
      newer: '1.1.0',
    });
    assert.equal((await schedulersOf(prefix))[0]?.every, 30_000);
  });

  it("ends with the newest deploy's schedules when deploys sync at the same time", async () => {
    for (let round = 0; round < 5; round++) {
      const prefix = `schedule-${randomUUID()}`;
      const every = (ms: number) =>
        defineSchedule({ id: 'tick', job: tick, payload: { n: 1 }, every: ms });
      await Promise.all([
        sync(prefix, [every(10_000)], '1.0.0'),
        sync(prefix, [every(20_000)], '2.0.0'),
        sync(prefix, [every(10_000)], '1.0.0'),
      ]);
      assert.equal((await schedulersOf(prefix))[0]?.every, 20_000, `round ${round}`);
    }
  });

  it('reports a schedule no code declares, and leaves it in place', async () => {
    const prefix = `schedule-${randomUUID()}`;
    await sync(prefix, [
      defineSchedule({ id: 'old', job: tick, payload: { n: 1 }, every: 60_000 }),
    ]);
    const result = await sync(prefix, []);
    assert.deepEqual(result, {
      synced: true,
      written: [],
      unknown: [{ queue: 'default', id: 'old' }],
    });
    assert.equal((await schedulersOf(prefix)).length, 1);
  });

  it('writes only the schedules of the queues it serves', async () => {
    const prefix = `schedule-${randomUUID()}`;
    await sync(prefix, [
      defineSchedule({ id: 'away', job: elsewhere, payload: {}, every: 60_000 }),
    ]);
    assert.deepEqual(await schedulersOf(prefix, 'other'), []);
  });

  it('refuses a schedule no handler could run, two with one id, and a cron Redis refuses', async () => {
    const prefix = `schedule-${randomUUID()}`;
    const one = defineSchedule({ id: 'tick', job: tick, payload: { n: 1 }, every: 60_000 });
    await assert.rejects(
      syncJobSchedules({
        redis,
        prefix,
        schedules: [one],
        queues: ['default'],
        handled: [],
        version: '1',
        log: silent,
      }),
      /no handler runs job "test.tick"/,
    );
    await assert.rejects(sync(prefix, [one, one]), /Two schedules "tick"/);
    await assert.rejects(
      sync(prefix, [
        defineSchedule({ id: 'bad', job: tick, payload: { n: 1 }, cron: 'not a cron' }),
      ]),
      /could not be written/,
    );
    // The lock was released after the failure: another sync goes through at once.
    assert.equal((await sync(prefix, [one])).synced, true);
  });

  it('gives up, rather than loop, when every sync outlasts its lock', async () => {
    const prefix = `schedule-${randomUUID()}`;
    const one = defineSchedule({ id: 'tick', job: tick, payload: { n: 1 }, every: 60_000 });
    // A fast Redis can finish a sync inside 1 ms: every read under the lock is made slower.
    const slow = new Proxy(redis, {
      get: (target, key, receiver) =>
        key === 'get'
          ? async (name: string) => {
              await sleep(5);
              return target.get(name);
            }
          : (Reflect.get(target, key, receiver) as unknown),
    });
    await assert.rejects(
      sync(prefix, [one], '1.0.0', { redis: slow, lockMs: 1 }),
      /longer than their 1 ms lock 3 times/,
    );
  });
});
