import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { exampleJob } from '#jobs/example.job';
import { createExampleHandler } from './example.worker.ts';
import { createJobHandlers } from './index.ts';

describe('example job handler', () => {
  it('runs the example job and does nothing', async () => {
    const handler = createExampleHandler();
    assert.equal(handler.job, exampleJob);
    const ctx = {
      jobId: '1',
      attempt: 1,
      signal: new AbortController().signal,
      log: pino({ level: 'silent' }),
    };
    assert.equal(await handler.run({ message: 'hi' }, ctx), undefined);
  });

  it('is among the handlers the worker process starts', () => {
    assert.deepEqual(
      createJobHandlers({}).map((handler) => handler.job.name),
      ['example.noop'],
    );
  });
});
