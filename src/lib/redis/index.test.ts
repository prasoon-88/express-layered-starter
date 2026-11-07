import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import pino, { type Logger } from 'pino';
import type { ChainableCommander } from 'ioredis';
import { freePort, holdDeadPort, redisSkip, startRedisServer } from '#testing/redisServer';
import {
  closeRedisClient,
  createRedisClient,
  defineScript,
  duplicateRedisClient,
  execOrThrow,
  type Redis,
} from './index.ts';

const silent = pino({ level: 'silent' });

const recordingLog = () => {
  const errors: unknown[] = [];
  const log = Object.assign(Object.create(silent) as Logger, {
    error: (fields: unknown) => errors.push(fields),
  });
  return { log, errors };
};

describe('execOrThrow', () => {
  const transaction = (replies: [Error | null, unknown][] | null) =>
    ({ exec: () => Promise.resolve(replies) }) as unknown as ChainableCommander;

  it('returns the reply of each command', async () => {
    assert.deepEqual(
      await execOrThrow(
        transaction([
          [null, 1],
          [null, 'OK'],
        ]),
      ),
      [1, 'OK'],
    );
  });

  it('throws the first failed command, which ioredis would only report in its replies', async () => {
    const failure = new Error('WRONGTYPE');
    await assert.rejects(
      execOrThrow(
        transaction([
          [null, 1],
          [failure, null],
        ]),
      ),
      failure,
    );
  });

  it('throws when the transaction was aborted', async () => {
    await assert.rejects(execOrThrow(transaction(null)), /aborted/);
  });
});

describe('closeRedisClient', () => {
  const client = (status: string) => {
    const calls: string[] = [];
    return {
      calls,
      client: {
        status,
        quit: () => {
          calls.push('quit');
          return Promise.resolve('OK' as const);
        },
        disconnect: () => {
          calls.push('disconnect');
        },
      } as unknown as Redis,
    };
  };

  it('quits a ready connection, letting in-flight commands finish', async () => {
    const { client: ready, calls } = client('ready');
    await closeRedisClient(ready);
    assert.deepEqual(calls, ['quit']);
  });

  it('drops one that is still connecting, and leaves an ended one alone', async () => {
    const connecting = client('reconnecting');
    await closeRedisClient(connecting.client);
    assert.deepEqual(connecting.calls, ['disconnect']);

    const ended = client('end');
    await closeRedisClient(ended.client);
    assert.deepEqual(ended.calls, []);
  });
});

describe('the Redis client', { skip: redisSkip }, () => {
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

  it('runs a script by its SHA, sending the source once when the server does not know it', async () => {
    const echo = defineScript('return ARGV[1] .. KEYS[1]');
    const sent: string[] = [];
    const spy = {
      evalsha: (...args: Parameters<Redis['evalsha']>) => {
        sent.push('evalsha');
        return redis.evalsha(...args);
      },
      eval: (...args: Parameters<Redis['eval']>) => {
        sent.push('eval');
        return redis.eval(...args);
      },
    } as Pick<Redis, 'evalsha' | 'eval'>;

    // As after a restart or a failover: the server holds no script.
    await redis.script('FLUSH');
    assert.equal(await echo(spy, ['b'], ['a']), 'ab');
    assert.equal(await echo(spy, ['d'], ['c']), 'cd');
    assert.deepEqual(sent, ['evalsha', 'eval', 'evalsha']);
  });

  it('rethrows a script error that is not NOSCRIPT', async () => {
    const failing = defineScript(`return redis.call('INCR', KEYS[1])`);
    const key = `script-${randomUUID()}`;
    await redis.set(key, 'not a number');
    await assert.rejects(failing(redis, [key], []), /not an integer/);
  });

  it('runs a transaction and throws the command Redis refused', async () => {
    const key = `exec-${randomUUID()}`;
    await redis.set(key, 'not a number');
    await assert.rejects(execOrThrow(redis.multi().incr(key)), /not an integer/);
    assert.deepEqual(await execOrThrow(redis.multi().set(key, '1').incr(key)), ['OK', 2]);
  });

  it('duplicates a connection that connects by itself, with a command timeout', async () => {
    const copy = duplicateRedisClient(redis, silent, { commandTimeoutMs: 1_000, name: 'test' });
    try {
      for (let attempt = 0; copy.status !== 'ready' && attempt < 100; attempt++) await sleep(10);
      assert.equal(await copy.ping(), 'PONG');
      assert.equal(copy.options.commandTimeout, 1_000);
      assert.equal(copy.options.enableAutoPipelining, false);
    } finally {
      copy.disconnect();
    }
  });

  it('auto-pipelines a duplicate on request, answering each command', async () => {
    const copy = duplicateRedisClient(redis, silent, {
      commandTimeoutMs: 1_000,
      name: 'test',
      autoPipelining: true,
    });
    try {
      for (let attempt = 0; copy.status !== 'ready' && attempt < 100; attempt++) await sleep(10);
      assert.equal(copy.options.enableAutoPipelining, true);
      const key = `pipe-${randomUUID()}`;
      // Sent in one tick, so ioredis writes them as one pipeline.
      const replies = await Promise.all([copy.set(key, '1'), copy.incr(key), copy.get(key)]);
      assert.deepEqual(replies, ['OK', 2, '2']);
    } finally {
      copy.disconnect();
    }
  });

  it('logs what goes wrong on a duplicate, naming it', async () => {
    const { log, errors } = recordingLog();
    const { port } = await holdDeadPort();
    const down = await createRedisClient(`redis://127.0.0.1:${port}`, silent, {
      connectTimeoutMs: 100,
    });
    const copy = duplicateRedisClient(down, log, { commandTimeoutMs: 100, name: 'cache' });
    try {
      for (let attempt = 0; errors.length === 0 && attempt < 100; attempt++) await sleep(10);
      assert.ok(errors.length > 0);
      assert.equal((errors[0] as { connection: string }).connection, 'cache');
    } finally {
      copy.disconnect();
      await closeRedisClient(down);
    }
  });
});
