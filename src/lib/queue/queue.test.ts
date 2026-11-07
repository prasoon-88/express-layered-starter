import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JobConfigError } from './errors.ts';
import { defineQueue } from './queue.ts';

describe('defineQueue', () => {
  it('describes a queue, leaving concurrency and the rate limit unset unless given, frozen', () => {
    const queue = defineQueue({ name: 'default' });
    assert.deepEqual(queue, { name: 'default', concurrency: undefined, rateLimit: undefined });
    assert.ok(Object.isFrozen(queue));

    const limited = defineQueue({
      name: 'email',
      concurrency: 10,
      rateLimit: { max: 14, perMs: 1_000 },
    });
    assert.deepEqual(limited.rateLimit, { max: 14, perMs: 1_000 });
    assert.ok(Object.isFrozen(limited.rateLimit));
  });

  it('refuses a name BullMQ keys cannot hold, and limits that can never work', () => {
    for (const name of ['Email', 'email:high', '1email', ''])
      assert.throws(() => defineQueue({ name }), JobConfigError, name);
    for (const spec of [
      { concurrency: 0 },
      { concurrency: 1_001 },
      { concurrency: 1.5 },
      { rateLimit: { max: 0, perMs: 1_000 } },
      { rateLimit: { max: 1, perMs: 0 } },
    ])
      assert.throws(
        () => defineQueue({ name: 'q', ...spec }),
        JobConfigError,
        JSON.stringify(spec),
      );
  });
});
