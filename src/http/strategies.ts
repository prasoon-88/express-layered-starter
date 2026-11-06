import type { RequestHandler } from 'express';
import { USER_ROLES } from '#constants/user.constant';
import type { AccessOf, Get, StrategyName } from './registry.ts';

export type AccessStrategy<S extends StrategyName> = {
  /** What is wrong with a route's options, or undefined. Checked once, when the app is built. */
  problem?: (access: AccessOf<S>) => string | undefined;
  /** The middleware that enforces the strategy. They run after `pre` and before `handlers`. */
  handlers: (access: AccessOf<S>, get: Get) => readonly RequestHandler[];
};

export type Strategies = { readonly [S in StrategyName]: AccessStrategy<S> };

const knownRoles = new Set<string>(USER_ROLES);

export const builtInStrategies = {
  public: {
    problem: ({ reason }) =>
      typeof reason === 'string' && reason.trim() ? undefined : 'a public route needs a reason',
    handlers: () => [],
  },
  authenticated: {
    handlers: (_access, get) => [get('authenticate')],
  },
  roles: {
    problem: ({ roles }) => {
      if (!Array.isArray(roles) || roles.length === 0)
        return 'a roles route needs at least one role';
      const unknown = roles.find((role) => !knownRoles.has(role));
      return unknown === undefined ? undefined : `unknown role "${unknown}"`;
    },
    handlers: ({ roles }, get) => [get('authenticate'), get('authorize')(roles)],
  },
} satisfies { [S in 'public' | 'authenticated' | 'roles']: AccessStrategy<S> };
