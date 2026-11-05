import { Router, type RequestHandler } from 'express';
import WEB_ROUTER from './web/index.ts';
import { createApiRouter } from './api/index.ts';

export type RoutesConfig = {
  /** The strict `auth` rate limit, for credential endpoints. */
  authLimit: RequestHandler;
};

// Application routes only. Health is mounted by app.ts ahead of the rate limiter and the
// request timeout, because probes must answer whatever those two are doing.
export const createRoutes = ({ authLimit }: RoutesConfig) => {
  const routes = Router();

  routes.use('/', WEB_ROUTER);
  routes.use('/api', createApiRouter({ authLimit }));

  return routes;
};
