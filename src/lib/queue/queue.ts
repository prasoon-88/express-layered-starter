import { MAX_WORKER_CONCURRENCY, QUEUE_NAME_PATTERN } from '#constants/queue.constant';
import { JobConfigError } from './errors.ts';

/** At most `max` jobs start per `perMs`, across every worker of the queue together. */
export type QueueRateLimit = { max: number; perMs: number };

export type QueueDefinition = {
  /** Part of every key of the queue: lowercase letters, digits and `-`. */
  readonly name: string;
  /** Jobs it runs at once in each worker process; WORKER_CONCURRENCY when not set. */
  readonly concurrency: number | undefined;
  /**
   * Shared by every worker process, since BullMQ keeps it in one Redis key per queue: ten
   * workers with `{ max: 14, perMs: 1_000 }` still start 14 jobs a second, which is what a
   * provider's own limit (SES, an SMS gateway) needs.
   */
  readonly rateLimit: Readonly<QueueRateLimit> | undefined;
};

type QueueSpec = { name: string; concurrency?: number; rateLimit?: QueueRateLimit };

const checkWhole = (queue: string, field: string, value: number, min: number, max?: number) => {
  if (!Number.isSafeInteger(value) || value < min || (max !== undefined && value > max))
    throw new JobConfigError(
      `Queue "${queue}": ${field} must be a whole number from ${min}${max === undefined ? '' : ` to ${max}`}, got ${value}`,
    );
};

/**
 * A queue: where jobs wait, and how fast its workers take them. A unit of deployment, too:
 * WORKER_QUEUES can run a queue in processes of its own. Jobs name the queue they run on.
 */
export const defineQueue = ({ name, concurrency, rateLimit }: QueueSpec): QueueDefinition => {
  if (!QUEUE_NAME_PATTERN.test(name))
    throw new JobConfigError(
      `Queue name must be lowercase letters, digits and -, starting with a letter: ${JSON.stringify(name)}`,
    );
  if (concurrency !== undefined)
    checkWhole(name, 'concurrency', concurrency, 1, MAX_WORKER_CONCURRENCY);
  if (rateLimit) {
    checkWhole(name, 'rateLimit.max', rateLimit.max, 1);
    checkWhole(name, 'rateLimit.perMs', rateLimit.perMs, 1);
  }
  return Object.freeze({
    name,
    concurrency,
    rateLimit: rateLimit && Object.freeze({ ...rateLimit }),
  });
};
