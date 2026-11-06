import express from 'express';
import PATHS from '#constants/path.constant';
import type { ReadinessCheck } from '#lib/health/index';
import notFoundMiddleware from '#middlewares/notFound.middleware';
import errorHandlerMiddleware from '#middlewares/error.middleware';
import requestIdMiddleware from '#middlewares/requestId.middleware';
import httpLoggerMiddleware from '#middlewares/httpLogger.middleware';
import corsMiddleware from '#middlewares/cors.middleware';
import securityHeadersMiddleware from '#middlewares/securityHeaders.middleware';
import { authorize } from '#middlewares/authorize.middleware';
import { requestTimeoutMiddleware } from '#middlewares/requestTimeout.middleware';
import type { Env } from '#constants/env/schema';
import type { RateLimiter } from '#rateLimiter';
import type { Idempotency } from '#idempotency';
import { createContainer } from '#http/container';
import { mount } from '#http/mount';
import { defineGroup } from '#http/routes';
import { builtInStrategies } from '#http/strategies';
import { apiV1Modules, pageModules, probeModules } from '#modules/index';
import { apiRoutes } from '#routes/api/index';
import { apiV1Routes } from '#routes/api/v1/index';

declare module '#http/registry' {
  interface Registry {
    env: Env;
    limit: Awaited<RateLimiter>['limit'];
    idempotent: Awaited<Idempotency>['idempotent'];
    readinessChecks: readonly ReadinessCheck[];
  }
}

export type AppConfig = {
  env: Env;
  rl: Pick<Awaited<RateLimiter>, 'limit'>;
  idempotency: Pick<Awaited<Idempotency>, 'idempotent'>;
  /** Dependencies `/health/ready` probes. Whoever creates a dependency passes its check in. */
  readinessChecks?: readonly ReadinessCheck[];
};

export const createApp = ({ env, rl, idempotency, readinessChecks = [] }: AppConfig) => {
  const container = createContainer();
  container.provide('env', () => env);
  container.provide('limit', () => rl.limit);
  container.provide('idempotent', () => idempotency.idempotent);
  container.provide('readinessChecks', () => readinessChecks);
  container.provide('authorize', () => authorize);

  // Health sits outside the group that carries the global limit and the request timeout,
  // because probes must answer whatever those two are doing.
  const { router, manifest } = mount({
    container,
    strategies: builtInStrategies,
    root: defineGroup('/', [
      ...probeModules,
      defineGroup('/', [...pageModules, apiRoutes([apiV1Routes(apiV1Modules)])], {
        use: [rl.limit('global'), requestTimeoutMiddleware(env.REQUEST_HANDLER_TIMEOUT_MS)],
      }),
    ]),
  });

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

  // Routes
  app.use(router);

  // Post Middlewares
  app.use(notFoundMiddleware);
  app.use(errorHandlerMiddleware);

  return { app, routes: manifest };
};
