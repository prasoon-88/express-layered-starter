import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import pino, { type Logger } from 'pino';
import { closeRedisClient, createRedisClient, type Redis } from '#lib/redis/index';
import { freePort, redisSkip, startRedisServer } from '#testing/redisServer';
import { createPrimaryGuard } from './primary.ts';

const silent = pino({ level: 'silent' });

const recordingLog = () => {
  const warnings: unknown[] = [];
  const errors: unknown[] = [];
  const log = Object.assign(Object.create(silent) as Logger, {
    warn: (fields: unknown) => warnings.push(fields),
    error: (fields: unknown) => errors.push(fields),
  });
  return { log, warnings, errors };
};

const until = async (condition: () => boolean, what: string) => {
  for (let attempt = 0; !condition(); attempt++) {
    if (attempt === 200) assert.fail(`timed out waiting until ${what}`);
    await sleep(20);
  }
};

/** A meter that keeps what the guard counts, as `name reason`. */
const recordingMeter = () => {
  const counted: string[] = [];
  const meter = {
    createCounter: (name: string) => ({
      add: (_value: number, attributes?: { reason?: string }) =>
        counted.push(attributes?.reason ? `${name} ${attributes.reason}` : name),
    }),
  } as unknown as NonNullable<Parameters<typeof createPrimaryGuard>[1]['meter']>;
  return { meter, counted };
};

const runIdOf = async (redis: Redis) => /^run_id:(\w+)/m.exec(await redis.info('server'))![1]!;

describe('createPrimaryGuard', { skip: redisSkip }, () => {
  let port = 0;
  let server: Awaited<ReturnType<typeof startRedisServer>>;
  let redis: Redis;

  before(async () => {
    port = await freePort();
    server = await startRedisServer(port);
    redis = await createRedisClient(`redis://127.0.0.1:${port}`, silent, {
      connectTimeoutMs: 1_000,
    });
  });

  after(async () => {
    await closeRedisClient(redis);
  });

  const guardFor = (epochKey: string, log: Logger = silent, meter = recordingMeter().meter) =>
    createPrimaryGuard(redis, { epochKey, epochTtlMs: 60_000, checkMs: 60_000, log, meter });

  it('is unusable until it has checked, then ties the epoch to this server', async () => {
    const epochKey = `epoch-${randomUUID()}`;
    const guard = guardFor(epochKey);
    assert.equal(guard.usable(), false);

    guard.start();
    await guard.check();
    guard.stop();
    assert.equal(guard.usable(), true);
    assert.match((await redis.get(epochKey))!, new RegExp(`^${await runIdOf(redis)}/`));
  });

  it('keeps an epoch made on this server, and renews one made on another', async () => {
    const epochKey = `epoch-${randomUUID()}`;
    const { log, warnings } = recordingLog();
    const { meter, counted } = recordingMeter();
    const guard = guardFor(epochKey, log, meter);

    await guard.check();
    const ours = await redis.get(epochKey);
    await guard.check();
    assert.equal(await redis.get(epochKey), ours, 'same server: kept');

    // As a replica promoted after a failover holds it: made under another run_id.
    await redis.set(epochKey, 'another-server/old-epoch');
    await guard.check();
    const renewed = await redis.get(epochKey);
    assert.notEqual(renewed, 'another-server/old-epoch');
    assert.match(renewed!, new RegExp(`^${await runIdOf(redis)}/`));
    assert.equal(warnings.length, 2, 'renewed twice: when first made, and for the new server');
    assert.deepEqual(counted, [
      'cache.epoch.renewals created',
      'cache.epoch.renewals server_changed',
    ]);
  });

  it('renews the epoch once, however many instances see the new server at once', async () => {
    const epochKey = `epoch-${randomUUID()}`;
    await redis.set(epochKey, 'another-server/old-epoch');
    const { log, warnings } = recordingLog();
    const { meter, counted } = recordingMeter();
    const guards = Array.from({ length: 5 }, () => guardFor(epochKey, log, meter));

    await Promise.all(guards.map((guard) => guard.check()));
    assert.equal(warnings.length, 1);
    assert.deepEqual(counted, ['cache.epoch.renewals server_changed']);
    assert.ok(guards.every((guard) => guard.usable()));
  });

  it('stays unusable, and says why, while it cannot check', async () => {
    const { log, errors } = recordingLog();
    const { meter, counted } = recordingMeter();
    const failing = {
      info: () => Promise.reject(new Error('INFO not allowed')),
    } as unknown as Redis;
    const guard = createPrimaryGuard(failing, {
      epochKey: 'unused',
      epochTtlMs: 60_000,
      checkMs: 60_000,
      log,
      meter,
    });
    await guard.check();
    assert.equal(guard.usable(), false);
    assert.equal(errors.length, 1);
    assert.deepEqual(counted, ['cache.epoch.check_failures']);
  });

  it('is unusable from a disconnect until it has checked the server it reconnected to', async () => {
    const epochKey = `epoch-${randomUUID()}`;
    const guard = guardFor(epochKey);
    guard.start();
    await guard.check();
    assert.equal(guard.usable(), true);
    const before = await runIdOf(redis);

    // A restart without persistence: another run_id and an empty dataset, as after a failover.
    server.kill();
    await once(server, 'exit');
    await until(() => !guard.usable(), 'the disconnect is noticed');
    server = await startRedisServer(port);
    await until(() => guard.usable(), 'the new server is checked');
    guard.stop();

    const after = await runIdOf(redis);
    assert.notEqual(after, before);
    assert.match((await redis.get(epochKey))!, new RegExp(`^${after}/`));
  });
});
