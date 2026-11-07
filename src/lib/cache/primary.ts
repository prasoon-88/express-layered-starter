import { randomUUID } from 'node:crypto';
import { metrics, type Meter } from '@opentelemetry/api';
import type { Logger } from 'pino';
import { defineScript, type Redis } from '#lib/redis/index';

/**
 * Keeps the cache epoch tied to the Redis server that holds it.
 *
 * Redis replicates in the background, so a failover can lose the last writes the old primary
 * acknowledged, invalidations included: an old token comes back, and with it entries it had
 * replaced. The epoch is part of every key and records the `run_id` of the server that made it.
 * A server with another `run_id` (a promoted replica, or a restart) gets a new epoch, which moves
 * every key at once, so nothing written under the old primary is read again.
 *
 * Until the server this connection talks to has been checked, the cache is not used: on start,
 * after every reconnect, and while a check fails. A connection a proxy keeps open across a
 * failover is caught by the periodic check, every `checkMs`.
 */
export type PrimaryGuard = {
  /** True once the epoch was checked against the server this connection now talks to. */
  usable: () => boolean;
  /** Checks now; resolves once done, whatever the result. */
  check: () => Promise<void>;
  start: () => void;
  stop: () => void;
};

// KEYS[1]: the epoch. ARGV[1]: the server's run_id. ARGV[2]: a fresh token. ARGV[3]: its lifetime.
// Returns 0 when the epoch was made on this server, 1 when it made the first one, 2 when it
// replaced one made on another server: a failover, or a restart. Atomic, so of many instances
// seeing a new server at once, exactly one renews the epoch and the others find it renewed.
const ENSURE_EPOCH = defineScript(`
local epoch = redis.call('GET', KEYS[1])
if epoch and string.sub(epoch, 1, #ARGV[1] + 1) == ARGV[1] .. '/' then
  redis.call('PEXPIRE', KEYS[1], ARGV[3])
  return 0
end
redis.call('SET', KEYS[1], ARGV[1] .. '/' .. ARGV[2], 'PX', ARGV[3])
if epoch then return 2 end
return 1
`);

const RENEWAL_REASON = { 1: 'created', 2: 'server_changed' } as const;

const RUN_ID = /^run_id:(\w+)\r?$/m;

type PrimaryGuardOptions = {
  epochKey: string;
  /** How long the epoch lives without a check renewing it. */
  epochTtlMs: number;
  checkMs: number;
  log: Logger;
  meter?: Pick<Meter, 'createCounter'>;
};

export const createPrimaryGuard = (
  redis: Redis,
  { epochKey, epochTtlMs, checkMs, log, meter = metrics.getMeter('cache') }: PrimaryGuardOptions,
): PrimaryGuard => {
  // `server_changed` means the Redis server under the cache changed, as on a failover: every
  // key moved, so expect a burst of misses. Failures mean reads are skipping the cache.
  const renewals = meter.createCounter('cache.epoch.renewals', {
    description: 'Cache epochs made, by reason: created, or server_changed (a failover or restart)',
  });
  const failures = meter.createCounter('cache.epoch.check_failures', {
    description: 'Cache epoch checks that failed; reads skip the cache until one passes',
  });

  let verified = false;
  // Bumped on every disconnect, so a check that began before one cannot vouch for the server after.
  let connection = 0;
  let running: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;

  const runCheck = async () => {
    const seen = connection;
    try {
      const runId = RUN_ID.exec(await redis.info('server'))?.[1];
      if (!runId) throw new Error('INFO server has no run_id');
      const outcome = await ENSURE_EPOCH(redis, [epochKey], [runId, randomUUID(), epochTtlMs]);
      if (outcome === 1 || outcome === 2) {
        const reason = RENEWAL_REASON[outcome];
        renewals.add(1, { reason });
        log.warn({ runId, reason }, 'cache epoch renewed for this Redis server');
      }
      if (seen === connection) verified = true;
    } catch (err) {
      verified = false;
      failures.add(1);
      log.error({ err }, 'cache epoch check failed; reads skip the cache until it passes');
    }
  };

  // One check at a time. A call during one (a reconnect mid-check) runs another after it, since
  // the one in flight may have begun against the previous connection.
  let again = false;
  const check = (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await runCheck();
      } while (again);
    })().finally(() => (running = undefined));
    return running;
  };

  const onClose = () => {
    connection++;
    verified = false;
  };
  const onReady = () => void check();

  return {
    usable: () => verified,
    check,
    start: () => {
      redis.on('close', onClose);
      redis.on('ready', onReady);
      if (redis.status === 'ready') void check();
      timer = setInterval(() => void check(), checkMs);
      timer.unref();
    },
    stop: () => {
      clearInterval(timer);
      redis.off('close', onClose);
      redis.off('ready', onReady);
    },
  };
};
