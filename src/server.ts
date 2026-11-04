import { createApp } from './app.ts';
import ENV_CONSTANTS from '#constants/env/index';
import { getLogger } from '#lib/logger/index';
import { registerProcessHandler } from '#lib/lifecycle/index';
import { initRateLimit } from '#rateLimiter';

const logger = getLogger('server');
export const rateLimiter = await initRateLimit(ENV_CONSTANTS, logger);

const app = createApp();

const server = app.listen(ENV_CONSTANTS.PORT, () => {
  logger.info({ port: ENV_CONSTANTS.PORT, env: ENV_CONSTANTS.NODE_ENV }, 'server started');
});

registerProcessHandler({
  server,
  rateLimiter,
});
