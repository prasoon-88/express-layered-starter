/**
 * A programming error: a spec, key, tag or option that can never work. It is not an AppError, so a
 * request that hits one answers 500, and a spec that hits one stops the boot where it is defined.
 */
export class CacheConfigError extends Error {
  override name = 'CacheConfigError';
}

/**
 * A loader ran past its entity's `hardTimeoutMs`: what it reads is too slow right now. The error
 * converter answers it with a 503, matching on this name, since `errors/` may not import `lib/`.
 */
export class CacheLoadTimeoutError extends Error {
  override name = 'CacheLoadTimeoutError';
}
