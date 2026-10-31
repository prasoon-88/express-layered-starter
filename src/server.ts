import app from './app.ts';
import ENV_CONSTANTS from '#constants/env.constant';
import { getLogger } from '#lib/logger/index';
import { registerProcessHandler } from '#lib/lifecycle/index';

const logger = getLogger('server');

const server = app.listen(ENV_CONSTANTS.PORT, () => {
  logger.info({ port: ENV_CONSTANTS.PORT, env: ENV_CONSTANTS.ENV }, 'server started');
});

registerProcessHandler({
  server,
});
