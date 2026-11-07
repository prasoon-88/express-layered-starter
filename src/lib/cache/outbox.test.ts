import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import pino from 'pino';
import { cacheOutboxContract } from '#testing/cacheOutboxContract';
import { createMemoryCacheOutbox, createOutboxRelay, type CacheOutboxStore } from './outbox.ts';
import type { CacheTag } from './spec.ts';

const silent = pino({ level: 'silent' });
const tag = (name: string) => JSON.stringify([name]) as CacheTag;

describe('createMemoryCacheOutbox', () => {
  cacheOutboxContract(() => {
    const store = createMemoryCacheOutbox();
    return Promise.resolve({
      store,
      enqueue: (tags) => {
        store.enqueue(tags);
        return Promise.resolve();
      },
    });
  });

  it('records nothing for an empty list of tags', async () => {
    const outbox = createMemoryCacheOutbox();
    outbox.enqueue([]);
    assert.deepEqual(await outbox.claim(10, 500), []);
  });
});

/** A meter that keeps what the relay records, and runs its backlog callback on demand. */
const recordingMeter = () => {
  const counts: { value: number; outcome: unknown }[] = [];
  // Gauges are their names here, as createObservableGauge below returns them.
  const observed = new Map<string, number>();
  let callback:
    ((result: { observe: (gauge: string, value: number) => void }) => unknown) | undefined;
  const meter = {
    createCounter: () => ({
      add: (value: number, attributes?: { outcome?: unknown }) =>
        counts.push({ value, outcome: attributes?.outcome }),
    }),
    createObservableGauge: (name: string) => name,
    addBatchObservableCallback: (cb: typeof callback) => (callback = cb),
    removeBatchObservableCallback: () => (callback = undefined),
  } as unknown as NonNullable<Parameters<typeof createOutboxRelay>[0]['meter']>;
  const collect = async () => {
    observed.clear();
    await callback?.({ observe: (gauge, value) => observed.set(gauge, value) });
    return Object.fromEntries(observed);
  };
  return { meter, counts, collect, registered: () => callback !== undefined };
};

describe('createOutboxRelay', () => {
  const relayFor = (
    store: CacheOutboxStore,
    invalidate: (...tags: CacheTag[]) => Promise<void>,
    { pollMs = 60_000, leaseMs = 60_000, meter = recordingMeter().meter } = {},
  ) => createOutboxRelay({ store, invalidate, pollMs, leaseMs, batchSize: 2, log: silent, meter });

  const recordingInvalidate = () => {
    const delivered: CacheTag[] = [];
    return {
      delivered,
      invalidate: (...tags: CacheTag[]) => {
        delivered.push(...tags);
        return Promise.resolve();
      },
    };
  };

  it('delivers what was enqueued as soon as it is told, in batches, and removes it', async () => {
    const outbox = createMemoryCacheOutbox();
    const { delivered, invalidate } = recordingInvalidate();
    const relay = relayFor(outbox, invalidate);
    outbox.onEnqueue?.(relay.kick);
    relay.start();

    for (const name of ['a', 'b', 'c']) outbox.enqueue([tag(name)]);
    await relay.stop();
    assert.deepEqual(delivered.sort(), [tag('a'), tag('b'), tag('c')]);
    assert.deepEqual(await outbox.claim(10, 0), [], 'nothing left');
  });

  it('delivers on start what an earlier process enqueued and never delivered', async () => {
    // The process that wrote crashed before delivering: its entries are still in the store.
    const outbox = createMemoryCacheOutbox();
    outbox.enqueue([tag('written-before-the-crash')]);

    const { delivered, invalidate } = recordingInvalidate();
    const relay = relayFor(outbox, invalidate);
    relay.start();
    await relay.stop();
    assert.deepEqual(delivered, [tag('written-before-the-crash')]);
  });

  it('keeps an entry whose delivery failed, and delivers it once its lease ran out', async () => {
    const outbox = createMemoryCacheOutbox();
    outbox.enqueue([tag('a')]);
    let failing = true;
    const delivered: CacheTag[] = [];
    const relay = relayFor(
      outbox,
      (...tags) => {
        if (failing) return Promise.reject(new Error('store down'));
        delivered.push(...tags);
        return Promise.resolve();
      },
      { pollMs: 10, leaseMs: 30 },
    );
    relay.start();
    await sleep(20);
    assert.deepEqual(delivered, []);

    failing = false;
    await sleep(80);
    await relay.stop();
    assert.deepEqual(delivered, [tag('a')]);
  });

  it('polls for entries nobody announced', async () => {
    const outbox = createMemoryCacheOutbox();
    const { delivered, invalidate } = recordingInvalidate();
    const relay = relayFor(outbox, invalidate, { pollMs: 10 });
    relay.start();
    outbox.enqueue([tag('a')]);
    await sleep(50);
    await relay.stop();
    assert.deepEqual(delivered, [tag('a')]);
  });

  it('runs one delivery at a time, and another after it when told during it', async () => {
    const outbox = createMemoryCacheOutbox();
    let inFlight = 0;
    let most = 0;
    const delivered: CacheTag[] = [];
    const relay = relayFor(outbox, async (...tags) => {
      most = Math.max(most, ++inFlight);
      await sleep(10);
      delivered.push(...tags);
      inFlight--;
    });
    outbox.onEnqueue?.(relay.kick);
    relay.start();

    outbox.enqueue([tag('a')]);
    await sleep(2);
    outbox.enqueue([tag('b')]);
    await sleep(50);
    await relay.stop();
    assert.equal(most, 1);
    assert.deepEqual(delivered, [tag('a'), tag('b')]);
  });

  it('delivers, when stopped, what is still waiting, and nothing after', async () => {
    const outbox = createMemoryCacheOutbox();
    const { delivered, invalidate } = recordingInvalidate();
    const relay = relayFor(outbox, invalidate);
    relay.start();
    outbox.enqueue([tag('before-stop')]);
    await relay.stop();
    assert.deepEqual(delivered, [tag('before-stop')]);

    outbox.enqueue([tag('after-stop')]);
    relay.kick();
    await sleep(10);
    assert.deepEqual(delivered, [tag('before-stop')]);
  });

  it('leaves in the store what fails while stopping', async () => {
    const outbox = createMemoryCacheOutbox();
    const relay = relayFor(outbox, () => Promise.reject(new Error('store down')), { leaseMs: 0 });
    outbox.enqueue([tag('a')]);
    await relay.stop();
    assert.equal((await outbox.claim(10, 0)).length, 1);
  });
  it('counts what it delivered and what failed, and reports the backlog while running', async () => {
    let now = 1_000;
    const outbox = createMemoryCacheOutbox({ now: () => now });
    const { meter, counts, collect, registered } = recordingMeter();
    let failing = true;
    const relay = relayFor(
      outbox,
      () => (failing ? Promise.reject(new Error('store down')) : Promise.resolve()),
      { leaseMs: 0, meter },
    );
    outbox.onEnqueue?.(relay.kick);
    outbox.enqueue([tag('a')]);
    now += 250;
    relay.start();
    await sleep(5);

    assert.deepEqual(await collect(), {
      'cache.outbox.pending': 1,
      'cache.outbox.oldest_age': 250,
    });
    failing = false;
    await relay.stop();
    assert.deepEqual(counts, [
      { value: 1, outcome: 'failed' },
      { value: 1, outcome: 'delivered' },
    ]);
    assert.equal(registered(), false, 'the backlog callback is removed on stop');
  });

  it('reports no backlog, without failing, when the store cannot tell', async () => {
    const { meter, collect } = recordingMeter();
    const store: CacheOutboxStore = {
      ...createMemoryCacheOutbox(),
      backlog: () => Promise.reject(new Error('store down')),
    };
    const relay = relayFor(store, () => Promise.resolve(), { meter });
    relay.start();
    assert.deepEqual(await collect(), {});
    await relay.stop();
  });
});
