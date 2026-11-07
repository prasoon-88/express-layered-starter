import { ServiceUnavailableError } from '#errors';

// Matched by name: `errors/` may not import `lib/`, where these are defined (lib/queue/errors.ts).
// No queue configured, or a queue that did not take the job: the work the request needed could
// not be handed on, so the client is told to retry later.
const UNAVAILABLE = new Set(['JobsUnavailableError', 'JobEnqueueError']);

export const queueConverter = (err: unknown) => {
  if (!(err instanceof Error) || !UNAVAILABLE.has(err.name)) return null;
  return new ServiceUnavailableError('Temporarily unavailable, try again shortly');
};
