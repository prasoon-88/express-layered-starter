import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { RateLimiterMemory, type RateLimiterAbstract } from 'rate-limiter-flexible';
import type { RateLimitStoreErrorMode } from '#constants/rateLimit.constant';
import { createRateLimitEngine } from './engine.ts';
import { buildDefaultPolicies, createPolicyRegistry } from './policies.ts';

const log = pino({ level: 'silent' });
const policy = { points: 2, durationS: 60 };

const policies = () =>
  createPolicyRegistry(
    buildDefaultPolicies({
      RATE_LIMIT_MAX: 100,
      RATE_LIMIT_WINDOW_S: 60,
      RATE_LIMIT_AUTH_MAX: 10,
      RATE_LIMIT_AUTH_WINDOW_S: 900,
      RATE_LIMIT_AUTH_BLOCK_S: 900,
    }),
  );

// A store that is down: every call fails with an Error, the way a dropped Redis connection does.
const brokenStore = () =>
  ({
    consume: () => Promise.reject(new Error('connection lost')),
  }) as unknown as RateLimiterAbstract;

const engineWith = (
  onStoreError: RateLimitStoreErrorMode,
  limiterFactory?: () => RateLimiterAbstract,
) =>
  createRateLimitEngine({
    policies: policies(),
    prefix: 'test',
    onStoreError,
    log,
    limiterFactory,
  });

describe('createRateLimitEngine', () => {
  it('allows up to the limit, then reports the limit as hit', async () => {
    const engine = engineWith('local', () => new RateLimiterMemory({ points: 2, duration: 60 }));

    const first = await engine.consume('p', policy, 'k');
    const second = await engine.consume('p', policy, 'k');
    const third = await engine.consume('p', policy, 'k');

    assert.deepEqual(
      [first, second, third].map((d) => [d.allowed, d.remaining, d.storeError]),
      [
        [true, 1, false],
        [true, 0, false],
        [false, 0, false],
      ],
    );
    assert.ok(third.resetMs > 0 && third.resetMs <= 60_000);
  });

  it('flags a store failure and denies it in deny mode', async () => {
    const d = await engineWith('deny', brokenStore).consume('p', policy, 'k');
    assert.deepEqual([d.allowed, d.storeError], [false, true]);
  });

  it('flags a store failure and allows it in allow mode', async () => {
    const d = await engineWith('allow', brokenStore).consume('p', policy, 'k');
    assert.deepEqual([d.allowed, d.storeError], [true, true]);
  });
});
