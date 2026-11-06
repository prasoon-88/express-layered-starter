import { READINESS_CHECK_TIMEOUT_MS } from '#constants/health.constant';
import { getLogger } from '#lib/logger/index';

const logger = getLogger('health');

export type ReadinessCheck = {
  name: string;
  /** `true`: while this is down the instance must not receive traffic. `false`: it is reported, nothing more. */
  critical: boolean;
  /** Resolves when the dependency answers; rejects (or never settles) when it cannot. */
  run: () => Promise<unknown>;
};

export type CheckReport = {
  name: string;
  critical: boolean;
  status: 'up' | 'down';
};

const withTimeout = async (work: Promise<unknown>, ms: number) => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms}ms`)), ms);
  });

  try {
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const runCheck = async (
  { name, critical, run }: ReadinessCheck,
  timeoutMs: number,
): Promise<CheckReport> => {
  try {
    await withTimeout(run(), timeoutMs);
    return { name, critical, status: 'up' };
  } catch (err) {
    // The reason is logged, never returned: a probe response must not leak connection details.
    logger.warn({ err, check: name, critical }, 'readiness check failed');
    return { name, critical, status: 'down' };
  }
};

export const runReadinessChecks = (
  checks: readonly ReadinessCheck[],
  { timeoutMs = READINESS_CHECK_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<CheckReport[]> => Promise.all(checks.map((check) => runCheck(check, timeoutMs)));
