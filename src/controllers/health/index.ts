import type { RequestHandler } from 'express';
import { apiResponse } from '#utils/apiResponse.util';
import lifecycleState from '#lib/lifecycle/state';
import { runReadinessChecks, type ReadinessCheck } from '#lib/health/index';
import ERROR_CODES from '#constants/error/errorCodes.constant';
import { ServiceUnavailableError } from '#errors';

type HealthControllerConfig = {
  checks?: readonly ReadinessCheck[];
};

export const createHealthController = ({ checks = [] }: HealthControllerConfig = {}) => {
  // Liveness never looks at dependencies: restarting this process cannot fix a dead database.
  const live: RequestHandler = (_req, res) => apiResponse.ok(res, { status: 'ok' });

  const ready: RequestHandler = async (_req, res) => {
    if (lifecycleState.isShuttingDown()) {
      throw new ServiceUnavailableError('shutting_down');
    }

    const report = await runReadinessChecks(checks);
    const results = report.map(({ name, status }) => ({ name, status }));

    if (report.some(({ critical, status }) => critical && status === 'down')) {
      throw new ServiceUnavailableError(
        'dependency_unavailable',
        ERROR_CODES.SERVICE_UNAVAILABLE,
        results,
      );
    }

    const degraded = report.some(({ status }) => status === 'down');
    return apiResponse.ok(res, { status: degraded ? 'degraded' : 'ok', checks: results });
  };

  return { live, ready };
};

export type HealthController = ReturnType<typeof createHealthController>;
