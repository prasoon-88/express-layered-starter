import { randomUUID } from 'node:crypto';
import { metrics, type Meter } from '@opentelemetry/api';
import type { Logger } from 'pino';
import type { CacheTag } from './spec.ts';

/**
 * Invalidations waiting to be delivered.
 *
 * A write and the invalidation of what it changed are two stores: committing one and then calling
 * the cache leaves a gap, and a crash in it leaves the old value cached until its TTL. With an
 * outbox the repository records the tags in the same transaction as the write, so they commit
 * together or not at all, and a relay delivers them until the cache took them. A database store
 * implements this on its branch, holding entries in a table it writes inside the transaction, and
 * proves it with `cacheOutboxContract` from `src/testing/cacheOutboxContract.ts`.
 */
export type OutboxEntry = { id: string; tags: readonly CacheTag[] };

export type CacheOutboxStore = {
  /**
   * Up to `limit` undelivered entries, each now held for `leaseMs` so another relay skips it.
   * An entry whose lease ran out is handed out again: delivering twice only reads a value twice.
   */
  claim: (limit: number, leaseMs: number) => Promise<readonly OutboxEntry[]>;
  /** Forgets delivered entries. */
  remove: (ids: readonly string[]) => Promise<void>;
  /**
   * How many entries wait, claimed or not, and how long the oldest has waited, in
   * ms, by the store's own clock (0 when none waits). For the backlog metrics.
   */
  backlog: () => Promise<{ entries: number; oldestAgeMs: number }>;
  /**
   * For a store that knows when an entry was committed: the relay then delivers it at once, not
   * at its next poll.
   */
  onEnqueue?: (listener: () => void) => void;
};

/**
 * The outbox for data that lives in process memory, as the in-memory repositories do. `enqueue`
 * is synchronous, so a repository calls it in the same step as its write: nothing can run between
 * them.
 */
export type MemoryCacheOutbox = CacheOutboxStore & {
  enqueue: (tags: readonly CacheTag[]) => void;
};

type MemoryEntry = { tags: readonly CacheTag[]; enqueuedAt: number; leasedUntil: number };

export const createMemoryCacheOutbox = ({ now = Date.now } = {}): MemoryCacheOutbox => {
  // In insertion order, so the first entry is the oldest.
  const entries = new Map<string, MemoryEntry>();
  const listeners: (() => void)[] = [];

  return {
    enqueue: (tags) => {
      if (tags.length === 0) return;
      entries.set(randomUUID(), { tags: [...tags], enqueuedAt: now(), leasedUntil: 0 });
      for (const listener of listeners) listener();
    },
    onEnqueue: (listener) => {
      listeners.push(listener);
    },
    claim: (limit, leaseMs) => {
      const at = now();
      const claimed: OutboxEntry[] = [];
      for (const [id, entry] of entries) {
        if (claimed.length === limit) break;
        if (entry.leasedUntil > at) continue;
        entry.leasedUntil = at + leaseMs;
        claimed.push({ id, tags: entry.tags });
      }
      return Promise.resolve(claimed);
    },
    remove: (ids) => {
      for (const id of ids) entries.delete(id);
      return Promise.resolve();
    },
    backlog: () => {
      const oldest = entries.values().next().value;
      return Promise.resolve({
        entries: entries.size,
        oldestAgeMs: oldest ? now() - oldest.enqueuedAt : 0,
      });
    },
  };
};

type RelayMeter = Pick<
  Meter,
  | 'createCounter'
  | 'createObservableGauge'
  | 'addBatchObservableCallback'
  | 'removeBatchObservableCallback'
>;

type RelayOptions = {
  store: CacheOutboxStore;
  invalidate: (...tags: CacheTag[]) => Promise<void>;
  /** How often the store is checked, for entries no `kick` announced and for retries. */
  pollMs: number;
  /** How long a claimed entry is held: past it, another relay may deliver it too. */
  leaseMs: number;
  batchSize: number;
  log: Logger;
  meter?: RelayMeter;
};

export type OutboxRelay = {
  start: () => void;
  /** Delivers now, for an entry just committed. */
  kick: () => void;
  /** Stops polling, waits for a delivery in flight, and delivers what is still waiting. */
  stop: () => Promise<void>;
};

export const createOutboxRelay = ({
  store,
  invalidate,
  pollMs,
  leaseMs,
  batchSize,
  log,
  meter = metrics.getMeter('cache'),
}: RelayOptions): OutboxRelay => {
  let timer: NodeJS.Timeout | undefined;
  let draining: Promise<void> | undefined;
  let again = false;
  let stopped = false;

  // A backlog that grows, or an oldest entry that ages, means invalidations are not getting
  // through: values they cover are served past the write that changed them. Alert on these.
  const deliveries = meter.createCounter('cache.outbox.deliveries', {
    description: 'Outbox entries the relay delivered, or failed to deliver, by outcome',
  });
  const pending = meter.createObservableGauge('cache.outbox.pending', {
    description: 'Outbox entries waiting to be delivered',
  });
  const oldestAge = meter.createObservableGauge('cache.outbox.oldest_age', {
    description: 'Age of the oldest outbox entry waiting to be delivered',
    unit: 'ms',
  });
  const observeBacklog: Parameters<RelayMeter['addBatchObservableCallback']>[0] = async (
    result,
  ) => {
    try {
      const { entries, oldestAgeMs } = await store.backlog();
      result.observe(pending, entries);
      result.observe(oldestAge, oldestAgeMs);
    } catch (err) {
      log.warn({ err }, 'cache outbox backlog unavailable');
    }
  };

  /** Delivers until the store has nothing undelivered, or a delivery fails. */
  const drainOnce = async () => {
    for (;;) {
      const batch = await store.claim(batchSize, leaseMs);
      if (batch.length === 0) return;
      try {
        await invalidate(...batch.flatMap((entry) => entry.tags));
      } catch (err) {
        // Left claimed: the lease runs out and a later drain delivers it.
        deliveries.add(batch.length, { outcome: 'failed' });
        throw err;
      }
      await store.remove(batch.map((entry) => entry.id));
      deliveries.add(batch.length, { outcome: 'delivered' });
    }
  };

  const drain = (): Promise<void> => {
    if (draining) {
      again = true;
      return draining;
    }
    draining = (async () => {
      do {
        again = false;
        try {
          await drainOnce();
        } catch (err) {
          log.error({ err }, 'cache outbox delivery failed; it is retried');
          return;
        }
      } while (again && !stopped);
    })().finally(() => (draining = undefined));
    return draining;
  };

  return {
    start: () => {
      meter.addBatchObservableCallback(observeBacklog, [pending, oldestAge]);
      timer = setInterval(() => void drain(), pollMs);
      timer.unref();
      void drain();
    },
    kick: () => {
      if (!stopped) void drain();
    },
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      meter.removeBatchObservableCallback(observeBacklog, [pending, oldestAge]);
      await draining;
      // A last delivery, for what was enqueued meanwhile. What fails waits in the store for a
      // relay that runs later.
      try {
        await drainOnce();
      } catch (err) {
        log.error({ err }, 'cache outbox delivery failed while stopping; it stays in the store');
      }
    },
  };
};
