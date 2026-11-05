import express from 'express';
import PATHS from '#constants/path.constant';
import { createRoutes } from '#routes/index';
import { createHealthRouter } from '#routes/health/index';
import { createHealthController } from '#controllers/health/index';
import type { ReadinessCheck } from '#lib/health/index';
import notFoundMiddleware from '#middlewares/notFound.middleware';
import errorHandlerMiddleware from '#middlewares/error.middleware';
import requestIdMiddleware from '#middlewares/requestId.middleware';
import httpLoggerMiddleware from '#middlewares/httpLogger.middleware';
import corsMiddleware from '#middlewares/cors.middleware';
import securityHeadersMiddleware from '#middlewares/securityHeaders.middleware';
import type { Env } from '#constants/env/schema';
import type { RateLimiter } from '#rateLimiter';
import { requestTimeoutMiddleware } from '#middlewares/requestTimeout.middleware';

export type AppConfig = {
  env: Env;
  rl: Pick<Awaited<RateLimiter>, 'limit'>;
  /** Dependencies `/health/ready` probes. Whoever creates a dependency passes its check in. */
  readinessChecks?: readonly ReadinessCheck[];
};

export const createApp = ({ env, rl, readinessChecks = [] }: AppConfig) => {
  const app = express();

  // Application settings config
  app.set('trust proxy', env.TRUST_PROXY);
  app.set('view engine', 'ejs');
  app.set('views', PATHS.VIEWS.path);
  app.locals.appName = env.SERVICE_NAME; // shown in the navbar

  // Pre Middlewares
  app.use(securityHeadersMiddleware());
  app.use(requestIdMiddleware());
  app.use(httpLoggerMiddleware());
  if (env.CORS_ENABLED) app.use(corsMiddleware()); // before auth, rate limiting, and routes
  app.use(express.static(PATHS.PUBLIC.path));

  app.use('/health', createHealthRouter(createHealthController({ checks: readinessChecks })));

  app.use(rl.limit('global'));
  app.use(requestTimeoutMiddleware(env.REQUEST_HANDLER_TIMEOUT_MS));

  // Routes
  app.use('/', createRoutes({ authLimit: rl.limit('auth') }));

  // Post Middlewares
  app.use(notFoundMiddleware);
  app.use(errorHandlerMiddleware);

  return app;
};
