export const RATE_LIMIT_STORES = ['memory', 'redis'] as const;
export type RateLimitStore = (typeof RATE_LIMIT_STORES)[number];

export const STORE_ERROR_MODES = ['local', 'allow', 'deny'] as const;
export type StoreErrorMode = (typeof STORE_ERROR_MODES)[number];

export const DEFAULT_RATE_LIMIT_STORE: RateLimitStore = 'memory';
export const DEFAULT_STORE_ERROR_MODE: StoreErrorMode = 'local';
export const DEFAULT_RATE_LIMIT_WINDOW_S: number = 60;
export const DEFAULT_RATE_LIMIT_MAX: number = 100;
export const DEFAULT_RATE_LIMIT_AUTH_WINDOW_S: number = 900;
export const DEFAULT_RATE_LIMIT_AUTH_MAX: number = 10;
export const DEFAULT_RATE_LIMIT_AUTH_BLOCK_S: number = 900;
export const DEFAULT_RATE_LIMIT_POLICY_REFRESH_S: number = 30;
export const DEFAULT_RATE_LIMIT_IPV6_SUBNET: number = 56;
export const DEFAULT_RATE_LIMIT_SKIP_PATHS: string[] = [
  '/health',
  '/health/live',
  '/health/ready',
] as const;
