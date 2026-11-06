import type { RequestHandler } from 'express';
import type { UserRole } from '#constants/user.constant';
import type { RouteManifestEntry } from './mount.ts';

export type RouteTable = {
  /** Every mounted route, in match order. Throws if read before mounting finished. */
  all: () => readonly RouteManifestEntry[];
};

/**
 * Everything the container can provide, by key. Whoever registers a key declares its type next to
 * the registration, by augmenting this interface:
 *
 *   declare module '#http/registry' {
 *     interface Registry { userService: UserService }
 *   }
 *
 * So no file has to list every dependency in the app.
 */
// eslint-disable-next-line no-restricted-syntax -- augmented by declaration merging, which needs an interface
export interface Registry {
  /** Verifies the caller and sets `req.user`. The `authenticated` and `roles` strategies need it. */
  authenticate: RequestHandler;
  /** Rejects a caller whose role is not listed. Runs after `authenticate`. */
  authorize: (roles: readonly UserRole[]) => RequestHandler;
  /** Provided by `mount` itself, for features that describe the API, such as OpenAPI. */
  routeTable: RouteTable;
}

type NoOptions = Record<never, never>;

/**
 * Every way a route can be accessed, by strategy name, with the options a route must give.
 * Add a strategy by augmenting this interface and passing its implementation to `mount`.
 */
// eslint-disable-next-line no-restricted-syntax -- augmented by declaration merging, which needs an interface
export interface AccessStrategies {
  /** Anyone, no credentials. The reason is required so that every public route is a decision. */
  public: { reason: string };
  /** Any signed-in caller. */
  authenticated: NoOptions;
  /** A signed-in caller with one of these roles. */
  roles: { roles: readonly [UserRole, ...UserRole[]] };
}

export type Key = keyof Registry;
export type Get = <K extends Key>(key: K) => Registry[K];
export type Factory<K extends Key> = (get: Get) => Registry[K];
export type Providers = { readonly [K in Key]?: Factory<K> };

export type StrategyName = keyof AccessStrategies;
export type AccessOf<S extends StrategyName> = { strategy: S } & AccessStrategies[S];
export type Access = { [S in StrategyName]: AccessOf<S> }[StrategyName];
