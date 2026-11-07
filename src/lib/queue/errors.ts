// The error converter matches the last two by name: `errors/` may not import `lib/`.

/** A job definition, handler or option that can never work: a programming error. */
export class JobConfigError extends Error {
  override name = 'JobConfigError';
}

/**
 * Thrown by a handler for a failure that another attempt cannot fix (a payload that names a
 * record that is gone, an address a provider refuses). The job fails at once, without retries.
 */
export class PermanentJobError extends Error {
  override name = 'PermanentJobError';
}

/** A run outlasted its job's `timeoutMs`. It is retried like any other failure. */
export class JobTimeoutError extends Error {
  override name = 'JobTimeoutError';
}

/** No queue is configured: neither QUEUE_REDIS_URL nor REDIS_URL is set. Answered with a 503. */
export class JobsUnavailableError extends Error {
  override name = 'JobsUnavailableError';
}

/**
 * The queue did not confirm the job (Redis down or slow). Answered with a 503. After a timeout
 * the add may still land, so a caller that retries should give a `jobId`: the retry is then
 * ignored if the first one did land.
 */
export class JobEnqueueError extends Error {
  override name = 'JobEnqueueError';
}
