import { randomUUID } from 'node:crypto';
import { defineScript, type Redis } from '#lib/redis/index';

/**
 * A lock per cache key across every instance, so a miss on a hot key is loaded once, not once per
 * instance. It saves work and nothing more: no result depends on it, so a lock that lapses or a
 * Redis that fails only means a key is loaded twice.
 */
export type KeyLock = {
  /** A token when this caller now holds the lock, `undefined` when another holder has it. */
  acquire: (key: string, ttlMs: number) => Promise<string | undefined>;
  /**
   * Releases the lock only if `token` still holds it, so a lapsed holder never frees another's.
   * True when it did: the lock was held all along, since a lapsed key never comes back with the
   * same token.
   */
  release: (key: string, token: string) => Promise<boolean>;
};

const RELEASE = defineScript(`
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`);

export const createRedisKeyLock = (redis: Redis, { prefix }: { prefix: string }): KeyLock => {
  const lockKey = (key: string) => `${prefix}lock:${key}`;
  return {
    acquire: async (key, ttlMs) => {
      const token = randomUUID();
      return (await redis.set(lockKey(key), token, 'PX', ttlMs, 'NX')) === 'OK' ? token : undefined;
    },
    release: async (key, token) => (await RELEASE(redis, [lockKey(key)], [token])) === 1,
  };
};
