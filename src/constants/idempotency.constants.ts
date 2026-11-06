import HTTP_STATUS from '#constants/http/httpStatus.constant';
import HTTP_HEADERS from '#constants/http/httpHeaders.constant';

export const IDEMPOTENCY_STORES = ['memory', 'redis'] as const;
export type IdempotencyStoreName = (typeof IDEMPOTENCY_STORES)[number];

export const IDEMPOTENCY_STORE_ERROR_MODES = ['allow', 'deny'] as const;
export type IdempotencyStoreErrorMode = (typeof IDEMPOTENCY_STORE_ERROR_MODES)[number];

export const DEFAULT_IDEMPOTENCY_STORE: IdempotencyStoreName = 'memory';
export const DEFAULT_IDEMPOTENCY_STORE_ERROR_MODE: IdempotencyStoreErrorMode = 'deny';
export const DEFAULT_IDEMPOTENCY_TTL_S = 86_400;
export const DEFAULT_IDEMPOTENCY_LOCK_TTL_S = 60;
export const DEFAULT_IDEMPOTENCY_MAX_BODY_BYTES = 256 * 1024;

// A retry of a rejected request should run again. 5xx is handled separately.
export const IDEMPOTENCY_NON_CACHEABLE_STATUSES = [
  HTTP_STATUS.REQUEST_TIMEOUT,
  HTTP_STATUS.CONFLICT,
  HTTP_STATUS.TOO_EARLY,
  HTTP_STATUS.TOO_MANY_REQUESTS,
] as const;

export const IDEMPOTENCY_REPLAY_HEADERS = [
  HTTP_HEADERS.CONTENT_TYPE,
  HTTP_HEADERS.LOCATION,
  HTTP_HEADERS.ETAG,
  HTTP_HEADERS.CACHE_CONTROL,
] as const;

export const IDEMPOTENCY_METHODS = ['POST', 'PATCH'] as const;
