import { it } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import type { CacheOutboxStore, CacheTag } from '#lib/cache/index';

// Test-only. What every CacheOutboxStore must do, so the relay delivers each invalidation however
// the store keeps it. The memory store runs it in lib/cache/outbox.test.ts; a database store runs
// it on its branch, against a real database:
//
//   describe('postgres cache outbox', () => {
//     cacheOutboxContract(async () => {
//       const store = createPgCacheOutbox(pool)
//       return { store, enqueue: (tags) => pool.transaction((tx) => store.enqueue(tx, tags)) }
//     })
//   })

export type OutboxUnderTest = {
  /** A store with nothing in it, so one test never sees another's entries. */
  store: CacheOutboxStore;
  /** Records tags as the store's own enqueue does, committed once it resolves. */
  enqueue: (tags: readonly CacheTag[]) => Promise<void>;
};

const tag = (name: string) => JSON.stringify([name]) as CacheTag;

// Long enough that no test outlives it by accident; short ones are given where a lease must lapse.
const HELD_MS = 60_000;
const SHORT_MS = 50;

export const cacheOutboxContract = (make: () => Promise<OutboxUnderTest>) => {
  it('hands out what was enqueued, each entry with its own tags', async () => {
    const { store, enqueue } = await make();
    await enqueue([tag('a'), tag('b')]);
    await enqueue([tag('c')]);

    const claimed = await store.claim(10, HELD_MS);
    assert.deepEqual(claimed.map((entry) => [...entry.tags].sort()).sort(), [
      [tag('a'), tag('b')],
      [tag('c')],
    ]);
    assert.equal(new Set(claimed.map((entry) => entry.id)).size, 2, 'every entry has its own id');
  });

  it('never hands an entry to a second claimer while its lease holds, even at the same moment', async () => {
    const { store, enqueue } = await make();
    for (const name of ['a', 'b', 'c', 'd']) await enqueue([tag(name)]);

    const [first, second] = await Promise.all([store.claim(10, HELD_MS), store.claim(10, HELD_MS)]);
    const ids = [...first, ...second].map((entry) => entry.id);
    assert.equal(ids.length, 4, 'all four handed out');
    assert.equal(new Set(ids).size, 4, 'none of them twice');
    assert.deepEqual(await store.claim(10, HELD_MS), []);
  });

  it('hands an entry out again once its lease ran out, as after a relay that died', async () => {
    const { store, enqueue } = await make();
    await enqueue([tag('a')]);

    const [claimed] = await store.claim(10, SHORT_MS);
    await sleep(SHORT_MS * 2);
    const [again] = await store.claim(10, HELD_MS);
    assert.equal(again?.id, claimed?.id);
  });

  it('hands out at most the limit', async () => {
    const { store, enqueue } = await make();
    for (const name of ['a', 'b', 'c']) await enqueue([tag(name)]);

    assert.equal((await store.claim(2, HELD_MS)).length, 2);
    assert.equal((await store.claim(2, HELD_MS)).length, 1);
  });

  it('forgets removed entries, and ignores ids it does not hold', async () => {
    const { store, enqueue } = await make();
    await enqueue([tag('a')]);
    await enqueue([tag('b')]);

    const claimed = await store.claim(1, SHORT_MS);
    await store.remove([...claimed.map((entry) => entry.id), 'unknown-id']);
    await sleep(SHORT_MS * 2);
    const rest = await store.claim(10, HELD_MS);
    assert.equal(rest.length, 1);
    assert.notEqual(rest[0]?.id, claimed[0]?.id);
  });

  it('reports its backlog: the entries waiting, claimed or not, and the age of the oldest', async () => {
    const { store, enqueue } = await make();
    assert.deepEqual(await store.backlog(), { entries: 0, oldestAgeMs: 0 });

    await enqueue([tag('a')]);
    await sleep(SHORT_MS);
    await enqueue([tag('b')]);
    await store.claim(1, HELD_MS);

    const { entries, oldestAgeMs } = await store.backlog();
    assert.equal(entries, 2);
    assert.ok(oldestAgeMs >= SHORT_MS - 5, `oldest is ${oldestAgeMs} ms old`);

    const claimed = await store.claim(10, HELD_MS);
    await store.remove(claimed.map((entry) => entry.id));
    assert.equal((await store.backlog()).entries, 1, 'the claimed entry was never removed');
  });
};
