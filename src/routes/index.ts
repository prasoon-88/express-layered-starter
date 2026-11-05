import { Router } from 'express';
import type { HealthController } from '#controllers/health/index';
import WEB_ROUTER from './web/index.ts';
import API_ROUTER from './api/index.ts';
import { createHealthRouter } from './health/index.ts';

export type RoutesConfig = {
  health: HealthController;
};

export const createRoutes = ({ health }: RoutesConfig) => {
  const routes = Router();

  routes.use('/health', createHealthRouter(health));
  routes.use('/', WEB_ROUTER);
  routes.use('/api', API_ROUTER);

  return routes;
};
