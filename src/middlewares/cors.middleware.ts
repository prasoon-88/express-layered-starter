import { corsConfig } from '#config/cors.config';
import cors from 'cors';

export const createCorsMiddleware = () => cors(corsConfig);
