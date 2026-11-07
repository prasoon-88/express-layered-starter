import { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { JOB_ID_PATTERN } from '#constants/queue.constant';
import { createRedisKeyLock } from '#lib/cache/lock';
import type { Redis } from '#lib/redis/index';
import { sleep } from '#utils/sleep.util';
import { JobConfigError } from './errors.ts';
import { checkPayloadSize, type AnyJob, type JobInput } from './job.ts';
import { jobOptions } from './producer.ts';

type Repeat = { every: number } | { cron: string; timezone: string | undefined };

export type JobSchedule<J extends AnyJob = AnyJob> = {
  /** Names the schedule in its queue; changing it makes a new schedule and leaves the old one. */
  readonly id: string;
  readonly job: J;
  readonly payload: JobInput<J>;
  readonly repeat: Readonly<Repeat>;
};

type ScheduleSpec<J extends AnyJob> = {
  id: string;
  job: J;
  payload: JobInput<J>;
} & (
  | { every: number; cron?: never; timezone?: never }
  | { cron: string; timezone?: string; every?: never }
);

/**
 * Runs a job on a schedule: every `every` ms, or on a `cron` pattern (5 or 6 fields, BullMQ's
 * cron-parser), in `timezone` (an IANA name; UTC when not given). The payload is checked against
 * the job's schema now, so a schedule that could never run stops the boot.
 *
 * Each run is an ordinary job of its definition: same queue, attempts, backoff and timeout. A
 * schedule runs once per due time however many workers there are; it is listed in
 * `workers/index.ts` and written to Redis by the worker at startup.
 */
export const defineSchedule = <J extends AnyJob>(spec: ScheduleSpec<J>): JobSchedule<J> => {
  const { id, job, payload } = spec;
  if (!JOB_ID_PATTERN.test(id))
    throw new JobConfigError(
      `Schedule id must be letters, digits, ., _ or -, not all digits: ${JSON.stringify(id)}`,
    );
  const parsed = job.schema.safeParse(payload);
  if (!parsed.success)
    throw new JobConfigError(`Schedule "${id}": the payload does not match job "${job.name}"`, {
      cause: parsed.error,
    });

  // Jobs a schedule makes are created inside Redis, where BullMQ checks no size: checked here.
  checkPayloadSize(job, payload, `Schedule "${id}"`);

  let repeat: Repeat;
  if (spec.every !== undefined) {
    if (!Number.isSafeInteger(spec.every) || spec.every < 1)
      throw new JobConfigError(`Schedule "${id}": every must be a whole number of ms, at least 1`);
    repeat = { every: spec.every };
  } else {
    if (!spec.cron.trim()) throw new JobConfigError(`Schedule "${id}": cron must not be empty`);
    if (spec.timezone !== undefined && !isTimeZone(spec.timezone))
      throw new JobConfigError(
        `Schedule "${id}": unknown timezone ${JSON.stringify(spec.timezone)}`,
      );
    repeat = { cron: spec.cron, timezone: spec.timezone };
  }
  return Object.freeze({ id, job, payload, repeat: Object.freeze(repeat) });
};

const isTimeZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

/**
 * Orders deploy versions: dot-separated numbers compare as numbers (1.10.0 > 1.9.0), anything
 * else as text. Returns > 0 when `a` is newer.
 */
export const compareVersions = (a: string, b: string) => {
  const [left, right] = [a.split(/[.-]/), b.split(/[.-]/)];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const [x = '', y = ''] = [left[i], right[i]];
    const [nx, ny] = [Number(x), Number(y)];
    const order =
      x !== '' && y !== '' && Number.isInteger(nx) && Number.isInteger(ny)
        ? nx - ny
        : x.localeCompare(y);
    if (order !== 0) return order;
  }
  return 0;
};

// One sync at a time across every worker: the version check and the writes happen under it, so
// an older deploy cannot write between a newer one's check and its writes.
const SYNC_LOCK_MS = 30_000;
const SYNC_LOCK_RETRY_MS = 100;
// A sync that keeps outlasting its lock (a Redis that slow, or thousands of schedules) stops the
// worker after this many, rather than retrying for ever.
const MAX_SYNC_ATTEMPTS = 3;

type SyncOptions = {
  redis: Redis;
  prefix: string;
  schedules: readonly JobSchedule[];
  /** The queues this worker serves: only their schedules are written. */
  queues: readonly string[];
  /** The jobs this worker's handlers run: a schedule of any other job could only fail. */
  handled: readonly string[];
  /** This deploy's version (SERVICE_VERSION). */
  version: string;
  log: Logger;
  /** How long one sync may hold the lock. */
  lockMs?: number;
};

export type ScheduleSync =
  | { synced: true; written: string[]; unknown: { queue: string; id: string }[] }
  | { synced: false; newer: string };

/**
 * Writes the schedules of the queues this worker serves, as `upsertJobScheduler`, at startup.
 *
 * Every worker of every deploy does this, so during a rolling deploy an older worker that
 * restarts would put back the schedules the newer one replaced. The schedules record the version
 * that wrote them, and a deploy older than that writes nothing. A schedule in Redis that no
 * deploy declares any more is reported, never removed: removing it here would let an older
 * worker delete a schedule a newer one added. `pnpm jobs unschedule` removes it.
 */
export const syncJobSchedules = async ({
  redis,
  prefix,
  schedules,
  queues,
  version,
  log,
  handled,
  lockMs = SYNC_LOCK_MS,
}: SyncOptions): Promise<ScheduleSync> => {
  const ids = new Set<string>();
  for (const { id, job } of schedules) {
    if (!handled.includes(job.name))
      throw new JobConfigError(`Schedule "${id}": no handler runs job "${job.name}"`);
    const key = `${job.queue.name}/${id}`;
    if (ids.has(key))
      throw new JobConfigError(`Two schedules "${id}" on queue "${job.queue.name}"`);
    ids.add(key);
  }

  const versionKey = `${prefix}:schedules-version`;
  const lock = createRedisKeyLock(redis, { prefix: `${prefix}:` });
  for (let attempt = 1; ; attempt++) {
    let token: string | undefined;
    while (!(token = await lock.acquire('schedules', lockMs))) await sleep(SYNC_LOCK_RETRY_MS);

    let outcome: ScheduleSync;
    try {
      const stored = await redis.get(versionKey);
      if (stored && compareVersions(stored, version) > 0)
        outcome = { synced: false, newer: stored };
      else {
        await redis.set(versionKey, version);
        outcome = { synced: true, ...(await writeSchedules(redis, prefix, schedules, queues)) };
      }
    } catch (err) {
      await lock.release('schedules', token);
      throw err;
    }

    // Released: it was ours all along, so nothing else wrote meanwhile. Lapsed (a pause longer
    // than the lock): run again, since writing the same schedules twice changes nothing.
    if (await lock.release('schedules', token)) {
      if (!outcome.synced)
        log.info(
          { version, newer: outcome.newer },
          'job schedules belong to a newer deploy; left as they are',
        );
      else {
        if (outcome.unknown.length > 0)
          log.warn(
            { unknown: outcome.unknown },
            'job schedules in Redis that no code declares; remove them with `pnpm jobs unschedule <queue> <id>`',
          );
        log.info({ written: outcome.written, version }, 'job schedules written');
      }
      return outcome;
    }
    if (attempt === MAX_SYNC_ATTEMPTS)
      throw new Error(
        `The job schedules took longer than their ${lockMs} ms lock ${MAX_SYNC_ATTEMPTS} times; another deploy may have written between`,
      );
    log.warn('the job schedule lock lapsed during the sync; syncing again');
  }
};

const writeSchedules = async (
  redis: Redis,
  prefix: string,
  schedules: readonly JobSchedule[],
  queues: readonly string[],
) => {
  const written: string[] = [];
  const unknown: { queue: string; id: string }[] = [];
  for (const name of queues) {
    const queue = new Queue(name, { connection: redis, prefix, skipVersionCheck: true });
    try {
      const own = schedules.filter((schedule) => schedule.job.queue.name === name);
      for (const { id, job, payload, repeat } of own) {
        try {
          await queue.upsertJobScheduler(
            id,
            'every' in repeat
              ? { every: repeat.every }
              : { pattern: repeat.cron, tz: repeat.timezone },
            { name: job.name, data: payload, opts: jobOptions(job) },
          );
        } catch (cause) {
          throw new JobConfigError(`Schedule "${id}" could not be written: ${String(cause)}`, {
            cause,
          });
        }
        written.push(id);
      }
      const declared = new Set(own.map(({ id }) => id));
      for (const existing of await queue.getJobSchedulers(0, -1)) {
        const id = existing.id ?? existing.key;
        if (!declared.has(id)) unknown.push({ queue: name, id });
      }
    } finally {
      await queue.close();
    }
  }
  return { written, unknown };
};
