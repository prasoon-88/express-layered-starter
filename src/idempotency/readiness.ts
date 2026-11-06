import type { IdempotencyStoreErrorMode } from '#constants/idempotency.constants';
import type { ReadinessCheck } from '#lib/health/index';

type StoreReadinessConfig = {
  ping: () => Promise<unknown>;
  onStoreError: IdempotencyStoreErrorMode;
};

export const createStoreReadinessCheck = ({
  ping,
  onStoreError,
}: StoreReadinessConfig): ReadinessCheck => ({
  name: 'idempotency-store',
  // `allow` keeps serving through a store outage. Only `deny` cannot.
  critical: onStoreError === 'deny',
  run: () => ping(),
});
