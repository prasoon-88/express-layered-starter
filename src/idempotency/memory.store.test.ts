import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CompletedRecord, InProgressRecord } from './types.ts';
import { createMemoryStore } from './memory.store.ts';

const progress = (token: string): InProgressRecord => ({
  state: 'in_progress',
  fingerprint: 'fp',
  token,
  startedAt: 0,
});

const done: CompletedRecord = { state: 'completed', fingerprint: 'fp', completedAt: 1 };

describe('createMemoryStore', () => {
  it('keeps the first lock and ignores a stale token', async () => {
    let now = 0;
    const store = createMemoryStore(() => now);

    assert.equal((await store.acquire('k', progress('t1'), 10)).acquired, true);
    assert.equal((await store.acquire('k', progress('t2'), 10)).acquired, false);
    assert.equal(await store.complete('k', 't2', done, 50), false);
    await store.release('k', 't2');

    const held = await store.acquire('k', progress('t3'), 10);
    assert.equal(held.acquired, false);
    if (!held.acquired) assert.equal(held.existing.state, 'in_progress');

    assert.equal(await store.complete('k', 't1', done, 50), true);
    now = 20;
    const replay = await store.acquire('k', progress('t4'), 10);
    assert.equal(replay.acquired, false);
    if (!replay.acquired) assert.equal(replay.existing.state, 'completed');
  });

  it('drops the lock once its ttl has passed', async () => {
    let now = 0;
    const store = createMemoryStore(() => now);
    await store.acquire('k', progress('t1'), 10);
    now = 10;
    assert.equal((await store.acquire('k', progress('t2'), 10)).acquired, true);
  });
});
