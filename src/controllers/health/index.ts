import type { RequestHandler } from 'express';
import { apiResponse } from '#utils/apiResponse.util';
import lifecycleState from '#lib/lifecycle/state';
import { ServiceUnavailableError } from '#errors';

const live: RequestHandler = (req, res) => apiResponse.ok(res, { status: 'ok' });

const ready: RequestHandler = (req, res) => {
  if (lifecycleState.isShuttingDown()) {
    throw new ServiceUnavailableError('shutting_down');
  }
  return apiResponse.ok(res, { status: 'ok' });
};

export const healthController = {
  ready,
  live,
};
