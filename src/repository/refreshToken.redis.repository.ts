import { ServiceUnavailableError } from '#errors';
import type { Redis } from '#lib/redis/index';
import type {
  NewRefreshToken,
  RefreshTokenRepository,
  StoredRefreshToken,
} from './refreshToken.repository.ts';

type RedisRefreshTokenOptions = {
  redis: Redis;
  /** Namespaces the keys, e.g. `<SERVICE_NAME>:auth`. */
  prefix: string;
  /**
   * How long a revoked family is remembered. At least the refresh ttl: every token in the family
   * was issued before the revocation, so none outlives it by more than that.
   */
  familyTtlMs: number;
};

// HSETNX alone would create the hash for a missing id. Checking first, in the same script, keeps
// "exists and unused" one atomic step, so exactly one caller wins.
const MARK_USED = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
return redis.call('HSETNX', KEYS[1], 'usedAt', ARGV[1])`;

// Commands fail fast while Redis is unreachable (no offline queue). Without a session store the
// server cannot log anyone in or refresh, so the client gets a 503 to retry, not a 500.
const unavailable = (cause: unknown) =>
  Object.assign(new ServiceUnavailableError('Session store is unavailable'), { cause });

const guard = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (err) {
    throw unavailable(err);
  }
};

export const createRedisRefreshTokenRepository = ({
  redis,
  prefix,
  familyTtlMs,
}: RedisRefreshTokenOptions): RefreshTokenRepository => {
  const tokenKey = (id: string) => `${prefix}:rt:${id}`;
  const familyKey = (familyId: string) => `${prefix}:rtf:${familyId}`;

  const create = (data: NewRefreshToken) =>
    guard(async () => {
      const key = tokenKey(data.id);
      // One transaction, so a token is never stored without its expiry.
      await redis
        .multi()
        .hSet(key, {
          userId: data.userId,
          familyId: data.familyId,
          sessionVersion: String(data.sessionVersion),
          hash: data.hash,
          expiresAt: String(data.expiresAt),
        })
        .pExpireAt(key, data.expiresAt)
        .exec();
    });

  const findById = (id: string) =>
    guard(async (): Promise<StoredRefreshToken | undefined> => {
      const row = await redis.hGetAll(tokenKey(id));
      if (!row.userId || !row.familyId || !row.sessionVersion || !row.hash || !row.expiresAt)
        return undefined;

      const revokedAt = await redis.get(familyKey(row.familyId));
      return {
        id,
        userId: row.userId,
        familyId: row.familyId,
        sessionVersion: Number(row.sessionVersion),
        hash: row.hash,
        expiresAt: Number(row.expiresAt),
        usedAt: row.usedAt === undefined ? null : Number(row.usedAt),
        revokedAt: revokedAt === null ? null : Number(revokedAt),
      };
    });

  const markUsed = (id: string, now: number) =>
    guard(
      async () =>
        (await redis.eval(MARK_USED, { keys: [tokenKey(id)], arguments: [String(now)] })) === 1,
    );

  const revokeFamily = (familyId: string, now: number) =>
    guard(async () => {
      await redis.set(familyKey(familyId), String(now), {
        condition: 'NX',
        expiration: { type: 'PX', value: familyTtlMs },
      });
    });

  return { create, findById, markUsed, revokeFamily };
};
