import { randomUUID } from 'node:crypto';
import { defineScript, execOrThrow, type Redis } from '#lib/redis/index';
import type { CacheTag } from './spec.ts';

/**
 * The current version of each tag: a random token that `bump` replaces. A cache key is built from
 * the tokens of its tags, so invalidating a tag moves every key built on it to a new one, and the
 * old entries are never read again. Nothing compares times, so no clock or pause can let an old
 * entry through.
 */
export type TagVersions = {
  /**
   * The tokens to build a key from: one per tag, creating any that is missing, plus, on Redis,
   * the cache epoch. `undefined` when the epoch is not set, so the cache must not be read.
   */
  current: (tags: readonly CacheTag[]) => Promise<readonly string[] | undefined>;
  /** A new token for each tag. Rejects unless every one was stored. */
  bump: (tags: readonly CacheTag[]) => Promise<void>;
};

/**
 * One process holds every token, so there is nothing to agree on. Capped at `maxTags`, oldest
 * first: a dropped token is made again, new, which only turns the entries built on it into misses.
 */
export const createMemoryTagVersions = (maxTags: number): TagVersions => {
  const tokens = new Map<CacheTag, string>();

  const store = (tag: CacheTag, token: string) => {
    tokens.delete(tag);
    tokens.set(tag, token);
    if (tokens.size > maxTags) tokens.delete(tokens.keys().next().value!);
    return token;
  };

  return {
    current: (tags) =>
      Promise.resolve(tags.map((tag) => tokens.get(tag) ?? store(tag, randomUUID()))),
    bump: (tags) => {
      for (const tag of tags) store(tag, randomUUID());
      return Promise.resolve();
    },
  };
};

// KEYS[1]: the epoch; KEYS[2..]: one key per tag. ARGV[1]: the token lifetime in ms;
// ARGV[2..]: a fresh token per tag, used when it has none (a script must not make its own random
// values, so the client makes them). The epoch is never made here: only the primary guard sets
// it, after it has checked which Redis it is talking to. A token in use is kept alive: its
// lifetime is renewed once half of it has passed, so it never lapses while entries need it.
const READ_TOKENS = defineScript(`
local epoch = redis.call('GET', KEYS[1])
if not epoch then return false end
local ttl = tonumber(ARGV[1])
local tokens = { epoch }
for i = 2, #KEYS do
  local token = redis.call('GET', KEYS[i])
  if not token then
    token = ARGV[i]
    redis.call('SET', KEYS[i], token, 'PX', ttl)
  elseif redis.call('PTTL', KEYS[i]) < ttl / 2 then
    redis.call('PEXPIRE', KEYS[i], ttl)
  end
  tokens[i] = token
end
return tokens
`);

type RedisTagVersionsOptions = {
  /** Every key this store writes starts with it. */
  prefix: string;
  /** How long an unused token lives. Longer than any entry, so only a token nobody reads lapses. */
  tokenTtlMs: number;
};

/** The key the cache epoch lives under, for the primary guard. */
export const epochKey = (prefix: string) => `${prefix}epoch`;

export const createRedisTagVersions = (
  redis: Redis,
  { prefix, tokenTtlMs }: RedisTagVersionsOptions,
): TagVersions => {
  const tagKey = (tag: CacheTag) => `${prefix}tag:${tag}`;

  return {
    current: async (tags) => {
      const reply = await READ_TOKENS(
        redis,
        [epochKey(prefix), ...tags.map(tagKey)],
        [tokenTtlMs, ...tags.map(() => randomUUID())],
      );
      if (reply === null) return undefined;
      if (!Array.isArray(reply) || !reply.every((token) => typeof token === 'string'))
        throw new Error('Unexpected reply from the cache token script');
      return reply;
    },
    bump: async (tags) => {
      if (tags.length === 0) return;
      const transaction = redis.multi();
      for (const tag of tags) transaction.set(tagKey(tag), randomUUID(), 'PX', tokenTtlMs);
      await execOrThrow(transaction);
    },
  };
};
