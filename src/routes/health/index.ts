import { Router } from 'express';
import HTTP_HEADERS from '#constants/http/httpHeaders.constant';
import type { HealthController } from '#controllers/health/index';

export const createHealthRouter = (healthController: HealthController) => {
  const healthRouter = Router();

  healthRouter.use((req, res, next) => {
    res.set(HTTP_HEADERS.CACHE_CONTROL, 'no-store');
    next();
  });

  healthRouter.get('/', healthController.ready);
  healthRouter.get('/ready', healthController.ready);
  healthRouter.get('/live', healthController.live);

  return healthRouter;
};
