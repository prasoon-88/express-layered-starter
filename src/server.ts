import { createApp } from './app.ts';
import { initRateLimit } from '#rateLimiter';
import { getLogger } from '#lib/logger/index';
import ENV_CONSTANTS from '#constants/env/index';
import { createHttpServer } from '#lib/http/createHttpServer';
import { registerProcessHandler } from '#lib/lifecycle/index';

const logger = getLogger('server');
export const rateLimiter = await initRateLimit(ENV_CONSTANTS, logger);

const app = createApp({
  env: ENV_CONSTANTS,
  rl: rateLimiter,
  readinessChecks: rateLimiter.readinessChecks,
});

const server = createHttpServer({ app, env: ENV_CONSTANTS });

server.listen(ENV_CONSTANTS.PORT, () => {
  logger.info({ port: ENV_CONSTANTS.PORT, env: ENV_CONSTANTS.NODE_ENV }, 'server started');
});

registerProcessHandler({
  server,
  hooks: [() => rateLimiter.close()],
});
