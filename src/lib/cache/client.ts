import { createHash } from 'node:crypto';
import { metrics } from '@opentelemetry/api';
import { errors as bentoErrors, type BentoCache, type BentoStore } from 'bentocache';
import type { GetSetFactoryContext } from 'bentocache/types';
import type { Logger } from 'pino';
import { MS_PER_SECOND } from '#constants/time.constant';
import { sleep } from '#utils/sleep.util';
import { CacheConfigError, CacheLoadTimeoutError } from './errors.ts';
import type { KeyLock } from './lock.ts';
import {
  checkTiming,
  encodeParts,
  type AnyCacheSpec,
  type CacheTag,
  type CacheTiming,
  type KeyPart,
  type SpecOutput,
} from './spec.ts';
import type { TagVersions } from './versions.ts';

type Outcome = 'hit' | 'miss' | 'shared' | 'invalid' | 'unstorable' | 'error' | 'bypass';

export type LookupCounter = {
  add: (value: number, attributes: { entity: string; outcome: Outcome }) => void;
};

type Bento = Pick<BentoCache<Record<string, BentoStore>>, 'getOrSet' | 'get'>;

/** Nothing found: returned to the caller as is, never cached. */
type Missing = null | undefined;

export type QueryOptions = {
  /** Identifies the value within the entity, e.g. `['byId', id]`. */
  key: readonly KeyPart[];
  /**
   * Tags besides the entity's `all`, which every entry carries: what can invalidate this value.
   * Their versions are read in the same round trip as `all`'s, however many there are.
   */
  tags?: readonly CacheTag[];
  /** Overrides the spec's `ttlS` for this key. */
  ttlS?: number;
};

export type EntityCache<S extends AnyCacheSpec> = {
  readonly spec: S;
  readonly tags: S['tags'];
  /**
   * Returns the cached value, or runs `load` and caches what the schema makes of it. Concurrent
   * calls for one key share one load. A store that fails never fails the read: `load` runs
   * instead. What `load` throws is rethrown unchanged.
   */
  query: {
    (options: QueryOptions, load: () => Promise<SpecOutput<S>>): Promise<SpecOutput<S>>;
    (
      options: QueryOptions,
      load: () => Promise<SpecOutput<S> | Missing>,
    ): Promise<SpecOutput<S> | Missing>;
  };
  /** Invalidates tags of this entity. Rejects like `Cache.invalidate`. */
  invalidate: (...tags: CacheTag<S['name']>[]) => Promise<void>;
  /** Invalidates every entry of this entity. */
  invalidateAll: () => Promise<void>;
};

export type Cache = {
  /** Binds a spec to this cache. */
  entity: <S extends AnyCacheSpec>(spec: S) => EntityCache<S>;
  /**
   * Invalidates tags of any entities: every value cached under them is read again. Call it after
   * the write that changed them commits, or record the tags in the cache outbox in the same
   * transaction. Rejects when the store did not take an invalidation.
   */
  invalidate: (...tags: CacheTag[]) => Promise<void>;
};

type CacheConfig = {
  bento: Bento;
  versions: TagVersions;
  /** False while the store cannot be trusted (see PrimaryGuard): reads then skip the cache. */
  usable?: () => boolean;
  /** Present with a store shared by instances, for specs that set `clusterLockMs`. */
  lock?: KeyLock;
  /** False turns off reads and writes only: invalidations still reach the store. */
  enabled: boolean;
  /** No value, stale period included, lives longer. */
  maxTtlS: number;
  log: Logger;
  counter?: LookupCounter;
};

// A waiter checks for the lock holder's value this often at first, then less often.
const FIRST_WAIT_MS = 10;
const LONGEST_WAIT_MS = 100;

const lookupCounter = (): LookupCounter =>
  metrics
    .getMeter('cache')
    .createCounter('cache.lookups', { description: 'Cache lookups by outcome' });

/** The tokens, folded into a fixed-length part of the key. */
const digest = (tokens: readonly string[]) =>
  createHash('sha256').update(tokens.join('\n')).digest('base64url').slice(0, 22);

export const createCache = ({
  bento,
  versions,
  usable = () => true,
  lock,
  enabled,
  maxTtlS,
  log,
  counter = lookupCounter(),
}: CacheConfig): Cache => {
  const invalidate = async (...tags: CacheTag[]) => {
    await versions.bump([...new Set(tags)]);
  };

  const entity = <S extends AnyCacheSpec>(spec: S): EntityCache<S> => {
    type T = SpecOutput<S>;
    const { name, schema, clusterLockMs } = spec;
    const all = spec.tags.all();
    const count = (outcome: Outcome) => counter.add(1, { entity: name, outcome });

    /** BentoCache's options for a lifetime. Worked out once for the spec's, at bind time. */
    const bentoTiming = ({ ttlS, staleS = 0, softTimeoutMs = 0, hardTimeoutMs }: CacheTiming) => {
      if (ttlS + staleS > maxTtlS)
        throw new CacheConfigError(
          `Cache "${name}": ttlS + staleS is ${ttlS + staleS}, more than CACHE_MAX_TTL_S (${maxTtlS})`,
        );
      return {
        ttl: ttlS * MS_PER_SECOND,
        // BentoCache's grace is the whole lifetime, stale period included.
        grace: staleS > 0 ? (ttlS + staleS) * MS_PER_SECOND : (false as const),
        timeout: softTimeoutMs,
        hardTimeout: hardTimeoutMs ?? null,
      };
    };
    const specTiming = bentoTiming(spec.timing);
    const timingFor = (ttlS: number | undefined) => {
      if (ttlS === undefined) return specTiming;
      checkTiming(name, { ttlS });
      return bentoTiming({ ...spec.timing, ttlS });
    };

    /** What the schema makes of a value, or undefined when it rejects it. */
    const parse = (value: unknown): { data: T } | undefined => {
      const parsed = schema.safeParse(value);
      return parsed.success ? { data: parsed.data as T } : undefined;
    };

    /** The lock holder's value, once it is stored; undefined if it is not within `lockMs`. */
    const waitForHolder = async (key: string, lockMs: number) => {
      const deadline = Date.now() + lockMs;
      for (
        let wait = FIRST_WAIT_MS;
        Date.now() < deadline;
        wait = Math.min(wait * 2, LONGEST_WAIT_MS)
      ) {
        await sleep(Math.min(wait, Math.max(deadline - Date.now(), 0)));
        const stored = parse(await bento.get<unknown>({ key, suppressL2Errors: true }));
        if (stored) return stored;
      }
      return undefined;
    };

    const query = async (options: QueryOptions, load: () => Promise<T | Missing>) => {
      const parts = encodeParts(options.key);
      const tags = [...new Set([all, ...(options.tags ?? [])])];
      const timing = timingFor(options.ttlS);
      if (!enabled) return load();
      if (!usable()) {
        count('bypass');
        return load();
      }

      let tokens: readonly string[] | undefined;
      try {
        tokens = await versions.current(tags);
      } catch (err) {
        count('error');
        log.warn({ err, entity: name }, 'cache error');
        return load();
      }
      if (!tokens) {
        count('bypass');
        return load();
      }
      // The tags' versions are part of the key: invalidating one moves the value to a new key.
      const key = `${name}:${spec.version}:${parts}:${digest(tokens)}`;

      const lookup = async (forceFresh: boolean): Promise<T | Missing> => {
        // Set once this call's load finished, so the caller gets it even when nothing is stored.
        let loaded: { value: T | Missing; outcome: Outcome } | undefined;
        let held: string | undefined;

        const factory = async (ctx: GetSetFactoryContext) => {
          if (clusterLockMs && lock) {
            try {
              held = await lock.acquire(key, clusterLockMs);
            } catch (err) {
              log.warn({ err, entity: name }, 'cache lock unavailable; loading without it');
            }
            if (held === undefined) {
              // Another instance is loading this key. Its value is returned, not stored again.
              const stored = await waitForHolder(key, clusterLockMs);
              if (stored) {
                loaded = { value: stored.data, outcome: 'shared' };
                return ctx.skip();
              }
            }
          }
          const value = await load();
          if (value === undefined || value === null) {
            loaded = { value, outcome: 'miss' };
            return ctx.skip();
          }
          const parsed = parse(value);
          if (!parsed) {
            log.error({ entity: name }, 'cache schema rejects the loaded value');
            loaded = { value, outcome: 'unstorable' };
            return ctx.skip();
          }
          loaded = { value: parsed.data, outcome: 'miss' };
          return parsed.data;
        };

        let cached: unknown;
        try {
          cached = await bento.getOrSet({
            key,
            factory,
            forceFresh,
            suppressL2Errors: true,
            ...timing,
          });
        } catch (err) {
          if (err instanceof bentoErrors.E_FACTORY_ERROR) throw err.cause;
          if (err instanceof bentoErrors.E_FACTORY_HARD_TIMEOUT)
            throw new CacheLoadTimeoutError(
              `Cache "${name}": the loader took longer than hardTimeoutMs`,
              { cause: err },
            );
          // The store failed, not the loader. That must never fail the read.
          count('error');
          log.warn({ err, entity: name }, 'cache error');
          return loaded ? loaded.value : load();
        } finally {
          // After the value is stored, so an instance that waited finds it.
          if (held !== undefined)
            await lock!.release(key, held).catch((err: unknown) => {
              log.warn({ err, entity: name }, 'cache lock release failed; it lapses by itself');
            });
        }

        if (loaded) {
          count(loaded.outcome);
          return loaded.value;
        }
        const hit = parse(cached);
        if (hit) {
          count('hit');
          return hit.data;
        }
        count('invalid');
        log.warn({ entity: name }, 'cached value no longer matches its schema; reloading');
        return forceFresh ? load() : lookup(true);
      };

      return lookup(false);
    };

    return Object.freeze({
      spec,
      tags: spec.tags,
      query: query as EntityCache<S>['query'],
      invalidate,
      invalidateAll: () => invalidate(all),
    });
  };

  return { entity, invalidate };
};
