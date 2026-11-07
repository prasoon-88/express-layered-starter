import { SECONDS_PER_DAY } from '#constants/time.constant';

/** A queue name: BullMQ keys contain it, so no `:`. */
export const QUEUE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
/** A job name: `<area>.<action>`, e.g. `email.send`. Unique across every queue. */
export const JOB_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

export const DEFAULT_JOB_ATTEMPTS = 5;
/** First retry waits about this long; each next one about twice as long. */
export const DEFAULT_JOB_BACKOFF_MS = 1_000;
/** No retry waits longer than this, however many attempts came before. */
export const MAX_JOB_BACKOFF_MS = 60 * 60 * 1_000;
export const DEFAULT_JOB_TIMEOUT_MS = 60_000;
/**
 * A payload names what to work on; the handler reads the rest. Payloads live in a Redis that never
 * evicts, so a large one costs memory no TTL gives back, until the job is removed.
 */
export const DEFAULT_MAX_JOB_PAYLOAD_BYTES = 64 * 1024;

/**
 * A completed job is kept this long, so enqueueing the same `jobId` again within it is ignored,
 * not run twice. A failed job is kept longer, to be looked at and retried.
 */
export const KEEP_COMPLETED_JOBS_S = SECONDS_PER_DAY;
export const KEEP_FAILED_JOBS_S = 7 * SECONDS_PER_DAY;

export const DEFAULT_WORKER_CONCURRENCY = 5;
export const MAX_WORKER_CONCURRENCY = 1_000;
export const DEFAULT_WORKER_SHUTDOWN_TIMEOUT_MS = 6_000;
export const DEFAULT_WORKER_HEALTH_PORT = 8001;

/** The longest an enqueue waits for the queue's Redis before it rejects. */
export const JOB_ENQUEUE_TIMEOUT_MS = 2_000;

/**
 * A custom job id: what BullMQ accepts (no `:`, which its keys use, and not all digits, which its
 * own ids are), kept to characters safe in logs and URLs.
 */
export const JOB_ID_PATTERN = /^(?!\d+$)[A-Za-z0-9._-]{1,128}$/;
