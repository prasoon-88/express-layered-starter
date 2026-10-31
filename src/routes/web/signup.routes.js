import { Router } from 'express';
import signupController from '#controllers/web/signup.controller.js';

const signupRouter = Router();

signupRouter.get('/', signupController.getSignup);

export default signupRouter;
