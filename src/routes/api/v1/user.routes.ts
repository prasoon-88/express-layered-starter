import { Router, type RequestHandler } from 'express';
import userController from '#controllers/api/v1/user.controller';

export const createUserRouter = ({ authLimit }: { authLimit: RequestHandler }) => {
  const userRouter = Router();

  // Credential endpoints get the strict `auth` policy, not just the global one.
  userRouter.post('/register', authLimit, userController.register);

  return userRouter;
};
