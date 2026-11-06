import express from 'express';
import { PATHS } from '#constants/path.constant';
import type { ReadinessCheck } from '#lib/health/index';
import { notFoundMiddleware } from '#middlewares/notFound.middleware';
import { errorHandlerMiddleware } from '#middlewares/errorHandler.middleware';
import { createRequestIdMiddleware } from '#middlewares/requestId.middleware';
import { createHttpLoggerMiddleware } from '#middlewares/httpLogger.middleware';
import { createCorsMiddleware } from '#middlewares/cors.middleware';
import { createSecurityHeadersMiddleware } from '#middlewares/securityHeaders.middleware';
import { createAuthorizeMiddleware } from '#middlewares/authorize.middleware';
import { createRequestTimeoutMiddleware } from '#middlewares/requestTimeout.middleware';
import type { Env } from '#constants/env/schema';
import type { RateLimiter } from '#rateLimiter';
import type { Idempotency } from '#idempotency';
import type { Redis } from '#lib/redis/index';
import { createContainer } from '#http/container';
import { mount } from '#http/mount';
import { defineGroup } from '#http/routes';
import { builtInStrategies } from '#http/strategies';
import { apiModules, apiV1Modules, pageModules, probeModules } from '#modules/index';
import { apiRoutes } from '#routes/api/index';
import { apiV1Routes } from '#routes/api/v1/index';

declare module '#http/registry' {
  interface Registry {
    env: Env;
    limit: Awaited<RateLimiter>['limit'];
    idempotent: Awaited<Idempotency>['idempotent'];
    readinessChecks: readonly ReadinessCheck[];
    /** Registered only when server.ts opened a connection. */
    redis: Redis;
  }
}

export type AppConfig = {
  env: Env;
  rl: Pick<Awaited<RateLimiter>, 'limit'>;
  idempotency: Pick<Awaited<Idempotency>, 'idempotent'>;
  /** Dependencies `/health/ready` probes. Whoever creates a dependency passes its check in. */
  readinessChecks?: readonly ReadinessCheck[];
  /** The shared client, when a store is set to redis. A feature that needs it without it stops the boot. */
  redis?: Redis;
};

export const createApp = ({ env, rl, idempotency, readinessChecks = [], redis }: AppConfig) => {
  const container = createContainer();
  container.provide('env', () => env);
  if (redis) container.provide('redis', () => redis);
  container.provide('limit', () => rl.limit);
  container.provide('idempotent', () => idempotency.idempotent);
  container.provide('readinessChecks', () => readinessChecks);
  container.provide('authorize', () => createAuthorizeMiddleware);

  // Health sits outside the group that carries the global limit and the request timeout,
  // because probes must answer whatever those two are doing.
  const { router, manifest } = mount({
    container,
    strategies: builtInStrategies,
    root: defineGroup('/', [
      ...probeModules,
      defineGroup('/', [...pageModules, apiRoutes([...apiModules, apiV1Routes(apiV1Modules)])], {
        use: [rl.limit('global'), createRequestTimeoutMiddleware(env.REQUEST_HANDLER_TIMEOUT_MS)],
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
  app.use(createSecurityHeadersMiddleware());
  app.use(createRequestIdMiddleware());
  app.use(createHttpLoggerMiddleware());
  if (env.CORS_ENABLED) app.use(createCorsMiddleware()); // before auth, rate limiting, and routes
  app.use(express.static(PATHS.PUBLIC.path));

  // Routes
  app.use(router);

  // Post Middlewares
  app.use(notFoundMiddleware);
  app.use(errorHandlerMiddleware);

  return { app, routes: manifest };
};
