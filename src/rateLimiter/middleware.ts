import { concatenateStrings } from '#utils/concateStrings';
import type { RequestHandler, Request } from 'express';
import type { RateLimitEngine } from './engine.ts';
import { UnknownPolicyError } from './errors.ts';
import { rateLimitHeaders } from './headers.ts';
import { keys, type KeyFn } from './keys.ts';
import type { PolicyName } from './policies.ts';
import type { Policy } from './types.ts';
import HTTP_HEADERS from '#constants/http/httpHeaders.constant';
import { ServiceUnavailableError, TooManyRequestsError } from '#errors';

type PolicyRef = PolicyName | Policy;

type LimitOptions = {
  policy: PolicyRef | ((req: Request) => Policy);
  key?: KeyFn;
  cost?: number | ((req: Request) => number);
  refundOnSuccess?: boolean;
};

type LimitConfig = {
  enabled: boolean;
  engine: RateLimitEngine;
  skipPaths: readonly string[];
  ipv6Subnet: number;
};

const isOptions = (x: PolicyRef | LimitOptions) => typeof x === 'object' && 'policy' in x;

export const createLimit = ({ enabled, engine, skipPaths, ipv6Subnet }: LimitConfig) => {
  const skip = new Set(skipPaths);
  const ctx = { ipv6Subnet };

  const resolve = (ref: PolicyRef) => {
    if (typeof ref === 'string')
      return {
        name: ref,
        policy: engine.policies.get(ref),
      };
    return {
      name: concatenateStrings(['adhoc', ref.points, ref.durationS, ref.blockDurationS], ':'),
      policy: ref,
    };
  };

  return (input: PolicyRef | LimitOptions): RequestHandler => {
    const opts: LimitOptions = isOptions(input) ? input : { policy: input };

    if (typeof opts.policy === 'string' && !engine.policies.get(opts.policy))
      throw new UnknownPolicyError(opts.policy);

    if (!enabled) return (_req, _res, _next) => _next();

    const keyFn = opts?.key ?? keys.ip;

    return async (req, res, next) => {
      if (req.method === 'OPTIONS' || skip.has(req.path)) return next();

      const { name, policy } = resolve(
        typeof opts.policy === 'function' ? opts.policy(req) : opts.policy,
      );

      const key = keyFn(req, ctx) ?? keys.ip(req, ctx);
      const cost = typeof opts?.cost === 'function' ? opts.cost(req) : (opts?.cost ?? 1);

      const d = await engine.consume(name, policy, key, cost);

      // No limit was checked, so there is no state to report and nothing to refund.
      if (d.storeError) {
        if (!d.allowed)
          throw new ServiceUnavailableError('Rate limiting is temporarily unavailable');
        return next();
      }

      res.set(rateLimitHeaders(d));

      if (!d.allowed) {
        res.set(HTTP_HEADERS.RETRY_AFTER, Math.max(1, Math.ceil(d.resetMs / 1000)).toString());
        throw new TooManyRequestsError();
      }

      if (opts.refundOnSuccess) {
        res.on('finish', () => {
          if (res.statusCode < 400) {
            void d.refund();
          }
        });
      }

      next();
    };
  };
};

export type Limit = ReturnType<typeof createLimit>;
