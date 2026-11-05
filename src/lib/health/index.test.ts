import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';

const { runReadinessChecks } = await import('./index.ts');

describe('runReadinessChecks', () => {
  it('reports a resolving check as up', async () => {
    const report = await runReadinessChecks([
      { name: 'db', critical: true, run: () => Promise.resolve() },
    ]);

    assert.deepEqual(report, [{ name: 'db', critical: true, status: 'up' }]);
  });

  it('reports a rejecting check as down and keeps the others', async () => {
    const report = await runReadinessChecks([
      { name: 'db', critical: true, run: () => Promise.reject(new Error('connection refused')) },
      { name: 'cache', critical: false, run: () => Promise.resolve() },
    ]);

    assert.deepEqual(report, [
      { name: 'db', critical: true, status: 'down' },
      { name: 'cache', critical: false, status: 'up' },
    ]);
  });

  it('reports a check that throws synchronously as down', async () => {
    const report = await runReadinessChecks([
      {
        name: 'db',
        critical: true,
        run: () => {
          throw new Error('boom');
        },
      },
    ]);

    assert.equal(report[0]?.status, 'down');
  });

  it('reports a check that never answers as down once the timeout passes', async () => {
    const startedAt = Date.now();

    const report = await runReadinessChecks(
      [{ name: 'db', critical: true, run: () => new Promise(() => {}) }],
      { timeoutMs: 20 },
    );

    assert.equal(report[0]?.status, 'down');
    assert.ok(Date.now() - startedAt < 1000, 'a hung dependency must not hang the probe');
  });

  it('starts every check at once instead of one after another', async () => {
    let started = 0;
    const releases: (() => void)[] = [];
    const slow = (name: string) => ({
      name,
      critical: false,
      run: () => {
        started++;
        return new Promise<void>((resolve) => releases.push(resolve));
      },
    });

    const pending = runReadinessChecks([slow('a'), slow('b')]);

    assert.equal(started, 2);
    releases.forEach((release) => release());
    await pending;
  });

  it('never puts the failure reason in the report', async () => {
    const report = await runReadinessChecks([
      { name: 'db', critical: true, run: () => Promise.reject(new Error('password=hunter2')) },
    ]);

    assert.equal(JSON.stringify(report).includes('hunter2'), false);
  });

  it('returns an empty report when nothing is registered', async () => {
    assert.deepEqual(await runReadinessChecks([]), []);
  });
});
