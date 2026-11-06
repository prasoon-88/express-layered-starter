import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { ConflictError } from '#errors';
import { createMemoryStore } from './memory.store.ts';
import { createRun } from './run.ts';

const log = pino({ level: 'silent' });
const options = { ttlS: 60, lockTtlS: 60 };

describe('createRun', () => {
  it('runs the work once and skips a repeat', async () => {
    const run = createRun({ store: createMemoryStore(), prefix: 'test', log });
    let calls = 0;

    const first = await run('stripe:evt_1', options, () => {
      calls += 1;
      return Promise.resolve('ok');
    });
    const second = await run('stripe:evt_1', options, () => {
      calls += 1;
      return Promise.resolve('ok');
    });

    assert.deepEqual(first, { skipped: false, value: 'ok' });
    assert.deepEqual(second, { skipped: true });
    assert.equal(calls, 1);
  });

  it('releases the lock when the work fails so a retry can run', async () => {
    const run = createRun({ store: createMemoryStore(), prefix: 'test', log });
    await assert.rejects(
      run('stripe:evt_2', options, () => Promise.reject(new Error('nope'))),
      /nope/,
    );

    const retried = await run('stripe:evt_2', options, () => Promise.resolve('recovered'));
    assert.deepEqual(retried, { skipped: false, value: 'recovered' });
  });

  it('rejects a second caller while the first is still running', async () => {
    const run = createRun({ store: createMemoryStore(), prefix: 'test', log });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = run('stripe:evt_3', options, () => gate.then(() => 'done'));
    await assert.rejects(
      run('stripe:evt_3', options, () => Promise.resolve('other')),
      ConflictError,
    );
    release();
    assert.deepEqual(await first, { skipped: false, value: 'done' });
  });
});
