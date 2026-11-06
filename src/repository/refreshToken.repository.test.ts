import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import pino from 'pino';
import { AppError } from '#errors';
import { closeRedisClient, createRedisClient, type Redis } from '#lib/redis/index';
import { freePort, redisSkip, startRedisServer } from '#testing/redisServer';
import {
  createRefreshTokenRepository,
  type NewRefreshToken,
  type RefreshTokenRepository,
} from './refreshToken.repository.ts';
import { createRedisRefreshTokenRepository } from './refreshToken.redis.repository.ts';

const FAMILY_TTL_MS = 60_000;

// Real clock: the Redis store expires keys on Redis' own clock, not on the `now` argument.
const token = (id: string, familyId = 'f1', ttlMs = 60_000): NewRefreshToken => ({
  id,
  userId: 'u1',
  familyId,
  // Not 0, so a store that loses the field and defaults it fails the round-trip test.
  sessionVersion: 2,
  hash: `hash-${id}`,
  expiresAt: Date.now() + ttlMs,
});

// The same behavior from every implementation, so swapping the store changes nothing above it.
const contract = (makeRepo: () => RefreshTokenRepository) => {
  it('stores a token as unused and unrevoked', async () => {
    const repo = makeRepo();
    const t = token('t1');
    await repo.create(t, Date.now());

    assert.deepEqual(await repo.findById('t1'), { ...t, usedAt: null, revokedAt: null });
    assert.equal(await repo.findById('missing'), undefined);
  });

  it('returns a copy, so editing it does not change the stored row', async () => {
    const repo = makeRepo();
    await repo.create(token('t1'), Date.now());

    const found = await repo.findById('t1');
    found!.usedAt = 1;
    assert.equal((await repo.findById('t1'))?.usedAt, null);
  });

  it('lets exactly one of two simultaneous markUsed calls win', async () => {
    const repo = makeRepo();
    await repo.create(token('t1'), Date.now());

    const results = await Promise.all([repo.markUsed('t1', 5), repo.markUsed('t1', 6)]);
    assert.deepEqual(results.sort(), [false, true]);
    assert.ok([5, 6].includes((await repo.findById('t1'))!.usedAt!));
  });

  it('reports false for a token that does not exist, and does not create it', async () => {
    const repo = makeRepo();
    assert.equal(await repo.markUsed('missing', 0), false);
    assert.equal(await repo.findById('missing'), undefined);
  });

  it('revokes every token in the family, keeps the first time, and touches nothing else', async () => {
    const repo = makeRepo();
    await repo.create(token('a1', 'fa'), Date.now());
    await repo.create(token('a2', 'fa'), Date.now());
    await repo.create(token('b1', 'fb'), Date.now());

    await repo.revokeFamily('fa', 7);
    await repo.revokeFamily('fa', 9);

    assert.equal((await repo.findById('a1'))?.revokedAt, 7);
    assert.equal((await repo.findById('a2'))?.revokedAt, 7);
    assert.equal((await repo.findById('b1'))?.revokedAt, null);
  });

  it('treats a token written into an already revoked family as revoked', async () => {
    const repo = makeRepo();
    await repo.create(token('a1', 'fa'), Date.now());
    await repo.revokeFamily('fa', 7);

    await repo.create(token('a2', 'fa'), Date.now());
    assert.equal((await repo.findById('a2'))?.revokedAt, 7);
  });

  it('forgets a token once it has expired', async () => {
    const repo = makeRepo();
    await repo.create(token('old', 'f1', 50), Date.now());
    await repo.create(token('live', 'f1'), Date.now());

    await sleep(120);
    await repo.create(token('new', 'f2'), Date.now());

    assert.equal(await repo.findById('old'), undefined);
    assert.ok(await repo.findById('live'));
  });
};

describe('refreshTokenRepository (memory)', () => {
  contract(() => createRefreshTokenRepository());
});

describe('refreshTokenRepository (redis)', { skip: redisSkip }, () => {
  const log = pino({ level: 'silent' });
  let redis: Redis;

  before(async () => {
    const port = await freePort();
    await startRedisServer(port);
    redis = await createRedisClient(`redis://127.0.0.1:${port}`, log, { connectTimeoutMs: 1000 });
  });

  after(async () => {
    await closeRedisClient(redis);
  });

  // A fresh prefix per test keeps them apart on the one server.
  const make = () =>
    createRedisRefreshTokenRepository({
      redis,
      prefix: `rt-test-${randomUUID()}`,
      familyTtlMs: FAMILY_TTL_MS,
    });

  contract(make);

  it('shares tokens between instances, the way replicas do', async () => {
    const prefix = `rt-test-${randomUUID()}`;
    const a = createRedisRefreshTokenRepository({ redis, prefix, familyTtlMs: FAMILY_TTL_MS });
    const b = createRedisRefreshTokenRepository({ redis, prefix, familyTtlMs: FAMILY_TTL_MS });
    await a.create(token('t1'), Date.now());

    assert.equal(await b.markUsed('t1', 1), true);
    assert.equal(await a.markUsed('t1', 2), false);
  });

  it('sets Redis expiry on both the token and the revoked family', async () => {
    const prefix = `rt-test-${randomUUID()}`;
    const repo = createRedisRefreshTokenRepository({ redis, prefix, familyTtlMs: FAMILY_TTL_MS });
    await repo.create(token('t1', 'fa', 30_000), Date.now());
    await repo.revokeFamily('fa', 1);

    const tokenTtl = await redis.pTTL(`${prefix}:rt:t1`);
    const familyTtl = await redis.pTTL(`${prefix}:rtf:fa`);
    assert.ok(tokenTtl > 0 && tokenTtl <= 30_000, `token ttl ${tokenTtl}`);
    assert.ok(familyTtl > 0 && familyTtl <= FAMILY_TTL_MS, `family ttl ${familyTtl}`);
  });

  it('answers 503 when Redis is unreachable, instead of a 500', async () => {
    const down = await createRedisClient(`redis://127.0.0.1:${await freePort()}`, log, {
      connectTimeoutMs: 200,
    });
    try {
      const repo = createRedisRefreshTokenRepository({
        redis: down,
        prefix: 'down',
        familyTtlMs: FAMILY_TTL_MS,
      });
      await assert.rejects(
        repo.findById('t1'),
        (err: unknown) => err instanceof AppError && err.statusCode === 503,
      );
    } finally {
      await closeRedisClient(down);
    }
  });
});
