import os from 'node:os';
import pino, { type DestinationStream, type LoggerOptions } from 'pino';
import { loggerConfig } from '#config/logger.config';
import requestContext from '#contexts/requestContext';

const buildOptions = ({ pretty }: { pretty: boolean }): LoggerOptions => ({
  level: loggerConfig.level,
  base: {
    service: loggerConfig.service,
    env: loggerConfig.env,
    pid: process.pid,
    hostname: os.hostname(),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: loggerConfig.redactPaths, censor: loggerConfig.sensor },

  // Adds the current request id to EVERY line, from any file, with no `req` passed around
  mixin: () => {
    const requestId = requestContext.getRequestId();
    return requestId ? { requestId } : {};
  },

  // JSON gets "info" instead of 30. The pretty printer needs the number.
  ...(!pretty && { formatters: { level: (label: string) => ({ level: label }) } }),
});

export const createLogger = (overrides: LoggerOptions = {}, destination?: DestinationStream) =>
  pino({ ...buildOptions({ pretty: false }), ...overrides }, destination);

const createDefaultLogger = async () => {
  if (loggerConfig.pretty) {
    try {
      const { createPrettyStream } = await import('./pretty.ts');
      return pino(buildOptions({ pretty: true }), await createPrettyStream());
    } catch {
      // pino-pretty is a dev dependency. If it is missing, fall back to JSON instead of crashing.
    }
  }
  return createLogger();
};

const logger = await createDefaultLogger();

// One logger per file: every line is tagged with where it came from.
export const getLogger = (module: string) => logger.child({ module });

export default logger;
