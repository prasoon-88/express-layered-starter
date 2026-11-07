import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import pino from 'pino';
import { createMemoryCacheOutbox, createOutboxRelay, type CacheOutboxStore } from './outbox.ts';
import type { CacheTag } from './spec.ts';

const silent = pino({ level: 'silent' });
const tag = (name: string) => JSON.stringify([name]) as CacheTag;

describe('createMemoryCacheOutbox', () => {
  it('hands an entry to one claimer until its lease runs out, and forgets it once removed', async () => {
    let now = 1_000;
    const outbox = createMemoryCacheOutbox({ now: () => now });
    outbox.enqueue([tag('a'), tag('b')]);
    outbox.enqueue([]);

    const [entry, ...rest] = await outbox.claim(10, 500);
    assert.deepEqual(entry?.tags, [tag('a'), tag('b')]);
    assert.deepEqual(rest, [], 'an empty enqueue records nothing');
    assert.deepEqual(await outbox.claim(10, 500), [], 'leased');

    now += 500;
    assert.equal(
      (await outbox.claim(10, 500)).length,
      1,
      'handed out again once the lease ran out',
    );

    await outbox.remove([entry.id]);
    now += 500;
    assert.deepEqual(await outbox.claim(10, 500), []);
  });

  it('claims at most the limit', async () => {
    const outbox = createMemoryCacheOutbox();
    for (const name of ['a', 'b', 'c']) outbox.enqueue([tag(name)]);
    assert.equal((await outbox.claim(2, 500)).length, 2);
    assert.equal((await outbox.claim(2, 500)).length, 1);
  });
});

describe('createOutboxRelay', () => {
  const relayFor = (
    store: CacheOutboxStore,
    invalidate: (...tags: CacheTag[]) => Promise<void>,
    { pollMs = 60_000, leaseMs = 60_000 } = {},
  ) => createOutboxRelay({ store, invalidate, pollMs, leaseMs, batchSize: 2, log: silent });

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
});
