import { Router, json, type RequestHandler } from 'express';
import { createApiV1Router } from './v1/index.ts';

export const createApiRouter = (deps: { authLimit: RequestHandler }) => {
  const router = Router();

  router.use(json());
  router.use('/v1', createApiV1Router(deps));

  return router;
};
