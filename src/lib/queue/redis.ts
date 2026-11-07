import type { Logger } from 'pino';
import type { Redis } from '#lib/redis/index';

// What BullMQ itself requires and recommends (RedisConnection.minimumVersion and
// recommendedMinimumVersion in bullmq 6). It would print them with console.warn; the queues are
// created with skipVersionCheck, and they are checked here instead, through the logger.
const MINIMUM_VERSION = [5, 0, 0];
const RECOMMENDED_VERSION = [6, 2, 0];

const field = (info: string, name: string) =>
  new RegExp(`^${name}:(\\S+)\\r?$`, 'm').exec(info)?.[1];

const isBelow = (version: string, floor: readonly number[]) => {
  const parts = version.split('.').map(Number);
  for (const [i, min] of floor.entries()) {
    const part = parts[i] ?? 0;
    if (part !== min) return part < min;
  }
  return false;
};

/**
 * Checks the Redis under the queue can hold jobs, before the worker takes one.
 *
 * - Its version: below 5.0 BullMQ's scripts do not run, so the worker stops; below 6.2 it warns.
 * - Its eviction policy: a queue is data, not a cache. Under memory pressure an evicting Redis
 *   deletes jobs silently, so only `noeviction` is safe; in production anything else stops it.
 * - AOF: without it a restart loses the jobs written since the last snapshot. A managed Redis may
 *   protect them otherwise (replicas, its own snapshots), so that is a warning.
 *
 * A Redis that does not answer INFO cannot be checked, which is a warning too.
 */
export const checkQueueRedis = async (
  redis: Pick<Redis, 'info'>,
  { production, log }: { production: boolean; log: Logger },
) => {
  let info: string;
  try {
    info = (
      await Promise.all([redis.info('server'), redis.info('memory'), redis.info('persistence')])
    ).join('\n');
  } catch (err) {
    log.warn(
      { err },
      'queue Redis does not answer INFO: its version, eviction policy and AOF are unchecked',
    );
    return;
  }

  const version = field(info, 'redis_version');
  if (version && isBelow(version, MINIMUM_VERSION))
    throw new Error(
      `queue Redis is ${version}; BullMQ needs ${MINIMUM_VERSION.join('.')} or newer`,
    );
  if (version && isBelow(version, RECOMMENDED_VERSION))
    log.warn(
      { version },
      `queue Redis is ${version}; BullMQ recommends ${RECOMMENDED_VERSION.join('.')} or newer`,
    );

  const policy = field(info, 'maxmemory_policy');
  if (policy !== undefined && policy !== 'noeviction') {
    const message = `queue Redis evicts keys (maxmemory-policy ${policy}): jobs can vanish under memory pressure. Set maxmemory-policy noeviction, or give the queue a Redis of its own (QUEUE_REDIS_URL)`;
    if (production) throw new Error(message);
    log.warn({ policy }, message);
  }
  if (field(info, 'aof_enabled') === '0')
    log.warn(
      'queue Redis has AOF off: a restart loses the jobs written since its last snapshot (appendonly yes)',
    );
};
