import { corsConfig } from '#config/cors.config';
import cors from 'cors';

const corsMiddleware = () => cors(corsConfig);

export default corsMiddleware;
