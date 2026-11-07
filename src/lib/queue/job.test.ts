import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as z from 'zod';
import { JobConfigError } from './errors.ts';
import { checkPayloadSize, defineJob, retryDelay } from './job.ts';
import { defineQueue } from './queue.ts';

const schema = z.object({ id: z.string() });
const email = defineQueue({ name: 'email' });

describe('defineJob', () => {
  it('describes a job, with the default policy where none is given, frozen', () => {
    const job = defineJob({ name: 'user.welcome', queue: email, schema });
    assert.equal(job.name, 'user.welcome');
    assert.equal(job.queue, email);
    assert.deepEqual(job.policy, {
      attempts: 5,
      backoffMs: 1_000,
      maxBackoffMs: 3_600_000,
      timeoutMs: 60_000,
      maxPayloadBytes: 65_536,
    });
    assert.ok(Object.isFrozen(job) && Object.isFrozen(job.policy));
  });

  it('refuses a name that is not area.action', () => {
    for (const name of ['welcome', 'User.welcome', 'user.', 'user:welcome', 'user.welcome!'])
      assert.throws(() => defineJob({ name, queue: email, schema }), JobConfigError, name);
    defineJob({ name: 'billing.invoiceSent', queue: email, schema });
  });

  it('refuses a policy that can never work', () => {
    const bad = [
      { attempts: 0 },
      { attempts: 1.5 },
      { backoffMs: 0 },
      { backoffMs: 100, maxBackoffMs: 99 },
      { timeoutMs: 0 },
      { maxPayloadBytes: 0 },
    ];
    for (const policy of bad)
      assert.throws(
        () => defineJob({ name: 'a.b', queue: email, schema, ...policy }),
        JobConfigError,
        JSON.stringify(policy),
      );
  });

  it('refuses a payload schema that is not plain JSON, since a payload is stored as JSON', () => {
    for (const shape of [z.object({ at: z.date() }), z.object({ n: z.bigint() })])
      assert.throws(() => defineJob({ name: 'a.b', queue: email, schema: shape }), /plain JSON/);
    // Only the input is stored, so a transform of plain JSON input is fine.
    defineJob({ name: 'a.b', queue: email, schema: z.string().transform((s) => s.length) });
  });
});

describe('retryDelay', () => {
  const policy = { backoffMs: 1_000, maxBackoffMs: 10_000 };

  it('doubles the ceiling with each retry, up to the cap', () => {
    const ceiling = (attempt: number) => retryDelay(policy, attempt, () => 0.999_999);
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(ceiling), [999, 1_999, 3_999, 7_999, 9_999, 9_999]);
  });

  it('spreads the wait over the whole range below the ceiling', () => {
    assert.equal(
      retryDelay(policy, 3, () => 0),
      0,
    );
    assert.equal(
      retryDelay(policy, 3, () => 0.5),
      2_000,
    );
  });
});

describe('checkPayloadSize', () => {
  const small = defineJob({
    name: 'a.b',
    queue: defineQueue({ name: 'q' }),
    schema: z.object({ text: z.string() }),
    maxPayloadBytes: 20,
  });

  it('measures the bytes of the JSON, as BullMQ does, multi-byte characters included', () => {
    // {"text":"abcdefghi"} is 20 bytes; one more character, or one character of 3 bytes, is over.
    checkPayloadSize(small, { text: 'abcdefghi' }, 'test');
    assert.throws(() => checkPayloadSize(small, { text: 'abcdefghij' }, 'test'), /21 bytes/);
    assert.throws(() => checkPayloadSize(small, { text: 'abcdefgh€' }, 'test'), /22 bytes/);
  });

  it('says what to do instead', () => {
    assert.throws(
      () => checkPayloadSize(small, { text: 'x'.repeat(100) }, 'Job "a.b"'),
      (err) =>
        err instanceof JobConfigError &&
        /^Job "a\.b": .*more than its maxPayloadBytes \(20\)\. Put the id/.test(err.message),
    );
  });
});
