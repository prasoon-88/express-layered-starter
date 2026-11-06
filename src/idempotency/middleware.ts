import { randomUUID } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import type { Logger } from 'pino';
import {
  BadRequestError,
  ConflictError,
  ServiceUnavailableError,
  UnprocessableEntityError,
} from '#errors';
import { ERROR_CODES } from '#constants/error/errorCodes.constant';
import { HTTP_HEADERS } from '#constants/http/httpHeaders.constant';
import { HTTP_STATUS } from '#constants/http/httpStatus.constant';
import {
  IDEMPOTENCY_NON_CACHEABLE_STATUSES,
  type IdempotencyStoreErrorMode,
} from '#constants/idempotency.constant';
import { REGEX } from '#constants/regex.constant';
import { concatenateStrings } from '#utils/concatenateStrings.util';
import { captureResponse } from './capture.ts';
import { fingerprint } from './fingerprint.ts';
import type { PolicyName, PolicyRegistry } from './policies.ts';
import { scopes, type ScopeFn } from './scope.ts';
import type {
  AcquireResult,
  IdempotencyRecord,
  IdempotencyStore,
  StoredResponse,
} from './types.ts';
import { MS_PER_SECOND } from '#constants/time.constant';

const REPLAYED = 'true';
const NON_CACHEABLE = new Set<number>(IDEMPOTENCY_NON_CACHEABLE_STATUSES);

type IdempotentOptions = { policy: PolicyName; scope?: ScopeFn };

type IdempotentConfig = {
  enabled: boolean;
  store: IdempotencyStore;
  policies: PolicyRegistry;
  prefix: string;
  maxBodyBytes: number;
  onStoreError: IdempotencyStoreErrorMode;
  log: Logger;
};

const isCacheable = (status: number) =>
  status < HTTP_STATUS.INTERNAL_SERVER_ERROR && !NON_CACHEABLE.has(status);

const replay = (res: Response, stored: StoredResponse) => {
  res
    .status(stored.status)
    .set(stored.headers)
    .set(HTTP_HEADERS.IDEMPOTENT_REPLAYED, REPLAYED)
    .end(Buffer.from(stored.body, 'base64'));
};

const completed = (
  record: IdempotencyRecord,
): record is Extract<IdempotencyRecord, { state: 'completed' }> => record.state === 'completed';

export const createIdempotent = ({
  enabled,
  store,
  policies,
  prefix,
  maxBodyBytes,
  onStoreError,
  log,
}: IdempotentConfig) => {
  const handler = (input: PolicyName | IdempotentOptions): RequestHandler => {
    const options: IdempotentOptions = typeof input === 'string' ? { policy: input } : input;
    const policy = policies.get(options.policy);
    if (!enabled) return (_req, _res, next) => next();

    const scope = options.scope ?? scopes.user;

    return async (req, res, next) => {
      if (!policy.methods.includes(req.method)) return next();

      const raw = req.get(HTTP_HEADERS.IDEMPOTENCY_KEY);
      if (!raw) {
        if (policy.required)
          throw new BadRequestError(
            'Idempotency-Key header is required',
            ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED,
          );
        return next();
      }
      if (!REGEX.IDEMPOTENCY_KEY.test(raw))
        throw new BadRequestError('Invalid Idempotency-Key', ERROR_CODES.IDEMPOTENCY_KEY_INVALID);

      const storageKey = concatenateStrings(
        [prefix, options.policy, scope(req), fingerprint.key(raw)],
        ':',
      );
      const digest = fingerprint.of(req);
      const token = randomUUID();

      let result: AcquireResult;
      try {
        result = await store.acquire(
          storageKey,
          { state: 'in_progress', fingerprint: digest, token, startedAt: Date.now() },
          policy.lockTtlS * MS_PER_SECOND,
        );
      } catch (err) {
        log.error({ err, policy: options.policy }, 'idempotency store error');
        if (onStoreError === 'allow') return next();
        throw new ServiceUnavailableError('Idempotency is temporarily unavailable');
      }

      if (!result.acquired) {
        const { existing } = result;
        if (existing.fingerprint !== digest)
          throw new UnprocessableEntityError(
            'Idempotency-Key was reused with a different request',
            ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
          );
        if (!completed(existing)) {
          res.set(HTTP_HEADERS.RETRY_AFTER, '1');
          throw new ConflictError(
            'A request with this Idempotency-Key is already in progress',
            ERROR_CODES.IDEMPOTENCY_IN_PROGRESS,
          );
        }
        if (!existing.response) return next();
        replay(res, existing.response);
        return;
      }

      captureResponse(res, maxBodyBytes, (captured) => {
        const done =
          captured && isCacheable(captured.status)
            ? store.complete(
                storageKey,
                token,
                {
                  state: 'completed',
                  fingerprint: digest,
                  response: captured,
                  completedAt: Date.now(),
                },
                policy.ttlS * MS_PER_SECOND,
              )
            : store.release(storageKey, token);
        done.catch((err) => log.warn({ err }, 'idempotency finalize failed'));
      });

      next();
    };
  };

  return handler;
};

export type Idempotent = ReturnType<typeof createIdempotent>;
