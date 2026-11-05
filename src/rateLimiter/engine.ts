import type { Logger } from 'pino';
import {
  RateLimiterMemory,
  RateLimiterRedis,
  type IRateLimiterOptions,
  type RateLimiterAbstract,
  type RateLimiterRes,
} from 'rate-limiter-flexible';
import type { Redis } from '#lib/redis/index';
import type { PolicyName, PolicyRegistry } from './policies.ts';
import type { Decision, Policy } from './types.ts';
import type { StoreErrorMode } from '#constants/rateLimit.constants';
import { concatenateStrings } from '#utils/concateStrings';

export type RateLimiterEngineDeps = {
  policies: PolicyRegistry;
  prefix: string;
  onStoreError: StoreErrorMode;
  log: Logger;
  redis?: Redis;
  limiterFactory?: (name: string, policy: Policy) => RateLimiterAbstract;
};

export const createRateLimitEngine = (deps: RateLimiterEngineDeps) => {
  const { policies, prefix, onStoreError, log, redis } = deps;
  const cache = new Map<string, { sig: string; limiter: RateLimiterAbstract }>();

  const build = (name: string, p: Policy): RateLimiterAbstract => {
    if (deps.limiterFactory) return deps.limiterFactory(name, p);
    const base: Pick<IRateLimiterOptions, 'points' | 'blockDuration' | 'duration'> = {
      points: p.points,
      duration: p.durationS,
      blockDuration: p.blockDurationS,
    };
    const memory = new RateLimiterMemory({
      ...base,
      keyPrefix: concatenateStrings([prefix, name, 'local'], ':'),
    });
    if (!redis) return memory;

    return new RateLimiterRedis({
      ...base,
      keyPrefix: concatenateStrings([prefix, name, 'redis'], ':'),
      storeClient: redis,
      useRedisPackage: true,
      rejectIfRedisNotReady: true,
      inMemoryBlockOnConsumed: p.points + 1,
      inMemoryBlockDuration: p.blockDurationS ?? p.durationS,
      ...(onStoreError === 'local' ? { insuranceLimiter: memory } : {}),
    });
  };

  const limiterFor = (name: string, p: Policy) => {
    const sig = concatenateStrings([p.points, p.durationS, p.blockDurationS ?? 0], '|');
    const hit = cache.get(name);
    if (hit?.sig === sig) return hit.limiter;
    const limiter = build(name, p);
    cache.set(name, { sig, limiter });
    return limiter;
  };

  const consume = async (
    name: string,
    p: Policy,
    key: string,
    cost: number = 1,
  ): Promise<Decision> => {
    const limiter = limiterFor(name, p);
    const noRefund = async () => {};
    const make = (allowed: boolean, res?: RateLimiterRes, storeError = false): Decision => ({
      allowed,
      storeError,
      limit: p.points,
      remaining: allowed ? (res?.remainingPoints ?? p.points) : 0,
      windowS: p.durationS,
      resetMs: res?.msBeforeNext ?? p.durationS * 1000,
      refund:
        allowed && res
          ? async () => {
              try {
                await limiter.reward(key, cost);
              } catch (err) {
                log.warn({ err }, 'rate limit refund failed');
              }
            }
          : noRefund,
    });

    try {
      return make(true, await limiter.consume(key, cost));
    } catch (rej) {
      if (!(rej instanceof Error)) return make(false, rej as RateLimiterRes); // limit hit
      log.error({ err: rej, policy: name }, 'rate limit store error'); // store failure
      return make(onStoreError === 'allow', undefined, true);
    }
  };

  return {
    consume,
    policies,
    reset: (name: PolicyName, key: string) => limiterFor(name, policies.get(name)).delete(key),
    block: (name: PolicyName, key: string, seconds: number) =>
      limiterFor(name, policies.get(name)).block(key, seconds),
  };
};

export type RateLimitEngine = ReturnType<typeof createRateLimitEngine>;
