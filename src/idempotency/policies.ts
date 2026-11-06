import type { Env } from '#constants/env/schema';
import { IDEMPOTENCY_METHODS } from '#constants/idempotency.constant';
import { UnknownPolicyError } from './errors.ts';
import type { Policy } from './types.ts';
import { SECONDS_PER_DAY } from '#constants/time.constant';

export const POLICY_NAMES = ['default', 'payments'] as const;
export type PolicyName = (typeof POLICY_NAMES)[number];

type PolicyMap<N extends string = PolicyName> = Record<N, Policy>;

export const buildDefaultPolicies = (
  e: Pick<Env, 'IDEMPOTENCY_TTL_S' | 'IDEMPOTENCY_LOCK_TTL_S'>,
): PolicyMap => ({
  default: {
    ttlS: e.IDEMPOTENCY_TTL_S,
    lockTtlS: e.IDEMPOTENCY_LOCK_TTL_S,
    required: false,
    methods: IDEMPOTENCY_METHODS,
  },
  payments: {
    ttlS: 7 * SECONDS_PER_DAY,
    lockTtlS: e.IDEMPOTENCY_LOCK_TTL_S,
    required: true,
    methods: ['POST'],
  },
});

type Override = PolicyMap<string>;

export const createPolicyRegistry = (defaults: PolicyMap) => {
  let overrides: Override = {};
  return {
    has: (name: PolicyName) => name in defaults,
    get: (name: PolicyName) => {
      const policy = overrides[name] ?? defaults[name];
      if (!policy) throw new UnknownPolicyError(name);
      return policy;
    },
    setOverrides: (next: Override) => {
      overrides = next;
    },
  };
};

export type PolicyRegistry = ReturnType<typeof createPolicyRegistry>;
