import { ServiceUnavailableError } from '#errors';

// Matched by name: `errors/` may not import `lib/`, where CacheLoadTimeoutError is defined.
// A loader past its entity's hardTimeoutMs means what it reads is too slow right now, so the
// client is told to retry later rather than that the server is broken.
export const cacheConverter = (err: unknown) => {
  if (!(err instanceof Error) || err.name !== 'CacheLoadTimeoutError') return null;
  return new ServiceUnavailableError('Temporarily unavailable, try again shortly');
};
