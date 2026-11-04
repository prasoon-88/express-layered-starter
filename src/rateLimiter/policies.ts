import type { Env } from '#constants/env/schema';
import { UnknownPolicyError } from './errors.ts';
import type { Policy } from './types.ts';

export const POLICY_NAMES = ['global', 'auth'] as const;
export type PolicyName = (typeof POLICY_NAMES)[number];

type PolicyMap<N extends string = PolicyName> = Record<N, Policy>;

export const buildDefaultPolicies = (
  e: Pick<
    Env,
    | 'RATE_LIMIT_MAX'
    | 'RATE_LIMIT_WINDOW_S'
    | 'RATE_LIMIT_AUTH_MAX'
    | 'RATE_LIMIT_AUTH_WINDOW_S'
    | 'RATE_LIMIT_AUTH_BLOCK_S'
  >,
): PolicyMap => ({
  global: { points: e.RATE_LIMIT_MAX, durationS: e.RATE_LIMIT_WINDOW_S },
  auth: {
    points: e.RATE_LIMIT_AUTH_MAX,
    durationS: e.RATE_LIMIT_AUTH_WINDOW_S,
    blockDurationS: e.RATE_LIMIT_AUTH_BLOCK_S,
  },
});

type Override = PolicyMap<string>;

export const createPolicyRegistry = (defaults: PolicyMap) => {
  let overrides: Override = {};
  return {
    has: (name: PolicyName) => name in defaults,
    get: (name: PolicyName) => {
      const p = overrides[name] ?? defaults[name];
      if (!p) throw new UnknownPolicyError(name);
      return p;
    },
    setOverrides: (next: Override) => {
      overrides = next;
    },
  };
};

export type PolicyRegistry = ReturnType<typeof createPolicyRegistry>;
