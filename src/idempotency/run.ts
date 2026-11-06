import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { ConflictError } from '#errors';
import { ERROR_CODES } from '#constants/error/errorCodes.constant';
import { concatenateStrings } from '#utils/concatenateStrings.util';
import { fingerprint } from './fingerprint.ts';
import type { Policy } from './types.ts';
import type { IdempotencyStore } from './types.ts';
import { MS_PER_SECOND } from '#constants/time.constant';

export type RunResult<T> = { skipped: true } | { skipped: false; value: T };

export type Run = <T>(
  name: string,
  options: Pick<Policy, 'ttlS' | 'lockTtlS'>,
  work: () => Promise<T>,
) => Promise<RunResult<T>>;

type RunConfig = {
  store: IdempotencyStore;
  prefix: string;
  log: Logger;
};

export const createRun = ({ store, prefix, log }: RunConfig): Run => {
  const run: Run = async (name, options, work) => {
    const digest = fingerprint.key(name);
    const storageKey = concatenateStrings([prefix, 'run', digest], ':');
    const token = randomUUID();
    const result = await store.acquire(
      storageKey,
      { state: 'in_progress', fingerprint: digest, token, startedAt: Date.now() },
      options.lockTtlS * MS_PER_SECOND,
    );

    if (!result.acquired) {
      if (result.existing.state === 'completed') return { skipped: true };
      throw new ConflictError(
        'Idempotent work is already in progress',
        ERROR_CODES.IDEMPOTENCY_IN_PROGRESS,
      );
    }

    try {
      const value = await work();
      const saved = await store.complete(
        storageKey,
        token,
        { state: 'completed', fingerprint: digest, completedAt: Date.now() },
        options.ttlS * MS_PER_SECOND,
      );
      if (!saved) log.warn({ name }, 'idempotency complete rejected');
      return { skipped: false, value };
    } catch (err) {
      await store.release(storageKey, token).catch((releaseErr) => {
        log.warn({ err: releaseErr }, 'idempotency release failed');
      });
      throw err;
    }
  };

  return run;
};
