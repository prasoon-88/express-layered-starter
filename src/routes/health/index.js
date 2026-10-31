import { Router } from 'express';
import HTTP_HEADERS from '#constants/httpHeaders.constant.js';
import { healthController } from '#controllers/health/index.js';

const HEALTH_ROUTER = Router();

HEALTH_ROUTER.use((req, res, next) => {
  res.set(HTTP_HEADERS.CACHE_CONTROL, 'no-store');
  next();
});

HEALTH_ROUTER.get('/', healthController.ready);
HEALTH_ROUTER.get('/ready', healthController.ready);
HEALTH_ROUTER.get('/live', healthController.live);

export default HEALTH_ROUTER;
