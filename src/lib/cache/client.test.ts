import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { BentoCache, bentostore } from 'bentocache';
import { memoryDriver } from 'bentocache/drivers/memory';
import type { GetSetFactoryContext } from 'bentocache/types';
import pino from 'pino';
import * as z from 'zod';
import { createCache, type LookupCounter } from './client.ts';
import { CacheConfigError, CacheLoadTimeoutError } from './errors.ts';
import type { KeyLock } from './lock.ts';
import { defineCacheSpec } from './spec.ts';
import { createMemoryTagVersions, type TagVersions } from './versions.ts';

const silent = pino({ level: 'silent' });

type Config = Parameters<typeof createCache>[0];
type Bento = Config['bento'];

const memoryBento = () =>
  new BentoCache({
    default: 'cache',
    stores: { cache: bentostore().useL1Layer(memoryDriver({ maxItems: 1_000 })) },
    prefix: `cache-test-${randomUUID()}`,
  });

const recorder = () => {
  const outcomes: string[] = [];
  const counter: LookupCounter = { add: (_n, { outcome }) => outcomes.push(outcome) };
  return { outcomes, counter };
};

const setup = (overrides: Partial<Config> = {}) => {
  const { outcomes, counter } = recorder();
  const bento = memoryBento();
  const versions = createMemoryTagVersions(1_000);
  const cache = createCache({
    bento,
    versions,
    enabled: true,
    maxTtlS: 3_600,
    log: silent,
    counter,
    ...overrides,
  });
  return { bento, versions, cache, outcomes };
};

const UserSchema = z.object({ id: z.string(), name: z.string() });
type User = z.infer<typeof UserSchema>;

const userSpec = defineCacheSpec({
  name: 'user',
  schema: UserSchema,
  ttlS: 60,
  tags: { one: (id: string) => [id], lists: () => [] },
});
const postSpec = defineCacheSpec({
  name: 'post',
  schema: z.object({ id: z.string() }),
  ttlS: 60,
  tags: { byAuthor: (userId: string) => [userId] },
});

/** A loader that counts its runs. */
const counting = <T>(value: () => T) => {
  let runs = 0;
  return {
    runs: () => runs,
    load: () => {
      runs++;
      return Promise.resolve(value());
    },
  };
};

const ada: User = { id: 'u1', name: 'Ada' };
const byId = (id: string) => ({ key: ['byId', id], tags: [userSpec.tags.one(id)] });

describe('createCache', () => {
  describe('query', () => {
    it('loads once, then serves the cached value', async () => {
      const { cache, outcomes } = setup();
      const users = cache.entity(userSpec);
      const loader = counting(() => ada);

      assert.deepEqual(await users.query(byId('u1'), loader.load), ada);
      assert.deepEqual(await users.query(byId('u1'), loader.load), ada);
      assert.equal(loader.runs(), 1);
      assert.deepEqual(outcomes, ['miss', 'hit']);
    });

    it('returns what the schema makes of the value, on a miss and a hit alike', async () => {
      const { cache } = setup();
      const users = cache.entity(userSpec);
      const load = () => Promise.resolve({ ...ada, passwordHash: 'secret' });

      assert.deepEqual(await users.query(byId('u1'), load), ada);
      assert.deepEqual(await users.query(byId('u1'), load), ada);
    });

    it('keeps keys apart', async () => {
      const { cache } = setup();
      const users = cache.entity(userSpec);
      await users.query(byId('u1'), () => Promise.resolve(ada));
      const other = await users.query(byId('u2'), () => Promise.resolve({ id: 'u2', name: 'Bob' }));
      assert.equal(other.name, 'Bob');
    });

    it('returns null and undefined without caching them', async () => {
      const { cache } = setup();
      const users = cache.entity(userSpec);
      for (const nothing of [null, undefined]) {
        const loader = counting((): User | null | undefined => nothing);
        assert.equal(await users.query(byId('x'), loader.load), nothing);
        assert.equal(await users.query(byId('x'), loader.load), nothing);
        assert.equal(loader.runs(), 2);
      }
    });

    it('returns, without caching, a value the schema rejects', async () => {
      const { cache, outcomes } = setup();
      const users = cache.entity(userSpec);
      const bad = { id: 1 } as unknown as User;
      const loader = counting(() => bad);

      assert.equal(await users.query(byId('u1'), loader.load), bad);
      await users.query(byId('u1'), loader.load);
      assert.equal(loader.runs(), 2);
      assert.deepEqual(outcomes, ['unstorable', 'unstorable']);
    });

    it('shares one load between concurrent calls for one key', async () => {
      const { cache } = setup();
      const users = cache.entity(userSpec);
      let runs = 0;
      const load = async () => {
        runs++;
        await sleep(20);
        return ada;
      };

      const results = await Promise.all([
        users.query(byId('u1'), load),
        users.query(byId('u1'), load),
        users.query(byId('u1'), load),
      ]);
      assert.equal(runs, 1);
      for (const result of results) assert.deepEqual(result, ada);
    });

    it('rethrows what the loader throws, unchanged, and caches nothing', async () => {
      const { cache } = setup();
      const users = cache.entity(userSpec);
      class NotFound extends Error {}
      const failure = new NotFound('gone');

      await assert.rejects(
        users.query(byId('u1'), () => Promise.reject<User>(failure)),
        (err) => err === failure,
      );
      assert.deepEqual(await users.query(byId('u1'), () => Promise.resolve(ada)), ada);
    });

    it('reloads a cached value that no longer matches the schema', async () => {
      const bento = memoryBento();
      const keys: string[] = [];
      const recording: Bento = {
        get: (options) => bento.get(options),
        getOrSet: (options) => {
          keys.push(options.key);
          return bento.getOrSet(options);
        },
      };
      const { cache, outcomes } = setup({ bento: recording });
      const users = cache.entity(userSpec);
      const loader = counting(() => ada);

      await users.query(byId('u1'), loader.load);
      await bento.set({ key: keys[0]!, value: { id: 'u1' } });
      assert.deepEqual(await users.query(byId('u1'), loader.load), ada);
      assert.deepEqual(outcomes, ['miss', 'invalid', 'miss']);
      assert.deepEqual(await users.query(byId('u1'), loader.load), ada);
      assert.equal(loader.runs(), 2);
    });

    it('rejects with CacheLoadTimeoutError when the loader outlasts hardTimeoutMs', async () => {
      const { cache } = setup();
      const slow = cache.entity(
        defineCacheSpec({ name: 'slow', schema: UserSchema, ttlS: 60, hardTimeoutMs: 20 }),
      );
      await assert.rejects(
        slow.query(byId('u1'), () => sleep(500, ada)),
        (err) => err instanceof CacheLoadTimeoutError && err.name === 'CacheLoadTimeoutError',
      );
    });

    it('serves the stale value within staleS when the loader fails', async () => {
      const { cache } = setup();
      const users = cache.entity(
        defineCacheSpec({
          name: 'stale',
          schema: UserSchema,
          ttlS: 1,
          staleS: 60,
          softTimeoutMs: 1_000,
        }),
      );
      await users.query(byId('u1'), () => Promise.resolve(ada));
      await sleep(1_100);

      assert.deepEqual(
        await users.query(byId('u1'), () => Promise.reject<User>(new Error('db down'))),
        ada,
      );
    });

    it('takes ttlS from the call, and never serves past it without staleS', async () => {
      const { cache } = setup();
      const users = cache.entity(userSpec);
      const options = { ...byId('u1'), ttlS: 1 };
      await users.query(options, () => Promise.resolve(ada));
      await sleep(1_100);

      await assert.rejects(
        users.query(options, () => Promise.reject<User>(new Error('db down'))),
        { message: 'db down' },
      );
    });

    it('keeps ttlS + staleS within CACHE_MAX_TTL_S, for the spec and the call', async () => {
      const { cache } = setup({ maxTtlS: 100 });
      const long = defineCacheSpec({ name: 'long', schema: UserSchema, ttlS: 60, staleS: 41 });
      assert.throws(() => cache.entity(long), /CACHE_MAX_TTL_S/);

      const users = cache.entity(userSpec);
      await assert.rejects(
        users.query({ ...byId('u1'), ttlS: 101 }, () => Promise.resolve(ada)),
        /CACHE_MAX_TTL_S/,
      );
      await assert.rejects(
        users.query({ ...byId('u1'), ttlS: 0 }, () => Promise.resolve(ada)),
        CacheConfigError,
      );
    });

    it('runs the loader and skips the store while disabled, still checking the options', async () => {
      const { cache, outcomes } = setup({ enabled: false });
      const users = cache.entity(userSpec);
      const loader = counting(() => ada);

      await users.query(byId('u1'), loader.load);
      await users.query(byId('u1'), loader.load);
      assert.equal(loader.runs(), 2);
      assert.deepEqual(outcomes, []);
      await assert.rejects(users.query({ key: [{}] as never }, loader.load), CacheConfigError);
    });
  });

  describe('when the store cannot be used', () => {
    it('goes to the loader while the store is not usable', async () => {
      let usable = false;
      const { cache, outcomes } = setup({ usable: () => usable });
      const users = cache.entity(userSpec);
      const loader = counting(() => ada);

      await users.query(byId('u1'), loader.load);
      usable = true;
      await users.query(byId('u1'), loader.load);
      await users.query(byId('u1'), loader.load);
      assert.equal(loader.runs(), 2);
      assert.deepEqual(outcomes, ['bypass', 'miss', 'hit']);
    });

    it('goes to the loader while the versions say the epoch is not set', async () => {
      const versions: TagVersions = {
        current: () => Promise.resolve(undefined),
        bump: () => Promise.resolve(),
      };
      const { cache, outcomes } = setup({ versions });
      assert.deepEqual(
        await cache.entity(userSpec).query(byId('u1'), () => Promise.resolve(ada)),
        ada,
      );
      assert.deepEqual(outcomes, ['bypass']);
    });

    it('goes to the loader when reading the versions fails', async () => {
      const versions: TagVersions = {
        current: () => Promise.reject(new Error('store down')),
        bump: () => Promise.reject(new Error('store down')),
      };
      const { cache, outcomes } = setup({ versions });
      assert.deepEqual(
        await cache.entity(userSpec).query(byId('u1'), () => Promise.resolve(ada)),
        ada,
      );
      assert.deepEqual(outcomes, ['error']);
      await assert.rejects(cache.invalidate(userSpec.tags.one('u1')), /store down/);
    });

    it('goes to the loader when the value store fails, loading once', async () => {
      const failure = new Error('store down');
      const loader = counting(() => ada);
      for (const getOrSet of [
        () => Promise.reject(failure),
        // Fails after the load: the value already loaded is returned, not loaded again.
        async ({ factory }: { factory: (ctx: GetSetFactoryContext) => Promise<unknown> }) => {
          await factory({ skip: () => undefined } as unknown as GetSetFactoryContext);
          throw failure;
        },
      ]) {
        const bento = { getOrSet, get: () => Promise.resolve(undefined) } as unknown as Bento;
        const { cache, outcomes } = setup({ bento });
        assert.deepEqual(await cache.entity(userSpec).query(byId('u1'), loader.load), ada);
        assert.deepEqual(outcomes, ['error']);
      }
      assert.equal(loader.runs(), 2);
    });
  });

  describe('invalidation', () => {
    it('reloads what a tag covered, and only that', async () => {
      const { cache } = setup();
      const users = cache.entity(userSpec);
      const first = counting(() => ada);
      const second = counting(() => ({ id: 'u2', name: 'Bob' }));

      await users.query(byId('u1'), first.load);
      await users.query(byId('u2'), second.load);
      await users.invalidate(users.tags.one('u1'));
      await users.query(byId('u1'), first.load);
      await users.query(byId('u2'), second.load);

      assert.equal(first.runs(), 2);
      assert.equal(second.runs(), 1);
    });

    it('never serves, after an invalidation, a value loaded before it', async () => {
      const { cache, outcomes } = setup();
      const users = cache.entity(userSpec);
      let runs = 0;
      const load = async () => {
        runs++;
        // A write commits and invalidates while this load holds what it read before the write.
        if (runs === 1) await users.invalidate(users.tags.one('u1'));
        return ada;
      };

      await users.query(byId('u1'), load);
      await users.query(byId('u1'), load);
      await users.query(byId('u1'), load);
      assert.equal(runs, 2);
      assert.deepEqual(outcomes, ['miss', 'miss', 'hit']);
    });

    it('reaches every entry of one entity, and no other, with invalidateAll', async () => {
      const { cache } = setup();
      const users = cache.entity(userSpec);
      const posts = cache.entity(postSpec);
      const user = counting(() => ada);
      const post = counting(() => ({ id: 'p1' }));

      await users.query(byId('u1'), user.load);
      await posts.query({ key: ['p1'] }, post.load);
      await users.invalidateAll();
      await users.query(byId('u1'), user.load);
      await posts.query({ key: ['p1'] }, post.load);

      assert.equal(user.runs(), 2);
      assert.equal(post.runs(), 1);
    });

    it('reaches a value through a tag of another entity, given on the cache', async () => {
      const { cache } = setup();
      const posts = cache.entity(postSpec);
      const loader = counting(() => ({ id: 'p1' }));
      const options = { key: ['p1'], tags: [userSpec.tags.one('u1')] };

      await posts.query(options, loader.load);
      await cache.invalidate(userSpec.tags.one('u1'));
      await posts.query(options, loader.load);
      assert.equal(loader.runs(), 2);
    });

    it('takes only its own tags on an entity, and any on the cache', async () => {
      const { cache } = setup();
      // @ts-expect-error: a post tag is not a user tag; cache.invalidate is the way across entities.
      await cache.entity(userSpec).invalidate(postSpec.tags.byAuthor('u1'));
      await cache.invalidate(userSpec.tags.one('u1'), postSpec.tags.byAuthor('u1'));
    });

    it('still records invalidations while disabled', async () => {
      const { bento, versions, cache } = setup();
      const off = createCache({ bento, versions, enabled: false, maxTtlS: 3_600, log: silent });
      const loader = counting(() => ada);

      await cache.entity(userSpec).query(byId('u1'), loader.load);
      await off.invalidate(userSpec.tags.one('u1'));
      await cache.entity(userSpec).query(byId('u1'), loader.load);
      assert.equal(loader.runs(), 2);
    });
  });

  describe('with a cluster lock', () => {
    const lockedSpec = defineCacheSpec({
      name: 'locked',
      schema: UserSchema,
      ttlS: 60,
      clusterLockMs: 200,
    });

    /** A lock held by someone else, as another instance would hold it. */
    const heldElsewhere = (calls: string[] = []): KeyLock => ({
      acquire: () => {
        calls.push('acquire');
        return Promise.resolve(undefined);
      },
      release: () => Promise.resolve(),
    });

    it('returns what the holder stored, without loading or storing it again', async () => {
      const bento = memoryBento();
      const keys: string[] = [];
      const recording: Bento = {
        get: (options) => bento.get(options),
        getOrSet: (options) => {
          keys.push(options.key);
          return bento.getOrSet(options);
        },
      };
      const { cache, outcomes } = setup({ bento: recording, lock: heldElsewhere() });
      const loader = counting(() => ada);

      const waiting = cache.entity(lockedSpec).query(byId('u1'), loader.load);
      // The holder, another instance with its own BentoCache, stores the value meanwhile.
      await sleep(15);
      await bento.set({ key: keys[0]!, value: ada });
      let written = 0;
      bento.on('cache:written', () => written++);

      assert.deepEqual(await waiting, ada);
      assert.equal(loader.runs(), 0);
      assert.equal(written, 0, 'the waiter does not store it again');
      assert.deepEqual(outcomes, ['shared']);
    });

    it('loads by itself once clusterLockMs passes without a value', async () => {
      const { cache, outcomes } = setup({ lock: heldElsewhere() });
      const loader = counting(() => ada);
      assert.deepEqual(await cache.entity(lockedSpec).query(byId('u1'), loader.load), ada);
      assert.equal(loader.runs(), 1);
      assert.deepEqual(outcomes, ['miss']);
    });

    it('takes and releases the lock around its own load', async () => {
      const calls: string[] = [];
      const lock: KeyLock = {
        acquire: () => {
          calls.push('acquire');
          return Promise.resolve('token');
        },
        release: (_key, token) => {
          calls.push(`release ${token}`);
          return Promise.reject(new Error('lapsed'));
        },
      };
      const { cache } = setup({ lock });
      await cache.entity(lockedSpec).query(byId('u1'), () => Promise.resolve(ada));
      assert.deepEqual(calls, ['acquire', 'release token']);
    });

    it('loads without the lock when taking it fails, and never for a spec without one', async () => {
      const calls: string[] = [];
      const lock: KeyLock = {
        acquire: () => {
          calls.push('acquire');
          return Promise.reject(new Error('store down'));
        },
        release: () => Promise.resolve(),
      };
      const { cache } = setup({ lock });
      const loader = counting(() => ada);
      await cache.entity(lockedSpec).query(byId('u1'), loader.load);
      await cache.entity(userSpec).query(byId('u1'), loader.load);
      assert.equal(loader.runs(), 2);
      assert.deepEqual(calls, ['acquire']);
    });
  });

  it('binds a spec with its tags', () => {
    const users = setup().cache.entity(userSpec);
    assert.equal(users.spec, userSpec);
    assert.equal(users.tags, userSpec.tags);
  });
});
