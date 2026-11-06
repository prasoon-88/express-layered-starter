export const RATE_LIMIT_STORES = ['memory', 'redis'] as const;
export type RateLimitStoreName = (typeof RATE_LIMIT_STORES)[number];

export const RATE_LIMIT_STORE_ERROR_MODES = ['local', 'allow', 'deny'] as const;
export type RateLimitStoreErrorMode = (typeof RATE_LIMIT_STORE_ERROR_MODES)[number];

export const DEFAULT_RATE_LIMIT_STORE: RateLimitStoreName = 'memory';
export const DEFAULT_RATE_LIMIT_STORE_ERROR_MODE: RateLimitStoreErrorMode = 'local';
export const DEFAULT_RATE_LIMIT_WINDOW_S = 60;
export const DEFAULT_RATE_LIMIT_MAX = 100;
export const DEFAULT_RATE_LIMIT_AUTH_WINDOW_S = 900;
export const DEFAULT_RATE_LIMIT_AUTH_MAX = 10;
export const DEFAULT_RATE_LIMIT_AUTH_BLOCK_S = 900;
export const DEFAULT_RATE_LIMIT_POLICY_REFRESH_S = 30;
export const DEFAULT_RATE_LIMIT_IPV6_SUBNET = 56;
// Health probes never reach the limiter (app.ts mounts them first), so nothing is skipped by default.
export const DEFAULT_RATE_LIMIT_SKIP_PATHS: readonly string[] = [];
