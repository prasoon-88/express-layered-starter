import type { RateLimitStoreErrorMode } from '#constants/rateLimit.constant';
import type { ReadinessCheck } from '#lib/health/index';
import type { Redis } from '#lib/redis/index';

type StoreReadinessConfig = {
  redis: Pick<Redis, 'ping'>;
  onStoreError: RateLimitStoreErrorMode;
};

// A real round trip, not a flag: with `disableOfflineQueue` a client that lost its connection
// rejects the ping at once, and one that is connected but unresponsive is caught by the timeout.
export const createStoreReadinessCheck = ({
  redis,
  onStoreError,
}: StoreReadinessConfig): ReadinessCheck => ({
  name: 'rate-limit-store',
  // `local` and `allow` keep serving through a Redis outage, so taking the instance out of rotation
  // would turn a degraded limiter into a full outage. Only `deny` cannot serve without the store.
  critical: onStoreError === 'deny',
  run: () => redis.ping(),
});
