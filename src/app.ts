import express from 'express';
import helmet from 'helmet';
import PATHS from '#constants/path.constant';
import ROUTES from '#routes/index';
import notFoundMiddleware from '#middlewares/notFound.middleware';
import errorHandlerMiddleware from '#middlewares/error.middleware';
import requestIdMiddleware from '#middlewares/requestId.middleware';
import httpLoggerMiddleware from '#middlewares/httpLogger.middleware';
import corsMiddleware from '#middlewares/cors.middleware';
import type { Env } from '#constants/env/schema';
import type { RateLimiter } from '#rateLimiter';

export type AppConfig = {
  env: Env;
  rl: Awaited<RateLimiter>;
};

export const createApp = ({ env, rl }: AppConfig) => {
  const app = express();

  // Application settings config
  app.set('trust proxy', env.TRUST_PROXY);
  app.set('view engine', 'ejs');
  app.set('views', PATHS.VIEWS.path);

  // Pre Middlewares
  app.use(helmet());
  app.use(requestIdMiddleware());
  app.use(httpLoggerMiddleware());
  if (env.CORS_ENABLED) app.use(corsMiddleware()); // before auth, rate limiting, and routes
  app.use(rl.limit('global'));
  app.use(express.static(PATHS.PUBLIC.path));

  // Routes
  app.use('/', ROUTES);

  // Post Middlewares
  app.use(notFoundMiddleware);
  app.use(errorHandlerMiddleware);

  return app;
};
