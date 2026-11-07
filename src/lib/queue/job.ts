import * as z from 'zod';
import {
  DEFAULT_JOB_ATTEMPTS,
  DEFAULT_JOB_BACKOFF_MS,
  DEFAULT_JOB_TIMEOUT_MS,
  DEFAULT_MAX_JOB_PAYLOAD_BYTES,
  JOB_NAME_PATTERN,
  MAX_JOB_BACKOFF_MS,
} from '#constants/queue.constant';
import { JobConfigError } from './errors.ts';
import type { QueueDefinition } from './queue.ts';

/** Settings for every run of a job. */
export type JobPolicy = {
  /** Runs at most this many times, the first included. */
  attempts: number;
  /** The first retry waits about this long, each next one about twice as long, up to `maxBackoffMs`. */
  backoffMs: number;
  maxBackoffMs: number;
  /**
   * A run longer than this fails, and is retried. The handler gets an `AbortSignal` that fires
   * then: work that ignores it keeps running in the background, so pass it on.
   */
  timeoutMs: number;
  /**
   * The largest payload, in bytes of its JSON (UTF-8), as BullMQ measures it. Larger is refused
   * when enqueued, and when a schedule is defined.
   */
  maxPayloadBytes: number;
};

export type JobDefinition<Name extends string = string, Schema extends z.ZodType = z.ZodType> = {
  /** `<area>.<action>`, e.g. `email.send`. Unique across every queue. */
  readonly name: Name;
  /** The queue it runs on (`defineQueue`): its workers, concurrency and rate limit. */
  readonly queue: QueueDefinition;
  /** What the payload must match: when it is enqueued, and again before it runs. */
  readonly schema: Schema;
  readonly policy: Readonly<JobPolicy>;
};

export type AnyJob = JobDefinition<string, z.ZodType>;

/** What a job is enqueued with, before the schema's defaults and transforms. */
export type JobInput<J extends AnyJob> = z.input<J['schema']>;
/** What its handler receives. */
export type JobPayload<J extends AnyJob> = z.output<J['schema']>;

type JobSpec<Name extends string, Schema extends z.ZodType> = {
  name: Name;
  queue: QueueDefinition;
  schema: Schema;
} & Partial<JobPolicy>;

const checkWhole = (job: string, field: string, value: number, min: number) => {
  if (!Number.isSafeInteger(value) || value < min)
    throw new JobConfigError(
      `Job "${job}": ${field} must be a whole number of at least ${min}, got ${value}`,
    );
};

/**
 * Describes one kind of background work: its name, its queue, its payload and how it is retried.
 * Pure: it touches no queue, so any service can import it and enqueue it. A handler for it is
 * registered in `workers/`, and runs in the worker process (`pnpm start:worker`).
 */
export const defineJob = <const Name extends string, Schema extends z.ZodType>({
  name,
  queue,
  schema,
  attempts = DEFAULT_JOB_ATTEMPTS,
  backoffMs = DEFAULT_JOB_BACKOFF_MS,
  maxBackoffMs = MAX_JOB_BACKOFF_MS,
  timeoutMs = DEFAULT_JOB_TIMEOUT_MS,
  maxPayloadBytes = DEFAULT_MAX_JOB_PAYLOAD_BYTES,
}: JobSpec<Name, Schema>): JobDefinition<Name, Schema> => {
  if (!JOB_NAME_PATTERN.test(name))
    throw new JobConfigError(`Job name must look like "area.action": ${JSON.stringify(name)}`);
  checkWhole(name, 'attempts', attempts, 1);
  checkWhole(name, 'backoffMs', backoffMs, 1);
  checkWhole(name, 'maxBackoffMs', maxBackoffMs, backoffMs);
  checkWhole(name, 'timeoutMs', timeoutMs, 1);
  checkWhole(name, 'maxPayloadBytes', maxPayloadBytes, 1);
  // A payload is stored as JSON and parsed again before it runs, so its schema must describe
  // plain JSON input: a Date would come back as a string and fail the second parse.
  try {
    z.toJSONSchema(schema, { io: 'input' });
  } catch (cause) {
    throw new JobConfigError(
      `Job "${name}": the payload schema must describe plain JSON (no dates, bigints or functions)`,
      { cause },
    );
  }

  return Object.freeze({
    name,
    queue,
    schema,
    policy: Object.freeze({ attempts, backoffMs, maxBackoffMs, timeoutMs, maxPayloadBytes }),
  });
};

/**
 * The wait before retry `attempt` (1 for the first retry): exponential, capped, and spread at
 * random over its whole range ("full jitter"), so jobs that failed together do not retry together.
 */
export const retryDelay = (
  { backoffMs, maxBackoffMs }: Pick<JobPolicy, 'backoffMs' | 'maxBackoffMs'>,
  attempt: number,
  random: () => number = Math.random,
) => {
  const ceiling = Math.min(maxBackoffMs, backoffMs * 2 ** Math.max(attempt - 1, 0));
  return Math.floor(random() * ceiling);
};

/**
 * Refuses a payload larger than the job allows, measured as BullMQ measures it: the bytes of its
 * JSON. `what` names the caller in the message (an enqueue, a schedule).
 */
export const checkPayloadSize = (job: AnyJob, payload: unknown, what: string) => {
  const bytes = Buffer.byteLength(JSON.stringify(payload) ?? '', 'utf8');
  if (bytes > job.policy.maxPayloadBytes)
    throw new JobConfigError(
      `${what}: the payload of job "${job.name}" is ${bytes} bytes, more than its maxPayloadBytes (${job.policy.maxPayloadBytes}). Put the id of what to work on, not the record`,
    );
};
