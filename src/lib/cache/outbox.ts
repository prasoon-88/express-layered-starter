import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { CacheTag } from './spec.ts';

/**
 * Invalidations waiting to be delivered.
 *
 * A write and the invalidation of what it changed are two stores: committing one and then calling
 * the cache leaves a gap, and a crash in it leaves the old value cached until its TTL. With an
 * outbox the repository records the tags in the same transaction as the write, so they commit
 * together or not at all, and a relay delivers them until the cache took them. A database store
 * implements this on its branch, holding entries in a table it writes inside the transaction.
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

export const createMemoryCacheOutbox = ({ now = Date.now } = {}): MemoryCacheOutbox => {
  const entries = new Map<string, { tags: readonly CacheTag[]; leasedUntil: number }>();
  const listeners: (() => void)[] = [];

  return {
    enqueue: (tags) => {
      if (tags.length === 0) return;
      entries.set(randomUUID(), { tags: [...tags], leasedUntil: 0 });
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
  };
};

type RelayOptions = {
  store: CacheOutboxStore;
  invalidate: (...tags: CacheTag[]) => Promise<void>;
  /** How often the store is checked, for entries no `kick` announced and for retries. */
  pollMs: number;
  /** How long a claimed entry is held: past it, another relay may deliver it too. */
  leaseMs: number;
  batchSize: number;
  log: Logger;
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
}: RelayOptions): OutboxRelay => {
  let timer: NodeJS.Timeout | undefined;
  let draining: Promise<void> | undefined;
  let again = false;
  let stopped = false;

  /** Delivers until the store has nothing undelivered, or a delivery fails. */
  const drainOnce = async () => {
    for (;;) {
      const batch = await store.claim(batchSize, leaseMs);
      if (batch.length === 0) return;
      // Left claimed when this throws: the lease runs out and a later drain delivers it.
      await invalidate(...batch.flatMap((entry) => entry.tags));
      await store.remove(batch.map((entry) => entry.id));
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
