import { Router, type RequestHandler } from 'express';
import { createUserRouter } from './user.routes.ts';

export const createApiV1Router = (deps: { authLimit: RequestHandler }) => {
  const router = Router();

  router.use('/user', createUserRouter(deps));

  return router;
};
