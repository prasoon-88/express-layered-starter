import ENV_CONSTANTS from '#constants/env/index';

const isProd = ENV_CONSTANTS.NODE_ENV === 'production';

export const loggerConfig = Object.freeze({
  env: ENV_CONSTANTS.NODE_ENV,
  service: ENV_CONSTANTS.SERVICE_NAME,
  level: ENV_CONSTANTS.LOG_LEVEL,
  pretty: ENV_CONSTANTS.LOG_PRETTY || !isProd,
  redactPaths: [
    'password',
    '*.password',
    'passwordConfirm',
    '*.passwordConfirm',
    'token',
    '*.token',
    'accessToken',
    '*.accessToken',
    'refreshToken',
    '*.refreshToken',
    'authorization',
    '*.authorization',
    'cookie',
    '*.cookie',
    'req.headers.authorization',
    'req.headers.cookie',
  ],
  sensor: '[REDACTED]',
  ignorePaths: ENV_CONSTANTS.LOG_IGNORE_PATHS,
  slowRequestMs: ENV_CONSTANTS.LOG_SLOW_MS,
});
