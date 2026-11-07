import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableError } from '#errors';
import { convertError } from './index.ts';
import { queueConverter } from './queue.converter.ts';

// Built here by name, as the converter matches them: `errors/` may not import `lib/queue`.
const named = (name: string) => Object.assign(new Error('x'), { name });

describe('queueConverter', () => {
  it('answers a job that could not be enqueued with a 503', () => {
    for (const name of ['JobsUnavailableError', 'JobEnqueueError']) {
      const err = queueConverter(named(name));
      assert.ok(err instanceof ServiceUnavailableError, name);
      assert.equal(err.statusCode, 503);
    }
  });

  it('leaves every other error alone, a job configuration error included', () => {
    assert.equal(queueConverter(named('JobConfigError')), null);
    assert.equal(queueConverter('JobEnqueueError'), null);
  });

  it('is one of the converters the error handler runs', () => {
    assert.ok(convertError(named('JobEnqueueError')) instanceof ServiceUnavailableError);
  });
});
