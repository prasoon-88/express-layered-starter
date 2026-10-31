import { Router, json } from 'express';
import API_V1_ROUTER from './v1/index.js';

const API_ROUTER = Router();

API_ROUTER.use(json());

API_ROUTER.use('/v1', API_V1_ROUTER);

export default API_ROUTER;
