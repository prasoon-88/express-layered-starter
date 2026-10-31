import { Router } from 'express';
import userRouter from './user.routes.ts';

const API_V1_ROUTER = Router();

API_V1_ROUTER.use('/user', userRouter);

export default API_V1_ROUTER;
