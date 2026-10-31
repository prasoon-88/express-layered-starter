import { Router } from 'express';
import WEB_ROUTER from './web/index.ts';
import API_ROUTER from './api/index.ts';
import HEALTH_ROUTER from './health/index.ts';

const ROUTES = Router();

ROUTES.use('/health', HEALTH_ROUTER);
ROUTES.use('/', WEB_ROUTER);
ROUTES.use('/api', API_ROUTER);

export default ROUTES;
