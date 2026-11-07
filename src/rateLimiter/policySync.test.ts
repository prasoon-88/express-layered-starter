import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { buildDefaultPolicies, createPolicyRegistry } from './policies.ts';
import { startPolicySync } from './policySync.ts';

const log = pino({ level: 'silent' });

const registry = () =>
  createPolicyRegistry(
    buildDefaultPolicies({
      RATE_LIMIT_MAX: 100,
      RATE_LIMIT_WINDOW_S: 60,
      RATE_LIMIT_AUTH_MAX: 10,
      RATE_LIMIT_AUTH_WINDOW_S: 900,
      RATE_LIMIT_AUTH_BLOCK_S: 900,
    }),
  );

describe('startPolicySync', () => {
  it('polls every intervalS seconds, not milliseconds', () => {
    mock.timers.enable({ apis: ['setInterval'] });
    try {
      let reads = 0;
      const stop = startPolicySync({
        redis: {
          hgetall: () => {
            reads++;
            return Promise.resolve({});
          },
        },
        hasKey: 'rl-config',
        registry: registry(),
        intervalS: 30,
        log,
      });

      assert.equal(reads, 1, 'reads once at start');

      mock.timers.tick(29_999);
      assert.equal(reads, 1, 'does not poll before 30 seconds');

      mock.timers.tick(1);
      assert.equal(reads, 2, 'polls at 30 seconds');

      stop();
      mock.timers.tick(60_000);
      assert.equal(reads, 2, 'stops polling after stop()');
    } finally {
      mock.timers.reset();
    }
  });

  it('applies a valid override from Redis and ignores an invalid one', async () => {
    const policies = registry();
    const stop = startPolicySync({
      redis: {
        hgetall: () =>
          Promise.resolve({
            global: JSON.stringify({ points: 5, durationS: 10 }),
            auth: JSON.stringify({ points: 0, durationS: 10 }),
          }),
      },
      hasKey: 'rl-config',
      registry: policies,
      intervalS: 30,
      log,
    });

    await new Promise((resolve) => setImmediate(resolve));
    stop();

    assert.deepEqual(policies.get('global'), { points: 5, durationS: 10 });
    assert.equal(policies.get('auth').points, 10);
  });
});
