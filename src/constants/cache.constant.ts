import { SECONDS_PER_DAY } from '#constants/time.constant';

export const CACHE_STORES = ['memory', 'redis'] as const;
export type CacheStoreName = (typeof CACHE_STORES)[number];

export const DEFAULT_CACHE_STORE: CacheStoreName = 'memory';
export const DEFAULT_CACHE_MEMORY_MAX_ENTRIES = 10_000;
export const MIN_CACHE_MEMORY_MAX_ENTRIES = 1;
export const DEFAULT_CACHE_OP_TIMEOUT_MS = 100;
export const DEFAULT_CACHE_MAX_TTL_S = SECONDS_PER_DAY;

export const DEFAULT_CACHE_OUTBOX_POLL_MS = 1_000;
export const DEFAULT_CACHE_PRIMARY_CHECK_MS = 5_000;
export const MIN_CACHE_INTERVAL_MS = 10;

/** Invalidations the outbox relay delivers in one round trip. */
export const CACHE_OUTBOX_BATCH_SIZE = 100;
/** How long a relay holds the entries it claimed; past it another relay may deliver them too. */
export const CACHE_OUTBOX_LEASE_MS = 5_000;
/** A tag's version token outlives the longest entry this many times over. */
export const CACHE_TOKEN_TTL_FACTOR = 2;

/** The longest an entry, stale period included, may live. */
export const CACHE_MAX_TTL_LIMIT_S = 30 * SECONDS_PER_DAY;
