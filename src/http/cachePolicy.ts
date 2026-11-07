import { CACHE_CONTROL, HTTP_HEADERS } from '#constants/http/httpHeaders.constant';
import { concatenateStrings } from '#utils/concatenateStrings.util';
import type { Access } from './registry.ts';

export type CachePolicy =
  | { mode: 'no-store' }
  | { mode: 'revalidate'; shared?: boolean }
  | { mode: 'fresh'; maxAgeS: number; staleWhileRevalidateS?: number; shared?: boolean };

/** `private, no-cache`: only the browser keeps it, and it revalidates every time. Safe on any GET. */
export const DEFAULT_GET_CACHE_POLICY: CachePolicy = Object.freeze({
  mode: 'revalidate',
  shared: false,
});

const CACHE_POLICY_MODES = [
  'no-store',
  'revalidate',
  'fresh',
] as const satisfies readonly CachePolicy['mode'][];
const MAX_AGE_LIMIT_S = 31_536_000;

const isWhole = (value: unknown, min: number) =>
  Number.isInteger(value) && (value as number) >= min;

/** Undefined when valid, else the reason. `method` is uppercase. */
export const cachePolicyProblem = (
  method: string,
  access: Access,
  policy: CachePolicy | undefined,
): string | undefined => {
  if (policy === undefined) return undefined;
  const mode: unknown = (policy as { mode?: unknown } | null)?.mode;
  if (!CACHE_POLICY_MODES.includes(mode as CachePolicy['mode']))
    return `unknown cache mode "${String(mode)}": expected one of ${concatenateStrings(CACHE_POLICY_MODES, ', ')}`;
  if (method !== 'GET' && policy.mode !== 'no-store')
    return `a ${method} route can declare only no-store, for responses such as tokens`;
  const shared: unknown = 'shared' in policy ? policy.shared : undefined;
  if (shared !== undefined && typeof shared !== 'boolean')
    return `shared must be a boolean, got ${JSON.stringify(shared)}`;
  if (shared === true && access.strategy !== 'public')
    return 'a route that needs credentials cannot be stored by shared caches (shared: true)';
  if (policy.mode !== 'fresh') return undefined;
  if (!isWhole(policy.maxAgeS, 1) || policy.maxAgeS > MAX_AGE_LIMIT_S)
    return `maxAgeS must be a whole number from 1 to ${MAX_AGE_LIMIT_S}`;
  if (policy.staleWhileRevalidateS !== undefined && !isWhole(policy.staleWhileRevalidateS, 0))
    return 'staleWhileRevalidateS must be a whole number of 0 or more';
  return undefined;
};

const seconds = (directive: string, value: number | undefined) =>
  value === undefined ? undefined : concatenateStrings([directive, value], '=');

const directives = (policy: CachePolicy, scope: string) => {
  switch (policy.mode) {
    case 'no-store':
      return [CACHE_CONTROL.NO_STORE];
    case 'revalidate':
      return [scope, CACHE_CONTROL.NO_CACHE];
    case 'fresh':
      return [
        scope,
        seconds(CACHE_CONTROL.MAX_AGE, policy.maxAgeS),
        seconds(CACHE_CONTROL.STALE_WHILE_REVALIDATE, policy.staleWhileRevalidateS),
      ];
  }
};

/** The `Cache-Control` value, plus `Vary: Authorization` when the route needs credentials. */
export const cacheHeaders = (
  access: Access,
  policy: CachePolicy,
): Readonly<Record<string, string>> => {
  const needsCredentials = access.strategy !== 'public';
  const declared = 'shared' in policy ? policy.shared : undefined;
  // Strictly `true`, so a value the boot check would refuse can never make a route public.
  const shared = declared === true || (declared === undefined && !needsCredentials);
  return Object.freeze({
    [HTTP_HEADERS.CACHE_CONTROL]: concatenateStrings(
      directives(policy, shared ? CACHE_CONTROL.PUBLIC : CACHE_CONTROL.PRIVATE),
      ', ',
    ),
    ...(needsCredentials && { [HTTP_HEADERS.VARY]: HTTP_HEADERS.AUTHORIZATION }),
  });
};
