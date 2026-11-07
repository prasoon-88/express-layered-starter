import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import pino, { type Logger } from 'pino';
import { closeRedisClient, createRedisClient, type Redis } from '#lib/redis/index';
import { freePort, redisSkip, startRedisServer } from '#testing/redisServer';
import { checkQueueRedis } from './redis.ts';

const silent = pino({ level: 'silent' });

const recordingLog = () => {
  const warnings: string[] = [];
  const log = Object.assign(Object.create(silent) as Logger, {
    warn: (...args: unknown[]) => warnings.push(String(args.at(-1))),
  });
  return { log, warnings };
};

/** A Redis that answers INFO with these fields, whatever the section. */
const answering = (fields: Record<string, string>) =>
  ({
    info: () =>
      Promise.resolve(
        Object.entries(fields)
          .map(([key, value]) => `${key}:${value}\r`)
          .join('\n'),
      ),
  }) as Pick<Redis, 'info'>;

describe('checkQueueRedis', () => {
  const safe = { redis_version: '7.4.1', maxmemory_policy: 'noeviction', aof_enabled: '1' };

  it('passes, silently, a recent Redis that never evicts and keeps an AOF', async () => {
    const { log, warnings } = recordingLog();
    await checkQueueRedis(answering(safe), { production: true, log });
    assert.deepEqual(warnings, []);
  });

  it('stops on a Redis older than BullMQ runs on, and warns below what it recommends', async () => {
    const { log, warnings } = recordingLog();
    await assert.rejects(
      checkQueueRedis(answering({ ...safe, redis_version: '4.0.14' }), { production: false, log }),
      /BullMQ needs 5\.0\.0/,
    );
    await checkQueueRedis(answering({ ...safe, redis_version: '6.0.16' }), {
      production: true,
      log,
    });
    assert.match(warnings[0]!, /recommends 6\.2\.0/);
  });

  it('stops on an evicting Redis in production, and only warns elsewhere', async () => {
    const evicting = answering({ ...safe, maxmemory_policy: 'allkeys-lru' });
    await assert.rejects(
      checkQueueRedis(evicting, { production: true, log: silent }),
      /maxmemory-policy allkeys-lru/,
    );
    const { log, warnings } = recordingLog();
    await checkQueueRedis(evicting, { production: false, log });
    assert.match(warnings[0]!, /evicts keys/);
  });

  it('warns about a Redis without AOF, and one that does not answer INFO', async () => {
    const { log, warnings } = recordingLog();
    await checkQueueRedis(answering({ ...safe, aof_enabled: '0' }), { production: true, log });
    await checkQueueRedis(
      { info: () => Promise.reject(new Error('unknown command')) },
      {
        production: true,
        log,
      },
    );
    assert.equal(warnings.length, 2);
    assert.match(warnings[0]!, /AOF off/);
    assert.match(warnings[1]!, /does not answer INFO/);
  });

  describe('against a real Redis', { skip: redisSkip }, () => {
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

    it('reads the policy Redis reports, and stops once it is set to evict', async () => {
      // The test server runs without AOF, as `startRedisServer` starts it.
      await checkQueueRedis(redis, { production: true, log: silent });
      await redis.config('SET', 'maxmemory-policy', 'volatile-lru');
      await assert.rejects(
        checkQueueRedis(redis, { production: true, log: silent }),
        /maxmemory-policy volatile-lru/,
      );
    });
  });
});
