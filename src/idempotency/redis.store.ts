import type { Redis } from '#lib/redis/index';
import type {
  AcquireResult,
  CompletedRecord,
  IdempotencyRecord,
  IdempotencyStore,
  InProgressRecord,
} from './types.ts';

// Commit and release no-op unless the stored fencing token matches, so a request whose lock
// already expired cannot overwrite a newer attempt.
const ACQUIRE = `
local cur = redis.call('GET', KEYS[1])
if cur then return cur end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return false`;

const COMPLETE = `
local cur = redis.call('GET', KEYS[1])
if not cur then return 0 end
local decoded = cjson.decode(cur)
if decoded.state ~= 'in_progress' or decoded.token ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1`;

const RELEASE = `
local cur = redis.call('GET', KEYS[1])
if not cur then return 1 end
local decoded = cjson.decode(cur)
if decoded.state == 'in_progress' and decoded.token == ARGV[1] then redis.call('DEL', KEYS[1]) end
return 1`;

const readRecord = (value: unknown): AcquireResult => {
  if (typeof value !== 'string') return { acquired: true };
  return { acquired: false, existing: JSON.parse(value) as IdempotencyRecord };
};

export const createRedisStore = (redis: Redis): IdempotencyStore => {
  const acquire = async (
    key: string,
    record: InProgressRecord,
    lockTtlMs: number,
  ): Promise<AcquireResult> =>
    readRecord(await redis.eval(ACQUIRE, 1, key, JSON.stringify(record), String(lockTtlMs)));

  const complete = async (key: string, token: string, record: CompletedRecord, ttlMs: number) =>
    (await redis.eval(COMPLETE, 1, key, token, JSON.stringify(record), String(ttlMs))) === 1;

  const release = async (key: string, token: string) => {
    await redis.eval(RELEASE, 1, key, token);
  };

  const ping = () => redis.ping();

  return { acquire, complete, release, ping };
};
